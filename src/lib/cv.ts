import type { Application, Job } from '@prisma/client';
import { db } from './db';
import { claudeStatus, NoCredentialError } from './claude';
import { askJsonCached } from './cache';
import { HttpError } from './auth/http';
import { RefineReply } from './schemas';
import { shareResume } from './gdrive';
import { checkForInjection } from './injection';
import { PROMPT_VERSIONS, REFINE_SYSTEM, refinePrompt } from './prompts';
import { claimsFor, isAdmin } from './user';
import { userDir } from './user-files';
import { existsSync } from 'node:fs';
import { baseResume, buildResume, resumeConfig, resumeMenu, ResumeEngineError, type BuiltResume, type Steer } from './resume';
import { BASE_NOT_READY, baseFailure, ensureBaseResume, NO_RESUME, queueBaseResume } from './resume/base';
import { hasResumeContent } from './resume/template';

/**
 * One job's CV as a thing the user can hold: built from the posting plus any
 * refinement, compiled, put on Drive, and recorded on the application. The
 * referral flow and the "Generate résumé" button both go through `publishCv`,
 * so the CV a referral message links to is the one he generated and refined,
 * not a second build that ignores the refinement.
 */

/** The longest message that a user can send to "Refine with Claude". */
export const CV_MESSAGE_MAX = 2000;

/** `task` is the ID of the cv task that wrote the turn. A retry of that task finds it and writes no second turn. */
export type ChatTurn = { role: 'you' | 'claude'; text: string; at: string; task?: string };

/** A refusal meant for the user, as opposed to a fault. */
export class CvError extends Error {}

/**
 * For `.catch()` in a route: a CvError becomes 400 and a missing Claude
 * credential becomes 409, each with its own message. Any other error goes on
 * to `handle`, which logs it and sends a fixed 500 message.
 */
export function rethrowForUser(e: unknown): never {
  if (e instanceof CvError) throw new HttpError(400, e.message);
  if (e instanceof NoCredentialError) throw new HttpError(409, e.message);
  throw e;
}

const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const readSteer = (app: Application) => parse<Steer>(app.cvSteer, {});
export const readChat = (app: Application) => parse<ChatTurn[]>(app.cvChat, []);

const postingText = (job: Job) => `${job.role}\n${job.description}`;

/** RESUME_PDF, RESUME_TEX and the Drive settings in .env are the admin's. A member gets a CV only from an own .tex file. */
/** Why a member's CV has no Drive link. */
export const DRIVE_ADMIN_ONLY = 'Google Drive is for the admin account only. Use the PDF link.';

export { NO_RESUME };

/** The PDF goes to the folder of the user. With `compile: false` the build does not start the LaTeX engine; only the worker compiles. */
export async function buildCv(app: Application, job: Job, opts: { compile?: boolean } = {}) {
  try {
    return await buildResume(app.userId, await claimsFor(app.userId), postingText(job), app.id, readSteer(app), {
      outDir: userDir(app.userId, 'resumes'),
      compile: opts.compile,
    });
  } catch (e) {
    if (e instanceof ResumeEngineError) throw new CvError(e.message);
    throw e;
  }
}

export type Published = { resume: BuiltResume | null; driveUrl: string | null; driveReason: string | null };

/** Why a referral links the base CV: the tailored PDF is not built yet. */
export const BASE_CV_REASON = 'The tailored CV is not built yet, so the message links the base CV. Press "Generate résumé" to build it.';

/**
 * Builds the CV of the application and puts it on Drive. The worker calls it with the default
 * (compile). A web request passes `compile: false`: it uses the built PDF if it exists, else the base PDF.
 */
export async function publishCv(app: Application, job: Job, opts: { compile?: boolean } = {}): Promise<Published> {
  let resume = await buildCv(app, job, { compile: opts.compile });
  const cfg = await resumeConfig(app.userId);
  // The base résumé of the template. The worker builds it when it is missing; a web request only asks for it.
  const baseOf = async (): Promise<string | null> => {
    if (cfg.pdf && existsSync(cfg.pdf)) return cfg.pdf;
    if (!cfg.template || opts.compile === false) return null;
    const built = await ensureBaseResume(app.userId);
    return 'path' in built ? built.path : null;
  };
  if (resume?.path && opts.compile === false && !existsSync(resume.path)) {
    const base = await baseOf();
    resume = base ? { ...resume, path: base, tailored: false, lead: null, reason: BASE_CV_REASON } : null;
  }
  if (!resume?.path && cfg.template) {
    const base = await baseOf();
    if (base) resume = baseResume(base, 'The tailored CV did not build, so this is the base CV.');
  }
  if (!resume || !resume.path) {
    if (cfg.template && hasResumeContent(await claimsFor(app.userId))) {
      const failed = await baseFailure(app.userId);
      if (failed) return { resume: null, driveUrl: null, driveReason: `Waypoint could not build your base résumé: ${failed}` };
      await queueBaseResume(app.userId);
      return { resume: null, driveUrl: null, driveReason: BASE_NOT_READY };
    }
    return { resume: null, driveUrl: null, driveReason: (await isAdmin(app.userId)) ? null : NO_RESUME };
  }

  // Drive is the account of the admin (GDRIVE_* in .env). A member gets the local PDF link only.
  const admin = await isAdmin(app.userId);
  const shared = admin
    ? await shareResume(resume.path, job.company, job.role, { id: app.cvDriveId, url: app.cvUrl, uploaded: app.cvPath })
    : { id: null, url: null, reason: DRIVE_ADMIN_ONLY };
  if (shared.url) resume.publicUrl = shared.url;

  await db.application.update({
    where: { id: app.id },
    data: { cvUrl: shared.url, cvDriveId: shared.id, cvPath: resume.path, cvLead: resume.lead },
  });
  return { resume, driveUrl: shared.url, driveReason: shared.reason };
}

