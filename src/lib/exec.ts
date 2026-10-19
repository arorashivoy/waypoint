import { spawn } from 'node:child_process';
import { accessSync, constants, lstatSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * The only module that starts a process.
 *
 * Text from users, postings and model replies never becomes a program or a
 * shell string. A caller names a program from a closed list, and the check for
 * that program compares the arguments with one exact template. A check never
 * looks for "bad" flags only. An argument that is not in the template is
 * refused. There is no shell, so quotes and semicolons are plain characters.
 *
 * The lint rule in eslint.config.mjs stops any other module from
 * importing child_process.
 */

export type Program = 'claude' | 'pdflatex' | 'xelatex' | 'lualatex' | 'tectonic' | 'pdftotext' | 'gs' | 'rclone' | 'systemctl';
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
  /** An absolute binary path, for WAYPOINT_CLAUDE_BIN or RESUME_ENGINE. It
   *  must be outside cwd, and its file name must be the program name. */
  bin?: string;
};
export type RunResult = { code: number; stdout: string; stderr: string };

export class ExecError extends Error {}

const MAX_OUTPUT = 5 * 1024 * 1024;
const MAX_TIMEOUT_MS = 600_000;
const SAFE_SOURCE = /^[A-Za-z0-9_][A-Za-z0-9_-]*\.tex$/;
const SONNET = /^claude-sonnet-\d[a-z0-9-]*$/;
const MCP_NAME = '.mcp-empty.json';
const MCP_EMPTY = '{"mcpServers":{}}';

// A claude flag that the app never uses. A token is refused if it equals the
// flag or starts with "<flag>=". These checks run first, so the message names the flag.
const CLAUDE_FORBIDDEN = [
  '--bare', '--append-system-prompt', '--append-system-prompt-file', '--allowedTools', '--allowed-tools',
  '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--add-dir', '--resume',
  '--continue', '--agents', '--plugin-dir', '--settings', '--permission-mode', '-c', '-r',
];
// These two flags are in the template, but only as a separate token.
const CLAUDE_FORBIDDEN_JOINED = ['--tools=', '--mcp-config='];

// The 15 arguments of a claude call. null marks a value that has its own check.
const CLAUDE_TEMPLATE: (string | null)[] = [
  '-p', '--output-format', 'json', '--model', null, '--tools', '', '--strict-mcp-config',
  '--mcp-config', null, '--setting-sources', '', '--no-session-persistence', '--system-prompt', null,
];

function checkClaude(args: readonly string[], opts: RunOptions): string | null {
  for (const t of args) {
    for (const f of CLAUDE_FORBIDDEN) if (t === f || t.startsWith(`${f}=`)) return `claude flag ${t} is not allowed`;
    for (const f of CLAUDE_FORBIDDEN_JOINED) if (t.startsWith(f)) return `claude flag ${t} is not allowed`;
  }
  let bad = -1;
  for (let i = 0; i < CLAUDE_TEMPLATE.length; i++) {
    const want = CLAUDE_TEMPLATE[i];
    if (want !== null && args[i] !== want) {
      bad = i;
      break;
    }
  }
  if (bad < 0 && args.length !== CLAUDE_TEMPLATE.length) bad = CLAUDE_TEMPLATE.length;
  if (bad >= 0) return `claude arguments must match the fixed template (tools stay off); argument ${bad} is "${args[bad] ?? ''}"`;

  if (!SONNET.test(args[4])) return `claude model "${args[4]}" is not a Sonnet model`;

  const mcp = args[9];
  if (!isAbsolute(mcp) || resolve(mcp) !== mcp || dirname(mcp) !== resolve(opts.cwd) || basename(mcp) !== MCP_NAME) {
    return `the claude mcp file must be ${MCP_NAME} in the work folder`;
  }
  try {
    if (!lstatSync(mcp).isFile() || readFileSync(mcp, 'utf8') !== MCP_EMPTY) return `the claude mcp file must hold exactly ${MCP_EMPTY}`;
  } catch {
    return `the claude mcp file ${MCP_NAME} cannot be read`;
  }

  if (args[14] === '' || args[14].startsWith('-')) return 'the claude system prompt must not be empty and must not start with "-"';
  return null;
}

/** lualatex runs Lua code from the source. --safer turns off io, os.execute and unsafe libraries; --nosocket turns off the network. */
export const LUA_SAFE = ['--safer', '--nosocket'] as const;

