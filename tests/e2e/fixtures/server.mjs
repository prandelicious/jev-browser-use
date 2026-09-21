import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesDir = join(dirname(fileURLToPath(import.meta.url)), 'pages');

export function startFixtureServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const name = url.pathname.replace(/^\//, '') || 'basic-click.html';
    try {
      const body = await readFile(join(pagesDir, name), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        stop: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
    server.on('error', reject);
  });
}
