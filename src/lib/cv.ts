import type { Application, Job } from '@prisma/client';
import { db } from './db';
import { claudeStatus } from './claude';
import { log } from './log';
import { askJsonCached } from './cache';
import { RefineReply } from './schemas';
import { shareResume } from './gdrive';
import { checkForInjection } from './injection';
import { PROMPT_VERSIONS, REFINE_SYSTEM, refinePrompt, WRITE_SYSTEM, writePrompt } from './prompts';
import { HttpError } from './auth/http';
import { readFileSync } from 'node:fs';
import { checkWritten, WriteReply, type Written } from './resume/written';
import { enqueueCv } from './tasks/cv';
import { claimsFor, isAdmin } from './user';
import { userDir } from './user-files';
import { existsSync } from 'node:fs';
import { baseResume, bulletLines, buildResume, rankEvidence, resumeConfig, resumeMenu, ResumeEngineError, type BuiltResume, type Steer } from './resume';
import { BASE_NOT_READY, baseFailure, ensureBaseResume, NO_RESUME, queueBaseResume } from './resume/base';
import { bestProjects, hasResumeContent } from './resume/template';

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
    ...writtenView(readSteer(app)),
  };
}

/** The lines that Claude wrote for this job, as old and new text, and the lines that the check refused. */
export function writtenView(steer: Steer) {
  const w = steer.written;
  const keep = new Set(steer.keep ?? []);
  const changes = [
    ...Object.entries(w?.bullets ?? {}).filter(([id]) => !keep.has(id)).map(([id, b]) => ({ id, kind: 'bullet' as const, old: b.old, now: b.text })),
    ...Object.entries(w?.projects ?? {}).filter(([id]) => !keep.has(id)).map(([id, p]) => ({ id, kind: 'project' as const, old: p.old, now: `${p.heading}: ${p.lines.join(' ')}` })),
  ];
  return { changes, droppedLines: w?.dropped ?? [] };
}

/** The most projects that one write sends to Claude. */
const WRITE_PROJECTS = 8;

/**
 * Asks Claude to write the project entries and the bullets of this job's CV from the whole profile, and keeps
 * only the lines that pass the check against their sources (resume/written.ts). The result goes in the steer of
 * the application, and the build uses it. Null when there is no profile or no Claude: the CV is then built as before.
 * `request` is the user's own words from Refine with Claude.
 */
export async function writeCv(app: Application, job: Job, request?: string): Promise<Written | null> {
  const doc = await claimsFor(app.userId);
  if (!doc) return null;
  if ((await claudeStatus(app.userId)).mode === 'none') return null;

  const cfg = await resumeConfig(app.userId);
  const tex = cfg.tex && existsSync(cfg.tex) ? readFileSync(cfg.tex, 'utf8') : null;
  const lines = tex ? bulletLines(tex, doc) : null;
  const steer = readSteer(app);

  // The projects that can reach the CV: the steered ones, the ones the posting asks for, then the best of the profile.
  const ranked = rankEvidence(doc, postingText(job)).filter((r) => r.kind === 'project' && r.score > 0).sort((a, b) => b.score - a.score);
  const ids = [...new Set([...(steer.projects ?? []), ...ranked.map((r) => r.target.slice('project:'.length)), ...bestProjects(doc, doc.targets.projects.length)])].slice(0, WRITE_PROJECTS);
  const claimsOf = (target: (t: string) => boolean) =>
    doc.claims.filter((c) => c.evidence.some((e) => target(e.target))).map((c) => ({ slug: c.slug, label: c.label, proofs: c.evidence.flatMap((e) => (e.proof ? [e.proof] : [])) }));
  const projects = ids.flatMap((id) => {
    const p = doc.targets.projects.find((x) => x.id === id);
    return p ? [{ id, title: p.title, description: p.description, bullets: p.bullets ?? [], claims: claimsOf((t) => t === `project:${id}`) }] : [];
  });
  const positions = doc.targets.positions.map((p) => ({
    id: p.id,
    title: p.title,
    company: p.company,
    // With a .tex source, only the bullets that are on the CV can change.
    bullets: (p.bullets ?? []).map((b) => ({ id: `${p.id}/${b.id}`, text: lines ? lines.get(`${p.id}/${b.id}`) : b.text || b.match })).filter((b): b is { id: string; text: string } => !!b.text),
    claims: claimsOf((t) => t === `position:${p.id}` || t.startsWith(`position:${p.id}/`)),
  }));
  const style = [...positions.flatMap((p) => p.bullets.map((b) => b.text)), ...projects.flatMap((p) => (p.description ? [p.description] : []))];

  const out = await askJsonCached(
    'cv-write',
    PROMPT_VERSIONS['cv-write'],
    { system: WRITE_SYSTEM, prompt: writePrompt({ projects, positions, style, job, request }), schema: WriteReply, effort: 'medium' },
    { userId: app.userId, kind: 'cv-write' },
    { perUser: true },
  );
  const written = checkWritten(out, doc, lines ? { bulletText: lines } : {});
  // A new request that rewords a line he kept as original asks again for that line, so the keep ends.
  const keep = request ? (steer.keep ?? []).filter((id) => !written.bullets[id] && !written.projects[id]) : steer.keep;
  await db.application.update({ where: { id: app.id }, data: { cvSteer: JSON.stringify({ ...steer, written, keep: keep?.length ? keep : undefined }) } });
  return written;
}

