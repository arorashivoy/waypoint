import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileLatex, engineArgs, findEngine } from '@/lib/latex';

describe('engineArgs', () => {
  it('turns shell escape off for pdflatex', () => {
    expect(engineArgs('pdflatex', 'tailored', '/w')).toEqual(['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-output-directory=/w', 'tailored.tex']);
  });
  it('runs tectonic in untrusted mode', () => {
    expect(engineArgs('tectonic', 'tailored', '/w')).toEqual(['-X', 'compile', '--untrusted', '--outdir', '/w', '--keep-logs', 'tailored.tex']);
  });
});

describe('findEngine', () => {
  it('accepts a full path whose file name is an engine', () => {
    const real = findEngine();
    if (!real) return;
    expect(findEngine(real.bin)).toEqual(real);
  });
  it('refuses a forced engine that is not on the list', () => {
    expect(findEngine('/bin/sh')).toBeNull();
  });
  it('refuses a forced engine with a relative path', () => {
    expect(findEngine('./bin/pdflatex')).toBeNull();
    expect(findEngine('bin/pdflatex')).toBeNull();
  });
});

const engine = findEngine();

describe.skipIf(!engine)('compileLatex', () => {
  it('compiles a small document', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-test-'));
    const out = join(dir, 'out.pdf');
    await compileLatex({ source: '\\documentclass{article}\\begin{document}Hi\\end{document}', assetsDir: null, outPdf: out, engine: engine!, timeoutMs: 60_000 });
    expect(existsSync(out)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 90_000);

  it('does not run \\write18', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-test-'));
    const marker = join(dir, 'pwned');
    const source = `\\documentclass{article}\\begin{document}\\immediate\\write18{touch ${marker}}Hi\\end{document}`;
    await compileLatex({ source, assetsDir: null, outPdf: join(dir, 'out.pdf'), engine: engine!, timeoutMs: 60_000 }).catch(() => {});
    expect(existsSync(marker)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 90_000);

  it('cannot read a file by absolute path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-test-'));
    const source = '\\documentclass{article}\\begin{document}\\input{/etc/hostname}\\end{document}';
    await expect(compileLatex({ source, assetsDir: null, outPdf: join(dir, 'out.pdf'), engine: engine!, timeoutMs: 60_000 })).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  }, 90_000);
});
