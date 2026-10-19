import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { compileLatex, findEngine } from '../latex';
import { enqueue } from '../tasks/queue';
import { claimsFor } from '../user';
import { baseOrder, baseResumePath, hasResumeContent, renderTemplate, templateAssetsDir } from './template';
import { resumeConfig } from '../resume';
import { getState, setState } from '../app-state';
import { db } from '../db';
import { profileVersion } from '../profile/store';
import { z } from 'zod';
import { scrub } from '../log';

/**
 * The default base résumé: a user with no own .tex gets a PDF that the built-in template makes
 * from the best projects of the profile. The worker builds it, so a web request never waits for a compile.
 */

export const NO_RESUME = 'No résumé is set up for your account yet.';

/** Why the base résumé of a user is not there yet. */
export const BASE_NOT_READY = 'Your base résumé is being built. Try again in a minute.';

const Failed = z.object({ version: z.number(), reason: z.string(), at: z.number() });
const failedKey = (userId: string) => `base-failed:${userId}`;

/** A failure older than this may pass: a timeout under load or a TeX install later can fix it. */
export const FAILURE_TTL_MS = 30 * 60_000;

/** The reason that the base build of the current profile version failed in the last 30 minutes, or null. A new version clears it. */
export async function baseFailure(userId: string): Promise<string | null> {
  const f = await getState(failedKey(userId), Failed);
  return f && Date.now() - f.at < FAILURE_TTL_MS && f.version === (await profileVersion(userId)) ? f.reason : null;
}

/** The first line, with no path and no key, at most 200 characters. */
function shortReason(text: string): string {
  return scrub(text.split('\n')[0].slice(0, 1000).replace(/(?<![\w.])\/[^\s'"`]+/g, '<path>')).slice(0, 200);
}

async function fail(userId: string, version: number, text: string): Promise<{ why: string }> {
  const reason = shortReason(text);
  await setState(failedKey(userId), { version, reason, at: Date.now() });
  return { why: reason };
}

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

  const known = await baseFailure(userId);
  if (known) return { why: known };
  const version = await profileVersion(userId);
  const engine = findEngine('pdflatex') ?? findEngine('xelatex');
  if (!engine) return fail(userId, version, 'The server has no pdflatex or xelatex.');
  try {
    await compileLatex({ source: renderTemplate(doc, {}, baseOrder(doc)), assetsDir: templateAssetsDir(), outPdf: path, engine, timeoutMs: cfg.timeoutMs });
  } catch (e) {
    return fail(userId, version, (e as Error).message);
  }
  await db.appState.deleteMany({ where: { key: failedKey(userId) } });

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
    // A failed build of this version is shown to the user. Do not queue it again.
    if (await baseFailure(userId)) return;
    await enqueue({ kind: 'cv', userId, payload: { action: 'base' }, dedupeKey: `cv-base:${userId}` });
  } catch {
    /* the base résumé is built when the CV code needs it */
  }
}
