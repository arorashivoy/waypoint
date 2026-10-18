import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { baseEnv, findOnPath, LATEX_ENGINES, LUA_SAFE, runProgram, type Program } from './exec';

/**
 * LaTeX compiles with no way out of the work folder.
 *
 * A CV source can carry text from an uploaded file or a model, so a compile
 * treats it as hostile: shell escape is off, `openin_any=p` and `openout_any=p`
 * stop reads and writes outside the folder (absolute paths, `..`, dotfiles),
 * and prlimit caps the memory. The source is written to a new folder for each
 * compile, with copies of the CV's class and image files only.
 */

export type Engine = { program: Program; bin: string };

const ASSET = /\.(cls|sty|bst|png|jpg|jpeg|pdf|eps|ttf|otf)$/i;
const MAX_COMPILE_MS = 60_000;

/** One compile gets at most 60 s, all passes together. */
export function compileBudget(timeoutMs: number): number {
  return Math.min(timeoutMs, MAX_COMPILE_MS);
}

/** Keep the first 20 lines that start with "!". Show the work folder as "." and
 *  any other absolute path as "<path>", so an error never names a host path. */
function cleanLog(text: string, work: string): string {
  return text
    .split('\n')
    .filter((l) => l.startsWith('!'))
    .slice(0, 20)
    .map((l) => l.split(work).join('.').replace(/(?<![\w.])\/[^\s'"`]+/g, '<path>'))
    .join(' ');
}

/** RESUME_ENGINE wins when its file name is an engine on the list. A path to
 *  anything else is refused, not run. A path that is not absolute is refused
 *  too. Otherwise the first engine on PATH. */
export function findEngine(forced?: string | null): Engine | null {
  if (forced) {
    const name = basename(forced) as Program;
    if (!LATEX_ENGINES.includes(name)) return null;
    if (forced.includes('/') && !isAbsolute(forced)) return null;
    const bin = forced.includes('/') ? forced : findOnPath(forced);
    return bin && existsSync(bin) ? { program: name, bin } : null;
  }
  for (const program of LATEX_ENGINES) {
    const bin = findOnPath(program);
    if (bin) return { program, bin };
  }
  return null;
}

export function engineArgs(program: Program, name: string, outDir: string): string[] {
  return program === 'tectonic'
    ? ['-X', 'compile', '--untrusted', '--outdir', outDir, '--keep-logs', `${name}.tex`]
    : ['-no-shell-escape', ...(program === 'lualatex' ? LUA_SAFE : []), '-interaction=nonstopmode', '-halt-on-error', `-output-directory=${outDir}`, `${name}.tex`];
}

export async function compileLatex(opts: { source: string; assetsDir: string | null; outPdf: string; engine: Engine; timeoutMs: number }): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'waypoint-cv-'));
  try {
    if (opts.assetsDir) {
      for (const f of readdirSync(opts.assetsDir)) {
        // A link could point outside the folder, so copy regular files only.
        if (ASSET.test(f)) {
          try {
            if (lstatSync(join(opts.assetsDir, f)).isFile()) copyFileSync(join(opts.assetsDir, f), join(work, f));
          } catch { /* an unreadable asset; LaTeX reports it */ }
        }
      }
    }
    const name = 'tailored';
    writeFileSync(join(work, `${name}.tex`), opts.source);

    const { program, bin } = opts.engine;
    const env = baseEnv({ openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: work });
    // pdflatex needs a second pass for its own cross-references; tectonic loops by itself.
    const passes = program === 'tectonic' ? 1 : 2;
    const budget = compileBudget(opts.timeoutMs);
    const start = Date.now();
    for (let i = 0; i < passes; i++) {
      const left = budget - (Date.now() - start);
      if (left < 1) throw new Error(`the compile took longer than ${budget / 1000} s`);
      const r = await runProgram(program, engineArgs(program, name, work), { cwd: work, timeoutMs: Math.floor(left), env, memoryMb: 512, bin });
      if (r.code !== 0) {
        const log = cleanLog(r.stdout + r.stderr, work);
        throw new Error(`${program} failed${log ? `: ${log}` : ''}`);
      }
    }
    const built = join(work, `${name}.pdf`);
    if (!existsSync(built)) throw new Error('the engine produced no PDF');
    mkdirSync(dirname(opts.outPdf), { recursive: true });
    copyFileSync(built, opts.outPdf);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