function checkLatex(program: Program, args: readonly string[], opts: RunOptions): string | null {
  const source = args[args.length - 1];
  if (typeof source !== 'string' || !SAFE_SOURCE.test(source)) return 'the LaTeX source must be a plain file name in the work folder';
  const out = resolve(opts.cwd);
  const want =
    program === 'tectonic'
      ? ['-X', 'compile', '--untrusted', '--outdir', out, '--keep-logs', source]
      : ['-no-shell-escape', ...(program === 'lualatex' ? LUA_SAFE : []), '-interaction=nonstopmode', '-halt-on-error', `-output-directory=${out}`, source];
  if (args.length !== want.length || want.some((w, i) => args[i] !== w)) {
    return `${program} arguments must match the fixed template (shell escape stays off)`;
  }
  const env = opts.env;
  if (!env || env.openin_any !== 'p' || env.openout_any !== 'p') return `${program} needs openin_any=p and openout_any=p in the environment`;
  if (env.TEXMFOUTPUT !== undefined && env.TEXMFOUTPUT !== out) return 'TEXMFOUTPUT must be the work folder';
  const m = opts.memoryMb;
  if (typeof m !== 'number' || !Number.isSafeInteger(m) || m <= 0) return `${program} needs memoryMb as a positive whole number`;
  return null;
}

function inside(child: string, parent: string): boolean {
  return child.startsWith(parent + sep);
}

function checkPdftotext(args: readonly string[], opts: RunOptions): string | null {
  if (args.length === 1 && args[0] === '-v') return null;
  if (args.length === 3 && (args[0] === '-layout' || args[0] === '-bbox-layout')) {
    const cwd = resolve(opts.cwd);
    if (inside(cwd, resolve(tmpdir())) && inside(resolve(args[1]), cwd) && inside(resolve(args[2]), cwd)) return null;
  }
  // -cropbox puts the word boxes in the frame of the crop box, as Ghostscript -dUseCropBox does.
  if (args.length === 4 && args[0] === '-cropbox' && args[1] === '-bbox-layout') {
    const cwd = resolve(opts.cwd);
    if (inside(cwd, resolve(tmpdir())) && inside(resolve(args[2]), cwd) && inside(resolve(args[3]), cwd)) return null;
  }
  return 'pdftotext takes only -v, or -layout, -bbox-layout or -cropbox -bbox-layout <in> <out> with both files inside a work folder in the temp folder';
}

