import { afterAll, describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    const saved = process.env.WAYPOINT_SECRET_KEY;
    process.env.WAYPOINT_SECRET_KEY = 'must-not-pass';
    try {
      const e = baseEnv({ openin_any: 'p', EMPTY: undefined });
      // LANG is copied only when the parent has it, so check a subset.
      for (const k of Object.keys(e)) expect(['HOME', 'LANG', 'PATH', 'openin_any']).toContain(k);
      expect(e.openin_any).toBe('p');
      expect(e.PATH).toBe(process.env.PATH);
    } finally {
      if (saved === undefined) delete process.env.WAYPOINT_SECRET_KEY;
      else process.env.WAYPOINT_SECRET_KEY = saved;
    }
  });
});

const T = (cwd: string) => ({ cwd, timeoutMs: 1000 });
const FAKE_CLAUDE = '/nonexistent-waypoint-dir/claude';

function mcpTemplate(cwd: string, over: Record<number, string> = {}): string[] {
  const a = ['-p', '--output-format', 'json', '--model', 'claude-sonnet-5', '--tools', '', '--strict-mcp-config',
    '--mcp-config', join(cwd, '.mcp-empty.json'), '--setting-sources', '', '--no-session-persistence',
    '--system-prompt', 'Be brief.'];
  for (const [i, v] of Object.entries(over)) a[Number(i)] = v;
  return a;
}

describe('claude template', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exec-test-'));
  writeFileSync(join(dir, '.mcp-empty.json'), '{"mcpServers":{}}');
  const bad = mkdtempSync(join(tmpdir(), 'exec-test-'));
  writeFileSync(join(bad, '.mcp-empty.json'), '{"mcpServers":{"x":{"command":"id"}}}');
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  });

  it('accepts the exact template (stops only at the missing binary)', async () => {
    await expect(runProgram('claude', mcpTemplate(dir), { ...T(dir), bin: FAKE_CLAUDE })).rejects.toThrow(/did not start/);
  });

  it('refuses --tools=default', async () => {
    const a = mcpTemplate(dir);
    a.splice(5, 2, '--tools=default');
    await expect(runProgram('claude', a, T(dir))).rejects.toThrow(/--tools=default is not allowed/);
  });

  it('refuses a second --tools default (length)', async () => {
    await expect(runProgram('claude', [...mcpTemplate(dir), '--tools', 'default'], T(dir))).rejects.toThrow(/fixed template/);
  });

  it('refuses --settings=', async () => {
    await expect(runProgram('claude', [...mcpTemplate(dir), '--settings={"hooks":{}}'], T(dir))).rejects.toThrow(/--settings/);
  });

  it('refuses an mcp file that has a server', async () => {
    await expect(runProgram('claude', mcpTemplate(bad), T(bad))).rejects.toThrow(/mcp/i);
  });

  it('refuses an mcp file in another folder', async () => {
    await expect(runProgram('claude', mcpTemplate(dir, { 9: join(bad, '.mcp-empty.json') }), T(dir))).rejects.toThrow(/mcp/i);
  });

  it('refuses --system-prompt used to hide -p', async () => {
    const a = ['--system-prompt', '-p', ...mcpTemplate(dir).slice(1, 13)];
    await expect(runProgram('claude', a, T(dir))).rejects.toThrow(/fixed template/);
    await expect(runProgram('claude', mcpTemplate(dir, { 14: '-p' }), T(dir))).rejects.toThrow(/system prompt/i);
  });

  it('refuses --permission-mode=bypassPermissions', async () => {
    await expect(runProgram('claude', [...mcpTemplate(dir), '--permission-mode=bypassPermissions'], T(dir))).rejects.toThrow(/--permission-mode/);
  });

  it('refuses a model that is not Sonnet', async () => {
    await expect(runProgram('claude', mcpTemplate(dir, { 4: 'claude-opus-5' }), T(dir))).rejects.toThrow(/model/i);
  });

  it('refuses an env key outside the list', async () => {
    await expect(
      runProgram('claude', mcpTemplate(dir), { ...T(dir), env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'x' }, bin: FAKE_CLAUDE }),
    ).rejects.toThrow(/environment key ANTHROPIC_API_KEY is not allowed for claude/);
  });
});

