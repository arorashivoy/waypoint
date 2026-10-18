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

const MAX_XML = 5 * 1024 * 1024;
const MAX_XML_ELEMENTS = 50_000;
/** A colour is white when every channel is within 16 of 255. */
const WHITE_FROM = 255 - 16;
export const NO_COLOUR_WARNING = 'Waypoint could not check text colour in this PDF.';

const normWord = (w: string) => w.normalize('NFKC').toLowerCase();
const decodeXml = (s: string) =>
  decode(s.replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => safeChar(parseInt(h, 16))).replace(/&#(\d{1,7});/g, (_, d) => safeChar(Number(d))));
function safeChar(n: number): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/**
 * The words of `pdftohtml -xml` output with white text (every colour channel
 * within 16 of #ffffff; the page is taken as white). The words are normalised
 * (NFKC, lower case). Throws when the XML is over 5 MB or has over 50 000 elements.
 */
export function colourHiddenWords(xml: string): Set<string> {
  if (xml.length > MAX_XML) throw new Error('The XML is too large.');
  const colours = new Map<string, boolean>();
  const words = new Set<string>();
  let count = 0;
  for (const m of xml.matchAll(/<fontspec\b([^>]*)>|<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    if (++count > MAX_XML_ELEMENTS) throw new Error('The XML has too many elements.');
    if (m[1] !== undefined) {
      const id = /\bid="([^"]*)"/.exec(m[1])?.[1];
      const c = /\bcolor="#([0-9a-fA-F]{6})"/.exec(m[1])?.[1];
      if (id === undefined) continue;
      const v = c ? [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) : [0];
      colours.set(id, v.length === 3 && v.every((x) => x >= WHITE_FROM));
      continue;
    }
    const font = /\bfont="([^"]*)"/.exec(m[2])?.[1];
    if (font === undefined || !colours.get(font)) continue;
    for (const w of decodeXml(m[3].replace(/<[^>]*>/g, '')).split(/\s+/)) if (w) words.add(normWord(w));
  }
  return words;
}

/**
 * The text of `pdftotext -bbox-layout` output, one line per line, without hidden words.
 * A word is hidden when it is tiny, or when it is in `white` (see colourHiddenWords).
 * The hidden words of a line become one hidden phrase.
 */
export function wordsFromBbox(html: string, white?: ReadonlySet<string>): Extracted {
  const lines: string[] = [];
  const hidden: string[] = [];
  for (const line of html.split(/<\/line>/)) {
    const shown: string[] = [];
    const tiny: string[] = [];
    for (const m of line.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const word = decode(m[5]);
      const w = Number(m[3]) - Number(m[1]);
      const h = Number(m[4]) - Number(m[2]);
      (isTiny(w, h, [...word].length) || white?.has(normWord(word)) ? tiny : shown).push(word);
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
    const bbox = readFileSync(output, 'utf8');
    // pdftotext cannot see colour. If pdftohtml fails, the tiny-text check still runs, and the user gets a warning.
    try {
      const r2 = await runProgram('pdftohtml', ['-xml', '-i', '-stdout', '-q', '-nodrm', input], { cwd: work, timeoutMs: 30_000, memoryMb: 512 });
      if (r2.code !== 0) throw new Error('pdftohtml failed');
      return wordsFromBbox(bbox, colourHiddenWords(r2.stdout));
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      return { ...wordsFromBbox(bbox), warnings: [NO_COLOUR_WARNING] };
    }
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
