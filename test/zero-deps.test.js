import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { diffLines } from '../src/diff.js';
import { discover, loadSession, parseWorkspaceYaml } from '../src/parser.js';
import { startServer } from '../src/server.js';

test('baseline app has zero external package dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);

  for (const dir of ['src', 'public']) {
    const absDir = fileURLToPathDir(dir);
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(m?js|html|css)$/i.test(entry.name)) continue;
      const content = await readFile(path.join(absDir, entry.name), 'utf8');
      assert.doesNotMatch(content, /\/vendor\//);
    }
  }
});

function fileURLToPathDir(rel) {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', rel);
}

test('native diffLines, Agent Host parser, icons/markdown, and node:http server work together', async (t) => {
  assert.equal(diffLines('a\nb\n', 'a\nc\n').filter((p) => p.added)[0].value, 'c\n');
  assert.equal(parseWorkspaceYaml('id: s-1\nsummary: "Demo title"\n').summary, 'Demo title');

  const sandbox = {};
  sandbox.globalThis = sandbox;
  const pubDir = fileURLToPathDir('public');
  vm.runInNewContext(await readFile(path.join(pubDir, 'icons.js'), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(path.join(pubDir, 'markdown.js'), 'utf8'), sandbox);
  assert.match(sandbox.chronicleMarkdown.sanitizeHtml(sandbox.chronicleMarkdown.parseMarkdown('# Hi')), /<h1>Hi<\/h1>/);

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-adv-starter-'));
  const agentDir = path.join(dataDir, '.copilot', 'session-state', 'u-1');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'workspace.yaml'), 'id: u-1\ncwd: c:\\repos\\app\nsummary: "Starter Agent Session"\n');
  await writeFile(path.join(agentDir, 'events.jsonl'), [
    { type: 'session.start', id: '1', timestamp: '2026-11-16T10:00:00Z', data: { sessionId: 'u-1', selectedModel: 'gpt-5' } },
    { type: 'user.message', id: '2', timestamp: '2026-11-16T10:00:05Z', data: { content: 'Test starter' } },
    { type: 'assistant.message', id: '3', timestamp: '2026-11-16T10:00:10Z', data: { content: 'Starter ok', model: 'gpt-5' } }
  ].map(JSON.stringify).join('\n'));

  const found = await discover(path.join(dataDir, '.copilot', 'session-state'));
  assert.equal(found.length, 1);
  const parsed = await loadSession(found[0]);
  assert.equal(parsed.title, 'Starter Agent Session');

  const instance = await startServer({ port: 0, dataDir, loadSamples: false, paths: [path.join(dataDir, '.copilot', 'session-state')] });
  t.after(async () => {
    instance.library.close();
    await new Promise((r) => instance.server.close(r));
    await rm(dataDir, { recursive: true, force: true });
  });

  await instance.library.idle();
  const res = await fetch(`${instance.url}/api/sessions`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.sessions.length, 1);
});
