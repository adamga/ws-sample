import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { summarizeSession, summarizeNode, detailNodeAsync, storyPage } from './parser.js';
import { createLibrary } from './library.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(projectRoot, 'public');
const MAX_JSON_BYTES = 32 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  applySecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  res.writeHead(status);
  res.end(body);
}

function contentDispositionAttachment(filename) {
  const safeAscii = String(filename || 'download').replace(/["\\\r\n]/g, '_');
  return `attachment; filename="${safeAscii}"`;
}

async function readJsonBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) {
      const err = new Error('Request payload exceeds 32 KB limit.');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!total) return null;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch {
    const err = new Error('Invalid JSON request body.');
    err.status = 400;
    throw err;
  }
}

function decodeSegment(segment) {
  try { return decodeURIComponent(segment); }
  catch {
    const err = new Error('Malformed URL parameter.');
    err.status = 400;
    throw err;
  }
}

async function serveStaticFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { sendJson(res, 400, { error: 'Malformed URL path.' }); return; }
  if (decoded.includes('\0')) { sendJson(res, 400, { error: 'Invalid URL path.' }); return; }

  const relative = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);
  const rootWithSep = publicDir.endsWith(path.sep) ? publicDir : publicDir + path.sep;
  if (resolved !== publicDir && !resolved.startsWith(rootWithSep)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }

  let target = resolved;
  let info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html');
    info = await stat(target).catch(() => null);
  }
  if (!info?.isFile()) { sendJson(res, 404, { error: 'Not found.' }); return; }

  const ext = path.extname(target).toLowerCase();
  applySecurityHeaders(res);
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', info.size);
  res.writeHead(200);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { error: 'Failed to read static file.' });
    else res.destroy();
  });
  stream.pipe(res);
}

function defaultDevicePaths() {
  const home = os.homedir();
  const vscodeStorage = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'workspaceStorage')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Code', 'User', 'workspaceStorage');
  const agentSessions = path.join(home, '.copilot', 'session-state');
  return { vscodeStorage, agentSessions };
}

