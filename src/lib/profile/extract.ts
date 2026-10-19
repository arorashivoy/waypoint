import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../auth/http';
import { GS_MAX_DPI, gsArgs, runProgram } from '../exec';
import { type CharCheck, type Glyph, GlyphIndex, MAX_PPM_BYTES, MAX_STRAY_SHARE, MAX_TXT_BYTES, parsePpm, parseTxtwrite, type Raster, strayInk, TxtwriteError, visibleGlyphs, type WordBox } from './pdf-colour';

/**
 * Text from a résumé file, for the import prompt (spec 3.3, step 1), and the
 * hidden-text check (spec 6.4). Hidden text never goes to Claude; it becomes
 * a warning on each draft.
 */

/** `warnings` names the pages that were not read. They are not hidden text. */
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

type BboxLine = { page: number; words: WordBox[] };

/** The lines of `pdftotext -bbox-layout` output, with the page number (from 1) and the word boxes in points. */
function parseBbox(html: string): { lines: BboxLine[]; sizes: [number, number][] } {
  const lines: BboxLine[] = [];
  const sizes: [number, number][] = [];
  for (const line of html.split(/<\/line>/)) {
    for (const p of line.matchAll(/<page width="([\d.]+)" height="([\d.]+)"/g)) sizes.push([Number(p[1]), Number(p[2])]);
    const words: WordBox[] = [];
    for (const m of line.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      words.push({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]), text: decode(m[5]) });
    }
    lines.push({ page: sizes.length, words });
  }
  return { lines, sizes };
}

/** The text, the hidden phrases, and the pages with words that were not read because they are not in `pages`. */
function readLines(lines: readonly BboxLine[], pages?: ReadonlyMap<number, CharCheck>): { text: string; hidden: string[]; skipped: number[] } {
  const out: string[] = [];
  const hidden: string[] = [];
  const skipped = new Set<number>();
  for (const { page, words } of lines) {
    if (!words.length) continue;
    const index = pages?.get(page);
    if (pages && !index) {
      skipped.add(page);
      continue;
    }
    const shown: string[] = [];
    const tiny: string[] = [];
    for (const w of words) {
      if (isTiny(w.x1 - w.x0, w.y1 - w.y0, [...w.text].length)) {
        tiny.push(w.text);
        continue;
      }
      // A word with no letter or digit (a dash, a bullet) cannot carry an instruction, so it is not checked.
      if (!index || !ALNUM.test(w.text)) {
        shown.push(w.text);
        continue;
      }
      const [s, h] = split([...w.text], index.charsShown(w));
      // The shown part must line up with glyphs that show at this place. If not (the 2 readers
      // do not agree on this word, for example a page that only gs turns), the whole word is hidden.
      if (s && !index.lineUp(w, { shown: true, part: s === w.text ? undefined : s })) {
        tiny.push(w.text);
        continue;
      }
      if (s) shown.push(s);
      if (h) tiny.push(h);
    }
    if (shown.length) out.push(shown.join(' '));
    const phrase = tiny.join(' ').slice(0, 200);
    if (/[A-Za-z]/.test(phrase) && hidden.length < MAX_HIDDEN) hidden.push(phrase);
  }
  return { text: out.join('\n').slice(0, MAX_TEXT), hidden, skipped: [...skipped].sort((a, b) => a - b) };
}

/**
 * The text of `pdftotext -bbox-layout` output, one line per line, without hidden text.
 * A word is hidden when it is tiny (part 3). `pages` holds, for each page that passed the
 * check, the glyphs that Ghostscript found and which of them show (see pdf-colour.ts). Then
 * each character of a word that does not show is hidden. A page that is not in `pages` is
 * not read, and `warnings` names it. Without `pages`, the colour is not checked.
 * The hidden text of a line becomes one hidden phrase.
 */
export function wordsFromBbox(html: string, pages?: ReadonlyMap<number, CharCheck>): Extracted {
  const r = readLines(parseBbox(html).lines, pages);
  const out: Extracted = { text: r.text, hidden: r.hidden };
  return r.skipped.length ? { ...out, warnings: [skippedWarning(r.skipped)] } : out;
}

export const NOT_CHECKED = 'Waypoint could not check this PDF for hidden text. Export it again as a normal PDF, or upload the .tex source.';

