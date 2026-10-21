import { describe, expect, it } from 'vitest';
import { checkUploadLength, MAX_YAML_BYTES, sniffResume, sniffYaml } from '@/lib/uploads';

const h = (len?: string) => new Headers(len === undefined ? {} : { 'content-length': len });
/** The status of the HttpError that fn throws, or 0 when it does not throw. */
const statusOf = (fn: () => unknown): number => {
  try {
    fn();
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
  return 0;
};

describe('checkUploadLength', () => {
  it('answers 411 without the header, 400 for a false number and 413 for a large body', () => {
    expect(statusOf(() => checkUploadLength(h(), MAX_YAML_BYTES, 'big'))).toBe(411);
    expect(statusOf(() => checkUploadLength(h('12abc'), MAX_YAML_BYTES, 'big'))).toBe(400);
    expect(statusOf(() => checkUploadLength(h(String(MAX_YAML_BYTES + 200_000)), MAX_YAML_BYTES, 'big', 64 * 1024))).toBe(413);
    expect(statusOf(() => checkUploadLength(h('1000'), MAX_YAML_BYTES, 'big'))).toBe(0);
  });
});

describe('sniffYaml', () => {
  it('accepts UTF-8 text and removes a BOM', () => {
    expect(sniffYaml(Buffer.from('﻿version: 1\n'), 'application/x-yaml')).toBe('version: 1\n');
  });
  it('accepts a content type with parameters', () => {
    expect(sniffYaml(Buffer.from('version: 1\n'), 'text/yaml; charset=utf-8')).toBe('version: 1\n');
    expect(statusOf(() => sniffYaml(Buffer.from('version: 1'), 'image/png; charset=utf-8'))).toBe(400);
    expect(sniffResume('cv.tex', 'text/x-tex; charset=utf-8', Buffer.from('\\documentclass{article}'))).toMatchObject({ kind: 'tex' });
  });
  it('refuses a PDF, a zip, a NUL byte, bad UTF-8 and a wrong content type', () => {
    for (const [bytes, type] of [
      [Buffer.from('%PDF-1.7 ...'), ''],
      [Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), ''],
      [Buffer.from('version: 1\0'), ''],
      [Buffer.from([0xff, 0xfe, 0x41]), ''],
      [Buffer.from('version: 1'), 'image/png'],
    ] as [Buffer, string][]) {
      expect(statusOf(() => sniffYaml(bytes, type))).toBe(400);
    }
  });
});

describe('sniffResume', () => {
  it('knows a PDF by its bytes and a .tex file by its name and text', () => {
    expect(sniffResume('cv.pdf', 'application/pdf', Buffer.from('%PDF-1.7'))).toEqual({ kind: 'pdf' });
    expect(sniffResume('cv.tex', '', Buffer.from('\\documentclass{article}'))).toEqual({ kind: 'tex', text: '\\documentclass{article}' });
  });
  it('refuses a zip named .pdf, a PDF that says it is an image, and binary named .tex', () => {
    expect(statusOf(() => sniffResume('cv.pdf', 'application/pdf', Buffer.from([0x50, 0x4b, 0x03, 0x04])))).toBe(400);
    expect(statusOf(() => sniffResume('cv.pdf', 'image/png', Buffer.from('%PDF-1.7')))).toBe(400);
    expect(statusOf(() => sniffResume('cv.tex', '', Buffer.from([0, 1, 2])))).toBe(400);
  });
});
