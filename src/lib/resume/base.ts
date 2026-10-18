import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { compileLatex, findEngine } from '../latex';
import { enqueue } from '../tasks/queue';
import { claimsFor } from '../user';
import { baseOrder, baseResumePath, hasResumeContent, renderTemplate, templateAssetsDir } from './template';
import { resumeConfig } from '../resume';

/**
 * The default base résumé: a user with no own .tex gets a PDF that the built-in template makes
 * from the best projects of the profile. The worker builds it, so a web request never waits for a compile.
 */

export const NO_RESUME = 'No résumé is set up for your account yet.';

/** Why the base résumé of a user is not there yet. */
export const BASE_NOT_READY = 'Your base résumé is being built. Try again in a minute.';

const OLD_BASE = /^base-\d+\.pdf$/;

/**
 * Builds `base-<profile version>.pdf` in the folder of the user. A file for the current version is
 * reused. The older base files of the user go after a new one is built.
 */
export async function ensureBaseResume(userId: string): Promise<{ path: string } | { why: string }> {
  const cfg = await resumeConfig(userId);
  if (!cfg.template) return { why: 'The account uses an own résumé source, so there is no template base.' };
  const doc = await claimsFor(userId);
  if (!hasResumeContent(doc)) return { why: NO_RESUME };

  const path = await baseResumePath(userId);
  if (existsSync(path) && statSync(path).size > 0) return { path };

  const engine = findEngine('pdflatex') ?? findEngine('xelatex');
  if (!engine) return { why: 'The server has no pdflatex or xelatex.' };
  await compileLatex({ source: renderTemplate(doc, {}, baseOrder(doc)), assetsDir: templateAssetsDir(), outPdf: path, engine, timeoutMs: cfg.timeoutMs });

  for (const f of readdirSync(dirname(path))) if (OLD_BASE.test(f) && f !== basename(path)) rmSync(`${dirname(path)}/${f}`, { force: true });
  return { path };
}

/**
 * Asks the worker for a new base résumé. A user with an own source gets none. It never throws:
 * a profile save must not fail because the task could not be queued.
 */
export async function queueBaseResume(userId: string): Promise<void> {
  try {
    if (!(await resumeConfig(userId)).template) return;
    await enqueue({ kind: 'cv', userId, payload: { action: 'base' }, dedupeKey: `cv-base:${userId}` });
  } catch {
    /* the base résumé is built when the CV code needs it */
  }
}
