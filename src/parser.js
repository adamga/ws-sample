import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { diffLines } from './diff.js';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isObject = (value) => value !== null && typeof value === 'object';
export const textOf = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (!value) return '';
  return textOf(value.value ?? value.text ?? value.content ?? '');
};
const uriOf = (value) => typeof value === 'string' ? value : value?.fsPath || value?.external || value?.path || '';
const resourceKey = (value) => typeof value === 'string' ? value : value?.external || value?.fsPath || value?.path || '';
const shortPath = (value) => {
  const uri = uriOf(value);
  try { return decodeURIComponent(uri).replace(/^file:\/+/, '').replace(/\//g, '\\'); }
  catch { return uri; }
};
const titleOf = (text, fallback) => (text || fallback).replace(/\s+/g, ' ').trim().slice(0, 130);

// Gathers string leaves breadth-first up to a character budget without serializing the whole value.
export function collectText(value, budget) {
  if (value === undefined || value === null) return '';
  const parts = [];
  const queue = [value];
  for (let index = 0; index < queue.length && budget > 0; index++) {
    const current = queue[index];
    if (typeof current === 'string') {
      const piece = current.length > budget ? current.slice(0, budget) : current;
      parts.push(piece);
      budget -= piece.length + 1;
    } else if (typeof current === 'number' || typeof current === 'boolean') {
      continue;
    } else if (current && typeof current === 'object') {
      if (queue.length > 200000) break;
      for (const child of Array.isArray(current) ? current : Object.values(current)) queue.push(child);
    }
  }
  return parts.join('\n');
}

function exceeds(value, limit) {
  let size = 0;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string') size += current.length + 2;
    else if (current && typeof current === 'object') {
      size += 2;
      for (const key in current) { size += key.length + 4; stack.push(current[key]); }
    } else size += 5;
    if (size > limit) return true;
  }
  return false;
}

// Large records are previewed rather than shipped whole to the browser.
export function boundedRaw(value, limit = 1_500_000) {
  if (!exceeds(value, limit)) return { value, truncated: false };
  let budget = limit;
  const prune = (current, depth) => {
    if (typeof current === 'string') {
      const text = current.length > 20000 ? `${current.slice(0, 20000)}… [${current.length - 20000} more characters not shown]` : current;
      budget -= text.length;
      return text;
    }
    budget -= 5;
    if (!current || typeof current !== 'object') return current;
    if (depth > 40) return '[nested too deeply to preview]';
    if (Array.isArray(current)) {
      const result = [];
      for (let index = 0; index < current.length; index++) {
        if (budget <= 0) { result.push(`… ${current.length - index} more items not shown`); break; }
        result.push(prune(current[index], depth + 1));
      }
      return result;
    }
    const result = {};
    const keys = Object.keys(current);
    for (let index = 0; index < keys.length; index++) {
      if (budget <= 0) { result['…'] = `${keys.length - index} more fields not shown`; break; }
      budget -= keys[index].length;
      result[keys[index]] = prune(current[keys[index]], depth + 1);
    }
    return result;
  };
  return { value: prune(value, 0), truncated: true };
}

// Splits on raw bytes so every record keeps its file offset; huge records can then be re-read lazily.
export async function readJsonLines(file, warnings = []) {
  const entries = [];
  let lineNumber = 0;
  let position = 0;
  let lineStart = 0;
  let pending = [];
  const handle = (buffer) => {
    lineNumber++;
    const start = lineStart;
    let end = buffer.length;
    if (end && buffer[end - 1] === 13) end--;
    try {
      let text = buffer.toString('utf8', 0, end);
      if (lineNumber === 1) text = text.replace(/^\uFEFF/, '');
      if (!text.trim()) return;
      entries.push({ value: JSON.parse(text), line: lineNumber, offset: start, length: end });
    } catch (error) {
      warnings.push(`${path.basename(file)}:${lineNumber}: invalid JSON (${error.message}). Record skipped; history may be incomplete.`);
    }
  };
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 })) {
    let index = 0;
    for (;;) {
      const newline = chunk.indexOf(10, index);
      if (newline < 0) { if (index < chunk.length) pending.push(chunk.subarray(index)); break; }
      const part = chunk.subarray(index, newline);
      handle(pending.length ? Buffer.concat([...pending, part]) : part);
      pending = [];
      lineStart = position + newline + 1;
      index = newline + 1;
    }
    position += chunk.length;
  }
  if (pending.length) handle(Buffer.concat(pending));
  return entries;
}

export async function readRecord(file, offset, length) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } finally { await handle.close(); }
}
export function replay(entries, warnings = [], { clone = true } = {}) {
  const copy = clone ? structuredClone : (value) => value;
  let state;
  for (const { value: entry, line } of entries) {
    try {
      if (entry.kind === 0) { state = copy(entry.v); continue; }
      if (!isObject(state)) throw new Error('Missing initial snapshot');
      if (![1, 2, 3].includes(entry.kind)) throw new Error(`Unknown mutation kind ${entry.kind}`);
      if (!Array.isArray(entry.k) || !entry.k.length || entry.k.some((key) =>
        !['string', 'number'].includes(typeof key) || unsafeKeys.has(String(key)) ||
        (typeof key === 'number' && (!Number.isSafeInteger(key) || key < 0)))) {
        throw new Error('Invalid mutation path');
      }
      let target = state;
      for (const key of entry.k.slice(0, -1)) {
        if (!Object.hasOwn(target, key) || !isObject(target[key])) throw new Error('Mutation parent is missing');
        target = target[key];
      }
      const key = entry.k.at(-1);
      if (entry.kind === 1) target[key] = copy(entry.v);
      else if (entry.kind === 3) delete target[key];
      else {
        const array = Object.hasOwn(target, key) ? target[key] : [];
        if (!Array.isArray(array)) throw new Error('Push target is not an array');
        if (entry.i !== undefined && (!Number.isSafeInteger(entry.i) || entry.i < 0 || entry.i > array.length)) {
          throw new Error('Invalid splice index');
        }
        if (entry.v !== undefined && !Array.isArray(entry.v)) throw new Error('Push value is not an array');
        if (entry.i !== undefined) array.length = entry.i;
        for (const value of entry.v || []) array.push(copy(value));
        target[key] = array;
      }
    } catch (error) { warnings.push(`Session line ${line}: ${error.message}. Mutation skipped; history may be incomplete.`); }
  }
  if (!isObject(state) || !Array.isArray(state.requests)) throw new Error('Not a VS Code session: no valid snapshot with a requests array.');
  return state;
}