// Ghostscript draws the first 10 pages normally and with no text, and writes the glyph positions (txtwrite),
// to find text that a person cannot see. The templates are fixed; only the resolution is a number that
// Waypoint computes from the page size, so that the long side of a picture is at most 1000 pixels.
export const GS_COMMON = ['-dSAFER', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dFirstPage=1', '-dLastPage=10', '-dUseCropBox'] as const;
export const GS_MAX_DPI = 300;
export type GsJob = 'render' | 'no-text' | 'text';
export const GS_OUTPUT: Record<GsJob, string> = { render: 'n-%02d.ppm', 'no-text': 'f-%02d.ppm', text: 'text.xml' };

/** The arguments for one Ghostscript job. `dpi` is used for the 2 pictures; txtwrite always runs at 720 dpi. */
export function gsArgs(job: GsJob, dpi: number, input: string, cwd: string): string[] {
  const out = `-sOutputFile=${join(resolve(cwd), GS_OUTPUT[job])}`;
  if (job === 'text') return [...GS_COMMON, '-r720', '-sDEVICE=txtwrite', '-dTextFormat=0', out, input];
  return [...GS_COMMON, `-r${dpi}`, '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', ...(job === 'no-text' ? ['-dFILTERTEXT'] : []), '-sDEVICE=ppmraw', out, input];
}

function checkGs(args: readonly string[], opts: RunOptions): string | null {
  const why = 'gs takes only the 3 fixed templates (render, no-text, text) with a resolution from 1 to 300 and the files inside a work folder in the temp folder';
  const cwd = resolve(opts.cwd);
  if (!inside(cwd, resolve(tmpdir())) || cwd.includes('%')) return why;
  const input = args[args.length - 1];
  if (typeof input !== 'string' || !isAbsolute(input) || resolve(input) !== input || !inside(input, cwd)) return why;
  const same = (want: string[]) => args.length === want.length && want.every((w, i) => args[i] === w);
  if (same(gsArgs('text', 0, input, cwd))) return null;
  const m = /^-r([1-9]\d{0,2})$/.exec(args[GS_COMMON.length] ?? '');
  const dpi = m ? Number(m[1]) : 0;
  if (dpi < 1 || dpi > GS_MAX_DPI) return why;
  if (same(gsArgs('render', dpi, input, cwd)) || same(gsArgs('no-text', dpi, input, cwd))) return null;
  return why;
}

export const RCLONE_REMOTE = /^[A-Za-z0-9][A-Za-z0-9_-]*:[A-Za-z0-9._\/-]*$/;
const BACKUP_FILE = /^\d{4}-\d{2}-\d{2}(-users\.tar\.gz|\.db)$/;
const UNITS = ['waypoint-web', 'waypoint-worker'];

// rclone copies one backup file to the remote. Nothing else is allowed.
function checkRclone(args: readonly string[]): string | null {
  if (args.length !== 4 || args[0] !== 'copy' || args[1] !== '--no-traverse') {
    return 'rclone arguments must be copy --no-traverse <file> <remote>';
  }
  const file = args[2];
  if (!isAbsolute(file) || resolve(file) !== file || !BACKUP_FILE.test(basename(file))) {
    return 'the rclone file must be an absolute path of a backup file';
  }
  if (!RCLONE_REMOTE.test(args[3])) return 'the rclone remote must look like name:folder';
  return null;
}

function checkSystemctl(args: readonly string[]): string | null {
  if (args.length === 3 && args[0] === '--user' && args[1] === 'is-active' && UNITS.includes(args[2])) return null;
  return 'systemctl takes only --user is-active waypoint-web or waypoint-worker';
}

const CHECKS: Record<Program, (args: readonly string[], opts: RunOptions) => string | null> = {
  claude: checkClaude,
  pdflatex: (a, o) => checkLatex('pdflatex', a, o),
  xelatex: (a, o) => checkLatex('xelatex', a, o),
  lualatex: (a, o) => checkLatex('lualatex', a, o),
  tectonic: (a, o) => checkLatex('tectonic', a, o),
  pdftotext: checkPdftotext,
  gs: checkGs,
  rclone: (a) => checkRclone(a),
  systemctl: (a) => checkSystemctl(a),
};

const BASE_KEYS = ['PATH', 'HOME', 'LANG'];
const LATEX_KEYS = [...BASE_KEYS, 'openin_any', 'openout_any', 'TEXMFOUTPUT'];
const ENV_KEYS: Record<Program, readonly string[]> = {
  claude: [...BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'],
  pdflatex: LATEX_KEYS,
  xelatex: LATEX_KEYS,
  lualatex: LATEX_KEYS,
  tectonic: LATEX_KEYS,
  pdftotext: BASE_KEYS,
  gs: BASE_KEYS,
  rclone: ['HOME', 'PATH', 'RCLONE_CONFIG'],
  systemctl: ['HOME', 'PATH', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'],
};

/** The environment for a program: the allowed keys that the parent process has. */
export function programEnv(program: Program): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_KEYS[program]) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

export function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const p = join(dir, name);
    try {
      if (!statSync(p).isFile()) continue;
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
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new ExecError('every argument must be a string');
  if (args.some((a) => a.includes('\0'))) throw new ExecError('an argument contains a NUL byte');
  if (typeof opts.cwd !== 'string' || !isAbsolute(opts.cwd)) throw new ExecError('cwd must be an absolute path');
  if (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs <= 0 || opts.timeoutMs > MAX_TIMEOUT_MS) {
    throw new ExecError(`timeoutMs must be a whole number from 1 to ${MAX_TIMEOUT_MS}`);
  }
  const why = CHECKS[program](args, opts);
  if (why) throw new ExecError(why);

  if (opts.env) {
    for (const k of Object.keys(opts.env)) {
      if (!ENV_KEYS[program].includes(k)) throw new ExecError(`environment key ${k} is not allowed for ${program}`);
    }
  }

  if (opts.bin !== undefined) {
    if (!isAbsolute(opts.bin)) throw new ExecError('bin must be an absolute path');
    if (basename(opts.bin) !== program) throw new ExecError(`${opts.bin} is not ${program}`);
    if (inside(resolve(opts.bin), resolve(opts.cwd))) throw new ExecError('bin must not be inside the work folder');
  }
  const bin = opts.bin || findOnPath(program);
  if (!bin) throw new ExecError(`${program} is not installed`);

  let cmd = bin;
  let argv = [...args];
  if (opts.memoryMb !== undefined) {
    if (!Number.isSafeInteger(opts.memoryMb) || opts.memoryMb <= 0) throw new ExecError('memoryMb must be a positive whole number');
    const prlimit = findOnPath('prlimit');
    if (!prlimit) throw new ExecError('prlimit is not installed, so the memory limit cannot be set');
    argv = [`--as=${opts.memoryMb * 1024 * 1024}`, '--', bin, ...args];
    cmd = prlimit;
  }

  return new Promise((resolvePromise, reject) => {
    const env = (opts.env ?? baseEnv()) as NodeJS.ProcessEnv;
    const child = spawn(cmd, argv, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: true });
    let stdout = '';
    let stderr = '';
    let size = 0;
    let failed = false;
    // Kill the whole process group, so a child of the child stops too.
    const kill = () => {
      try {
        if (child.pid === undefined) throw new Error('no pid');
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const fail = (e: ExecError) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      kill();
      reject(e);
    };
    const timer = setTimeout(() => fail(new ExecError(`${program} took longer than ${opts.timeoutMs} ms`)), opts.timeoutMs);
    const take = (which: 'out' | 'err') => (d: string) => {
      size += Buffer.byteLength(d);
      if (size > MAX_OUTPUT) return fail(new ExecError(`${program} output is larger than 5 MB`));
      if (which === 'out') stdout += d;
      else stderr += d;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', take('out'));
    child.stderr.on('data', take('err'));
    child.on('error', (e) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      reject(new ExecError(`${program} did not start: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    // A child that exits early closes the pipe. Ignore the EPIPE. The result comes from "close".
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}
