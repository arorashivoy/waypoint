/**
 * Hidden-by-colour check for PDFs (spec 6.4).
 *
 * Ghostscript draws each page 2 times: normally, and with all text removed
 * (-dFILTERTEXT). Ghostscript's txtwrite device gives the position of each
 * glyph. A glyph is visible when the pixels in its box differ between the 2
 * pictures. A picture, a pattern or a band behind or over the text is in both
 * pictures, so it cancels out. Text that has the colour of what is behind it,
 * or that something covers, does not change the picture.
 *
 * All 3 outputs use the page frame of pdftotext: points, the page after its
 * /Rotate turn, with (0, 0) at the top left. The text that goes to Claude
 * still comes from pdftotext; this module only says which characters show.
 */

export const NO_COLOUR_WARNING = 'Waypoint could not check text colour in this PDF.';
/** Two pixels differ when one channel differs by more than 24. */
const TOLERANCE = 24;
/**
 * A glyph is visible when at least 8% of the pixels in its box are ink (see isInk)
 * that only this glyph owns. Measured with antialiasing at about 90 dpi on Helvetica,
 * Times, Courier and Computer Modern from 6 to 12 pt: the lowest visible letter is 15%
 * (a Times "t" at 6 pt). White text on white, under a cover, or over a thin rule is 0%.
 * 8% keeps a margin on both sides.
 */
export const INK_MIN_SHARE = 0.08;
/** The glyph box above and below the baseline, as a share of the font size. Accents and descenders fit in it. */
const ASCENT = 0.95;
const DESCENT = 0.3;
const MAX_PIXELS = 4_000_000;
/** The largest PPM file that Waypoint reads. A picture of 1000 x 1000 pixels is about 3 000 070 bytes. */
export const MAX_PPM_BYTES = 3 * 1024 * 1024;
/** Limits for the txtwrite file. */
export const MAX_TXT_BYTES = 8 * 1024 * 1024;
const MAX_GLYPHS = 200_000;
const MAX_LINES = 400_000;
/** The most pixel visits for one page. A page over the limit is not checked. */
const MAX_VISITS = 30_000_000;

export type Raster = { width: number; height: number; data: Buffer };

/** A binary PPM (P6, 8 bit). Returns null for any other data, or a picture over 4 000 000 pixels. */
export function parsePpm(buf: Buffer): Raster | null {
  let pos = 0;
  const token = (): string | null => {
    for (;;) {
      while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++;
      if (buf[pos] !== 0x23) break;
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
    }
    const start = pos;
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    return pos > start && pos - start < 20 ? buf.toString('latin1', start, pos) : null;
  };
  if (token() !== 'P6') return null;
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  pos++; // one whitespace byte before the pixels
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS || max !== 255) return null;
  if (buf.length - pos < width * height * 3) return null;
  return { width, height, data: buf.subarray(pos, pos + width * height * 3) };
}

/**
 * One glyph. (x, y) is the start of its baseline in points, (dx, dy) the unit
 * direction of the text, `len` the advance and `size` the font size, all in points.
 * A glyph with no advance (the second part of a ligature that has no Unicode map)
 * has `lead`: the index of the glyph before it. It has no pixels of its own.
 * `span` numbers the txtwrite span; `steep` marks a span whose glyph places are estimated.
 */
export type Glyph = { c: string; x: number; y: number; dx: number; dy: number; len: number; size: number; lead?: number; span: number; steep: boolean };

export class TxtwriteError extends Error {}

