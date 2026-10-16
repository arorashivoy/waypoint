import type { Application, Job } from '@prisma/client';
import { db } from './db';
import { askJson, claudeStatus, NoCredentialError } from './claude';
import { HttpError } from './auth/http';
import { RefineReply } from './schemas';
import { shareResume } from './gdrive';
import { checkForInjection } from './injection';
import { REFINE_SYSTEM, refinePrompt } from './prompts';
import { claimsFor, isAdmin } from './user';
import { buildResume, resumeMenu, type BuiltResume, type Steer } from './resume';

/**
 * One job's CV as a thing the user can hold: built from the posting plus any
 * refinement, compiled, put on Drive, and recorded on the application. The
 * referral flow and the "Generate résumé" button both go through `publishCv`,
 * so the CV a referral message links to is the one he generated and refined,
 * not a second build that ignores the refinement.
 */

export type ChatTurn = { role: 'you' | 'claude'; text: string; at: string };

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

/** Until part 3 adds templates for each user, RESUME_PDF, RESUME_TEX and the
 *  Drive settings in .env are the admin's. A member gets no résumé. */
export const NO_RESUME = 'No résumé is set up for your account yet.';

export async function buildCv(app: Application, job: Job) {
  if (!(await isAdmin(app.userId))) return null;
  return buildResume(await claimsFor(app.userId), postingText(job), app.id, readSteer(app));
}

export type Published = { resume: BuiltResume | null; driveUrl: string | null; driveReason: string | null };

export async function publishCv(app: Application, job: Job): Promise<Published> {
  const resume = await buildCv(app, job);
  if (!resume || !resume.path) {
    return { resume: null, driveUrl: null, driveReason: (await isAdmin(app.userId)) ? null : NO_RESUME };
  }

  const shared = await shareResume(resume.path, job.company, job.role, { id: app.cvDriveId, url: app.cvUrl, uploaded: app.cvPath });
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
export async function refineCv(app: Application, job: Job, request: string) {
  const text = request.trim().slice(0, 1000);
  if (!text) throw new CvError('Type what to change first.');

  // His own words, but often pasted from somewhere — a posting, a recruiter's
  // message — and so the same check the reply path uses.
  const probe = checkForInjection(text);
  if (probe.suspicious) throw new CvError(`Not sent to Claude: ${probe.why}. Rephrase it as a plain request about the CV.`);

  if (!(await isAdmin(app.userId))) throw new CvError(NO_RESUME);
  const doc = await claimsFor(app.userId);
  if (!doc) throw new CvError('Refining needs a valid data/profile/claims.yml — it only ever chooses between what that file lists. Run npm run check:claims.');
  const menu = resumeMenu(doc);
  if (!menu) throw new CvError('Refining needs RESUME_TEX: there is no LaTeX source to rearrange.');
  const { mode, detail } = await claudeStatus(app.userId);
  if (mode === 'none') throw new CvError(detail);

  const current = await buildCv(app, job);
  const history = readChat(app);
  const out = (
    await askJson({
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
    }, { userId: app.userId, kind: 'refine' })
  ).data;

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
  const chat: ChatTurn[] = [...history, { role: 'you' as const, text, at: now }, { role: 'claude' as const, text: reply, at: now }].slice(-MAX_TURNS);
  const saved = await db.application.update({
    where: { id: app.id },
    data: { cvSteer: JSON.stringify(steer), cvChat: JSON.stringify(chat) },
  });
  return cvView(saved, await publishCv(saved, job));
}

/** Drops the refinement, so the next build is the posting's own selection again. */
export async function resetCv(app: Application, job: Job) {
  const saved = await db.application.update({ where: { id: app.id }, data: { cvSteer: null, cvChat: '[]' } });
  return cvView(saved, await publishCv(saved, job));
}
