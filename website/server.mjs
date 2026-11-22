import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const base = '/find-a-note/';
const output = new URL('./dist/', import.meta.url);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

export function createPreviewServer() {
  return createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      if (pathname === '/' || pathname === base.slice(0, -1)) {
        response.writeHead(302, { Location: base }).end();
        return;
      }

      const relative = pathname.slice(base.length) || 'index.html';
      const type = mime[extname(relative)];
      if (!pathname.startsWith(base) || !/^(assets\/)?[\w.-]+$/.test(relative) || !type) {
        response.writeHead(404).end();
        return;
      }

      const file = new URL(relative, output);
      const info = await stat(file);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
}
