import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { HttpError } from '@/lib/auth/http';
import { draftsFromResume } from '@/lib/profile/resume-import';
import { draftsFromRepo } from '@/lib/profile/github-import';
import { userDir } from '@/lib/user-files';
import { db } from '@/lib/db';
import { visibleTo } from '@/lib/job-scope';
import { analyseJob } from '@/lib/analysis';
import { pruneCacheBySize } from '@/lib/cache';
import { getState, setState } from '@/lib/app-state';
import { rescanPendingDrafts } from '@/lib/profile/drafts';
import { NoCredentialError, claudeStatus, credentialFor } from '@/lib/claude';
import { fetchAll } from '@/lib/sources';
import { queueAnalysis } from '@/lib/queue';
import { searchQueries } from '@/lib/resume';
import { ensureBaseResume } from '@/lib/resume/base';
import { suggestWording, wordingView } from '@/lib/resume/suggest';
import { CV_MESSAGE_MAX, NO_RESUME, CvError, cvView, publishCv, refineCv, resetCv } from '@/lib/cv';
import { PasteTaskPayload, PasteUserError, pasteJob } from '@/lib/sources/paste';
import { runOutreach } from '@/lib/outreach';
import { INCOMING_MAX } from '@/lib/schemas';
import { claimsFor, isAdmin } from '@/lib/user';
import { TaskDeferred, TaskFatal } from '@/lib/tasks/worker';
import { RETRY_DELAYS_MS, pruneTasks, type TaskKind, type TaskRow } from '@/lib/tasks/queue';

type Entry = {
  schema: z.ZodType<unknown>;
  run: (payload: unknown, task: TaskRow, signal: AbortSignal) => Promise<unknown>;
};

/** The handler of each kind of task. Later tasks add their handlers here. */
export const handlers = new Map<TaskKind, Entry>();

/**
 * The worker checks the payload with `schema` before it calls `h`. The return value of `h` becomes `Task.result`.
 * The signal aborts when the attempt reaches its time limit. The worker then fails the attempt and does not wait for `h`.
 */
export function registerHandler<P>(
  kind: TaskKind,
  schema: z.ZodType<P>,
  h: (payload: P, task: TaskRow, signal: AbortSignal) => Promise<unknown>,
): void {
  handlers.set(kind, { schema, run: (payload, task, signal) => h(payload as P, task, signal) });
}

// The worker enqueues maintenance each hour. It keeps the model cache under its size limit.
// It also scans the old pending drafts one time, with the signals that came after they were made.
const RESCAN_KEY = 'rescan-drafts-v1';
registerHandler('maintenance', z.unknown(), async () => {
  const pruned = await pruneCacheBySize();
  const tasksPruned = await pruneTasks();
  if ((await getState(RESCAN_KEY, z.object({ at: z.string() }))) === null) {
    const rescanned = await rescanPendingDrafts();
    await setState(RESCAN_KEY, { at: new Date().toISOString(), rescanned });
    return { pruned, tasksPruned, rescanned };
  }
  return { pruned, tasksPruned };
});

// A refresh queues tasks with a `batch` (for the progress count). The job screen queues one task with no batch.
// `force` asks for a new analysis even when one exists.
registerHandler('analysis', z.object({ jobId: z.string(), batch: z.string().optional(), force: z.boolean().optional() }), async ({ jobId, force }, task) => {
  const userId = task.userId;
  if (!userId) return { skipped: 'no-user' };
  const job = await db.job.findFirst({ where: { id: jobId, ...visibleTo(userId) } });
  if (!job) return { skipped: 'gone' };
  if (!(await credentialFor(userId))) {
    const status = await claudeStatus(userId);
    if (status.capReached) {
      throw new TaskDeferred(new Date(status.resetsAt), 'The shared key reached the monthly cap.');
    }
    return { skipped: 'no-credential' };
  }
  await analyseJob(job, userId, force ?? false);
  return {};
});