export async function startServer({ port = 3210, dataDir, loadSamples = true, paths = [] } = {}) {
  const configFile = dataDir ? path.join(dataDir, 'settings.json') : path.join(projectRoot, '.chat-explorer.json');
  const imports = new Set();
  const startupWarnings = [];
  let saveQueue = Promise.resolve();

  const library = createLibrary({ cacheDir: path.join(dataDir || path.join(projectRoot, '.chat-explorer-cache'), dataDir ? 'index-cache' : '') });

  async function importPath(input, persist = true) {
    const result = await library.addPath(input);
    if (persist) {
      imports.add(path.resolve(input));
      const content = JSON.stringify({ paths: [...imports] }, null, 2);
      const save = saveQueue.catch(() => {}).then(async () => {
        const temporary = `${configFile}.${process.pid}.tmp`;
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, configFile);
      });
      saveQueue = save;
      await save;
    }
    return result;
  }

  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    for (const input of config.paths || []) {
      imports.add(input);
      try { await importPath(input, false); } catch (error) { startupWarnings.push(`${input}: ${error.message}`); }
    }
  } catch (error) { if (error.code !== 'ENOENT') startupWarnings.push(`Saved library: ${error.message}`); }

  if (!library.size && loadSamples) {
    try {
      const samples = await readdir(path.join(projectRoot, 'chatsessions'), { withFileTypes: true });
      for (const entry of samples.filter((value) => value.isDirectory())) {
        try { await importPath(path.join(projectRoot, 'chatsessions', entry.name), false); }
        catch (error) { startupWarnings.push(`${entry.name}: ${error.message}`); }
      }
    } catch (error) { if (error.code !== 'ENOENT') startupWarnings.push(error.message); }
  }
  for (const input of paths) {
    try { await importPath(input); } catch (error) { startupWarnings.push(`${input}: ${error.message}`); }
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        sendJson(res, 403, { error: 'Local requests only.' });
        return;
      }
      if ((req.headers.origin && ![`http://${host}`].includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        sendJson(res, 403, { error: 'Cross-origin access is not allowed.' });
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${host}`);
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;
      const method = req.method || 'GET';

      if (pathname.startsWith('/api/')) {
        if (method === 'GET' && pathname === '/api/sessions') {
          sendJson(res, 200, { ...library.list(), warnings: startupWarnings, defaultPaths: defaultDevicePaths() });
          return;
        }
        if (method === 'POST' && pathname === '/api/import') {
          const body = await readJsonBody(req);
          if (typeof body?.path !== 'string' || !body.path.trim()) {
            sendJson(res, 400, { error: 'A local path is required.' });
            return;
          }
          sendJson(res, 200, await importPath(body.path.trim()));
          return;
        }
        if (method === 'GET' && pathname === '/api/search') {
          const query = String(searchParams.get('q') || '').slice(0, 200);
          const sessionScope = searchParams.get('session');
          sendJson(res, 200, library.search(query, { session: sessionScope ? String(sessionScope) : undefined }));
          return;
        }

        let match;
        if (method === 'GET' && (match = /^\/api\/sessions\/([^/]+)$/.exec(pathname))) {
          const session = await library.getSession(decodeSegment(match[1]));
          sendJson(res, 200, {
            ...summarizeSession(session),
            overview: summarizeNode(session.overview),
            requests: session.requests.map(summarizeNode)
          });
          return;
        }
        if (method === 'GET' && (match = /^\/api\/sessions\/([^/]+)\/nodes\/([^/]+)$/.exec(pathname))) {
          const session = await library.getSession(decodeSegment(match[1]));
          const item = session.nodes.get(decodeSegment(match[2]));
          if (!item) { sendJson(res, 404, { error: 'Item not found.' }); return; }
          sendJson(res, 200, await detailNodeAsync(session, item));
          return;
        }
        if (method === 'GET' && (match = /^\/api\/sessions\/([^/]+)\/story$/.exec(pathname))) {
          const session = await library.getSession(decodeSegment(match[1]));
          sendJson(res, 200, storyPage(session, {
            parentId: searchParams.get('parent') || undefined,
            offset: Number(searchParams.get('offset') || 0),
            limit: Number(searchParams.get('limit') || 16)
          }));
          return;
        }
        if (method === 'GET' && (match = /^\/api\/sessions\/([^/]+)\/search$/.exec(pathname))) {
          const query = String(searchParams.get('q') || '').toLowerCase().trim();
          const session = await library.getSession(decodeSegment(match[1]));
          sendJson(res, 200, {
            ids: query ? [...session.nodes.values()].filter((item) => item.searchText.includes(query)).map((item) => item.id) : []
          });
          return;
        }
        if (method === 'GET' && (match = /^\/api\/sessions\/([^/]+)\/export$/.exec(pathname))) {
          const session = await library.getSession(decodeSegment(match[1]));
          sendJson(res, 200, session.raw, {
            'Content-Disposition': contentDispositionAttachment(`chat-${session.id}.json`)
          });
          return;
        }

        sendJson(res, 404, { error: 'API route not found.' });
        return;
      }

      await serveStaticFile(req, res, pathname);
    } catch (error) {
      console.error(error.message);
      if (!res.headersSent) sendJson(res, error.status || 400, { error: error.message });
      else res.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const actual = server.address().port;
  return { server, port: actual, url: `http://127.0.0.1:${actual}`, sessionCount: library.size, warnings: startupWarnings, importPath, library };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv.indexOf('--path');
  if (input >= 0 && !process.argv[input + 1]) { console.error('--path requires a folder or file.'); process.exit(1); }
  startServer({ port: Number(process.env.PORT || 3210), dataDir: process.env.CHRONICLE_DATA_DIR || undefined, paths: input >= 0 ? [process.argv[input + 1]] : [] })
    .then(({ url, sessionCount, warnings }) => {
      console.log(`Chat Explorer: ${url} (${sessionCount} sessions, read-only)`);
      for (const warning of warnings) console.warn(warning);
    })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