describe('LaTeX template', () => {
  const dir = tmpdir();
  const good = ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', `-output-directory=${dir}`, 'x.tex'];
  const env = baseEnv({ openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: dir });
  const o = { cwd: dir, timeoutMs: 1000, env, memoryMb: 512, bin: '/nonexistent-waypoint-dir/pdflatex' };

  it('accepts the exact template (stops only at the missing binary)', async () => {
    // prlimit starts, then fails to run the missing binary: the check passed.
    const r = await runProgram('pdflatex', good, o);
    expect(r.code).not.toBe(0);
  });
  it('needs --safer and --nosocket for lualatex, and refuses them for pdflatex', async () => {
    const lua = { ...o, bin: '/nonexistent-waypoint-dir/lualatex' };
    await expect(runProgram('lualatex', good, lua)).rejects.toThrow(/shell/);
    const safe = ['-no-shell-escape', '--safer', '--nosocket', ...good.slice(1)];
    expect((await runProgram('lualatex', safe, lua)).code).not.toBe(0);
    await expect(runProgram('pdflatex', safe, o)).rejects.toThrow(/shell/);
  });
  it('refuses -jobname before the source', async () => {
    await expect(runProgram('pdflatex', ['-jobname', '-no-shell-escape', 'x.tex'], o)).rejects.toThrow(/shell/);
  });
  it('refuses an added -shell-restricted', async () => {
    await expect(runProgram('pdflatex', ['-shell-restricted', ...good], o)).rejects.toThrow(/shell/);
  });
  it('refuses another output directory', async () => {
    const a = [...good];
    a[3] = '-output-directory=/tmp/other';
    await expect(runProgram('pdflatex', a, o)).rejects.toThrow(/shell/);
  });
  it('refuses a tectonic call with the pdflatex template', async () => {
    await expect(runProgram('tectonic', good, { ...o, bin: '/nonexistent-waypoint-dir/tectonic' })).rejects.toThrow(/shell/);
  });
  it('refuses a missing openin_any', async () => {
    const e = { ...env } as Record<string, string>;
    delete e.openin_any;
    await expect(runProgram('pdflatex', good, { ...o, env: e })).rejects.toThrow(/openin_any/);
  });
  it('refuses a missing env', async () => {
    await expect(runProgram('pdflatex', good, { ...o, env: undefined })).rejects.toThrow(/openin_any/);
  });
  it('refuses a missing memoryMb', async () => {
    await expect(runProgram('pdflatex', good, { ...o, memoryMb: undefined })).rejects.toThrow(/memoryMb/);
  });
  it('refuses a TEXMFOUTPUT that is not the work folder', async () => {
    await expect(runProgram('pdflatex', good, { ...o, env: { ...env, TEXMFOUTPUT: '/' } })).rejects.toThrow(/TEXMFOUTPUT/);
  });
});

