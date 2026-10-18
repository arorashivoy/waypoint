/**
 * White-text and same-colour-as-background check for PDFs (spec 6.4).
 * `pdftotext` cannot see colour, so this reads `pdftohtml -xml` (font colours
 * and text boxes) and a low-resolution picture from `pdftoppm` (page colours).
 * A text box is hidden when its font colour is close to the colour around it.
 * All reads are bounded.
 */

export type Rgb = [number, number, number];
/** A box as fractions (0 to 1) of the page, so two tools with different scales can compare it. */
export type Region = { page: number; x0: number; y0: number; x1: number; y1: number };
/** The colour around a region, or null when the picture has no data for it. */
export type Background = (page: number, region: Region) => Rgb | null;

export const NO_COLOUR_WARNING = 'Waypoint could not check text colour in this PDF.';
const MAX_XML = 5 * 1024 * 1024;
const MAX_XML_ELEMENTS = 50_000;
/** With no picture, the page is taken as white and "close" is 16. */
const WHITE_TOLERANCE = 16;
/** With a picture, "close" is 24 on every channel. */
const BACKGROUND_TOLERANCE = 24;
const RING = 2;
const MAX_SAMPLES = 200;
const MAX_PIXELS = 4_000_000;

const close = (a: Rgb, b: Rgb, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/** The attributes of a tag as a map. A name that repeats: the last value wins. `id` is read first-wins, because pdftohtml writes it before any free text. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]{0,40})="([^"]{0,200})"/g)) {
    if (m[1] === 'id' && out.has('id')) continue;
    out.set(m[1], m[2]);
  }
  return out;
}

function parseColour(v: string | undefined): Rgb | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(v ?? '');
  return m ? ([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb) : null;
}

/**
 * The regions of `pdftohtml -xml` text whose font colour is close to the colour
 * around the text. `background` gives that colour; without it the page is white.
 * A font with no valid #rrggbb colour is taken as black, the PDF default.
 * Throws when the XML is over 5 MB or has over 50 000 elements.
 */
export function colourHiddenRegions(xml: string, background?: Background): Region[] {
  if (xml.length > MAX_XML) throw new Error('The XML is too large.');
  const fonts = new Map<string, Rgb>();
  const out: Region[] = [];
  let page = 0;
  let pw = 0;
  let ph = 0;
  let count = 0;
  const re = /<fontspec\b([\s\S]{0,2000}?)\/>\s*(?=<|$)|<text\b([^>]{0,500})>([\s\S]{0,20000}?)<\/text>|<page\b([^>]{0,500})>/g;
  for (const m of xml.matchAll(re)) {
    if (++count > MAX_XML_ELEMENTS) throw new Error('The XML has too many elements.');
    if (m[1] !== undefined) {
      const a = attributes(m[1]);
      const id = a.get('id');
      if (id !== undefined) fonts.set(id, parseColour(a.get('color')) ?? [0, 0, 0]);
    } else if (m[4] !== undefined) {
      const a = attributes(m[4]);
      page = Number(a.get('number')) || page + 1;
      pw = Number(a.get('width')) || 0;
      ph = Number(a.get('height')) || 0;
    } else {
      const a = attributes(m[2]);
      const [top, left, w, h] = ['top', 'left', 'width', 'height'].map((k) => Number(a.get(k)));
      const colour = fonts.get(a.get('font') ?? '');
      if (!colour || !pw || !ph || ![top, left, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      const region = { page, x0: left / pw, y0: top / ph, x1: (left + w) / pw, y1: (top + h) / ph };
      const bg = background?.(page, region) ?? null;
      if (bg ? close(colour, bg, BACKGROUND_TOLERANCE) : close(colour, [255, 255, 255], WHITE_TOLERANCE)) out.push(region);
    }
  }
  return out;
}

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

const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];

/** The median colour of the pixels in a 2 pixel ring just outside the region. Null when there are none. */
export function ringColour(img: Raster, r: Region): Rgb | null {
  const { width: W, height: H, data } = img;
  const ix0 = Math.max(0, Math.floor(r.x0 * W));
  const iy0 = Math.max(0, Math.floor(r.y0 * H));
  const ix1 = Math.min(W, Math.ceil(r.x1 * W));
  const iy1 = Math.min(H, Math.ceil(r.y1 * H));
  const ox0 = Math.max(0, ix0 - RING);
  const oy0 = Math.max(0, iy0 - RING);
  const ox1 = Math.min(W, ix1 + RING);
  const oy1 = Math.min(H, iy1 + RING);
  const total = (ox1 - ox0) * (oy1 - oy0) - Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  if (total <= 0) return null;
  const step = Math.ceil(total / MAX_SAMPLES);
  const ch: number[][] = [[], [], []];
  let n = 0;
  for (let y = oy0; y < oy1; y++) {
    for (let x = ox0; x < ox1; x++) {
      if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue;
      if (n++ % step) continue;
      const o = (y * W + x) * 3;
      ch[0].push(data[o]);
      ch[1].push(data[o + 1]);
      ch[2].push(data[o + 2]);
    }
  }
  return ch[0].length ? [median(ch[0]), median(ch[1]), median(ch[2])] : null;
}

/** A Background from the pictures of the pages (page number to raster). A page with no picture gives null. */
export function backgroundFrom(pages: ReadonlyMap<number, Raster>): Background {
  return (page, region) => {
    const img = pages.get(page);
    return img ? ringColour(img, region) : null;
  };
}