registerHandler('refresh', z.object({ force: z.boolean() }), async ({ force }, task) => {
  const userId = task.userId;
  if (!userId) return { skipped: 'no-user' };
  // A user with no country on gets the paused note. No fetch and no analysis run.
  if (!(await db.countryPref.count({ where: { userId, on: true } }))) {
    return { added: 0, total: 0, report: [], analysing: null, note: 'Every country is paused.' };
  }
  // The feed cache is global and a board returns every country. So the refresh keeps the
  // countries of all active users, not only the countries of the user who started it.
  const prefs = await db.countryPref.findMany({ where: { on: true, user: { disabledAt: null } }, select: { cc: true } });
  const ccs = [...new Set(prefs.map((p) => p.cc))];
  if (!ccs.length) return { added: 0, total: 0, report: [], analysing: null, note: 'Every country is paused.' };

  const { jobs, report, commit } = await fetchAll(ccs, searchQueries(await claimsFor(userId)), { force });

  const known = new Set(
    (await db.job.findMany({ where: { externalId: { in: jobs.map((j) => j.externalId) } }, select: { externalId: true } }))
      .map((j) => j.externalId),
  );
  for (const j of jobs) {
    await db.job.upsert({
      where: { externalId: j.externalId },
      // An undated listing keeps the date it was first seen rather than being
      // re-stamped today on every refresh.
      // A board job is a feed job now, also when a user pasted it first.
      update: { pastedBy: null, fetchedAt: new Date(), ...(j.postedAt && { postedAt: j.postedAt }), description: j.description, url: j.url, priority: j.priority },
      create: { ...j, postedAt: j.postedAt ?? new Date() },
    });
  }
  const added = jobs.filter((j) => !known.has(j.externalId)).length;
  // The jobs are stored. Only now the boards get the new etag and date.
  await commit();

  // The analysis tasks run in the worker after this task. The client polls /api/state for progress.
  const analysing = await queueAnalysis(userId);

  // "Live" counts the stored jobs in the countries of this user, as the job list does. A board that was
  // fetched less than 6 hours ago is skipped, so the jobs of this run alone can be 0.
  const mine = (await db.countryPref.findMany({ where: { userId, on: true }, select: { cc: true } })).map((p) => p.cc);
  const total = await db.job.count({ where: { cc: { in: mine }, ...visibleTo(userId) } });

  return { added, total, report, analysing };
});

// The action `base` builds the base résumé of the template after a profile save. It has no job.
// The action `suggest` asks the model for new wording of the bullets. It builds no PDF.
registerHandler(
  'cv',
  z.object({
    jobId: z.string().optional(),
    action: z.enum(['generate', 'refine', 'reset', 'base', 'suggest']),
    message: z.string().max(CV_MESSAGE_MAX).optional(),
  }),
  async ({ jobId, action, message }, task) => {
    const userId = task.userId;
    if (!userId) return { skipped: 'no-user' };
    if (action === 'base') {
      const built = await ensureBaseResume(userId);
      return 'why' in built ? { skipped: built.why } : { built: true };
    }
    if (!jobId) throw new TaskFatal('The task has no job.');
    const job = await db.job.findFirst({ where: { id: jobId, ...visibleTo(userId) } });
    if (!job) throw new TaskFatal('The job is gone.');
    const app = await db.application.upsert({
      where: { userId_jobId: { userId, jobId } },
      update: {},
      create: { userId, jobId },
    });
    try {
      if (action === 'suggest') return await suggestWording(app, job);
      // The wording view (the suggestions and the keyword report) goes with each CV view.
      if (action === 'refine') return { ...(await refineCv(app, job, message ?? '', task.id)), ...(await wordingView(userId, job)) };
      if (action === 'reset') return { ...(await resetCv(app, job)), ...(await wordingView(userId, job)) };
      const view = { ...cvView(app, await publishCv(app, job)), ...(await wordingView(userId, job)) };
      if (!view.pdfUrl) {
        throw new TaskFatal((await isAdmin(userId)) ? 'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.' : NO_RESUME);
      }
      return view;
    } catch (e) {
      // The user must read these two errors. A retry cannot change them.
      if (e instanceof CvError || e instanceof NoCredentialError) throw new TaskFatal(e.message);
      throw e;
    }
  },
);

/**
 * The count of drafts that this task wrote already, or null. The drafts of a task have its ID as their batch ID,
 * and `createDrafts` writes them in one statement. So a retry after the write (for example when the result could
 * not be stored) returns this count and writes nothing.
 */