describe('pdftotext paths', () => {
  it.skipIf(!findOnPath('pdftotext'))('accepts -bbox-layout with paths inside a temp work folder (the check passes, the run fails)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'exec-test-'));
    try {
      const r = await runProgram('pdftotext', ['-bbox-layout', `${d}/missing.pdf`, `${d}/o.html`], T(d));
      expect(r.code).not.toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('refuses -bbox-layout with /etc/passwd in, and any other flag', async () => {
    const d = mkdtempSync(join(tmpdir(), 'exec-test-'));
    try {
      await expect(runProgram('pdftotext', ['-bbox-layout', '/etc/passwd', `${d}/o.html`], T(d))).rejects.toThrow(/pdftotext/);
      await expect(runProgram('pdftotext', ['-htmlmeta', `${d}/a.pdf`, `${d}/o.html`], T(d))).rejects.toThrow(/pdftotext/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('refuses /etc/passwd in and a home path out', async () => {
    await expect(
      runProgram('pdftotext', ['-layout', '/etc/passwd', `${homedir()}/out.txt`], T(tmpdir())),
    ).rejects.toThrow(/pdftotext/);
  });
  it('refuses a path that leaves the work folder with ..', async () => {
    const d = mkdtempSync(join(tmpdir(), 'exec-test-'));
    try {
      await expect(runProgram('pdftotext', ['-layout', `${d}/../x.pdf`, `${d}/o.txt`], T(d))).rejects.toThrow(/pdftotext/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('refuses a work folder outside the temp folder', async () => {
    await expect(runProgram('pdftotext', ['-layout', `${homedir()}/a.pdf`, `${homedir()}/o.txt`], T(homedir()))).rejects.toThrow(/pdftotext/);
  });
  it.skipIf(!findOnPath('pdftotext'))('accepts paths inside a temp work folder (the check passes, the run fails)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'exec-test-'));
    try {
      const r = await runProgram('pdftotext', ['-layout', `${d}/missing.pdf`, `${d}/o.txt`], T(d));
      expect(r.code).not.toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('general refusals', () => {
  it('refuses constructor and __proto__ as program names', async () => {
    // @ts-expect-error: not a Program
    await expect(runProgram('constructor', [], T(tmpdir()))).rejects.toThrow(ExecError);
    // @ts-expect-error: not a Program
    await expect(runProgram('__proto__', [], T(tmpdir()))).rejects.toThrow(ExecError);
  });
  it('refuses a NUL byte', async () => {
    await expect(runProgram('pdftotext', ['-v\0'], T(tmpdir()))).rejects.toThrow(/NUL/);
  });
  it('refuses a bin with another basename', async () => {
    await expect(runProgram('pdftotext', ['-v'], { ...T(tmpdir()), bin: '/bin/sh' })).rejects.toThrow(/not pdftotext/);
  });
  it('refuses a relative bin', async () => {
    await expect(runProgram('pdftotext', ['-v'], { ...T(tmpdir()), bin: 'pdftotext' })).rejects.toThrow(/absolute/);
  });
  it('refuses a bin inside the work folder', async () => {
    const d = tmpdir();
    await expect(runProgram('pdftotext', ['-v'], { ...T(d), bin: join(d, 'pdftotext') })).rejects.toThrow(/inside/);
  });
  it('refuses an env key outside the list', async () => {
    await expect(runProgram('pdftotext', ['-v'], { ...T(tmpdir()), env: { PATH: '/usr/bin', FOO: 'x' } })).rejects.toThrow(/environment key FOO is not allowed for pdftotext/);
  });
  it('refuses a bad timeout', async () => {
    await expect(runProgram('pdftotext', ['-v'], { cwd: tmpdir(), timeoutMs: 0 })).rejects.toThrow(/timeout/);
    await expect(runProgram('pdftotext', ['-v'], { cwd: tmpdir(), timeoutMs: Number.NaN })).rejects.toThrow(/timeout/);
    await expect(runProgram('pdftotext', ['-v'], { cwd: tmpdir(), timeoutMs: 600_001 })).rejects.toThrow(/timeout/);
  });
  it.skipIf(!findOnPath('pdftotext'))('survives EPIPE when the child exits early', async () => {
    const r = await runProgram('pdftotext', ['-v'], { cwd: tmpdir(), timeoutMs: 10_000, input: 'x'.repeat(2_000_000) });
    expect(r.code).toBe(0);
  });
});

describe('rclone and systemctl templates', () => {
  const o = (program: string) => ({ ...T(tmpdir()), bin: `/nonexistent-waypoint-dir/${program}` });
  const file = '/home/u/waypoint/data/backups/2026-10-17.db';

  it('accepts the exact rclone template (stops only at the missing binary)', async () => {
    await expect(runProgram('rclone', ['copy', '--no-traverse', file, 'gdrive:waypoint'], o('rclone'))).rejects.toThrow(/did not start/);
  });
  it('refuses another rclone command, flag, file or remote', async () => {
    const r = (a: string[]) => runProgram('rclone', a, o('rclone'));
    await expect(r(['sync', '--no-traverse', file, 'gdrive:w'])).rejects.toThrow(/rclone/);
    await expect(r(['copy', '--no-traverse', '--config=/x', file, 'gdrive:w'])).rejects.toThrow(/rclone/);
    await expect(r(['copy', '--no-traverse', '/etc/passwd', 'gdrive:w'])).rejects.toThrow(/backup file/);
    await expect(r(['copy', '--no-traverse', 'data/backups/2026-10-17.db', 'gdrive:w'])).rejects.toThrow(/backup file/);
    await expect(r(['copy', '--no-traverse', file, '--bwlimit=1'])).rejects.toThrow(/remote/);
    await expect(r(['copy', '--no-traverse', file, 'gdrive:a b'])).rejects.toThrow(/remote/);
    await expect(r(['copy', '--no-traverse', file, '-x:y'])).rejects.toThrow(/remote/);
  });
  it('accepts systemctl --user is-active for the two units', async () => {
    for (const u of ['waypoint-web', 'waypoint-worker']) {
      await expect(runProgram('systemctl', ['--user', 'is-active', u], o('systemctl'))).rejects.toThrow(/did not start/);
    }
  });
  it('refuses systemctl with any other unit name or argument', async () => {
    const r = (a: string[]) => runProgram('systemctl', a, o('systemctl'));
    await expect(r(['--user', 'is-active', 'ssh'])).rejects.toThrow(/systemctl/);
    await expect(r(['--user', 'stop', 'waypoint-web'])).rejects.toThrow(/systemctl/);
    await expect(r(['is-active', 'waypoint-web'])).rejects.toThrow(/systemctl/);
    await expect(r(['--user', 'is-active', 'waypoint-web', 'ssh'])).rejects.toThrow(/systemctl/);
  });
  it('refuses an env key outside the list', async () => {
    await expect(
      runProgram('systemctl', ['--user', 'is-active', 'waypoint-web'], { ...o('systemctl'), env: { PATH: '/usr/bin', LANG: 'C' } }),
    ).rejects.toThrow(/environment key LANG is not allowed for systemctl/);
    await expect(
      runProgram('rclone', ['copy', '--no-traverse', file, 'g:w'], { ...o('rclone'), env: { PATH: '/usr/bin', RCLONE_CONFIG: '/x', HOME: '/h' } }),
    ).rejects.toThrow(/did not start/);
  });
});
