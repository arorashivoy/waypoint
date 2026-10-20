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
/** The share for a glyph with no letter or digit (a dash, a dot, a bullet). */
export const MARK_MIN_SHARE = 0.02;
/** A glyph whose advance is under 20% of its font size never shows (a zero-width glyph or a hairline). */
const MIN_ADVANCE = 0.2;
/** A letter or digit shows only when the box around its ink is at least 20% of its glyph box. */
const MIN_INK_BOX = 0.2;
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
/** Helvetica advances (in 1/1000 of the font size) for the characters 32 to 126. */
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

/** An estimated advance of a character, as a share of the font size, to place the glyphs of a steep span (Helvetica widths; 0.556 for other characters). */
function roughWidth(c: string): number {
  const n = c.codePointAt(0) ?? 0;
  return n >= 32 && n <= 126 && c.length === 1 ? HELVETICA[n - 32] / 1000 : 0.556;
}

function spanGlyphs(s: [number, number, number, number], size: number, chars: { b: [number, number, number, number]; c: string }[]): Omit<Glyph, 'span'>[] {
  const [sx, sy, ex, ey] = s;
  const L = Math.hypot(ex - sx, ey - sy);
  if (!(size > 0) || !chars.length) return [];
  // A span with no advance (for example a font with zero widths) still paints. Its glyphs are kept, with no advance, so that their ink is not given to another glyph.
  if (!(L > 0)) return chars.map((ch) => ({ c: ch.c, x: sx, y: sy, dx: 1, dy: 0, len: 0, size, steep: false }));
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
function pixelBounds(g: Glyph, k: number, W: number, H: number, pad = 0): [number, number, number, number] {
  const f = frame(g);
  const pts: [number, number][] = [];
  for (const u of [-pad, g.len + pad]) for (const v of [-DESCENT * g.size - pad, ASCENT * g.size + pad]) pts.push([g.x + u * f.ux + v * f.vx, g.y + u * f.uy + v * f.vy]);
  const xs = pts.map((p) => p[0] * k);
  const ys = pts.map((p) => p[1] * k);
  return [Math.max(0, Math.floor(Math.min(...xs))), Math.max(0, Math.floor(Math.min(...ys))), Math.min(W, Math.ceil(Math.max(...xs))), Math.min(H, Math.ceil(Math.max(...ys)))];
}

/** Call `fn` for each pixel whose centre is inside the glyph box. */
/** `pad` (points) makes the box larger on each side. */
function eachPixel(g: Glyph, k: number, W: number, H: number, fn: (o: number) => void, pad = 0): number {
  const [x0, y0, x1, y1] = pixelBounds(g, k, W, H, pad);
  const f = frame(g);
  const lo = -DESCENT * g.size - pad;
  const hi = ASCENT * g.size + pad;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = (x + 0.5) / k - g.x;
      const py = (y + 0.5) / k - g.y;
      const u = px * f.ux + py * f.uy;
      const v = px * f.vx + py * f.vy;
      if (u >= -pad && u < g.len + pad && v >= lo && v <= hi) fn(y * W + x);
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
  // A dash or a dot has little ink, so a glyph with no letter or digit (after NFKC) needs only 2%.
  // Circled and squared letters open to letters under NFKC, so they need 8% like a letter.
  const shows = r.share.map((v, i) => v >= (/[\p{L}\p{N}]/u.test(glyphs[i].c.normalize('NFKC')) ? INK_MIN_SHARE : MARK_MIN_SHARE));
  // In a steep span the glyph places are estimates, so a glyph between 2 glyphs of its span that show also shows.
  const solid = (i: number) => i >= 0 && i < glyphs.length && !isSpace(glyphs[i].c);
  const out = shows.map((v, i) => {
    const g = glyphs[i];
    if (v || !g.steep || g.lead !== undefined) return v;
    return solid(i - 1) && solid(i + 1) && glyphs[i - 1].span === g.span && glyphs[i + 1].span === g.span && shows[i - 1] && shows[i + 1];
  });
  return { shows: out, marks: r.mark.map((v) => v >= MARK_MIN_SHARE), dup: r.dup };
}

/** For each glyph: does it show, and is it a copy of an earlier glyph (the same character at almost the same place). */
export type PageCheck = { shows: boolean[]; dup: boolean[]; marks?: boolean[] };

/** The share of each glyph box that is ink that only this glyph owns (0 to 1), or null when the page is too large to check. See visibleGlyphs. */
export function glyphInk(glyphs: readonly Glyph[], normal: Raster, noText: Raster, k: number): { share: number[]; mark: number[]; dup: boolean[] } | null {
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
  // A glyph with almost no advance (other than the second part of a pdflatex ligature) still
  // paints ink. For the owners, its box is 1 font size wide around its place, so its ink is
  // shared and no other glyph can take it.
  const owner = new Int32Array(W * H).fill(-1);
  let visits = 0;
  for (let i = 0; i < n; i++) {
    if (follows[i] >= 0 || isSpace(glyphs[i].c) || isLigaturePart(glyphs, i)) continue;
    const g = glyphs[i];
    if (g.len < MIN_ADVANCE * g.size) {
      // A glyph with almost no advance: every pixel within 1 font size of its place, in any direction, is shared.
      const r = g.size * k;
      const px0 = Math.max(0, Math.floor(g.x * k - r));
      const px1 = Math.min(W, Math.ceil(g.x * k + r));
      const py0 = Math.max(0, Math.floor(g.y * k - r));
      const py1 = Math.min(H, Math.ceil(g.y * k + r));
      for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) owner[y * W + x] = -2;
      visits += Math.max(0, px1 - px0) * Math.max(0, py1 - py0);
      if (visits > MAX_VISITS) return null;
      continue;
    }
    visits += eachPixel(g, k, W, H, (o) => {
      owner[o] = owner[o] === -1 ? i : owner[o] === i ? i : -2;
    });
    if (visits > MAX_VISITS) return null;
  }
  const a = normal.data;
  const b = noText.data;
  const shows = new Array<number>(n).fill(0);
  const marks = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const g = glyphs[i];
    if (follows[i] >= 0 || isSpace(g.c) || g.lead !== undefined) continue;
    // A zero-width glyph or a hairline never shows.
    if (g.len < MIN_ADVANCE * g.size) continue;
    let area = 0;
    let ink = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    visits += eachPixel(g, k, W, H, (o) => {
      area++;
      if (owner[o] !== i) return;
      if (!isInk(a, b, o, W, H)) return;
      ink++;
      const x = o % W;
      const y = (o - x) / W;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    });
    if (visits > MAX_VISITS) return null;
    marks[i] = area > 0 ? ink / area : 0;
    // The ink of a letter or digit fills a good part of the box of its font size and advance. A thin line or a dot does not.
    const inkBox = ink ? (x1 - x0 + 1) * (y1 - y0 + 1) : 0;
    if (/[\p{L}\p{N}]/u.test(g.c.normalize('NFKC')) && inkBox < MIN_INK_BOX * g.len * g.size * k * k) continue;
    shows[i] = marks[i];
  }
  for (let i = 0; i < n; i++) {
    if (follows[i] < 0) continue;
    shows[i] = shows[follows[i]];
    marks[i] = marks[follows[i]];
  }
  return { share: shows, mark: marks, dup };
}