async function draftsOfTask(userId: string, taskId: string): Promise<number | null> {
  const n = await db.profileDraft.count({ where: { userId, batchId: taskId } });
  return n ? n : null;
}

/** The error of an import that the user must read, or null when a retry can help. */
function importFatal(e: unknown): TaskFatal | null {
  if (e instanceof NoCredentialError) return new TaskFatal(e.message);
  // A 4xx error is a fact about the request. A 429 or a 5xx error from GitHub can pass, so the task runs again.
  if (e instanceof HttpError && e.status < 500 && e.status !== 429) return new TaskFatal(e.message);
  return null;
}

/** The only file names that the server makes for a waiting résumé upload. */
export const RESUME_FILE = /^[a-z0-9]{8,40}\.(pdf|tex)$/;

registerHandler(
  'resume-import',
  z
    .object({ file: z.string().regex(RESUME_FILE), type: z.enum(['pdf', 'tex']) })
    .refine((p) => p.file.endsWith(`.${p.type}`), 'The file name and the type do not match.'),
  async ({ file, type }, task) => {
    const userId = task.userId;
    if (!userId) return { skipped: 'no-user' };
    // The path comes from the userId of the task and the name that the server made. Never from the payload alone.
    const path = join(userDir(userId, 'imports'), file);
    // The file stays while a retry can still happen. It goes when the task ends: done, fatal or the last attempt.
    let ends = task.attempts > RETRY_DELAYS_MS.length;
    try {
      const written = await draftsOfTask(userId, task.id);
      if (written !== null) {
        ends = true;
        return { drafts: written, dropped: 0, hidden: 0 };
      }
      let buf: Buffer;
      try {
        buf = readFileSync(path);
      } catch {
        ends = true;
        throw new TaskFatal('The uploaded file is gone. Upload the résumé again.');
      }
      try {
        const result = await draftsFromResume(userId, type, buf, task.id);
        ends = true;
        return result;
      } catch (e) {
        const fatal = importFatal(e);
        if (fatal) {
          ends = true;
          throw fatal;
        }
        throw e;
      }
    } finally {
      if (ends) rmSync(path, { force: true });
    }
  },
);

registerHandler('github-import', z.object({ username: z.string().max(100), repo: z.string().max(100) }), async ({ username, repo }, task) => {
  const userId = task.userId;
  if (!userId) return { skipped: 'no-user' };
  const written = await draftsOfTask(userId, task.id);
  if (written !== null) return { drafts: written, dropped: 0 };
  try {
    return await draftsFromRepo(userId, username, repo, task.id);
  } catch (e) {
    throw importFatal(e) ?? e;
  }
});

// The three outreach actions that call Claude. The ID is the application of this user. The result is the JSON for the client.
registerHandler(
  'outreach',
  z.object({
    action: z.enum(['referral', 'note', 'reply']),
    applicationId: z.string().max(64),
    name: z.string().max(120).optional(),
    profileUrl: z.string().max(500).nullable().optional(),
    // Recorded exception: this is the one payload with text from a third party (the message of a contact, up to INCOMING_MAX).
    // The reply needs it when the task runs, and a placeholder row would show an empty draft while the task waits.
    // The maintenance task deletes finished tasks after TASK_KEEP_DAYS.
    incoming: z.string().max(INCOMING_MAX).optional(),
  }),
  async (payload, task) => {
    const userId = task.userId;
    if (!userId) return { skipped: 'no-user' };
    try {
      return await runOutreach(userId, payload);
    } catch (e) {
      if (e instanceof NoCredentialError) throw new TaskFatal(e.message);
      throw e;
    }
  },
);

// A pasted job link. The route checked the link. The payload holds only the parts that it read, and the fetch URL is built from them again.
registerHandler('paste', PasteTaskPayload, async (payload, task) => {
  const userId = task.userId;
  if (!userId) return { skipped: 'no-user' };
  try {
    return await pasteJob(userId, payload);
  } catch (e) {
    if (e instanceof PasteUserError) throw new TaskFatal(e.message);
    throw e;
  }
});