async function optionalJson(file, warnings) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') warnings.push(`${path.basename(file)}: ${error.message}`);
    return null;
  }
}
async function optionalLines(file, warnings) {
  try { return await readJsonLines(file, warnings); }
  catch (error) {
    if (error.code !== 'ENOENT') warnings.push(`${path.basename(file)}: ${error.message}`);
    return [];
  }
}

async function optionalText(file, warnings) {
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') warnings.push(`${path.basename(file)}: ${error.message}`);
    return null;
  }
}

export function parseWorkspaceYaml(content) {
  if (!content || typeof content !== 'string') return null;
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawVal] = match;
    if (unsafeKeys.has(key)) continue;
    let value = rawVal.trim();
    if (value === '' || value === 'null' || value === '~') {
      result[key] = null;
    } else if (value === 'true' || value === 'false') {
      result[key] = value === 'true';
    } else if (/^-?\d+$/.test(value)) {
      result[key] = Number(value);
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      try { result[key] = JSON.parse(value); }
      catch {
        result[key] = value.slice(1, -1)
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      result[key] = value.slice(1, -1).replace(/''/g, "'");
    } else {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : null;
}

export async function discover(input) {
  const resolved = path.resolve(input);
  const info = await stat(resolved);
  if (info.isFile()) {
    const base = path.basename(resolved).toLowerCase();
    if (base === 'workspace.yaml') {
      const siblingEvents = path.join(path.dirname(resolved), 'events.jsonl');
      try {
        if ((await stat(siblingEvents)).isFile()) return [siblingEvents];
      } catch { /* missing events.jsonl */ }
      throw new Error('Selected workspace.yaml folder does not contain an events.jsonl transcript yet.');
    }
    if (/\.(jsonl|json)$/i.test(resolved)) return [resolved];
    if (base === 'state.vscdb') return discover(path.dirname(resolved));
    throw new Error('Choose a workspace storage folder, a .copilot/session-state folder, or a session .json/.jsonl/workspace.yaml file.');
  }
  const files = [];
  const skipDirs = new Set([
    'node_modules', '.git', 'GitHub.copilot-chat', 'chatEditingSessions', 'contents',
    '.session-operation-locks', 'checkpoints', 'files', 'research', 'attachments'
  ]);
  async function visit(dir, depth) {
    const children = await readdir(dir, { withFileTypes: true });
    // Agent Host / Copilot CLI session folder containing events.jsonl
    const eventsEntry = children.find((entry) => entry.isFile() && entry.name.toLowerCase() === 'events.jsonl');
    if (eventsEntry) {
      files.push(path.join(dir, eventsEntry.name));
      return;
    }
    const isSessions = ['chatsessions', 'emptywindowchatsessions', 'transferredchatsessions'].includes(path.basename(dir).toLowerCase());
    if (isSessions) {
      const candidates = children.filter((entry) => entry.isFile() && /\.(jsonl|json)$/i.test(entry.name));
      for (const entry of candidates) {
        if (entry.name.endsWith('.json') && candidates.some((other) => other.name === entry.name + 'l')) continue;
        files.push(path.join(dir, entry.name));
      }
    }
    if (depth < 4) {
      for (const entry of children) {
        if (entry.isDirectory() && !skipDirs.has(entry.name)) {
          await visit(path.join(dir, entry.name), depth + 1);
        }
      }
    }
  }
  await visit(resolved, 0);
  if (!files.length) throw new Error('No persisted sessions found. Select a workspaceStorage folder, a .copilot\\session-state folder, or a session file directly.');
  return files;
}

export function applyTextEdits(content, edits) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  function offset(line, column) {
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
      throw new Error('Invalid edit range');
    }
    // VS Code clamps full-document replacement ranges that extend past EOF.
    if (line > starts.length) return content.length;
    const start = starts[line - 1];
    let end = line < starts.length ? starts[line] - 1 : content.length;
    if (content[end - 1] === '\r') end--;
    return Math.min(start + column - 1, end);
  }
  const changes = edits.map((edit) => ({
    start: offset(edit.range.startLineNumber, edit.range.startColumn),
    end: offset(edit.range.endLineNumber, edit.range.endColumn), text: edit.text ?? ''
  })).sort((a, b) => b.start - a.start || b.end - a.end);
  let boundary = content.length;
  for (const change of changes) {
    if (change.end < change.start || change.end > boundary) throw new Error('Overlapping or reversed edit range');
    content = content.slice(0, change.start) + change.text + content.slice(change.end);
    boundary = change.start;
  }
  return content;
}

export const sessionKey = (file) => createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 20);

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  return value;
}

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

