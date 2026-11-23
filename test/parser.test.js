import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { replay, applyTextEdits, readJsonLines, discover, loadSession, detailNode, summarizeNode, storyPage } from '../src/parser.js';

const log = (values) => values.map((value, index) => ({ value, line: index + 1 }));
const range = (sl, sc, el, ec) => ({ startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec });
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function save(relative, value) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  }
  return { root, save };
}
test('replays set, append, truncate, optional values and delete without mutating input', () => {
  const initial = { requests: [{ response: [{ value: 'old' }, { value: 'removed' }] }], customTitle: 'old' };
  const state = replay(log([
    { kind: 0, v: initial },
    { kind: 1, k: ['customTitle'], v: 'new' },
    { kind: 2, k: ['requests', 0, 'response'], i: 1, v: [{ value: 'new' }] },
    { kind: 2, k: ['requests', 0, 'response'], i: 1 },
    { kind: 2, k: ['requests'], v: [{ message: { text: 'next' } }] },
    { kind: 3, k: ['customTitle'] }
  ]));
  assert.equal(state.requests.length, 2);
  assert.deepEqual(state.requests[0].response, [{ value: 'old' }]);
  assert.equal('customTitle' in state, false);
  assert.equal(initial.customTitle, 'old');
  assert.equal(initial.requests[0].response.length, 2);
});
test('rejects unsafe and invalid mutations with explicit warnings', () => {
  const warnings = [];
  const state = replay(log([
    { kind: 0, v: { requests: [] } },
    { kind: 1, k: ['__proto__', 'polluted'], v: true },
    { kind: 1, k: ['constructor', 'prototype', 'polluted'], v: true },
    { kind: 2, k: ['requests'], i: -1 },
    { kind: 1, k: ['requests', 99, 'response'], v: [] },
    { kind: 999, k: [] }
  ]), warnings);
  assert.equal(warnings.length, 5);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(state.requests, []);
  assert.throws(() => replay(log([{ kind: 1, k: ['requests'], v: [] }]), []), /no valid snapshot/);
});
test('applies simultaneous UTF-16 edits, CRLF positions and VS Code EOF clamping', () => {
  assert.equal(applyTextEdits('a😀b\r\nsecond', [
    { range: range(1, 2, 1, 4), text: 'X' },
    { range: range(2, 1, 2, 7), text: 'last' }
  ]), 'aXb\r\nlast');
  assert.equal(applyTextEdits('old\ntext', [{ range: range(1, 1, 99, 1), text: 'replacement' }]), 'replacement');
  assert.equal(applyTextEdits('abc', [{ range: range(1, 99, 1, 100), text: '!' }]), 'abc!');
  assert.throws(() => applyTextEdits('abcdef', [
    { range: range(1, 1, 1, 4), text: '' }, { range: range(1, 3, 1, 6), text: '' }
  ]), /Overlapping/);
});
test('reads partial JSONL with line-numbered warnings, retaining all valid records', async (t) => {
  const { save } = await fixture(t);
  const file = await save('partial.jsonl', '\uFEFF{"kind":0,"v":{"requests":[]}}\r\n\n{"kind":1');
  const warnings = [];
  const entries = await readJsonLines(file, warnings);
  assert.equal(entries.length, 1);
  assert.match(warnings[0], /partial.jsonl:3/);
  assert.deepEqual(replay(entries), { requests: [] });
});
test('discovers workspace folders and prefers canonical JSONL over flat JSON', async (t) => {
  const { root, save } = await fixture(t);
  await save('workspace\\chatSessions\\one.json', { requests: [] });
  const canonical = await save('workspace\\chatSessions\\one.jsonl', '{"kind":0,"v":{"requests":[]}}\n');
  await save('workspace\\GitHub.copilot-chat\\transcripts\\not-a-session.jsonl', '{}');
  const dbPath = await save('workspace\\state.vscdb', 'not opened as a database');
  assert.deepEqual(await discover(root), [canonical]);
  assert.deepEqual(await discover(dbPath), [canonical]);
  assert.deepEqual(await discover(canonical), [canonical]);
});
test('joins tool inputs, sidecar events, models, request baselines and exact saved snapshots', async (t) => {
  const { save } = await fixture(t);
  const start = 1730000000000;
  const file = await save('chatSessions\\session-one.jsonl', [
    { kind: 0, v: { sessionId: 'session-one', customTitle: 'Fixture session', requests: [
      { requestId: 'r1', timestamp: start, modelId: 'copilot/first', message: { text: 'First prompt' }, response: [
        { value: '**Hello** ' }, { kind: 'inlineReference', name: 'sample.js' }, { value: '!' },
        { kind: 'thinking', value: [], id: 'opaque-value' }, { kind: 'thinking', value: '' },
        { kind: 'toolInvocationSerialized', toolCallId: 'call-one', toolId: 'read_file', isComplete: true, startedAt: start, completedAt: start + 5 }
      ] },
      { requestId: 'r2', timestamp: start + 100, modelId: 'copilot/second', modelConfiguration: { reasoningEffort: 'high' }, message: { text: 'Second prompt' }, response: [{ kind: 'thinking', value: ['Recorded ', 'reasoning'] }] }
    ] } },
    { kind: 2, k: ['requests', 1, 'response'], v: [{ value: 'Final answer' }] }
  ].map(JSON.stringify).join('\n'));
  const resource = 'file:///c%3A/sample.js';
  const uri = { external: resource, fsPath: 'c:\\sample.js' };
  await save('GitHub.copilot-chat\\transcripts\\session-one.jsonl', [
    { type: 'assistant.message', timestamp: new Date(start + 1).toISOString(), data: { toolRequests: [{ toolCallId: 'call-one', arguments: '{"filePath":"sample.js"}' }] } },
    { type: 'tool.execution_complete', timestamp: new Date(start + 2).toISOString(), data: { toolCallId: 'call-one', success: false } },
    { type: 'user.message', timestamp: new Date(start + 100).toISOString(), data: { content: 'Second prompt' } }
  ].map(JSON.stringify).join('\n'));
  await save('chatEditingSessions\\session-one\\contents\\aaaaaaa', 'initial');
  await save('chatEditingSessions\\session-one\\contents\\bbbbbbb', 'saved');
  await save('chatEditingSessions\\session-one\\state.json', {
    initialFileContents: [[resource, 'aaaaaaa']],
    timeline: {
      fileBaselines: [[`${resource}::r2`, { uri, requestId: 'r2', epoch: 5, content: 'external change' }]],
      operations: [
        { type: 'textEdit', uri, requestId: 'r1', epoch: 1, edits: [{ range: range(1, 1, 99, 1), text: 'first edit' }] },
        { type: 'textEdit', uri, requestId: 'r2', epoch: 6, edits: [{ range: range(1, 1, 1, 9), text: 'updated' }] }
      ]
    },
    recentSnapshot: { entries: [{ resource, originalHash: 'aaaaaaa', currentHash: 'bbbbbbb' }] }
  });
  const session = await loadSession(file);
  assert.deepEqual(session.warnings, []);
  assert.equal(session.requests.length, 2);
  assert.deepEqual(session.modelTimeline.map((item) => item.to), ['copilot/first', 'copilot/second']);
  const nodes = [...session.nodes.values()];
  const tool = nodes.find((item) => item.kind === 'tool');
  assert.deepEqual(tool.arguments, { filePath: 'sample.js' });
  assert.equal(tool.failed, true);
  assert.equal(tool.children.length, 1);
  assert.equal(tool.duration, 5);
  assert.equal(nodes.find((item) => item.kind === 'response').text, '**Hello** [sample.js]!');
  assert.equal(nodes.find((item) => item.kind === 'reasoning').available, false);
  assert.equal(nodes.filter((item) => item.kind === 'reasoning')[1].text, 'Recorded reasoning');
  const edits = nodes.filter((item) => item.source === 'Edit timeline' && item.kind === 'edit');
  assert.equal(edits.length, 2);
  assert.equal(edits[0].before, 'initial');
  assert.equal(edits[0].after, 'first edit');
  assert.equal(edits[1].before, 'external change');
  assert.equal(edits[1].after, 'updated change');
  const snapshotGroup = session.overview.children.filter((item) => item.title === 'Saved file snapshots');
  assert.equal(snapshotGroup.length, 1);
  assert.equal(snapshotGroup[0].children.length, 1);
  assert.equal(snapshotGroup[0].children[0].before, 'initial');
  assert.equal(snapshotGroup[0].children[0].after, 'saved');
  assert.ok(detailNode(edits[0]).diff.some((part) => part.added));
  assert.equal('raw' in summarizeNode(tool), false);
  assert.match(tool.searchText, /sample.js/);
  const firstPage = storyPage(session, { limit: 3 });
  assert.equal(firstPage.items[0].kind, 'prompt');
  assert.equal(firstPage.items[0].text, 'First prompt');
  assert.equal(firstPage.items[0].raw.response, undefined);
  assert.equal(firstPage.nextOffset, 3);
  const story = [];
  for (let offset = 0; ; ) {
    const page = storyPage(session, { offset, limit: 3 });
    story.push(...page.items);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  assert.deepEqual(story.map((item) => item.id), session.requests.flatMap((request) => [request.id, ...request.children.map((child) => child.id)]));
  assert.equal(new Set(story.map((item) => item.id)).size, story.length);
  const promptStory = storyPage(session, { parentId: session.requests[0].id, limit: 50 });
  assert.equal(promptStory.items[0].kind, 'model');
  assert.equal(promptStory.items.find((item) => item.kind === 'response').text, '**Hello** [sample.js]!');
  assert.equal(promptStory.items.find((item) => item.kind === 'tool').arguments.filePath, 'sample.js');
  assert.throws(() => storyPage(session, { offset: -1 }), /Invalid story page/);
  assert.throws(() => storyPage(session, { parentId: 'missing' }), /not found/);
});
test('labels missing edit blobs and does not fabricate a before/after pair', async (t) => {
  const { save } = await fixture(t);
  const file = await save('chatSessions\\missing.json', { sessionId: 'missing', requests: [{ requestId: 'r', message: { text: 'Edit' }, response: [] }] });
  await save('chatEditingSessions\\missing\\state.json', {
    initialFileContents: [['file:///a.js', 'aaaaaaa']],
    timeline: { operations: [{ type: 'textEdit', uri: 'file:///a.js', requestId: 'r', epoch: 1, edits: [{ range: range(1, 1, 1, 1), text: 'new' }] }] }
  });
  const session = await loadSession(file);
  assert.equal(session.warnings.length, 2);
  const edit = [...session.nodes.values()].find((item) => item.kind === 'edit');
  assert.equal(edit.before, undefined);
  assert.equal(edit.after, undefined);
  assert.equal(detailNode(edit).diff, undefined);
});
test('reconstructs the supplied multi-source session completely', async (t) => {
  const root = path.resolve('chatsessions\\1e9022e8d1cbb426c5a9be632fba179a');
  const file = path.join(root, 'chatSessions', 'c3391e05-f0b1-4466-8243-36c06a668d46.jsonl');
  if (!(await stat(file).catch(() => null))) {
    t.skip('Uncommitted local sample chatsessions fixture is not present on disk');
    return;
  }
  const original = await readFile(file);
  const session = await loadSession(file);
  assert.equal(session.requests.length, 13);
  assert.equal(session.stats.tools, 581);
  assert.equal(session.sources.transcript, 2195);
  assert.deepEqual(session.warnings, []);
  const nodes = [...session.nodes.values()];
  const snapshots = nodes.filter((item) => item.kind === 'edit' && item.source === 'Saved snapshots');
  assert.equal(snapshots.length, 41);
  assert.ok(snapshots.every((item) => typeof item.before === 'string' && typeof item.after === 'string'));
  const operations = nodes.filter((item) => item.kind === 'edit' && item.source === 'Edit timeline');
  assert.equal(operations.length, 246);
  assert.ok(operations.every((item) => typeof item.before === 'string' && typeof item.after === 'string'));
  assert.equal(nodes.filter((item) => item.kind === 'tool' && item.arguments !== undefined).length, 535);
  assert.deepEqual(await readFile(file), original, 'Source remains byte-for-byte unchanged');
});

test('library indexes a folder of workspaces, hides empty sessions, searches and reuses its cache', async (t) => {
  const { root, save } = await fixture(t);
  const { createLibrary } = await import('../src/library.js');
  const session = (title, text, answer) => JSON.stringify({ kind: 0, v: { sessionId: title, customTitle: title, requests: text ? [{ requestId: 'r1', message: { text }, response: [{ value: answer }] }] : [] } }) + '\n';
  await save('ws-a\\workspace.json', { folder: 'file:///c%3A/Repos/alpha' });
  await save('ws-a\\chatSessions\\one.jsonl', session('Alpha work', 'Build the zebra importer', 'Done with the quokka parser.'));
  await save('ws-a\\chatSessions\\empty.jsonl', session('Nothing', null));
  await save('ws-b\\chatSessions\\two.jsonl', session('Beta work', 'Plan the zebra migration', 'Sure.'));
  await save('ws-b\\state.vscdb', 'binary');
  await save('random-notes.txt', 'ignored');
  const cacheDir = path.join(root, '.cache');
  const library = createLibrary({ cacheDir, indexerArgs: [] });
  t.after(() => library.close());
  const added = await library.addPath(root);
  assert.equal(added.found, 3);
  await library.idle();
  const listed = library.list();
  assert.deepEqual(listed.sessions.map((s) => s.title).sort(), ['Alpha work', 'Beta work']);
  assert.equal(listed.empty, 1);
  assert.equal(listed.sessions.find((s) => s.title === 'Alpha work').workspaceName, 'alpha');
  const both = library.search('ZEBRA');
  assert.equal(both.total, 2);
  assert.match(both.results[0].snippet, /zebra/i);
  const answer = library.search('quokka parser');
  assert.equal(answer.total, 1);
  assert.equal(answer.results[0].sessionTitle, 'Alpha work');
  assert.equal(answer.results[0].promptIndex, 1);
  const alpha = listed.sessions.find((s) => s.title === 'Alpha work').id;
  assert.equal(library.search('zebra', { session: alpha }).total, 1);
  assert.equal((await library.getSession(alpha)).requests.length, 1);
  library.close();

  const reopened = createLibrary({ cacheDir, indexerArgs: [] });
  t.after(() => reopened.close());
  assert.equal((await reopened.addPath(root)).indexing, 0);
  assert.equal(reopened.search('zebra').total, 2);
});