const INT = /^-?\d{1,8}$/;
// The font name comes from the PDF, and Ghostscript does not escape it. A name
// with a quote, an angle bracket or a control character can forge the rest of
// the line, so such a line is refused and the whole check stops.
const SPAN = /^<span bbox="([^"]*)" font="[^"<>\x00-\x1f\x7f]{0,200}" size="(\d{1,6}\.\d{1,6})">$/;
const CHAR = /^<char bbox="([^"]*)" c="([^"<>]{1,64})"\/>$/;
const ENTITY = /&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]{1,6}|#\d{1,7});/g;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Four whole numbers in tenths of a point (txtwrite runs at 720 dpi), as points. */
function box(s: string): [number, number, number, number] {
  const p = s.split(' ');
  if (p.length !== 4 || !p.every((v) => INT.test(v))) throw new TxtwriteError('bad bbox');
  return p.map((v) => Number(v) / 10) as [number, number, number, number];
}

function unescape(s: string): string {
  if (s.replace(ENTITY, '').includes('&')) throw new TxtwriteError('bad entity');
  const out = s.replace(ENTITY, (_, e: string) => {
    if (e in NAMED) return NAMED[e];
    const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
  if ([...out].length > 8) throw new TxtwriteError('char too long');
  return out;
}

/**
 * The glyphs of each page from `gs -sDEVICE=txtwrite -dTextFormat=0 -r720`.
 * The parser reads one strict form per line. Any other line, a number that is
 * not a plain whole number, or a file over the limits throws TxtwriteError.
 */
export function parseTxtwrite(xml: string): Glyph[][] {
  if (xml.length > MAX_TXT_BYTES) throw new TxtwriteError('txtwrite output too large');
  const lines = xml.split('\n');
  if (lines.length > MAX_LINES) throw new TxtwriteError('too many lines');
  const pages: Glyph[][] = [];
  let page: Glyph[] | null = null;
  let span: { s: [number, number, number, number]; size: number; chars: { b: [number, number, number, number]; c: string }[] } | null = null;
  let count = 0;
  let spans = 0;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line === '') continue;
    if (line === '<page>') {
      if (page || span) throw new TxtwriteError('nested page');
      if (pages.length >= 10) throw new TxtwriteError('too many pages');
      page = [];
      continue;
    }
    if (line === '</page>') {
      if (!page || span) throw new TxtwriteError('bad page end');
      pages.push(page);
      page = null;
      continue;
    }
    const sm = SPAN.exec(line);
    if (sm) {
      if (!page || span) throw new TxtwriteError('bad span');
      span = { s: box(sm[1]), size: Number(sm[2]), chars: [] };
      continue;
    }
    const cm = CHAR.exec(line);
    if (cm) {
      if (!span) throw new TxtwriteError('char outside span');
      if (++count > MAX_GLYPHS) throw new TxtwriteError('too many glyphs');
      span.chars.push({ b: box(cm[1]), c: unescape(cm[2]) });
      continue;
    }
    if (line === '</span>') {
      if (!span || !page) throw new TxtwriteError('bad span end');
      const base = page.length;
      const id = spans++;
      for (const g of spanGlyphs(span.s, span.size, span.chars)) page.push({ ...g, span: id, ...(g.lead === undefined ? {} : { lead: base + (page.length - base) + g.lead }) });
      span = null;
      continue;
    }
    throw new TxtwriteError('unknown line');
  }
  if (page || span) throw new TxtwriteError('unclosed element');
  return pages;
}

/**
 * The glyphs of one span. The span bbox is the start and the end of its
 * baseline. For a span that is more across than up, each char bbox gives the
 * x of its start and end. For a steeper span, txtwrite gives no position per
 * char, so the span is divided into equal parts.
 */
/** A rough advance of a character, as a share of the font size, to place the glyphs of a steep span. */
function roughWidth(c: string): number {
  if (/^[ijlft.,:;'!|I\s]$/.test(c)) return 0.3;
  if (/^[mwMW@]$/.test(c)) return 0.85;
  if (/^[A-Z0-9]$/.test(c)) return 0.65;
  return 0.55;
}

function spanGlyphs(s: [number, number, number, number], size: number, chars: { b: [number, number, number, number]; c: string }[]): Omit<Glyph, 'span'>[] {
  const [sx, sy, ex, ey] = s;
  const L = Math.hypot(ex - sx, ey - sy);
  if (!(L > 0) || !(size > 0) || !chars.length) return [];
  const dx = (ex - sx) / L;
  const dy = (ey - sy) / L;
  const across = Math.abs(ex - sx) >= Math.abs(ey - sy);
  const out: Omit<Glyph, 'span'>[] = [];
  let last = -1;
  const widths = chars.map((ch) => roughWidth(ch.c));
  const total = widths.reduce((a, b) => a + b, 0);
  let before = 0;
  chars.forEach((ch, i) => {
    let t0: number;
    let t1: number;
    if (across) {
      t0 = (ch.b[0] - sx) / (ex - sx);
      t1 = (ch.b[2] - sx) / (ex - sx);
    } else {
      t0 = before / total;
      t1 = (before + widths[i]) / total;
    }
    before += widths[i];
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
    if (t1 < t0) [t0, t1] = [t1, t0];
    const g: Omit<Glyph, 'span'> = { c: ch.c, x: sx + t0 * L * dx, y: sy + t0 * L * dy, dx, dy, len: Math.max((t1 - t0) * L, 0.05), size, steep: !across };
    if ((t1 - t0) * L < 0.02 * size && last >= 0) g.lead = last - out.length;
    else if (!isSpace(ch.c)) last = out.length;
    out.push(g);
  });
  return out;
}

/** Spacing accents that TeX and some other programs print over a letter as a separate glyph. */
const ACCENT = /^[`¨¯´¸ˆ-˝̀-ͯ]$/u;
const isSpace = (c: string) => /^\s*$/u.test(c);

type Frame = { ux: number; uy: number; vx: number; vy: number };
const frame = (g: Glyph): Frame => ({ ux: g.dx, uy: g.dy, vx: g.dy, vy: -g.dx });

/** The pixel box that holds the glyph box, at `k` pixels per point, inside the picture. */
function pixelBounds(g: Glyph, k: number, W: number, H: number): [number, number, number, number] {
  const f = frame(g);
  const pts: [number, number][] = [];
  for (const u of [0, g.len]) for (const v of [-DESCENT * g.size, ASCENT * g.size]) pts.push([g.x + u * f.ux + v * f.vx, g.y + u * f.uy + v * f.vy]);
  const xs = pts.map((p) => p[0] * k);
  const ys = pts.map((p) => p[1] * k);
  return [Math.max(0, Math.floor(Math.min(...xs))), Math.max(0, Math.floor(Math.min(...ys))), Math.min(W, Math.ceil(Math.max(...xs))), Math.min(H, Math.ceil(Math.max(...ys)))];
}

/** Call `fn` for each pixel whose centre is inside the glyph box. */
function eachPixel(g: Glyph, k: number, W: number, H: number, fn: (o: number) => void): number {
  const [x0, y0, x1, y1] = pixelBounds(g, k, W, H);
  const f = frame(g);
  const lo = -DESCENT * g.size;
  const hi = ASCENT * g.size;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = (x + 0.5) / k - g.x;
      const py = (y + 0.5) / k - g.y;
      const u = px * f.ux + py * f.uy;
      const v = px * f.vx + py * f.vy;
      if (u >= 0 && u < g.len && v >= lo && v <= hi) fn(y * W + x);
    }
  }
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

/**
 * True when pixel `o` of the normal picture shows ink: on some channel, its value
 * is more than 24 above or below every value of the picture with no text at the
 * same pixel and 2 pixels away in each of the 4 directions. White text over a thin
 * rule only cuts the rule: its pixels, also the grey edge pixels, stay inside the
 * range of the paper and the rule, so they are not ink.
 */
function isInk(a: Buffer, b: Buffer, o: number, W: number, H: number): boolean {
  const x = o % W;
  const y = (o - x) / W;
  for (let c = 0; c < 3; c++) {
    const v = a[o * 3 + c];
    let lo = b[o * 3 + c];
    let hi = lo;
    for (const [dx, dy] of NEIGHBOURS) {
      const q = (Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))) * 3 + c;
      lo = Math.min(lo, b[q]);
      hi = Math.max(hi, b[q]);
    }
    if (v > hi + TOLERANCE || v < lo - TOLERANCE) return true;
  }
  return false;
}
const NEIGHBOURS = [[2, 0], [-2, 0], [0, 2], [0, -2]] as const;

const near = (a: Glyph, b: Glyph) => Math.hypot(a.x - b.x, a.y - b.y) < 0.15 * Math.max(a.size, b.size) && Math.abs(a.size - b.size) < 0.34 * Math.max(a.size, b.size) && a.dx * b.dx + a.dy * b.dy > 0.95;

/**
 * Which glyphs of one page show. `normal` and `noText` are the 2 pictures at
 * `k` pixels per point. Returns one flag per glyph, or null when the page is
 * too large to check.
 *
 * - A pixel counts for a glyph only when no other glyph box holds it. So text
 *   printed over other text (an overlap) does not borrow its ink.
 * - The same character printed again at almost the same place (fake bold, a
 *   shadow) is one glyph.
 * - An accent printed over exactly one letter of about the same size does not
 *   take pixels from the letter, and it shows when the letter shows.
 */
export function visibleGlyphs(glyphs: readonly Glyph[], normal: Raster, noText: Raster, k: number): PageCheck | null {
  const r = glyphInk(glyphs, normal, noText, k);
  if (!r) return null;
  const shows = r.share.map((v) => v >= INK_MIN_SHARE);
  // In a steep span the glyph places are estimates, so a glyph between 2 glyphs of its span that show also shows.
  const solid = (i: number) => i >= 0 && i < glyphs.length && !isSpace(glyphs[i].c);
  const out = shows.map((v, i) => {
    const g = glyphs[i];
    if (v || !g.steep || g.lead !== undefined) return v;
    return solid(i - 1) && solid(i + 1) && glyphs[i - 1].span === g.span && glyphs[i + 1].span === g.span && shows[i - 1] && shows[i + 1];
  });
  return { shows: out, dup: r.dup };
}

/** For each glyph: does it show, and is it a copy of an earlier glyph (the same character at almost the same place). */
export type PageCheck = { shows: boolean[]; dup: boolean[] };

/** The share of each glyph box that is ink that only this glyph owns (0 to 1), or null when the page is too large to check. See visibleGlyphs. */
export function glyphInk(glyphs: readonly Glyph[], normal: Raster, noText: Raster, k: number): { share: number[]; dup: boolean[] } | null {
  const { width: W, height: H } = normal;
  if (noText.width !== W || noText.height !== H) return null;
  const n = glyphs.length;
  // For each glyph: -1 when it owns its pixels, or the index of the glyph it follows.
  const follows = new Int32Array(n).fill(-1);
  const dup = new Array<boolean>(n).fill(false);
  const grid = new Map<string, number[]>();
  const cell = (g: Glyph) => [Math.floor(g.x / 4), Math.floor(g.y / 4)];
  for (let i = 0; i < n; i++) {
    const g = glyphs[i];
    if (isSpace(g.c) || g.lead !== undefined) continue;
    const [cx, cy] = cell(g);
    let same = -1;
    for (let a = -2; a <= 2 && same < 0; a++) {
      for (let b = -2; b <= 2 && same < 0; b++) {
        for (const j of grid.get(`${cx + a},${cy + b}`) ?? []) {
          if (glyphs[j].c === g.c && near(glyphs[j], g)) {
            same = j;
            break;
          }
        }
      }
    }
    if (same >= 0) {
      follows[i] = same;
      dup[i] = true;
    }
    else {
      const key = `${cx},${cy}`;
      const list = grid.get(key) ?? [];
      if (list.length < 64) list.push(i);
      grid.set(key, list);
    }
  }
  // An accent over exactly one letter follows that letter.
  for (let i = 0; i < n; i++) {
    const g = glyphs[i];
    if (follows[i] >= 0 || !ACCENT.test(g.c)) continue;
    const [cx, cy] = cell(g);
    const bases: number[] = [];
    for (let a = -3; a <= 3; a++) {
      for (let b = -3; b <= 3; b++) {
        for (const j of grid.get(`${cx + a},${cy + b}`) ?? []) {
          const h = glyphs[j];
          if (j === i || ACCENT.test(h.c) || isSpace(h.c)) continue;
          const overlap = Math.min(g.x + g.len * g.dx, h.x + h.len * h.dx) - Math.max(g.x, h.x);
          const sameLine = Math.abs((g.x - h.x) * -h.dy + (g.y - h.y) * h.dx) < 0.3 * h.size;
          if (Math.abs(g.dy) < 0.01 && Math.abs(h.dy) < 0.01 && overlap > 0.3 * Math.min(g.len, h.len) && sameLine && Math.abs(g.size - h.size) < 0.34 * h.size) bases.push(j);
        }
      }
    }
    if (bases.length === 1) follows[i] = bases[0];
  }
  // Pixel owners: -1 none, -2 more than one glyph, else the glyph index.
  const owner = new Int32Array(W * H).fill(-1);
  let visits = 0;
  for (let i = 0; i < n; i++) {
    if (follows[i] >= 0 || isSpace(glyphs[i].c) || glyphs[i].lead !== undefined) continue;
    visits += eachPixel(glyphs[i], k, W, H, (o) => {
      owner[o] = owner[o] === -1 ? i : owner[o] === i ? i : -2;
    });
    if (visits > MAX_VISITS) return null;
  }
  const a = normal.data;
  const b = noText.data;
  const shows = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (follows[i] >= 0 || isSpace(glyphs[i].c) || glyphs[i].lead !== undefined) continue;
    let area = 0;
    let ink = 0;
    visits += eachPixel(glyphs[i], k, W, H, (o) => {
      area++;
      if (owner[o] !== i) return;
      if (isInk(a, b, o, W, H)) ink++;
    });
    if (visits > MAX_VISITS) return null;
    shows[i] = area > 0 ? ink / area : 0;
  }
  for (let i = 0; i < n; i++) if (follows[i] >= 0) shows[i] = shows[follows[i]];
  return { share: shows, dup };
}

/** The point in the middle of the glyph box, in points. */
function centre(g: Glyph): [number, number] {
  const u = g.len / 2;
  const v = ((ASCENT - DESCENT) / 2) * g.size;
  return [g.x + u * g.dx + v * g.dy, g.y + u * g.dy - v * g.dx];
}

export type WordBox = { x0: number; y0: number; x1: number; y1: number; text: string };

/** Says, for each character of a pdftotext word, if it shows. */
export type CharCheck = { charsShown(w: WordBox): boolean[] | null };

/**
 * For a page whose txtwrite output the parser refused (for example a font name
 * that forges a line): no character shows. Then the forged lines cannot move glyph boxes.
 */
export const NOTHING_SHOWS: CharCheck = { charsShown: (w) => [...w.text].map(() => false) };

/** A page index of glyph centres, to find the glyphs of a pdftotext word. */
export class GlyphIndex implements CharCheck {
  private grid = new Map<string, number[]>();
  private centres: [number, number][];
  private static CELL = 8;
  private shows: readonly boolean[];
  constructor(private glyphs: readonly Glyph[], check: PageCheck) {
    this.shows = check.shows;
    this.centres = glyphs.map(centre);
    glyphs.forEach((g, i) => {
      // A copy of a glyph is not a character of its own (pdftotext also drops it).
      if (isSpace(g.c) || check.dup[i]) return;
      const [x, y] = this.centres[i];
      const key = `${Math.floor(x / GlyphIndex.CELL)},${Math.floor(y / GlyphIndex.CELL)}`;
      const list = this.grid.get(key) ?? [];
      list.push(i);
      this.grid.set(key, list);
    });
  }

  /**
   * One flag per character of the word: true when it shows. A character with no glyph
   * (Ghostscript did not draw it) does not show.
   */
  charsShown(w: WordBox): boolean[] {
    const C = GlyphIndex.CELL;
    const m = 0.5;
    const cx0 = Math.floor((w.x0 - m) / C);
    const cx1 = Math.floor((w.x1 + m) / C);
    const cy0 = Math.floor((w.y0 - m) / C);
    const cy1 = Math.floor((w.y1 + m) / C);
    // A word box too large to search (a huge font) does not show.
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 20_000) return [...w.text].map(() => false);
    const found: number[] = [];
    for (let x = cx0; x <= cx1; x++) {
      for (let y = cy0; y <= cy1; y++) {
        for (const i of this.grid.get(`${x},${y}`) ?? []) {
          const [px, py] = this.centres[i];
          if (px >= w.x0 - m && px <= w.x1 + m && py >= w.y0 - m && py <= w.y1 + m) found.push(i);
        }
      }
    }
    const chars = [...w.text];
    if (!found.length) return chars.map(() => false);
    // Read order: along the text direction of the glyphs.
    const g0 = this.glyphs[found[0]];
    found.sort((a, b) => this.centres[a][0] * g0.dx + this.centres[a][1] * g0.dy - (this.centres[b][0] * g0.dx + this.centres[b][1] * g0.dy));
    // A ligature glyph stands for 2 or 3 characters; an accent stands for none.
    const slots: number[] = [];
    const letters: string[] = [];
    for (const i of found) {
      const c = this.glyphs[i].c;
      if (ACCENT.test(c)) continue;
      const parts = [...c.normalize('NFKC').toLowerCase()].slice(0, 4);
      for (const p of parts.length ? parts : ['']) {
        slots.push(i);
        letters.push(p);
      }
    }
    if (!slots.length) return chars.map(() => false);
    if (!sameLetters(chars.join(''), letters.join(''))) return chars.map(() => false);
    // A glyph with no advance shows only as the second or third letter of an ff, fi, fl, ffi or ffl ligature whose first glyph shows.
    const shown = (i: number, j: number) => {
      const lead = this.glyphs[i].lead;
      if (lead === undefined) return this.shows[i];
      return this.shows[lead] && /^[fil]$/.test(chars[j] ?? '') && (chars[j - 1] === 'f' || (chars[j - 2] === 'f' && chars[j - 1] === 'f'));
    };
    if (slots.length === chars.length) return slots.map((i, j) => shown(i, j));
    return this.aligned(chars, slots, letters, shown);
  }

  /**
   * The counts differ (a ligature, an accent, a font with no Unicode map). Match the
   * characters to the glyphs by their letters (longest common subsequence). A matched
   * character shows when its glyph shows. A character with no match shows only when
   * there is a glyph between the matched characters around it, and every such glyph shows.
   */
  private aligned(chars: string[], slots: number[], letters: string[], shown: (i: number, j: number) => boolean): boolean[] {
    const n = chars.length;
    const s = slots.length;
    if (n * s > 40_000) return chars.map(() => false);
    const lower = chars.map((c) => c.normalize('NFKC').toLowerCase());
    // L[j][t]: the longest common subsequence of chars from j and slots from t.
    const L = Array.from({ length: n + 1 }, () => new Int32Array(s + 1));
    for (let j = n - 1; j >= 0; j--) for (let t = s - 1; t >= 0; t--) L[j][t] = lower[j] === letters[t] && letters[t] !== '' ? L[j + 1][t + 1] + 1 : Math.max(L[j + 1][t], L[j][t + 1]);
    const match = new Int32Array(n).fill(-1);
    for (let j = 0, t = 0; j < n && t < s; ) {
      if (lower[j] === letters[t] && letters[t] !== '' && L[j][t] === L[j + 1][t + 1] + 1) match[j++] = t++;
      else if (L[j + 1][t] >= L[j][t + 1]) j++;
      else t++;
    }
    const out = new Array<boolean>(n).fill(false);
    for (let j = 0; j < n; j++) {
      if (match[j] >= 0) {
        out[j] = shown(slots[match[j]], j);
        continue;
      }
      let p = j - 1;
      while (p >= 0 && match[p] < 0) p--;
      let q = j + 1;
      while (q < n && match[q] < 0) q++;
      const from = p >= 0 ? match[p] + 1 : 0;
      const to = q < n ? match[q] : s;
      // The characters with no match from p + 1 to q - 1. A glyph with no advance in their part
      // shows when its first glyph shows and they are the letters of an ff, fi, fl, ffi or ffl ligature.
      const run = chars.slice(p + 1, q).join('');
      const lig = /^f[fil]{1,2}$/.test(run) || /^[fil]{1,2}$/.test(run);
      let ok = to > from;
      for (let t = from; t < to && ok; t++) {
        const lead = this.glyphs[slots[t]].lead;
        ok = lead === undefined ? this.shows[slots[t]] : lig && this.shows[lead];
      }
      out[j] = ok;
    }
    return out;
  }
}

/**
 * False when pdftotext and Ghostscript read clearly different letters at the
 * same place. Then no character of the word shows (the 2 readers do not agree on the PDF).
 * Short words and words with few plain letters always pass, because fonts with
 * no Unicode map give odd characters in one reader.
 */
function sameLetters(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (x.length < 4 || y.length < 4) return true;
  const count = new Map<string, number>();
  for (const c of x) count.set(c, (count.get(c) ?? 0) + 1);
  let same = 0;
  for (const c of y) {
    const v = count.get(c) ?? 0;
    if (v > 0) {
      same++;
      count.set(c, v - 1);
    }
  }
  return same >= 0.5 * Math.min(x.length, y.length);
}
