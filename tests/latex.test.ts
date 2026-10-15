import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProgram } from '@/lib/exec';
import { compileBudget, compileLatex, engineArgs, findEngine } from '@/lib/latex';

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

describe('compileBudget', () => {
  it('caps a compile at 60 seconds', () => {
    expect(compileBudget(600_000)).toBe(60_000);
    expect(compileBudget(180_000)).toBe(60_000);
    expect(compileBudget(5_000)).toBe(5_000);
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

  it('does not run \\write18, and shell escape is off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-test-'));
    try {
      const marker = join(dir, 'pwned');
      const out = join(dir, 'out.pdf');
      const body = engine!.program === 'pdflatex' ? '\\ifnum\\pdfshellescape=0 NOSHELL\\else SHELL\\fi' : 'Hi';
      const source = `\\documentclass{article}\\begin{document}\\immediate\\write18{touch ${marker}}${body}\\end{document}`;
      await compileLatex({ source, assetsDir: null, outPdf: out, engine: engine!, timeoutMs: 60_000 }).catch(() => {});
      expect(existsSync(marker)).toBe(false);
      // pdflatex only: \pdfshellescape is 0 with -no-shell-escape, and 2 (restricted) without it.
      if (engine!.program === 'pdflatex') {
        const txt = join(dir, 'out.txt');
        await runProgram('pdftotext', ['-layout', out, txt], { cwd: dir, timeoutMs: 10_000 });
        expect(readFileSync(txt, 'utf8')).toContain('NOSHELL');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it('does not copy a symlinked asset from outside the folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-test-'));
    try {
      writeFileSync(join(dir, 'secret.txt'), '\\relax');
      const assets = join(dir, 'assets');
      mkdirSync(assets);
      symlinkSync(join(dir, 'secret.txt'), join(assets, 'evil.cls'));
      const source = '\\documentclass{article}\\begin{document}\\input{evil.cls}Hi\\end{document}';
      await expect(compileLatex({ source, assetsDir: assets, outPdf: join(dir, 'out.pdf'), engine: engine!, timeoutMs: 60_000 })).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it('cannot read a file by absolute path, and the error names no path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-test-'));
    try {
      const source = '\\documentclass{article}\\begin{document}\\input{/etc/hostname}\\end{document}';
      const err = await compileLatex({ source, assetsDir: null, outPdf: join(dir, 'out.pdf'), engine: engine!, timeoutMs: 60_000 }).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      expect(err!.message).not.toContain('/etc/hostname');
      expect(err!.message).not.toContain(tmpdir());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
