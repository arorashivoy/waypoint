import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../auth/http';
import { runProgram } from '../exec';
import { isInvisible, MAX_PPM_BYTES, NO_COLOUR_WARNING, parsePpm, type Raster } from './pdf-colour';

/**
 * Text from a résumé file, for the import prompt (spec 3.3, step 1), and the
 * hidden-text check (spec 6.4). Hidden text never goes to Claude; it becomes
 * a warning on each draft.
 */

/** `warnings` holds checks that did not run. They are not hidden text. */
export type Extracted = { text: string; hidden: string[]; warnings?: string[] };
export const MAX_TEXT = 60_000;
/** A word box under 3.7 pt high is a font under 4 pt. */
const TINY_HEIGHT = 3.7;
/** A word with an estimated font size under 4 pt is hidden, for any rotation. */
const TINY_FONT = 3.7;
const MAX_HIDDEN = 20;
const MAX_TEX = 500_000;

/**
 * Estimated font size of a word from its box. For a box of width w and height h,
 * w * h is about chars * size^2 / 2 for any rotation, so size = sqrt(2wh / chars).
 */
function isTiny(w: number, h: number, chars: number): boolean {
  return h < TINY_HEIGHT || Math.sqrt((2 * w * h) / Math.max(chars, 1)) < TINY_FONT;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * The text of `pdftotext -bbox-layout` output, one line per line, without hidden words.
 * A word is hidden when it is tiny, or when no pixel in its box differs from the colour around it
 * (see isInvisible). `pages` holds the picture of each page (page number to raster).
 * A word on a page with no picture is kept and `warnings` says that the colour was not checked.
 * Without `pages`, the colour is not checked and there is no warning. The hidden words of a line become one hidden phrase.
 */
export function wordsFromBbox(html: string, pages?: ReadonlyMap<number, Raster>): Extracted {
  const lines: string[] = [];
  const hidden: string[] = [];
  let page = 0;
  let pw = 0;
  let ph = 0;
  let unchecked = false;
  for (const line of html.split(/<\/line>/)) {
    for (const p of line.matchAll(/<page width="([\d.]+)" height="([\d.]+)"/g)) {
      page++;
      pw = Number(p[1]);
      ph = Number(p[2]);
    }
    const shown: string[] = [];
    const tiny: string[] = [];
    for (const m of line.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const word = decode(m[5]);
      const w = Number(m[3]) - Number(m[1]);
      const h = Number(m[4]) - Number(m[2]);
      let invisible: boolean | null = false;
      if (pages) {
        const img = pages.get(page);
        invisible = img && pw > 0 && ph > 0 ? isInvisible(img, { x0: Number(m[1]) / pw, y0: Number(m[2]) / ph, x1: Number(m[3]) / pw, y1: Number(m[4]) / ph }) : null;
        if (invisible === null) unchecked = true;
      }
      (isTiny(w, h, [...word].length) || invisible ? tiny : shown).push(word);
    }
    if (shown.length) lines.push(shown.join(' '));
    const phrase = tiny.join(' ').slice(0, 200);
    if (/[A-Za-z]/.test(phrase) && hidden.length < MAX_HIDDEN) hidden.push(phrase);
  }
  const out: Extracted = { text: lines.join('\n').slice(0, MAX_TEXT), hidden };
  return unchecked ? { ...out, warnings: [NO_COLOUR_WARNING] } : out;
}

/** The pictures of the pages that pdftoppm wrote, by page number. A file that is over 3 MB or is not a good PPM is left out. */
function readPages(work: string, prefix: string): Map<number, Raster> {
  const pages = new Map<number, Raster>();
  for (const f of readdirSync(work)) {
    const m = new RegExp(`^${prefix}-(\\d{1,3})\\.ppm$`).exec(f);
    if (!m || statSync(join(work, f)).size > MAX_PPM_BYTES) continue;
    const img = parsePpm(readFileSync(join(work, f)));
    if (img) pages.set(Number(m[1]), img);
  }
  return pages;
}

export async function extractPdf(buf: Buffer): Promise<Extracted> {
  const work = mkdtempSync(join(tmpdir(), 'wp-pdf-'));
  try {
    const input = join(work, 'in.pdf');
    const output = join(work, 'out.html');
    writeFileSync(input, buf);
    const r = await runProgram('pdftotext', ['-bbox-layout', input, output], { cwd: work, timeoutMs: 30_000, memoryMb: 512 });
    if (r.code !== 0) throw new HttpError(400, 'Waypoint could not read this PDF.');
    const bbox = readFileSync(output, 'utf8');
    // pdftotext cannot see colour. Pictures of the first 10 pages show it. If a picture is missing, the
    // tiny-text check still runs, and the user gets a warning.
    let pages = new Map<number, Raster>();
    try {
      const r2 = await runProgram('pdftoppm', ['-scale-to', '1000', '-l', '10', input, join(work, 'pg')], { cwd: work, timeoutMs: 30_000, memoryMb: 512 });
      if (r2.code === 0) pages = readPages(work, 'pg');
    } catch (e) {
      if (!(e instanceof Error)) throw e;
    }
    return wordsFromBbox(bbox, pages);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const HIDDEN_TEX = /\\(?:text)?color\s*\{\s*white\s*\}|\\fontsize\s*\{\s*[0-3](?:\.\d+)?\s*(?:pt)?\s*\}/i;

const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);

/** The index of `word` in `t` from `from`, where a letter does not follow it. */
function findWord(t: string, word: string, from: number): number {
  for (let a = t.indexOf(word, from); a >= 0; a = t.indexOf(word, a + 1)) {
    if (!isLetter(t[a + word.length])) return a;
  }
  return -1;
}

/**
 * Remove each `open ... close` span with a linear scan. LaTeX hides the text
 * to the end of the file when there is no close, so the scan does the same.
 * `\iffalse` and `\fi` match only when no letter follows them.
 */
function cut(t: string, open: string, close: string, wordEnds: boolean): string {
  let out = '';
  let from = 0;
  for (;;) {
    const a = wordEnds ? findWord(t, open, from) : t.indexOf(open, from);
    if (a < 0) break;
    const start = a + open.length;
    const b = wordEnds ? findWord(t, close, start) : t.indexOf(close, start);
    if (b < 0) return out + t.slice(from, a);
    out += t.slice(from, a) + ' ';
    from = b + close.length;
  }
  return out + t.slice(from);
}

const IFFALSE = /\\iffalse(?![A-Za-z])/;
const COMMENT_BEGIN = /\\begin\s{0,20}\{\s{0,20}comment\s{0,20}\}/g;
const COMMENT_END = /\\end\s{0,20}\{\s{0,20}comment\s{0,20}\}/g;

/**
 * The signs of hidden text in a .tex file: white text, a font under 4 pt, an `\iffalse` block and a `comment` environment.
 * The résumé import and the own-source upload both use it.
 */
export function hiddenTexMarkers(src: string): string[] {
  const hidden = HIDDEN_TEX.test(src) ? ['The .tex file sets white text or a font under 4 pt.'] : [];
  // Text in these blocks does not show in the PDF. Nesting is hard to parse, so the file gets a warning.
  if (IFFALSE.test(src)) hidden.push('\\iffalse block');
  COMMENT_BEGIN.lastIndex = 0;
  if (COMMENT_BEGIN.test(src)) hidden.push('comment environment');
  COMMENT_BEGIN.lastIndex = 0;
  return hidden;
}

/** The words of a .tex file: no comments, no environments, macro arguments kept. */
export function extractTex(srcIn: string): Extracted {
  const src = srcIn.slice(0, MAX_TEX);
  const hidden = hiddenTexMarkers(src);
  let t = src
    .replace(/(^|[^\\])%.*$/gm, '$1');
  t = cut(t.replace(COMMENT_BEGIN, '\\begin{comment}').replace(COMMENT_END, '\\end{comment}'), '\\begin{comment}', '\\end{comment}', false);
  t = cut(t, '\\iffalse', '\\fi', true);
  t = t
    .replace(/\\(begin|end)\s{0,20}\{[^}]{0,200}\}/g, '\n')
    .replace(/\\item\b/g, '\n');
  // Keep the argument of a macro: \textbf{x} -> x. Repeat for nested macros.
  for (let i = 0; i < 5; i++) t = t.replace(/\\[a-zA-Z]{1,40}\*?(?:\[[^\][\\]{0,200}\])?\{([^{}]{0,2000})\}/g, '$1');
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