/** A text-ink pixel counts as stray when it is more than 2 pixels outside every glyph box. */
const STRAY_PAD_PX = 2;
/** A page fails when more than 2% of its text ink is stray. */
export const MAX_STRAY_SHARE = 0.02;

/**
 * The share of the text ink of a page (pixels that differ by more than 24
 * between the normal picture and the picture with no text) that is outside every
 * glyph box made larger by 2 pixels. Stroked text with a wide line, sheared text
 * or text with a stretched matrix paints ink outside the boxes that txtwrite
 * gives, and that ink could cover a hidden glyph. Returns null when the page is too large to check.
 */
export function strayInk(glyphs: readonly Glyph[], normal: Raster, noText: Raster, k: number): number | null {
  const { width: W, height: H } = normal;
  if (noText.width !== W || noText.height !== H) return null;
  const inBox = new Uint8Array(W * H);
  let visits = 0;
  for (const g of glyphs) {
    visits += eachPixel(g, k, W, H, (o) => {
      inBox[o] = 1;
    }, STRAY_PAD_PX / k);
    if (visits > MAX_VISITS) return null;
  }
  const a = normal.data;
  const b = noText.data;
  let ink = 0;
  let stray = 0;
  for (let o = 0; o < W * H; o++) {
    const p = o * 3;
    if (Math.abs(a[p] - b[p]) > TOLERANCE || Math.abs(a[p + 1] - b[p + 1]) > TOLERANCE || Math.abs(a[p + 2] - b[p + 2]) > TOLERANCE) {
      ink++;
      if (!inBox[o]) stray++;
    }
  }
  return ink ? stray / ink : 0;
}

