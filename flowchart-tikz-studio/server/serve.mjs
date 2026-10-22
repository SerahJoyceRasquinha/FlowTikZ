#!/usr/bin/env node
/**
 * Minimal production server: serves the built app from dist/. No dependencies
 * beyond Node itself, and no API keys - image import runs entirely in the
 * browser with the bundled offline recogniser (Tesseract OCR).
 *
 *   npm run build
 *   npm run serve        (PORT defaults to 4173)
 *
 * Deploying dist/ as static files anywhere else works just as well.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  // The offline OCR language model: fetched and unzipped by the OCR worker itself.
  '.gz': 'application/octet-stream',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep) && file !== root) {
      res.statusCode = 403;
      return res.end();
    }
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(root, 'index.html');
    const body = await readFile(file);
    res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end('Internal error');
  }
}).listen(port, () => {
  console.log(`Flowchart Studio on http://localhost:${port} - image import: offline recogniser (OCR)`);
});