async function loadAgentHostSession(file, entries, warnings) {
  const id = sessionKey(file);
  const sessionDir = path.dirname(file);
  const [yamlText, vscodeMeta, planText] = await Promise.all([
    optionalText(path.join(sessionDir, 'workspace.yaml'), warnings),
    optionalJson(path.join(sessionDir, 'vscode.metadata.json'), warnings),
    optionalText(path.join(sessionDir, 'plan.md'), warnings)
  ]);
  const yaml = parseWorkspaceYaml(yamlText);

  let checkpointFiles = [];
  try {
    const cpEntries = await readdir(path.join(sessionDir, 'checkpoints'), { withFileTypes: true });
    const mdFiles = cpEntries.filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name).sort();
    checkpointFiles = (await Promise.all(mdFiles.map(async (name) => {
      const content = await optionalText(path.join(sessionDir, 'checkpoints', name), warnings);
      if (!content || (name.toLowerCase() === 'index.md' && !/\|\s*\d+\s*\|/.test(content))) return null;
      return { name, content };
    }))).filter(Boolean);
  } catch { /* no checkpoints folder */ }

  const startEntry = entries.find((e) => e.value?.type === 'session.start');
  const startData = startEntry?.value?.data || {};
  const sessionId = String(yaml?.id || startData.sessionId || path.basename(sessionDir));
  const clientName = String(yaml?.last_client_name || yaml?.client_name || startData.producer || 'copilot-agent');

  const nodes = new Map();
  let sequence = 0;
  function node(kind, title, raw, extra = {}) {
    const value = { id: `${id}-${sequence++}`, kind, title, source: 'events.jsonl', children: [], raw, ...extra };
    nodes.set(value.id, value);
    return value;
  }

  const overview = node('overview', 'Untitled agent session', {
    sessionId,
    format: 'copilot-session-state',
    clientName,
    workspace: yaml || null
  }, { source: path.basename(file) });

  const requests = [];
  const modelTimeline = [];
  let currentModel = startData.selectedModel || 'Not recorded';
  let currentConfig = cleanObject({
    reasoningEffort: startData.reasoningEffort,
    contextTier: startData.contextTier
  });
  let previousTimelineModel;
  let currentRequest = null;
  let lastResponseText = '';
  let editCount = 0;
  let firstEventTs;
  let lastEventTs;

  const pendingToolMeta = new Map();
  const openTools = new Map();
  const editGroups = new Map();

  function recordModelIfChanged(ownerRequest, model, config, timestamp) {
    const resolved = model || 'Not recorded';
    if (resolved === previousTimelineModel) return;
    const change = {
      from: previousTimelineModel || null,
      to: resolved,
      timestamp,
      prompt: ownerRequest.index,
      configuration: config
    };
    modelTimeline.push(change);
    ownerRequest.children.push(node(
      'model',
      previousTimelineModel ? `Model changed: ${previousTimelineModel} → ${resolved}` : `Model selected: ${resolved}`,
      change,
      { model: resolved, timestamp }
    ));
    previousTimelineModel = resolved;
  }

  for (const { value: event, line } of entries) {
    if (!isObject(event) || typeof event.type !== 'string') {
      warnings.push(`events.jsonl:${line}: skipped record without an event type.`);
      continue;
    }
    // Avoid retaining inline multi-megabyte binary blobs in memory; rawRef reads from disk on demand.
    if (event.type === 'session.binary_asset' && isObject(event.data) && typeof event.data.data === 'string' && event.data.data.length > 1024) {
      event.data = { ...event.data, data: `[${event.data.byteLength || event.data.data.length} bytes omitted in memory; inspect record to load]` };
    }

    const data = isObject(event.data) ? event.data : {};
    const ts = toEpochMs(event.timestamp || event.ts);
    if (ts !== undefined) {
      if (firstEventTs === undefined || ts < firstEventTs) firstEventTs = ts;
      if (lastEventTs === undefined || ts > lastEventTs) lastEventTs = ts;
    }

    if (event.type === 'session.start' || event.type === 'session.resume') {
      if (data.selectedModel) currentModel = data.selectedModel;
      const nextCfg = cleanObject({ reasoningEffort: data.reasoningEffort, contextTier: data.contextTier });
      if (nextCfg) currentConfig = nextCfg;
      continue;
    }

    if (event.type === 'session.model_change') {
      if (data.newModel) currentModel = data.newModel;
      currentConfig = cleanObject({
        reasoningEffort: data.reasoningEffort,
        contextTier: data.contextTier,
        source: data.source
      }) || currentConfig;
      if (currentRequest) recordModelIfChanged(currentRequest, currentModel, currentConfig, ts);
      continue;
    }

    if (event.type === 'user.message') {
      const promptText = textOf(data.content) || textOf(data.transformedContent) || '(Empty prompt)';
      const promptIndex = requests.length + 1;
      const promptRaw = {
        requestId: data.interactionId || data.messageId || event.id,
        messageId: data.messageId,
        turnId: data.turnId,
        timestamp: ts,
        modelId: currentModel,
        modelConfiguration: currentConfig,
        agent: { name: clientName, fullName: clientName },
        modeInfo: data.agentMode ? { name: data.agentMode } : undefined,
        delivery: data.delivery
      };
      currentRequest = node('prompt', titleOf(promptText, 'User prompt'), promptRaw, {
        text: promptText,
        timestamp: ts,
        model: currentModel,
        index: promptIndex,
        hidden: false,
        requestId: promptRaw.requestId
      });
      requests.push(currentRequest);
      lastResponseText = '';
      recordModelIfChanged(currentRequest, currentModel, currentConfig, ts);
      continue;
    }

    if (event.type === 'assistant.message') {
      if (data.model && data.model !== currentModel) {
        currentModel = data.model;
        if (currentRequest) recordModelIfChanged(currentRequest, currentModel, currentConfig, ts);
      }
      for (const tr of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
        if (tr?.toolCallId) {
          pendingToolMeta.set(tr.toolCallId, {
            ...tr,
            arguments: parseMaybeJson(tr.arguments),
            model: data.model || currentModel
          });
        }
      }
      if (!currentRequest) continue;

      const rText = typeof data.reasoningText === 'string' ? data.reasoningText : '';
      if (rText.trim() || data.reasoningOpaque) {
        currentRequest.children.push(node(
          'reasoning',
          rText.trim() ? titleOf(rText, 'Reasoning') : 'Reasoning · text not persisted',
          { reasoningText: rText, hasOpaque: Boolean(data.reasoningOpaque), messageId: data.messageId, turnId: data.turnId },
          { text: rText, available: Boolean(rText.trim()), model: data.model || currentModel, timestamp: ts }
        ));
      }

      const contentText = textOf(data.content);
      if (contentText.trim()) {
        currentRequest.children.push(node(
          'response',
          titleOf(contentText, 'Assistant response'),
          data,
          { text: contentText, available: true, model: data.model || currentModel, timestamp: ts }
        ));
        lastResponseText = contentText.trim();
      }
      continue;
    }

    if (event.type === 'tool.execution_start') {
      if (!currentRequest) continue;
      const reqMeta = pendingToolMeta.get(data.toolCallId);
      const args = parseMaybeJson(data.arguments ?? reqMeta?.arguments);
      const toolName = data.toolName || reqMeta?.name || 'tool';
      const toolModel = data.model || reqMeta?.model || currentModel;
      const label = reqMeta?.toolTitle || data.toolTitle || reqMeta?.intentionSummary ||
        (typeof args?.description === 'string' ? args.description : '') || toolName;
      const cmd = typeof args?.command === 'string' ? args.command : null;
      const specific = {};
      if (cmd) {
        specific.language = /powershell|pwsh/i.test(toolName) ? 'pwsh' : 'bash';
        specific.commandLine = { original: cmd };
      }
      if (toolName === 'task') {
        specific.kind = 'subagent';
        specific.prompt = args?.prompt;
        if (args?.agent_type) specific.agentType = args.agent_type;
        if (args?.model) specific.modelName = args.model;
      }
      const rawTool = {
        toolId: toolName,
        toolCallId: data.toolCallId,
        invocationMessage: reqMeta?.intentionSummary || label,
        isComplete: false,
        startedAt: ts,
        source: { label: clientName },
        toolSpecificData: specific
      };
      const toolNode = node('tool', titleOf(label, toolName), rawTool, {
        timestamp: ts,
        duration: null,
        toolName,
        arguments: args,
        model: specific.modelName || toolModel,
        failed: false,
        hidden: false
      });
      currentRequest.children.push(toolNode);
      if (data.toolCallId) {
        openTools.set(data.toolCallId, { node: toolNode, startTs: ts, owner: currentRequest });
      }
      continue;
    }

    if (event.type === 'tool.execution_complete') {
      const open = data.toolCallId ? openTools.get(data.toolCallId) : null;
      const owner = open?.owner || currentRequest;
      if (!owner) continue;

      const parsedResult = parseMaybeJson(data.result);
      let outputText = '';
      if (typeof parsedResult === 'string') outputText = parsedResult;
      else if (isObject(parsedResult)) {
        outputText = typeof parsedResult.content === 'string'
          ? parsedResult.content
          : typeof parsedResult.output === 'string'
            ? parsedResult.output
            : textOf(parsedResult);
      }

      let toolNode = open?.node;
      if (!toolNode) {
        const reqMeta = data.toolCallId ? pendingToolMeta.get(data.toolCallId) : null;
        const toolName = reqMeta?.name || data.toolTelemetry?.properties?.command || 'tool';
        toolNode = node('tool', titleOf(reqMeta?.toolTitle || toolName, 'Tool call'), {
          toolId: toolName,
          toolCallId: data.toolCallId,
          isComplete: true,
          source: { label: clientName },
          toolSpecificData: {}
        }, {
          timestamp: ts,
          duration: null,
          toolName,
          arguments: reqMeta?.arguments,
          model: data.model || currentModel,
          failed: false,
          hidden: false
        });
        owner.children.push(toolNode);
      }

      const failed = data.success === false || Boolean(data.error);
      toolNode.failed = failed;
      toolNode.duration = open?.startTs && ts ? Math.max(0, ts - open.startTs) : null;
      toolNode.raw.isComplete = true;
      toolNode.raw.completedAt = ts;
      if (data.shellExecution) Object.assign(toolNode.raw.toolSpecificData, data.shellExecution);
      if (toolNode.raw.toolSpecificData?.kind === 'subagent' && outputText) {
        toolNode.raw.toolSpecificData.result = outputText;
      }
      toolNode.raw.resultDetails = {
        isError: failed,
        ...(outputText ? { output: [{ isText: true, value: outputText }] } : {}),
        ...(isObject(parsedResult) && parsedResult.structuredContent ? { structuredContent: parsedResult.structuredContent } : {}),
        ...(data.error ? { error: data.error } : {})
      };
      toolNode.children.push(node('event', `tool.execution_complete · ${toolNode.toolName}`, event, {
        line, timestamp: ts, text: outputText
      }));

      // Reconstruct file edit diffs from edit/create tool arguments
      const args = toolNode.arguments;
      if (!failed && (toolNode.toolName === 'edit' || toolNode.toolName === 'create') && typeof args?.path === 'string') {
        const filePath = shortPath(args.path);
        const before = toolNode.toolName === 'create' ? '' : (typeof args.old_str === 'string' ? args.old_str : undefined);
        const after = toolNode.toolName === 'create'
          ? (typeof args.file_text === 'string' ? args.file_text : '')
          : (typeof args.new_str === 'string' ? args.new_str : undefined);
        if (!editGroups.has(owner.id)) {
          const group = node('group', 'File edit history', {
            description: 'File create and edit operations recorded in the Copilot Agent tool stream.'
          }, { source: 'Edit timeline' });
          owner.children.push(group);
          editGroups.set(owner.id, group);
        }
        editCount++;
        editGroups.get(owner.id).children.push(node(
          'edit',
          `${toolNode.toolName} · ${filePath.split('\\').at(-1)}`,
          { type: toolNode.toolName, path: filePath, arguments: args },
          { source: 'Edit timeline', file: filePath, before, after, epoch: editCount, model: toolNode.model, timestamp: ts }
        ));
      }

      // Surface task_complete summary as readable turn response when distinct
      if (toolNode.toolName === 'task_complete' && typeof args?.summary === 'string' && args.summary.trim() && args.summary.trim() !== lastResponseText) {
        owner.children.push(node(
          'response',
          titleOf(args.summary, 'Task completion summary'),
          { summary: args.summary, source: 'task_complete' },
          { text: args.summary, available: true, model: toolNode.model, timestamp: ts }
        ));
        lastResponseText = args.summary.trim();
      }
      continue;
    }

    if (event.type === 'session.task_complete' && currentRequest) {
      const summaryText = typeof data.summary === 'string' ? data.summary.trim() : '';
      if (summaryText && summaryText !== lastResponseText) {
        currentRequest.children.push(node(
          'response',
          titleOf(summaryText, 'Task completion summary'),
          data,
          { text: summaryText, available: true, model: currentModel, timestamp: ts }
        ));
        lastResponseText = summaryText;
      }
      continue;
    }

    if ((event.type === 'session.error' || event.type === 'model.turn_failed' || event.type === 'abort') && currentRequest) {
      currentRequest.children.push(node(
        'event',
        `${event.type}${data.message ? ` · ${titleOf(String(data.message), '')}` : ''}`,
        event,
        { line, timestamp: ts, text: textOf(data.message || data.reason || ''), failed: event.type !== 'abort' }
      ));
    }
  }

  overview.title = titleOf(yaml?.summary || yaml?.name || '', requests[0]?.title || 'Untitled agent session');

  if (planText?.trim()) {
    overview.children.push(node('response', 'Session plan (plan.md)', { file: 'plan.md', content: planText }, {
      source: 'plan.md', text: planText, available: true
    }));
  }
  if (checkpointFiles.length) {
    const cpGroup = node('group', 'Session checkpoints', {
      description: 'Checkpoint handoff summaries persisted alongside the Copilot Agent session.'
    }, { source: 'checkpoints' });
    for (const cp of checkpointFiles) {
      cpGroup.children.push(node('response', `Checkpoint · ${cp.name}`, cp, {
        source: `checkpoints/${cp.name}`, text: cp.content, available: true
      }));
    }
    overview.children.push(cpGroup);
  }
  if (yaml) overview.children.push(node('context', 'Workspace & session metadata', yaml, { source: 'workspace.yaml' }));
  if (vscodeMeta) overview.children.push(node('context', 'VS Code Agent Host metadata', vscodeMeta, { source: 'vscode.metadata.json' }));

  if (entries.length) {
    const eventGroup = node('group', 'Agent event stream', {
      description: 'Original append-only events from events.jsonl. Open any event to load its full persisted JSON record from disk.'
    }, { source: 'events.jsonl' });
    for (const { value, line, offset, length } of entries) {
      const eventType = value?.type || 'unknown';
      const detailLabel = value?.data?.toolName ? ` · ${value.data.toolName}` : '';
      eventGroup.children.push(node(
        'event',
        `Line ${line} · ${eventType}${detailLabel}`,
        { type: eventType, id: value?.id, timestamp: value?.timestamp, recordBytes: length, note: 'Open this record to load it from events.jsonl.' },
        { line, source: 'events.jsonl', timestamp: toEpochMs(value?.timestamp), rawRef: { offset, length } }
      ));
    }
    overview.children.push(eventGroup);
  }

  const allNodes = [...nodes.values()];
  const stats = {
    prompts: requests.length,
    responses: allNodes.filter((item) => item.kind === 'response' && item.source === 'events.jsonl').length,
    tools: allNodes.filter((item) => item.kind === 'tool').length,
    reasoning: allNodes.filter((item) => item.kind === 'reasoning').length,
    edits: editCount,
    events: entries.length,
    models: new Set(modelTimeline.map((item) => item.to)).size
  };

  for (const item of allNodes) {
    const deep = !['overview', 'group', 'prompt'].includes(item.kind) && !item.rawRef;
    item.searchText = `${item.title}\n${item.text || ''}\n${deep ? collectText(item.raw, 20000) : ''}\n${collectText(item.arguments, 8000)}`.toLowerCase();
  }

  const rawWsPath = String(
    vscodeMeta?.worktreeProperties?.repositoryPath ||
    yaml?.cwd ||
    yaml?.git_root ||
    startData.context?.cwd ||
    startData.context?.gitRoot ||
    ''
  ).trim();
  const workspacePath = rawWsPath ? shortPath(rawWsPath) : '';
  const repoFallback = typeof yaml?.repository === 'string' ? yaml.repository.split('/').at(-1) : '';
  const workspaceName = workspacePath
    ? workspacePath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1).replace(/\.code-workspace$/i, '')
    : repoFallback;

  const createdAt = toEpochMs(yaml?.created_at || startData.startTime) ?? firstEventTs;
  const updatedAt = toEpochMs(yaml?.updated_at);
  const lastAt = Math.max(lastEventTs || 0, updatedAt || 0) || createdAt;

  const exportedRaw = {
    format: 'copilot-session-state',
    sessionId,
    title: overview.title,
    clientName,
    workspace: yaml || null,
    vscodeMetadata: vscodeMeta || null,
    requests: requests.map((req) => ({
      index: req.index,
      timestamp: req.timestamp,
      model: req.model,
      prompt: req.text
    }))
  };

  return {
    id,
    sessionId,
    sessionFormat: 'agent-host',
    clientName,
    title: overview.title,
    file,
    createdAt,
    workspace: workspacePath,
    workspacePath,
    workspaceName,
    lastAt,
    firstPrompt: requests[0]?.title || '',
    size: (await stat(file)).size,
    stats,
    warnings,
    modelTimeline,
    overview,
    requests,
    nodes,
    raw: exportedRaw,
    sources: {
      session: 'events.jsonl',
      transcript: entries.length,
      debug: 0,
      editing: editCount > 0,
      models: modelTimeline.length > 0,
      workspaceYaml: Boolean(yaml),
      checkpoints: checkpointFiles.length
    }
  };
}

