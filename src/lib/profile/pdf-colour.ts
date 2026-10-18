/**
 * Hidden-by-colour check for PDFs (spec 6.4). `pdftotext` cannot see colour,
 * so this looks at a picture of each page from `pdftoppm`. A word is invisible
 * when no pixel in its box differs from the colour around the box. The check
 * uses pixels only, so no text of the PDF (font names, for example) is parsed.
 */

export type Rgb = [number, number, number];
/** A box as fractions (0 to 1) of the page, so a picture of any size can use it. */
export type Region = { x0: number; y0: number; x1: number; y1: number };

export const NO_COLOUR_WARNING = 'Waypoint could not check text colour in this PDF.';
/** "Close" is 24 on every channel. */
const TOLERANCE = 24;
const RING = 2;
const MAX_SAMPLES = 200;
const MAX_PIXELS = 4_000_000;
/** The largest PPM file that Waypoint reads. A picture of 1000 x 1000 pixels is 3 000 015 bytes. */
export const MAX_PPM_BYTES = 3 * 1024 * 1024;

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


/**
 * True when no pixel inside the region differs from the median colour of the
 * 2 pixel ring around it by more than 24 on any channel. Returns null when the
 * ring has no pixels (the region is the whole picture): the word is not checked.
 */
export function isInvisible(img: Raster, r: Region): boolean | null {
  const bg = ringColour(img, r);
  if (!bg) return null;
  const { width: W, height: H, data } = img;
  const x0 = Math.max(0, Math.floor(r.x0 * W));
  const y0 = Math.max(0, Math.floor(r.y0 * H));
  // A box has at least 1 pixel.
  const x1 = Math.min(W, Math.max(x0 + 1, Math.ceil(r.x1 * W)));
  const y1 = Math.min(H, Math.max(y0 + 1, Math.ceil(r.y1 * H)));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 3;
      if (Math.abs(data[o] - bg[0]) > TOLERANCE || Math.abs(data[o + 1] - bg[1]) > TOLERANCE || Math.abs(data[o + 2] - bg[2]) > TOLERANCE) return false;
    }
  }
  return true;
}
