// Tiny static server for the sample apps. No dependencies. Local only. Usage: node samples/serve.mjs [port] [root]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const samples = dirname(fileURLToPath(import.meta.url));
const root = process.argv[3] ? resolve(process.argv[3]) : samples;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.wasm': 'application/wasm',
};
const port = Number(process.argv[2] ?? 4173);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x').pathname;
    let p = normalize(decodeURIComponent(url));
    if (p.endsWith('/') || p.endsWith('\\')) p += 'index.html';
    const file = join(root, p);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file); // read first: never send a status before we know it
    const headers = { 'content-type': types[extname(file)] ?? 'application/octet-stream' };
    // Sample "broken-http-cache": no service worker, but the HTTP cache can still serve the page offline.
    // Samples only: a real app served from another root must never get a cache header it did not ask for.
    if (root === samples && (url.startsWith('/broken-http-cache/') || url === '/app.js')) headers['cache-control'] = 'max-age=3600';
    res.writeHead(200, headers).end(body);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e instanceof URIError ? 400 : 404).end('not found');
    else res.destroy();
  }
}).listen(port, '127.0.0.1', () => console.log('samples on http://localhost:' + port));