function skippedWarning(pages: number[]): string {
  const list = pages.slice(0, 10).join(', ') + (pages.length > 10 ? ' and more' : '');
  return pages.length === 1
    ? `Waypoint did not read page ${list} of this PDF, because it could not check it for hidden text.`
    : `Waypoint did not read pages ${list} of this PDF, because it could not check them for hidden text.`;
}

/** A page passes the frame check when at least 90% of its words line up with Ghostscript glyphs. */
const MIN_LINED_UP = 0.9;
/** gs may write at most 20 MB to one file. */
const GS_LIMITS = { timeoutMs: 30_000, memoryMb: 512, fileBytes: 20_000_000 };
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
 * Check the first 10 pages with Ghostscript. Returns the glyph index of each page
 * that passed every check: both pictures read, the page size agrees, the frame
 * check (the words line up with the glyphs), and the stray-ink check. Throws when
 * Ghostscript fails; then no page passes.
 */
async function checkPages(work: string, input: string, lines: readonly BboxLine[], sizes: readonly [number, number][]): Promise<Map<number, GlyphIndex>> {
  const first = sizes.slice(0, 10);
  const side = Math.max(1, ...first.flat());
  const dpi = Math.max(1, Math.min(GS_MAX_DPI, Math.floor((72 * PICTURE_SIDE) / side)));
  const k = dpi / 72;
  for (const job of ['text', 'render', 'no-text'] as const) {
    const r = await runProgram('gs', gsArgs(job, dpi, input, work), { cwd: work, ...GS_LIMITS });
    if (r.code !== 0) throw new Error(`gs ${job} failed`);
  }
  const xmlPath = join(work, 'text.xml');
  if (statSync(xmlPath).size > MAX_TXT_BYTES) throw new Error('txtwrite output too large');
  const out = new Map<number, GlyphIndex>();
  let glyphPages: Glyph[][];
  try {
    glyphPages = parseTxtwrite(readFileSync(xmlPath, 'utf8'));
  } catch (e) {
    // The output does not have the strict form, and a line can be forged: no page passes.
    if (e instanceof TxtwriteError) return out;
    throw e;
  }
  if (glyphPages.length !== first.length) throw new Error('gs and pdftotext count different pages');
  glyphPages.forEach((glyphs, i) => {
    const [w, h] = first[i];
    const normal = readPicture(work, 'n', i + 1);
    const noText = readPicture(work, 'f', i + 1);
    if (!normal || !noText) return;
    const fits = (a: number, b: number) => Math.abs(normal.width - a * k) <= 2 && Math.abs(normal.height - b * k) <= 2;
    if (!fits(w, h) && !fits(h, w)) return;
    const check = visibleGlyphs(glyphs, normal, noText, k);
    const stray = strayInk(glyphs, normal, noText, k);
    if (!check || stray === null || stray > MAX_STRAY_SHARE) return;
    const index = new GlyphIndex(glyphs, check);
    const words = lines.filter((l) => l.page === i + 1).flatMap((l) => l.words).filter((x) => ALNUM.test(x.text));
    const lined = words.filter((x) => index.lineUp(x)).length;
    if (words.length && lined < MIN_LINED_UP * words.length) return;
    out.set(i + 1, index);
  });
  return out;
}

/**
 * The text of a PDF résumé. Only pages that pass the hidden-text check are read
 * (fail closed). When no page with text passes, the import stops with NOT_CHECKED.
 * When some pages are skipped, `warnings` names them.
 */
export async function extractPdf(buf: Buffer): Promise<Extracted> {
  const work = mkdtempSync(join(tmpdir(), 'wp-pdf-'));
  try {
    const input = join(work, 'in.pdf');
    const output = join(work, 'out.html');
    writeFileSync(input, buf);
    const r = await runProgram('pdftotext', ['-cropbox', '-bbox-layout', input, output], { cwd: work, timeoutMs: 30_000, memoryMb: 512 });
    if (r.code !== 0) throw new HttpError(400, 'Waypoint could not read this PDF.');
    const { lines, sizes } = parseBbox(readFileSync(output, 'utf8'));
    let pages = new Map<number, GlyphIndex>();
    try {
      pages = await checkPages(work, input, lines, sizes);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
    }
    const res = readLines(lines, pages);
    const withText = new Set(lines.filter((l) => l.words.length).map((l) => l.page));
    if (res.skipped.length && res.skipped.length === withText.size) throw new HttpError(400, NOT_CHECKED);
    const out: Extracted = { text: res.text, hidden: res.hidden };
    return res.skipped.length ? { ...out, warnings: [skippedWarning(res.skipped)] } : out;
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
