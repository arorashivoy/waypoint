import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../auth/http';
import { runProgram } from '../exec';

/**
 * Text from a résumé file, for the import prompt (spec 3.3, step 1), and the
 * hidden-text check (spec 6.4). Hidden text never goes to Claude; it becomes
 * a warning on each draft.
 */

export type Extracted = { text: string; hidden: string[] };
export const MAX_TEXT = 60_000;
/** A word box under 3.7 pt high is a font under 4 pt. */
const TINY_HEIGHT = 3.7;
const MAX_HIDDEN = 20;

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The text of `pdftotext -bbox-layout` output, one line per line, without tiny words. The tiny words of a line become one hidden phrase. */
export function wordsFromBbox(html: string): Extracted {
  const lines: string[] = [];
  const hidden: string[] = [];
  for (const line of html.split(/<\/line>/)) {
    const shown: string[] = [];
    const tiny: string[] = [];
    for (const m of line.matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const word = decode(m[3]);
      (Number(m[2]) - Number(m[1]) < TINY_HEIGHT ? tiny : shown).push(word);
    }
    if (shown.length) lines.push(shown.join(' '));
    const phrase = tiny.join(' ').slice(0, 200);
    if (/[A-Za-z]/.test(phrase) && hidden.length < MAX_HIDDEN) hidden.push(phrase);
  }
  return { text: lines.join('\n').slice(0, MAX_TEXT), hidden };
}

export async function extractPdf(buf: Buffer): Promise<Extracted> {
  const work = mkdtempSync(join(tmpdir(), 'wp-pdf-'));
  try {
    const input = join(work, 'in.pdf');
    const output = join(work, 'out.html');
    writeFileSync(input, buf);
    const r = await runProgram('pdftotext', ['-bbox-layout', input, output], { cwd: work, timeoutMs: 30_000, memoryMb: 512 });
    if (r.code !== 0) throw new HttpError(400, 'Waypoint could not read this PDF.');
    return wordsFromBbox(readFileSync(output, 'utf8'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const HIDDEN_TEX = /\\(?:text)?color\s*\{\s*white\s*\}|\\fontsize\s*\{\s*[0-3](?:\.\d+)?\s*(?:pt)?\s*\}/i;

/** The words of a .tex file: no comments, no environments, macro arguments kept. */
export function extractTex(src: string): Extracted {
  const hidden = HIDDEN_TEX.test(src) ? ['The .tex file sets white text or a font under 4 pt.'] : [];
  let t = src
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\\(begin|end)\s*\{[^}]*\}/g, '\n')
    .replace(/\\item\b/g, '\n');
  // Keep the argument of a macro: \textbf{x} → x. Repeat for nested macros.
  for (let i = 0; i < 5; i++) t = t.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1');
  t = t
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ');
  const text = t
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { text: text.slice(0, MAX_TEXT), hidden };
}