export async function loadSession(file) {
  const warnings = [];
  const entries = file.endsWith('.jsonl') ? await readJsonLines(file, warnings) : [];
  const isAgentEventStream = file.endsWith('.jsonl') && (
    path.basename(file).toLowerCase() === 'events.jsonl' ||
    (entries.length > 0 && entries[0].value?.kind === undefined && typeof entries[0].value?.type === 'string')
  );
  if (isAgentEventStream) {
    return loadAgentHostSession(file, entries, warnings);
  }
  const session = file.endsWith('.jsonl') ? replay(entries, warnings, { clone: false }) : JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(session.requests)) throw new Error('Session has no requests array.');
  const id = sessionKey(file);
  const sessionId = session.sessionId || path.basename(file).replace(/\.(jsonl|json)$/, '');
  const root = path.basename(path.dirname(file)).toLowerCase() === 'chatsessions' ? path.dirname(path.dirname(file)) : path.dirname(file);
  const copilot = path.join(root, 'GitHub.copilot-chat');
  const editRoot = path.join(root, 'chatEditingSessions', sessionId);
  // Only session IDs that are safe as a directory component may resolve sidecars.
  const safeId = /^[a-zA-Z0-9_-]+$/.test(sessionId);
  const [transcript, debug, editing, models, workspace] = await Promise.all([
    safeId ? optionalLines(path.join(copilot, 'transcripts', sessionId + '.jsonl'), warnings) : [],
    safeId ? optionalLines(path.join(copilot, 'debug-logs', sessionId, 'main.jsonl'), warnings) : [],
    safeId ? optionalJson(path.join(editRoot, 'state.json'), warnings) : null,
    safeId ? optionalJson(path.join(copilot, 'debug-logs', sessionId, 'models.json'), warnings) : null,
    optionalJson(path.join(root, 'workspace.json'), warnings)
  ]);
  const nodes = new Map();
  let sequence = 0;
  function node(kind, title, raw, extra = {}) {
    const value = { id: `${id}-${sequence++}`, kind, title, source: 'chatSessions', children: [], raw, ...extra };
    nodes.set(value.id, value);
    return value;
  }
  const overview = node('overview', session.customTitle || session.title || 'Untitled session', session, { source: path.basename(file) });
  const requests = [];
  const tools = new Map();
  const modelTimeline = [];
  let previousModel;
  for (const [index, request] of session.requests.entries()) {
    const prompt = textOf(request.message) || '(Empty prompt)';
    const parent = node('prompt', titleOf(prompt, 'User prompt'), request, {
      text: prompt, timestamp: request.timestamp, model: request.modelId || 'Not recorded', index: index + 1,
      hidden: !!request.hiddenFromTranscript, requestId: request.requestId
    });
    requests.push(parent);
    const model = request.modelId || 'Not recorded';
    if (model !== previousModel) {
      const change = { from: previousModel || null, to: model, timestamp: request.timestamp, prompt: index + 1, configuration: request.modelConfiguration };
      modelTimeline.push(change);
      parent.children.push(node('model', previousModel ? `Model changed: ${previousModel} → ${model}` : `Model selected: ${model}`, change, { model, timestamp: request.timestamp }));
      previousModel = model;
    }
    let pending = [];
    let pendingKind;
    function flush() {
      if (!pending.length) return;
      const raw = pending;
      const text = raw.map((part) => part.kind === 'inlineReference' ? `[${part.name || shortPath(part.inlineReference)}]` : textOf(part)).join('');
      const reasoning = pendingKind === 'reasoning';
      parent.children.push(node(pendingKind, reasoning ? (text.trim() ? titleOf(text, 'Reasoning') : 'Reasoning · text not persisted') : titleOf(text, 'Assistant response'), raw, { text, available: !!text.trim(), model }));
      pending = [];
    }
    for (const part of request.response || []) {
      const kind = part.kind;
      if (!kind || ['markdownContent', 'markdown', 'thinking', 'inlineReference'].includes(kind)) {
        const nextKind = kind === 'thinking' ? 'reasoning' : 'response';
        if (pendingKind !== nextKind) flush();
        pendingKind = nextKind;
        pending.push(part);
        continue;
      }
      flush();
      if (kind === 'toolInvocationSerialized' || kind === 'toolInvocation') {
        const tool = node('tool', textOf(part.pastTenseMessage) || textOf(part.invocationMessage) || part.toolId || 'Tool call', part, {
          timestamp: part.startedAt, duration: part.completedAt && part.startedAt ? part.completedAt - part.startedAt : null,
          toolName: part.toolId, model: part.toolSpecificData?.modelName || model,
          failed: !!part.resultDetails?.isError, hidden: part.presentation === 'hidden'
        });
        if (part.toolCallId) tools.set(part.toolCallId, tool);
        parent.children.push(tool);
      } else if (kind === 'textEditGroup') {
        parent.children.push(node('edit', `Edit ${shortPath(part.uri)}`, part, { file: shortPath(part.uri), model }));
      } else {
        parent.children.push(node(kind === 'codeblockUri' ? 'file' : 'event', kind === 'codeblockUri' ? shortPath(part.uri) : kind, part, { model }));
      }
    }
    flush();
    for (const [key, label] of [['variableData', 'Prompt attachments & context'], ['contentReferences', 'Content references'], ['codeCitations', 'Code citations'], ['result', 'Response metadata & summaries']]) {
      const value = request[key];
      if (value && (Array.isArray(value) ? value.length : Object.keys(value).length)) parent.children.push(node('context', label, value, { model }));
    }
  }
  function requestAt(time) {
    const timestamp = new Date(time).getTime();
    let matched = requests[0];
    for (const request of requests) if (request.timestamp <= timestamp) matched = request;
    return matched;
  }
  for (const [records, label] of [[transcript, 'Agent transcript'], [debug, 'Debug log']]) {
    const groups = new Map();
    for (const { value: event, line } of records) {
      const owner = requestAt(event.timestamp || event.ts);
      if (!owner) {
        overview.children.push(node('event', event.type || 'Event', event, { source: label, line }));
        continue;
      }
      if (!groups.has(owner.id)) {
        const group = node('group', label, { description: 'Original sidecar events, in recorded order. These can overlap the rendered response.' }, { source: label });
        owner.children.push(group);
        groups.set(owner.id, group);
      }
      const data = event.data || event.attrs || {};
      const eventNode = node('event', `${event.type || 'Event'}${data.toolName ? ` · ${data.toolName}` : ''}`, event, {
        source: label, line, timestamp: event.timestamp || event.ts, text: textOf(data.content)
      });
      groups.get(owner.id).children.push(eventNode);
      if (data.toolCallId && tools.has(data.toolCallId)) {
        const tool = tools.get(data.toolCallId);
        tool.children.push(eventNode);
        if (data.arguments) tool.arguments = data.arguments;
        if (data.success === false) tool.failed = true;
      }
      for (const toolRequest of data.toolRequests || []) {
        if (!tools.has(toolRequest.toolCallId)) continue;
        const tool = tools.get(toolRequest.toolCallId);
        try { tool.arguments = typeof toolRequest.arguments === 'string' ? JSON.parse(toolRequest.arguments) : toolRequest.arguments; }
        catch { tool.arguments = toolRequest.arguments; }
      }
    }
  }
  if (editing) {
    const contents = new Map();
    for (const [resource, hash] of editing.initialFileContents || []) {
      if (!/^[a-f0-9]{7,64}$/i.test(hash)) { warnings.push(`Invalid content hash for ${resource}`); continue; }
      try { contents.set(resource, await readFile(path.join(editRoot, 'contents', hash), 'utf8')); }
      catch (error) { warnings.push(`Snapshot ${hash} for ${shortPath(resource)}: ${error.message}`); }
    }
    const groups = new Map();
    const timeline = [
      ...(editing.timeline?.fileBaselines || []).map(([, baseline]) => ({ ...baseline, isBaseline: true })),
      ...(editing.timeline?.operations || [])
    ].sort((a, b) => a.epoch - b.epoch || Number(!!b.isBaseline) - Number(!!a.isBaseline));
    for (const op of timeline) {
      const normalized = resourceKey(op.uri);
      if (op.isBaseline) {
        contents.set(normalized, op.content);
        continue;
      }
      const owner = requests.find((request) => request.requestId === op.requestId) || requests[0];
      let before = contents.get(normalized);
      let after;
      try {
        if (op.type === 'create') { before = ''; after = op.initialContent ?? ''; }
        else if (op.type === 'textEdit') {
          if (before === undefined) throw new Error('Base snapshot is missing');
          after = applyTextEdits(before, op.edits || []);
        } else if (op.type === 'delete') { before = op.finalContent ?? before; after = ''; }
        else if (op.type === 'rename') {
          before = contents.get(resourceKey(op.oldUri));
          after = before;
          contents.delete(resourceKey(op.oldUri));
          if (after !== undefined) contents.set(resourceKey(op.newUri), after);
        }
        if (after !== undefined) contents.set(normalized, after);
      } catch (error) {
        contents.delete(normalized);
        warnings.push(`Edit epoch ${op.epoch}: ${error.message}; showing recorded edits without a fabricated diff.`);
      }
      const edit = node('edit', `${op.type} · ${shortPath(op.uri).split('\\').at(-1)}`, op, {
        source: 'Edit timeline', file: shortPath(op.uri), before, after, epoch: op.epoch
      });
      if (owner) {
        if (!groups.has(owner.id)) {
          const group = node('group', 'File edit history', { description: 'Edit operations reconstructed from persisted content blobs and chronological UTF-16 ranges.' }, { source: 'Edit timeline' });
          owner.children.push(group); groups.set(owner.id, group);
        }
        groups.get(owner.id).children.push(edit);
      } else overview.children.push(edit);
    }
    const snapshots = node('group', 'Saved file snapshots', { description: 'Exact before/after content blobs from the most recent saved editing state. These compare the session-wide original with its saved current version, not a single prompt.' }, { source: 'Saved snapshots' });
    for (const entry of editing.recentSnapshot?.entries || []) {
      const pair = {};
      for (const [side, hash] of [['before', entry.originalHash], ['after', entry.currentHash]]) {
        if (!/^[a-f0-9]{7,64}$/i.test(hash)) { warnings.push(`Missing or invalid ${side} snapshot hash for ${shortPath(entry.resource)}`); continue; }
        try { pair[side] = await readFile(path.join(editRoot, 'contents', hash), 'utf8'); }
        catch (error) { warnings.push(`Snapshot ${hash}: ${error.message}`); }
      }
      snapshots.children.push(node('edit', shortPath(entry.resource), entry, {
        source: 'Saved snapshots', file: shortPath(entry.resource), ...pair,
        model: entry.telemetryInfo?.modelId
      }));
    }
    if (snapshots.children.length) overview.children.unshift(snapshots);
    overview.children.push(node('context', 'Editing checkpoints & snapshots', editing, { source: 'chatEditingSessions' }));
  }
  if (models) overview.children.push(node('context', 'Recorded model catalog', models, { source: 'models.json' }));
  if (workspace) overview.children.push(node('context', 'Workspace metadata', workspace, { source: 'workspace.json' }));
  if (entries.length) {
    const group = node('group', 'Persistence operations', { description: 'Original mutation records. Replay uses kind 0 snapshot, 1 set, 2 append/truncate, 3 delete.' });
    // Records are re-read from disk on demand; the snapshot alone can be hundreds of megabytes.
    for (const { value, line, offset, length } of entries) {
      group.children.push(node('event', `Line ${line} · ${['Snapshot', 'Set', 'Append / truncate', 'Delete'][value.kind] || 'Unknown'} ${value.k?.join('.') || ''}`,
        { kind: value.kind, k: value.k, recordBytes: length, note: 'Open this record to load it from the session file.' },
        { line, source: path.basename(file), rawRef: { offset, length } }));
    }
    overview.children.push(group);
  }
  const allNodes = [...nodes.values()];
  const stats = {
    prompts: requests.length, responses: allNodes.filter((item) => item.kind === 'response').length,
    tools: allNodes.filter((item) => item.kind === 'tool').length,
    reasoning: allNodes.filter((item) => item.kind === 'reasoning').length,
    edits: (editing?.timeline?.operations || []).length || allNodes.filter((item) => item.kind === 'edit').length,
    events: transcript.length + debug.length, models: new Set(modelTimeline.map((item) => item.to)).size
  };
  // Keep the full text index on the server, not in tree responses.
  for (const item of allNodes) {
    // Containers are covered by their children; stringifying them can exceed V8's maximum string length.
    const deep = !['overview', 'group', 'prompt'].includes(item.kind) && !item.rawRef;
    item.searchText = `${item.title}\n${item.text || ''}\n${deep ? collectText(item.raw, 20000) : ''}\n${collectText(item.arguments, 8000)}`.toLowerCase();
  }
  const workspaceUri = workspace?.folder || workspace?.workspace || '';
  const workspacePath = workspaceUri ? shortPath(workspaceUri) : '';
  const timestamps = requests.map((request) => request.timestamp).filter(Number.isFinite);
  const result = {
    id, sessionId, sessionFormat: 'vscode-chat', clientName: 'vscode-chat', title: overview.title, file, createdAt: session.creationDate, workspace: workspaceUri,
    workspacePath, workspaceName: workspacePath ? workspacePath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1).replace(/\.code-workspace$/i, '') : '',
    lastAt: timestamps.length ? Math.max(...timestamps) : session.lastMessageDate || session.creationDate,
    firstPrompt: requests[0]?.title || '', size: (await stat(file)).size,
    stats, warnings, modelTimeline, overview, requests, nodes, raw: session,
    sources: { session: path.basename(file), transcript: transcript.length, debug: debug.length, editing: !!editing, models: !!models }
  };
  return result;
}