/** Letters for the line-up check: NFKC ligatures opened, NFKD, no marks, lower case, no white space. */
function letters(s: string): string {
  return s.normalize('NFKC').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s/gu, '');
}
const ALNUM_CHAR = /^[\p{L}\p{N}]$/u;
const LIGATURE_LETTER = /^[fil]$/;
/** Ghostscript 10.0 gives the first glyph of an f ligature in a font with no Unicode map the text U+6600 (the bytes of "f"). */
const LIGATURE_LEAD = '\u6600';
/** Ghostscript 10.0 gives the second glyph of ff, fi, fl, ffi and ffl (no advance) one of these texts. */
const LIGATURE_FOLLOWERS = ['\u6600', '\u6900', '\ucf00', '\u6c00'];
/** Ghostscript 10.02 gives the first glyph the text "f", and the parts (no advance) the texts f, i, l and U+00CF (the rest of ffi and ffl). */
const LIGATURE_LEAD_10_02 = 'f';
const LIGATURE_FOLLOWERS_10_02 = ['f', 'i', 'l', '\u00cf'];

/** True when the glyph is the first glyph of a pdflatex ligature, in the 10.0 or the 10.02 form. */
function isLigatureLead(c: string): boolean {
  return c === LIGATURE_LEAD || c === LIGATURE_LEAD_10_02;
}

/** True for the second glyph of a pdflatex ligature: no advance, after a lead glyph of the same form, with a known text. */
function isLigaturePart(glyphs: readonly Glyph[], i: number): boolean {
  const g = glyphs[i];
  if (g.lead === undefined) return false;
  const lead = glyphs[g.lead].c;
  return (lead === LIGATURE_LEAD && LIGATURE_FOLLOWERS.includes(g.c)) || (lead === LIGATURE_LEAD_10_02 && LIGATURE_FOLLOWERS_10_02.includes(g.c));
}
/** The most unknown glyphs (U+FFFD, private use) that one word may have. */
const MAX_UNKNOWN = 2;

type Token = { kind: 'text'; t: string[] } | { kind: 'unknown' } | { kind: 'lig'; lead: number; n: number };

/**
 * True when the tokens spell the word `want` (an array of characters). A text token
 * must match its characters exactly. A ligature token of n glyphs stands for n or n + 1
 * of the letters f, i and l (ff, fi, fl, ffi, ffl), at most 3. An unknown token stands for
 * one character, and a word may have at most 2 unknown tokens.
 * A character of the word that is not a letter or digit (a dash) may take one glyph of any
 * text, or none; a text token with no letter or digit may be left out.
 */
