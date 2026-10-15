import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { baseEnv, findOnPath, runProgram, ExecError } from '@/lib/exec';

describe('runProgram', () => {
  it('refuses a program that is not on the list', async () => {
    // @ts-expect-error: 'sh' is not a Program
    await expect(runProgram('sh', ['-c', 'id'], { cwd: tmpdir(), timeoutMs: 1000 })).rejects.toThrow(ExecError);
  });

  it('refuses claude arguments that turn tools on', async () => {
    await expect(runProgram('claude', ['-p', '--tools', 'default'], { cwd: tmpdir(), timeoutMs: 1000 })).rejects.toThrow(/tools/);
  });

  it('refuses claude arguments with --bare or --append-system-prompt', async () => {
    const ok = ['-p', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'];
    await expect(runProgram('claude', [...ok, '--bare'], { cwd: tmpdir(), timeoutMs: 1000 })).rejects.toThrow(/--bare/);
    await expect(runProgram('claude', [...ok, '--append-system-prompt', 'x'], { cwd: tmpdir(), timeoutMs: 1000 })).rejects.toThrow(/append/);
  });

  it('refuses LaTeX arguments without the no-shell-escape flag', async () => {
    await expect(runProgram('pdflatex', ['-interaction=nonstopmode', 'a.tex'], { cwd: tmpdir(), timeoutMs: 1000 })).rejects.toThrow(/shell/);
  });

  it('refuses a LaTeX source path with a folder in it', async () => {
    await expect(
      runProgram('pdflatex', ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '../x.tex'], { cwd: tmpdir(), timeoutMs: 1000 }),
    ).rejects.toThrow(/file name/);
  });

  it.skipIf(!findOnPath('pdftotext'))('runs an allowed program without a shell', async () => {
    const r = await runProgram('pdftotext', ['-v'], { cwd: tmpdir(), timeoutMs: 10_000 });
    expect(r.code).toBe(0);
    expect(r.stderr + r.stdout).toMatch(/pdftotext/i);
  });
});

describe('baseEnv', () => {
  it('keeps only PATH, HOME and LANG plus the extras given', () => {
    process.env.WAYPOINT_SECRET_KEY = 'must-not-pass';
    const e = baseEnv({ openin_any: 'p', EMPTY: undefined });
    // LANG is copied only when the parent has it, so check a subset.
    for (const k of Object.keys(e)) expect(['HOME', 'LANG', 'PATH', 'openin_any']).toContain(k);
    expect(e.openin_any).toBe('p');
    expect(e.PATH).toBe(process.env.PATH);
  });
});