export function summarizeNode(item) {
  const { id, kind, title, timestamp, model, hidden, index, toolName, failed, source, available, file, duration, epoch } = item;
  return { id, kind, title, timestamp, model, hidden, index, toolName, failed, source, available, file, duration, epoch,
    children: item.children.map(summarizeNode) };
}
export function summarizeSession(session) {
  const { id, sessionId, sessionFormat, clientName, title, file, createdAt, lastAt, workspace, workspacePath, workspaceName, firstPrompt, size, stats, warnings, modelTimeline, sources } = session;
  return { id, sessionId, sessionFormat, clientName, title, file, createdAt, lastAt, workspace, workspacePath, workspaceName, firstPrompt, size, stats, warnings, modelTimeline, sources };
}
// Compact text used for cross-session search. Node IDs are deterministic for unchanged source files.
export function buildCorpus(session) {
  const entries = [];
  const limit = 60000;
  const add = (item, prompt, text) => {
    text = String(text || '').trim();
    if (text) entries.push([item.id, item.kind, prompt, text.length > limit ? text.slice(0, limit) : text]);
  };
  for (const request of session.requests) {
    add(request, request.index, request.text);
    for (const child of request.children) {
      if (child.kind === 'response' || child.kind === 'reasoning') add(child, request.index, child.text);
      else if (child.kind === 'tool') {
        add(child, request.index, `${child.title}\n${child.toolName || ''}\n${collectText(child.arguments, 4000)}\n${collectText(child.raw?.toolSpecificData, 4000)}\n${collectText(child.raw?.resultDetails, 3000)}`);
      } else if (child.kind === 'edit' || child.kind === 'file') add(child, request.index, `${child.title}\n${child.file || ''}`);
      else if (child.kind === 'group' && child.source === 'Edit timeline') {
        for (const edit of child.children) add(edit, request.index, `${edit.title}\n${edit.file || ''}`);
      }
    }
  }
  return entries;
}
export function detailNode(item) {
  const { children, searchText, rawRef, ...detail } = item;
  const bounded = boundedRaw(item.raw);
  detail.raw = bounded.value;
  if (bounded.truncated) detail.rawTruncated = true;
  if (item.before !== undefined && item.after !== undefined) {
    detail.diff = diffLines(item.before, item.after, { timeout: 1500 }) || null;
  }
  return { ...detail, childCount: children.length };
}
// Loads a record that was deliberately left on disk (see rawRef) and returns a bounded detail.
export async function detailNodeAsync(session, item) {
  if (!item.rawRef) return detailNode(item);
  const raw = await readRecord(session.file, item.rawRef.offset, item.rawRef.length);
  return detailNode({ ...item, raw });
}

export function storyPage(session, { parentId, offset = 0, limit = 16 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid story page: offset must be non-negative and limit must be between 1 and 50.');
  }
  const parent = parentId ? session.nodes.get(parentId) : null;
  if (parentId && !parent) throw new Error('Story parent not found.');
  const items = parent ? parent.children : session.requests.flatMap((request) => [request, ...request.children]);
  return {
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    items: items.slice(offset, offset + limit).map((item) => {
      if (item.kind !== 'prompt') return detailNode(item);
      // The response is streamed separately; do not repeat it in every prompt header.
      const { response, result, ...metadata } = item.raw;
      return { ...summarizeNode({ ...item, children: [] }), text: item.text, raw: boundedRaw(metadata, 200000).value };
    })
  };
}
