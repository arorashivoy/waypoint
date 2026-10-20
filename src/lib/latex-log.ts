import { basename } from 'node:path';

const MAX_LINES = 20;

/** An absolute path inside a log line. A slash inside a word ("and/or") is not one. */
const ABSOLUTE_PATH = /(?<![\w.])\/[^\s'"`()<>]+/g;

/**
 * The first 20 lines of a LaTeX log, safe to show to the user. A path under the
 * user's folder keeps its relative form. Any other absolute path becomes its
 * base name, so a log never names a folder of the host.
 */
export function latexLogExcerpt(log: string, userDir: string): string {
  const dir = userDir.replace(/\/+$/, '');
  return log
    .split(/\r?\n/)
    .slice(0, MAX_LINES)
    .map((line) =>
      line.replace(ABSOLUTE_PATH, (path) => {
        if (dir && path === dir) return '.';
        if (dir && path.startsWith(`${dir}/`)) return path.slice(dir.length + 1);
        return basename(path);
      }),
    )
    .join('\n');
}