/** What the job detail screen shows for a built CV. */
export function cvView(app: Application, p: Published) {
  const r = p.resume;
  return {
    pdfUrl: r ? `/api/resume/${app.id}` : null,
    driveUrl: p.driveUrl,
    driveReason: p.driveReason,
    tailored: !!r?.tailored,
    lead: r?.lead || null,
    projects: r?.order || [],
    bullets: r?.experience || [],
    skills: r?.skillsLead || [],
    reason: r?.reason || null,
    chat: readChat(app),
  };
}

const MAX_TURNS = 40;

/**
 * One turn of "Refine with Claude".
 *
 * Claude never edits LaTeX. It returns a `Steer` — ids from claims.yml and the
 * base CV, in order — and every id is checked against the menu before it is
 * used. So the worst a confused or manipulated reply can do is choose a
 * different arrangement of things he already wrote; it cannot put a sentence,
 * a skill without evidence, or a project with no CV entry onto the page.
 */
export async function refineCv(app: Application, job: Job, request: string, taskId?: string) {
  const text = request.trim().slice(0, 1000);
  if (!text) throw new CvError('Type what to change first.');

  // A retry of a task that saved its turn already only builds the CV again. No second Claude call, no second turn.
  if (taskId && readChat(app).some((t) => t.task === taskId)) return cvView(app, await publishCv(app, job));

  // His own words, but often pasted from somewhere — a posting, a recruiter's
  // message — and so the same check the reply path uses.
  const probe = checkForInjection(text);
  if (probe.suspicious) throw new CvError(`Not sent to Claude: ${probe.why}. Rephrase it as a plain request about the CV.`);

  const doc = await claimsFor(app.userId);
  if (!doc) throw new CvError('Refining needs a profile. Add your positions and projects on the Profile screen.');
  const menu = await resumeMenu(doc, app.userId);
  if (!menu) throw new CvError((await isAdmin(app.userId)) ? 'Refining needs a LaTeX source: upload an own .tex file, or set RESUME_TEX.' : NO_RESUME);
  const { mode, detail } = await claudeStatus(app.userId);
  if (mode === 'none') throw new CvError(detail);

  const current = await buildCv(app, job);
  const history = readChat(app);
  // Through the cache: a retry with the same CV, history and message reuses the paid reply.
  const out = await askJsonCached(
    'refine',
    PROMPT_VERSIONS.refine,
    {
      system: REFINE_SYSTEM,
      prompt: refinePrompt(
        menu,
        { projects: current?.order || [], bullets: current?.experience || [], skills: current?.skillsLead || [] },
        job,
        history.slice(-10),
        text,
      ),
      schema: RefineReply,
      effort: 'medium',
    },
    { userId: app.userId, kind: 'refine' },
    { perUser: true },
  );

  const rejected: string[] = [];
  /** Null keeps the previous choice; anything else is filtered to the menu. */
  const pick = (v: unknown, allowed: Set<string>): string[] | null => {
    if (!Array.isArray(v)) return null;
    const ids = [...new Set(v.map(String))];
    rejected.push(...ids.filter((id) => !allowed.has(id)));
    return ids.filter((id) => allowed.has(id));
  };
  const projects = pick(out.projects, new Set(menu.projects.filter((p) => p.usable).map((p) => p.id)));
  const bullets = pick(out.bullets, new Set(menu.bullets.map((b) => b.id)));
  const skills = pick(out.skills, new Set(menu.skills.map((s) => s.slug)));

  const steer: Steer = { ...readSteer(app) };
  // An emptied list means "back to what the posting picks", never "no
  // projects at all" — a CV with an empty projects section is not a choice.
  if (projects) steer.projects = projects.length ? projects : undefined;
  if (bullets) steer.bullets = bullets.length ? bullets : undefined;
  if (skills) steer.skills = skills.length ? skills : undefined;

  let reply = String(out.reply ?? '').trim().slice(0, 600) || 'Done.';
  if (rejected.length) reply += ` (Ignored ${rejected.join(', ')}: not something claims.yml lets the CV carry.)`;
  const posting = checkForInjection(job.description);
  if (posting.suspicious) reply += ` Note: the posting itself looks like it addresses a model (${posting.why}); it was read as data only.`;

  const now = new Date().toISOString();
  const mark = taskId ? { task: taskId } : {};
  const chat: ChatTurn[] = [...history, { role: 'you' as const, text, at: now, ...mark }, { role: 'claude' as const, text: reply, at: now, ...mark }].slice(-MAX_TURNS);
  const saved = await db.application.update({
    where: { id: app.id },
    data: { cvSteer: JSON.stringify(steer), cvChat: JSON.stringify(chat) },
  });
  return cvView(saved, await publishCv(saved, job));
}

/** Drops the refinement and the wording suggestions, so the next build is the posting's own selection again. */
export async function resetCv(app: Application, job: Job) {
  const saved = await db.application.update({ where: { id: app.id }, data: { cvSteer: null, cvChat: '[]', cvSuggestions: null } });
  return cvView(saved, await publishCv(saved, job));
}
