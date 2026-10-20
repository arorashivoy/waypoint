import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\b`));
  if (!m) throw new Error(`Token --${name} is not a 6-digit hex colour in globals.css`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GLASS_FALLBACK = '#1A1724';

describe('design tokens', () => {
  const text = ['text', 'soft', 'mint', 'lav', 'butter', 'coral'];

  it.each(text)('--%s has 4.5:1 on --night', (name) => {
    expect(contrast(token(name), token('night'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(text)('--%s has 4.5:1 on the solid glass fallback', (name) => {
    expect(contrast(token(name), GLASS_FALLBACK)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['mint', 'lav'])('--ink-on has 4.5:1 on --%s', (name) => {
    expect(contrast(token('ink-on'), token(name))).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the solid fallback in a @supports rule', () => {
    expect(css).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)/);
    expect(css).toContain(GLASS_FALLBACK);
  });

  it('keeps no light hard-coded ground', () => {
    expect(css).not.toMatch(/#F4F1EA/i);
  });
});