export function matchLetters(want: readonly string[], tokens: readonly Token[]): boolean {
  const seen = new Set<number>();
  const go = (i: number, j: number): boolean => {
    const key = i * 1000 + j;
    if (seen.has(key)) return false;
    seen.add(key);
    if (j === tokens.length) return want.slice(i).every((c) => !ALNUM_CHAR.test(c));
    const tk = tokens[j];
    if (i < want.length && !ALNUM_CHAR.test(want[i])) {
      if (go(i + 1, j)) return true;
      if ((tk.kind === 'unknown' || (tk.kind === 'text' && tk.t.length === 1)) && go(i + 1, j + 1)) return true;
    }
    if (tk.kind === 'text') {
      if (tk.t.every((c, k) => want[i + k] === c) && go(i + tk.t.length, j + 1)) return true;
      if (!tk.t.some((c) => ALNUM_CHAR.test(c)) && go(i, j + 1)) return true;
      return false;
    }
    if (tk.kind === 'unknown') return i < want.length && go(i + 1, j + 1);
    for (const k of [tk.n, tk.n + 1].filter((x) => x <= 3)) {
      if (k >= 2 && i + k <= want.length && want.slice(i, i + k).every((c) => LIGATURE_LETTER.test(c)) && go(i + k, j + 1)) return true;
    }
    return false;
  };
  if (tokens.filter((t) => t.kind === 'unknown').length > MAX_UNKNOWN) return false;
  return want.length < 1000 && tokens.length < 1000 && go(0, 0);
}

/** The point in the middle of the glyph box, in points. */
function centre(g: Glyph): [number, number] {
  const u = g.len / 2;
  const v = ((ASCENT - DESCENT) / 2) * g.size;
  return [g.x + u * g.dx + v * g.dy, g.y + u * g.dy - v * g.dx];
}

export type WordBox = { x0: number; y0: number; x1: number; y1: number; text: string };

/** Says, for each character of a pdftotext word, if it shows. */
export type CharCheck = { charsShown(w: WordBox): boolean[]; lineUp(w: WordBox, opts?: { shown?: boolean; part?: string }): boolean };

