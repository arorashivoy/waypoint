import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

/**
 * The only module that starts a process.
 *
 * Text from users, postings and model replies never becomes a program or a
 * shell string. A caller names a program from a closed list, and the argument
 * check for that program refuses any shape that the app does not use. There is
 * no shell, so quotes and semicolons in an argument are plain characters.
 *
 * The lint rule in eslint.config.mjs stops any other module from importing
 * child_process.
 */

export type Program = 'claude' | 'pdflatex' | 'xelatex' | 'lualatex' | 'tectonic' | 'pdftotext';
export const LATEX_ENGINES: readonly Program[] = ['pdflatex', 'xelatex', 'lualatex', 'tectonic'];

export type RunOptions = {
  cwd: string;
  timeoutMs: number;
  input?: string;
  /** The full child environment. Use baseEnv() to make it. */
  env?: Record<string, string>;
  /** A limit on the address space, through prlimit. Not for Node programs:
   *  V8 reserves more address space than it uses. */
  memoryMb?: number;
  /** An explicit binary path, for WAYPOINT_CLAUDE_BIN or RESUME_ENGINE. Its
   *  file name must still be the program name. */
  bin?: string;
};
export type RunResult = { code: number; stdout: string; stderr: string };

export class ExecError extends Error {}

const MAX_OUTPUT = 5 * 1024 * 1024;
const SAFE_FILE = /^[A-Za-z0-9_-]+\.tex$/;

const CLAUDE_REQUIRED: [string, string | null][] = [
  ['-p', null],
  ['--tools', ''],
  ['--strict-mcp-config', null],
  ['--setting-sources', ''],
  ['--no-session-persistence', null],
];
const CLAUDE_FORBIDDEN = ['--bare', '--append-system-prompt', '--append-system-prompt-file', '--allowedTools', '--allowed-tools', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--add-dir', '--resume', '--continue', '-c', '-r', '--agents', '--plugin-dir', '--settings'];

function checkClaude(args: readonly string[]): string | null {
  for (const f of CLAUDE_FORBIDDEN) if (args.includes(f)) return `claude flag ${f} is not allowed`;
  for (const [flag, value] of CLAUDE_REQUIRED) {
    const i = args.indexOf(flag);
    if (i < 0) return `claude needs ${flag}`;
    if (value !== null && args[i + 1] !== value) return `claude ${flag} must be "${value}" (tools stay off)`;
  }
  return null;
}

function checkLatex(program: Program, args: readonly string[]): string | null {
  const flag = program === 'tectonic' ? '--untrusted' : '-no-shell-escape';
  if (!args.includes(flag)) return `${program} needs ${flag} (shell escape stays off)`;
  if (args.some((a) => /shell-escape|enable-write18/.test(a) && a !== '-no-shell-escape')) return 'shell escape is not allowed';
  const source = args[args.length - 1];
  if (!SAFE_FILE.test(source)) return 'the LaTeX source must be a plain file name in the work folder';
  return null;
}

function checkPdftotext(args: readonly string[]): string | null {
  if (args.length === 1 && args[0] === '-v') return null;
  if (args.length === 3 && args[0] === '-layout' && args.slice(1).every((a) => a.startsWith('/') && !a.includes('..'))) return null;
  return 'pdftotext takes only -v, or -layout <absolute in> <absolute out>';
}

const CHECKS: Record<Program, (args: readonly string[]) => string | null> = {
  claude: checkClaude,
  pdflatex: (a) => checkLatex('pdflatex', a),
  xelatex: (a) => checkLatex('xelatex', a),
  lualatex: (a) => checkLatex('lualatex', a),
  tectonic: (a) => checkLatex('tectonic', a),
  pdftotext: checkPdftotext,
};

export function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* not in this folder */
    }
  }
  return null;
}

export function baseEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG'] as const) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v;
  return out;
}

export async function runProgram(program: Program, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  // An own-property check, so a name such as "constructor" is refused too.
  if (!Object.prototype.hasOwnProperty.call(CHECKS, program)) throw new ExecError(`program ${String(program)} is not on the list`);
  const check = CHECKS[program];
  if (args.some((a) => a.includes('\0'))) throw new ExecError('an argument contains a NUL byte');
  const why = check(args);
  if (why) throw new ExecError(why);

  if (opts.bin && basename(opts.bin) !== program) throw new ExecError(`${opts.bin} is not ${program}`);
  const bin = opts.bin || findOnPath(program);
  if (!bin) throw new ExecError(`${program} is not installed`);

  let cmd = bin;
  let argv = [...args];
  if (opts.memoryMb) {
    const prlimit = findOnPath('prlimit');
    if (prlimit) {
      argv = [`--as=${opts.memoryMb * 1024 * 1024}`, '--', bin, ...args];
      cmd = prlimit;
    }
  }

  return new Promise((resolve, reject) => {
    const env = (opts.env ?? baseEnv()) as NodeJS.ProcessEnv;
    const child = spawn(cmd, argv, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    let size = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ExecError(`${program} took longer than ${opts.timeoutMs} ms`));
    }, opts.timeoutMs);
    const take = (which: 'out' | 'err') => (d: Buffer) => {
      size += d.length;
      if (size > MAX_OUTPUT) {
        child.kill('SIGKILL');
        return;
      }
      if (which === 'out') stdout += d;
      else stderr += d;
    };
    child.stdout.on('data', take('out'));
    child.stderr.on('data', take('err'));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new ExecError(`${program} did not start: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(opts.input ?? '');
  });
}