/** "Use my original": the line or the project keeps the text that he wrote, for this job. Queues a build. */
export async function keepOriginal(userId: string, jobId: string, id: string) {
  const app = await db.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
  if (!app) throw new HttpError(404, 'Not found.');
  const steer = readSteer(app);
  if (!steer.written?.bullets[id] && !steer.written?.projects[id]) throw new HttpError(404, 'Not found.');
  const next: Steer = { ...steer, keep: [...new Set([...(steer.keep ?? []), id])] };
  await db.application.update({ where: { id: app.id }, data: { cvSteer: JSON.stringify(next) } });
  try {
    return { taskId: await enqueueCv(userId, jobId, { action: 'generate' }) };
  } catch (e) {
    await db.application.update({ where: { id: app.id }, data: { cvSteer: app.cvSteer } });
    throw e;
  }
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

  // The request can also ask for new words. Claude writes them, and each line passes the check or is not used.
  // A failed write does not fail the refinement: the new order stands, and the lines written before stay.
  const steered = await db.application.update({ where: { id: app.id }, data: { cvSteer: JSON.stringify(steer) } });
  let written: Written | null = null;
  let writeFailed = false;
  try {
    written = await writeCv(steered, job, text);
  } catch (e) {
    writeFailed = true;
    log.warn({ err: e, jobId: job.id }, 'cv write failed during refine');
  }

  let reply = String(out.reply ?? '').trim().slice(0, 600) || 'Done.';
  if (rejected.length) reply += ` (Ignored ${rejected.join(', ')}: not something claims.yml lets the CV carry.)`;
  if (written) {
    const n = Object.keys(written.bullets).length + Object.keys(written.projects).length;
    if (n) reply += ` Reworded ${n} ${n === 1 ? 'line' : 'lines'}.`;
    for (const d of written.dropped.slice(0, 3)) reply += ` Not used: ${d.why}.`;
  }
  if (writeFailed) reply += ' Claude could not write new words this time. Ask again to retry.';
  const posting = checkForInjection(job.description);
  if (posting.suspicious) reply += ` Note: the posting itself looks like it addresses a model (${posting.why}); it was read as data only.`;

  const now = new Date().toISOString();
  const mark = taskId ? { task: taskId } : {};
  const chat: ChatTurn[] = [...history, { role: 'you' as const, text, at: now, ...mark }, { role: 'claude' as const, text: reply, at: now, ...mark }].slice(-MAX_TURNS);
  const saved = await db.application.update({ where: { id: app.id }, data: { cvChat: JSON.stringify(chat) } });
  return cvView(saved, await publishCv(saved, job));
}

/** Drops the refinement and the wording suggestions, so the next build is the posting's own selection again. */
export async function resetCv(app: Application, job: Job) {
  const saved = await db.application.update({ where: { id: app.id }, data: { cvSteer: null, cvChat: '[]', cvSuggestions: null } });
  return cvView(saved, await publishCv(saved, job));
}
