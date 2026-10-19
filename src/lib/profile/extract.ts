import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../auth/http';
import { GS_MAX_DPI, gsArgs, runProgram } from '../exec';
import { type CharCheck, type Glyph, GlyphIndex, MAX_PPM_BYTES, MAX_TXT_BYTES, NO_COLOUR_WARNING, NOTHING_SHOWS, parsePpm, parseTxtwrite, type Raster, TxtwriteError, visibleGlyphs } from './pdf-colour';

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
const ALNUM = /[\p{L}\p{N}]/u;

/**
 * The shown and the hidden part of one word. A letter or a digit shows when its
 * flag is true. Another character (a dot, a dash) shows when its flag is true or
 * a letter or digit next to it in the word shows, so "Node.js" keeps its dot.
 */
function split(chars: string[], flags: boolean[]): [string, string] {
  let shown = '';
  let hidden = '';
  chars.forEach((c, i) => {
    const ok = flags[i] || (!ALNUM.test(c) && ((ALNUM.test(chars[i - 1] ?? '') && flags[i - 1]) || (ALNUM.test(chars[i + 1] ?? '') && flags[i + 1])));
    if (ok) shown += c;
    else hidden += c;
  });
  return [shown, hidden];
}

/**
 * The text of `pdftotext -bbox-layout` output, one line per line, without hidden text.
 * A word is hidden when it is tiny (part 3). `pages` holds, for each checked page, the
 * glyphs that Ghostscript found and which of them show (see pdf-colour.ts). Then each
 * character of a word that does not show is hidden. A word on a page that is not in
 * `pages` is kept and `warnings` says that the colour was not checked.
 * Without `pages`, the colour is not checked and there is no warning.
 * The hidden text of a line becomes one hidden phrase.
 */
export function wordsFromBbox(html: string, pages?: ReadonlyMap<number, CharCheck>): Extracted {
  const lines: string[] = [];
  const hidden: string[] = [];
  let page = 0;
  let unchecked = false;
  for (const line of html.split(/<\/line>/)) {
    page += [...line.matchAll(/<page width="/g)].length;
    const shown: string[] = [];
    const tiny: string[] = [];
    for (const m of line.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const word = decode(m[5]);
      const [x0, y0, x1, y1] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      if (isTiny(x1 - x0, y1 - y0, [...word].length)) {
        tiny.push(word);
        continue;
      }
      // A word with no letter or digit (a dash, a bullet) cannot carry an instruction, so it is not checked.
      if (!pages || !ALNUM.test(word)) {
        shown.push(word);
        continue;
      }
      const index = pages.get(page);
      const flags = index?.charsShown({ x0, y0, x1, y1, text: word });
      if (!flags) {
        unchecked = true;
        shown.push(word);
        continue;
      }
      const [s, h] = split([...word], flags);
      if (s) shown.push(s);
      if (h) tiny.push(h);
    }
    if (shown.length) lines.push(shown.join(' '));
    const phrase = tiny.join(' ').slice(0, 200);
    if (/[A-Za-z]/.test(phrase) && hidden.length < MAX_HIDDEN) hidden.push(phrase);
  }
  const out: Extracted = { text: lines.join('\n').slice(0, MAX_TEXT), hidden };
  return unchecked ? { ...out, warnings: [NO_COLOUR_WARNING] } : out;
}

const GS_LIMITS = { timeoutMs: 30_000, memoryMb: 512 };
/** The long side of a page picture, in pixels. */
const PICTURE_SIDE = 1000;

/** The picture of page `n` from a gs job, or null when the file is missing, over 3 MB or not a good PPM. */
function readPicture(work: string, prefix: string, n: number): Raster | null {
  const f = join(work, `${prefix}-${String(n).padStart(2, '0')}.ppm`);
  try {
    if (statSync(f).size > MAX_PPM_BYTES) return null;
    return parsePpm(readFileSync(f));
  } catch {
    return null;
  }
}

/**
 * Check the first 10 pages with Ghostscript. Returns the glyph index of each
 * page that was checked. Throws when Ghostscript fails or its output is not as expected.
 */
async function checkPages(work: string, input: string, bbox: string): Promise<Map<number, CharCheck>> {
  const sizes = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)"/g)].slice(0, 10).map((m) => [Number(m[1]), Number(m[2])]);
  const side = Math.max(1, ...sizes.flat());
  const dpi = Math.max(1, Math.min(GS_MAX_DPI, Math.floor((72 * PICTURE_SIDE) / side)));
  const k = dpi / 72;
  for (const job of ['text', 'render', 'no-text'] as const) {
    const r = await runProgram('gs', gsArgs(job, dpi, input, work), { cwd: work, ...GS_LIMITS });
    if (r.code !== 0) throw new Error(`gs ${job} failed`);
  }
  const xmlPath = join(work, 'text.xml');
  if (statSync(xmlPath).size > MAX_TXT_BYTES) throw new Error('txtwrite output too large');
  const out = new Map<number, CharCheck>();
  let glyphPages: Glyph[][];
  try {
    glyphPages = parseTxtwrite(readFileSync(xmlPath, 'utf8'));
  } catch (e) {
    if (!(e instanceof TxtwriteError)) throw e;
    // The output does not have the strict form. A line can be forged, so nothing on the first 10 pages shows.
    sizes.forEach((_, i) => out.set(i + 1, NOTHING_SHOWS));
    return out;
  }
  if (glyphPages.length !== sizes.length) throw new Error('gs and pdftotext count different pages');
  glyphPages.forEach((glyphs, i) => {
    const [w, h] = sizes[i];
    const normal = readPicture(work, 'n', i + 1);
    const noText = readPicture(work, 'f', i + 1);
    if (!normal || !noText) return;
    // The picture must have the page size that pdftotext gives (in either order, for a turned page), so that both use one frame.
    const fits = (a: number, b: number) => Math.abs(normal.width - a * k) <= 2 && Math.abs(normal.height - b * k) <= 2;
    if (!fits(w, h) && !fits(h, w)) return;
    const check = visibleGlyphs(glyphs, normal, noText, k);
    if (check) out.set(i + 1, new GlyphIndex(glyphs, check));
  });
  return out;
}

export async function extractPdf(buf: Buffer): Promise<Extracted> {
  const work = mkdtempSync(join(tmpdir(), 'wp-pdf-'));
  try {
    const input = join(work, 'in.pdf');
    const output = join(work, 'out.html');
    writeFileSync(input, buf);
    const r = await runProgram('pdftotext', ['-cropbox', '-bbox-layout', input, output], { cwd: work, timeoutMs: 30_000, memoryMb: 512 });
    if (r.code !== 0) throw new HttpError(400, 'Waypoint could not read this PDF.');
    const bbox = readFileSync(output, 'utf8');
    // pdftotext cannot see colour. Ghostscript checks the first 10 pages. If it fails, the
    // tiny-text check still runs, and the user gets a warning. Pages after 10 get the warning too.
    let pages = new Map<number, CharCheck>();
    try {
      pages = await checkPages(work, input, bbox);
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
