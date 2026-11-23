import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/calculator.js': ['calculator.js', 'text/javascript; charset=utf-8']
};
const directory = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    const pathname = req.url.split('?', 1)[0];
    if (!Object.hasOwn(files, pathname)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const [filename, type] = files[pathname];
    try {
      const content = await readFile(path.join(directory, filename));
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      console.error(`Failed to serve ${filename}:`, error.message);
      res.writeHead(500).end('Failed to serve file');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(3211, '127.0.0.1', () => {
    console.log('SciCalc is running at http://127.0.0.1:3211');
  });
}
