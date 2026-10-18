import { HttpError } from './auth/http';

/**
 * Checks for uploads (spec 2.5): a size limit for each kind, and the file
 * signature and the content type, not only the name.
 */

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_YAML_BYTES = 1024 * 1024;

/**
 * Checks the Content-Length of an upload before the body is read. A missing
 * or false length is refused too, so a client cannot send a body of any size.
 * `framing` is room for the multipart framing around the file.
 */
export function checkUploadLength(headers: Headers, maxBytes: number, tooLarge: string, framing = 1024 * 1024): void {
  const raw = headers.get('content-length');
  if (raw === null) throw new HttpError(411, 'Send the file with a Content-Length header.');
  const length = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(length)) throw new HttpError(400, 'The Content-Length header is not a number.');
  if (length > maxBytes + framing) throw new HttpError(413, tooLarge);
}

/** The file in the form field "file", after the length check. */
export async function readFormFile(req: Request, maxBytes: number, tooLarge: string): Promise<{ name: string; type: string; buf: Buffer }> {
  // formData() reads the whole body, so the size check must come first.
  checkUploadLength(req.headers, maxBytes, tooLarge, 64 * 1024);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Send the file as a form upload.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded.');
  if (file.size > maxBytes) throw new HttpError(413, tooLarge);
  return { name: file.name.slice(0, 200), type: file.type.toLowerCase(), buf: Buffer.from(await file.arrayBuffer()) };
}

const startsWith = (buf: Buffer, sig: number[]) => buf.length >= sig.length && sig.every((b, i) => buf[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04];

function utf8(buf: Buffer): string | null {
  if (buf.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

const YAML_TYPES = ['', 'application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml', 'text/plain', 'application/octet-stream'];
const PDF_TYPES = ['', 'application/pdf', 'application/x-pdf', 'application/octet-stream'];
const TEX_TYPES = ['', 'text/x-tex', 'application/x-tex', 'text/plain', 'application/octet-stream'];

/** The text of a YAML upload, or HttpError(400). */
export function sniffYaml(buf: Buffer, type: string): string {
  const text = !startsWith(buf, PDF) && !startsWith(buf, ZIP) && YAML_TYPES.includes(type) ? utf8(buf) : null;
  if (text === null) throw new HttpError(400, 'Upload a claims.yml text file.');
  return text.replace(/^﻿/, '');
}

/** A résumé upload: a PDF by its bytes, or a .tex file by its name and its text. */
export function sniffResume(name: string, type: string, buf: Buffer): { kind: 'pdf' } | { kind: 'tex'; text: string } {
  if (startsWith(buf, PDF) && PDF_TYPES.includes(type)) return { kind: 'pdf' };
  if (/\.tex$/i.test(name) && TEX_TYPES.includes(type) && !startsWith(buf, ZIP)) {
    const text = utf8(buf);
    if (text !== null) return { kind: 'tex', text: text.replace(/^﻿/, '') };
  }
  throw new HttpError(400, 'Upload the résumé as a PDF or a .tex file.');
}

/** The text of an own résumé source upload: a .tex name, text bytes, no PDF and no ZIP. Or HttpError(400). */
export function sniffTex(name: string, type: string, buf: Buffer): string {
  const text = /\.tex$/i.test(name) && TEX_TYPES.includes(type) && !startsWith(buf, PDF) && !startsWith(buf, ZIP) ? utf8(buf) : null;
  if (text === null) throw new HttpError(400, 'Upload the résumé source as a .tex text file.');
  return text.replace(/^﻿/, '');
}