/** A page index of glyph centres, to find the glyphs of a pdftotext word. */
export class GlyphIndex implements CharCheck {
  private grid = new Map<string, number[]>();
  private centres: [number, number][];
  private static CELL = 8;
  private shows: readonly boolean[];
  private marks?: readonly boolean[];
  constructor(private glyphs: readonly Glyph[], check: PageCheck) {
    this.shows = check.shows;
    this.marks = check.marks;
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
   * True when Ghostscript has glyphs with the text of this pdftotext word at the
   * same place. A glyph counts only when its centre is inside the word box and its
   * height (the font size times 1.25) is from 0.6 to 1.6 times the box thickness, so
   * specks of a tiny font cannot stand for a word. The letters must agree exactly
   * (NFKD, no marks, lower case; see matchLetters). For the whole word, the centre of
   * the glyph run must also be within 2 pt (or 12% of the box thickness) of the centre of the box.
   * With `shown`, only glyphs that show count, so a hidden glyph cannot make the word
   * line up; the per-word check uses this. The page gate uses all glyphs, because it
   * checks that the 2 frames agree. `part` is the shown part of the word when some
   * characters are hidden.
   */
  lineUp(w: WordBox, opts: { shown?: boolean; part?: string } = {}): boolean {
    const part = opts.part;
    const want = [...letters(part ?? w.text)];
    if (!want.length) return true;
    const tol = Math.max(2, 0.12 * Math.min(w.x1 - w.x0, w.y1 - w.y0));
    const found = this.near(w)
      .filter((i) => {
        const lead = this.glyphs[i].lead;
        if (opts.shown && !(lead === undefined ? this.shows[i] : this.shows[lead])) return false;
        return this.sized(w, i);
      })
      .slice(0, 64);
    // A word with no letter or digit (a bullet, an arrow, a dash) needs at least one glyph of its size at its place
    // with ink (2%) and a normal advance. The ink-box rule for letters does not apply: a font with no Unicode
    // map can give a dash the text "4".
    if (!want.some((c) => ALNUM_CHAR.test(c))) {
      if (!opts.shown) return found.length > 0;
      return this.near(w).some((i) => (this.marks?.[i] ?? this.shows[i]) && this.sized(w, i));
    }
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    // Look for a run of glyphs, next to each other in text order, with the letters of the word.
    for (let a = 0; a < found.length; a++) {
      for (let b = a; b < found.length && b - a <= 2 * want.length + 2; b++) {
        const run = found.slice(a, b + 1);
        if (!matchLetters(want, this.tokens(run))) continue;
        if (part !== undefined) return true;
        const g = this.glyphs[run[0]];
        const h = this.glyphs[run[run.length - 1]];
        const up = ((ASCENT - DESCENT) / 2) * g.size;
        const mx = (g.x + h.x + h.len * h.dx) / 2 + up * g.dy;
        const my = (g.y + h.y + h.len * h.dy) / 2 - up * g.dx;
        if (Math.abs(mx - cx) <= tol && Math.abs(my - cy) <= tol) return true;
      }
    }
    return false;
  }

  /** True when the glyph height (font size × 1.25) is 0.6 to 1.6 times the thickness of the word box. */
  private sized(w: WordBox, i: number): boolean {
    const g = this.glyphs[i];
    const thick = Math.abs(g.dx) >= Math.abs(g.dy) ? w.y1 - w.y0 : w.x1 - w.x0;
    const height = (ASCENT + DESCENT) * g.size;
    return height >= 0.6 * thick && height <= 1.6 * thick;
  }

  /**
   * The letter tokens of a glyph run. A glyph with followers that have no advance
   * (a ligature with no Unicode map, for example U+6600 + U+6900 for "fi") is one
   * ligature token. A glyph U+FFFD or in the private use area is one unknown letter.
   * An accent glyph gives no token.
   */
  private tokens(run: number[]): Token[] {
    const out: Token[] = [];
    for (const i of run) {
      const g = this.glyphs[i];
      const last = out[out.length - 1];
      // Only Ghostscript's forms of an f ligature are ligature tokens: U+6600, then U+6600, U+6900, U+CF00 or U+6C00 (10.0), or f, then f, i, l or U+00CF (10.02).
      if (g.lead !== undefined && isLigaturePart(this.glyphs, i)) {
        if (last?.kind === 'lig' && last.lead === g.lead) last.n++;
        else out.push({ kind: 'lig', lead: g.lead, n: 1 });
        continue;
      }
      if (isLigatureLead(g.c) && run.some((j) => this.glyphs[j].lead === i && isLigaturePart(this.glyphs, j))) {
        out.push({ kind: 'lig', lead: i, n: 1 });
        continue;
      }
      const n = g.c.codePointAt(0) ?? 0;
      if ([...g.c].length === 1 && (n === 0xfffd || (n >= 0xe000 && n <= 0xf8ff))) {
        out.push({ kind: 'unknown' });
        continue;
      }
      const t = letters(g.c);
      if (t) out.push({ kind: 'text', t: [...t] });
    }
    return out;
  }

  /** The glyphs (not spaces, not copies) whose centre is in the box, in text order. */
  private near(w: { x0: number; y0: number; x1: number; y1: number }): number[] {
    const C = GlyphIndex.CELL;
    const cx0 = Math.floor(w.x0 / C);
    const cx1 = Math.floor(w.x1 / C);
    const cy0 = Math.floor(w.y0 / C);
    const cy1 = Math.floor(w.y1 / C);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 20_000) return [];
    const found: number[] = [];
    for (let x = cx0; x <= cx1; x++) {
      for (let y = cy0; y <= cy1; y++) {
        for (const i of this.grid.get(`${x},${y}`) ?? []) {
          const [px, py] = this.centres[i];
          if (px >= w.x0 && px <= w.x1 && py >= w.y0 && py <= w.y1) found.push(i);
        }
      }
    }
    if (!found.length) return found;
    const g0 = this.glyphs[found[0]];
    return found.sort((a, b) => this.centres[a][0] * g0.dx + this.centres[a][1] * g0.dy - (this.centres[b][0] * g0.dx + this.centres[b][1] * g0.dy));
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
      // A character of the word that is not a letter or digit (a dash) needs only the mark rule.
      if (lead === undefined) return ALNUM_CHAR.test(chars[j] ?? '') ? this.shows[i] : (this.marks?.[i] ?? this.shows[i]);
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
