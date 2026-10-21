// Copies the pdf.js worker to public/, so the browser loads it as a static file.
// Next cannot minify the worker when it bundles it. Runs from "postinstall".
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const to = join(root, 'public/pdfjs/pdf.worker.min.mjs');

if (existsSync(from)) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
