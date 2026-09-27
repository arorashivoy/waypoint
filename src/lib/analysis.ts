import type { Job } from '@prisma/client';
import { db } from './db';
import { detectMode } from './claude';
import { askJsonCached } from './cache';
import { ANALYSE_SYSTEM, analysePrompt, NOTE_SYSTEM, notePrompt } from './prompts';
import { profileSummary } from './user';
import { fieldFit, levelFit, matchScore, rankRoutes, routeLabel, type Route } from './match';
import { renderNote, resolveHighlight, type Slots } from './templates';
import { CV_COUNTRY_RULES, FIELD_QUERIES } from './countries';
import { loadClaims } from './claims';
import { claimsInPosting, projectPicks, rankEvidence } from './resume';
import { fieldFromText } from './sources/geo';

export type Analysis = {
  field: string;
  mode: string;
  level: string;
  sponsor: boolean;
  visa: string;
  requirements: { t: string; ok: boolean }[];
  must: string[];
  projects: { n: string; why: string }[];
  by: 'claude' | 'heuristic';
};

/** The two fields claims.yml has the strongest job or project evidence for. Without
 *  a claims file, Backend: every software profile overlaps it. */
function strongFields(): string[] {
  const doc = loadClaims();
  if (!doc) return ['Backend'];
  return FIELD_QUERIES.map((q) => ({ field: q.field, score: rankEvidence(doc, q.query).find((p) => p.kind === 'project' || p.kind === 'position')?.score || 0 }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((f) => f.field);
}

/** Keyword overlap, used when Claude is not reachable so the app still works. */
function heuristicAnalysis(job: Job, profile: Awaited<ReturnType<typeof profileSummary>>): Analysis {
  const haystack = [
    ...profile.positions.map((p) => `${p.title} ${p.company} ${p.summary || ''}`),
    ...profile.projects.map((p) => `${p.title} ${p.description || ''}`),
    ...profile.skills,
  ].join(' ').toLowerCase();

  const field = fieldFromText(`${job.role}\n${job.description}`);

  // Deliberately narrow patterns. An earlier, looser set matched words that
  // appear in any corporate posting — "platform", "systems", "optimization" —
  // and handed a paid-search marketing role a 65% score. Used only when there
  // is no claims.yml; with one, the posting is read against the claim graph.
  const candidates = [
    ['Production systems at scale', /high[- ]throughput|low[- ]latency|production services|scalab(le|ility)|high availability/i],
    ['Java or Spring', /\bjava\b|spring boot|\bjvm\b/i],
    ['Python', /\bpython\b|\bdjango\b|\bfastapi\b/i],
    ['C++', /\bc\+\+\b|\bcpp\b/i],
    ['Distributed systems', /distributed systems|\bkafka\b|microservices|event[- ]driven/i],
    ['Machine learning', /\bbert\b|transformer|pytorch|tensorflow|machine learning engineer|deep learning/i],
    ['Strong algorithms and maths', /data structures and algorithms|numerical method|linear algebra|competitive programming/i],
  ] as const;

  const claims = loadClaims();
  const requirements: { t: string; ok: boolean }[] =
    field === 'Other'
      ? [{ t: 'A software engineering role', ok: false }]
      : claims
      ? claimsInPosting(claims, `${job.role}\n${job.description}`).slice(0, 5)
      : candidates
          .filter(([, re]) => re.test(job.description) || re.test(job.role))
          .slice(0, 5)
          .map(([t, re]) => ({ t, ok: re.test(haystack) }));

  // A posting that names none of these is outside the profile's vocabulary, so
  // nothing is credited until Claude has actually read it.
  if (requirements.length < 2) requirements.push({ t: 'Core skills named in the posting', ok: false });

  const lead = projectPicks(claims).find((p) => p.role === job.field)?.lead;
  const projects = profile.projects
    .map((p) => ({ n: p.title, why: p.title === lead ? 'Closest match to this posting' : 'Supporting evidence, one line' }))
    .sort((a, b) => (a.n === lead ? -1 : b.n === lead ? 1 : 0))
    .slice(0, 3);

  return {
    field,
    mode: job.mode,
    level: job.level,
    sponsor: job.sponsor,
    visa: job.visa,
    requirements,
    must: [
      job.cc === 'IN'
        ? 'A notice period line'
        : `A work authorisation line: "Will require ${job.visa === 'Sponsorship not stated' ? 'sponsorship' : job.visa} sponsorship"`,
      ...(CV_COUNTRY_RULES[job.cc] || []).slice(0, 1),
    ].filter(Boolean),
    projects,
    by: 'heuristic',
  };
}

/** How many times a posting may fail analysis before it stops being queued. A
 *  posting whose description breaks the model every time would otherwise take a
 *  slot out of every refresh's budget forever. */
export const MAX_ANALYSIS_TRIES = 3;

/**
 * `analysedAt` — not `analysis` — is the flag that means "Claude has read this".
 * They differ whenever a call failed: the heuristic is still written so the card
 * has something to show, but the job stays eligible for a retry instead of being
 * silently frozen at a keyword guess.
 *
 * The model call itself goes through `askJsonCached`, so a posting syndicated to
 * two boards under two externalIds costs one call, not two.
 */
export async function analyseJob(job: Job, userId: string, force = false): Promise<Analysis> {
  if (job.analysedAt && job.analysis && !force) return JSON.parse(job.analysis) as Analysis;

  const profile = await profileSummary(userId);
  let analysis: Analysis;
  let read = false;

  const { mode } = await detectMode();
  if (mode === 'none') {
    analysis = heuristicAnalysis(job, profile);
  } else {
    try {
      const out = await askJsonCached<Omit<Analysis, 'by'>>('analysis', ANALYSE_SYSTEM, analysePrompt(profile, job));
      analysis = { ...out, requirements: out.requirements || [], must: out.must || [], projects: out.projects || [], by: 'claude' };
      read = true;
    } catch {
      analysis = heuristicAnalysis(job, profile);
    }
  }

  await db.job.update({
    where: { id: job.id },
    data: {
      analysis: JSON.stringify(analysis),
      analysedAt: read ? new Date() : job.analysedAt,
      analysisTries: read ? job.analysisTries : job.analysisTries + 1,
      field: analysis.field || job.field,
      mode: analysis.mode || job.mode,
      level: analysis.level || job.level,
      sponsor: analysis.sponsor ?? job.sponsor,
      visa: analysis.visa || job.visa,
    },
  });
  return analysis;
}

type Profile = Awaited<ReturnType<typeof profileSummary>>;

function viewOf(job: Job, profile: Profile, contacts: { company: string | null; position: string | null; firstName: string; lastName: string; profileUrl: string | null }[], analysis: Analysis) {
  const routes = rankRoutes(contacts as any, {
    company: job.company,
    field: analysis.field,
    currentEmployer: profile.currentEmployer,
    schools: profile.schools,
    interests: profile.interests,
  });

  const provisional = analysis.by !== 'claude';
  const raw = matchScore(analysis.requirements, fieldFit(analysis.field, strongFields()), levelFit(analysis.level, profile.levels));
  // A keyword guess is never allowed to outrank a posting Claude actually read.
  const match = provisional ? Math.min(raw, 65) : raw;

  return { analysis, routes, match, provisional, path: routeLabel(routes, job.company) };
}

/**
 * Scoring a list of jobs needs the profile and the connection list exactly once,
 * not once per job — with a few hundred listings that difference is hundreds of
 * queries per page load.
 */
export async function makeJobViewer(userId: string) {
  const [profile, contacts] = await Promise.all([
    profileSummary(userId),
    db.contact.findMany({ where: { userId } }),
  ]);
  return (job: Job) => viewOf(job, profile, contacts, job.analysis ? JSON.parse(job.analysis) : heuristicAnalysis(job, profile));
}

export async function jobView(job: Job, userId: string, opts: { analyse?: boolean } = {}) {
  const [profile, contacts] = await Promise.all([
    profileSummary(userId),
    db.contact.findMany({ where: { userId } }),
  ]);

  const analysis: Analysis = job.analysis
    ? JSON.parse(job.analysis)
    : opts.analyse
      ? await analyseJob(job, userId)
      : heuristicAnalysis(job, profile);

  return viewOf(job, profile, contacts, analysis);
}

/**
 * The note is assembled from `CONNECT_NOTE_TEMPLATE`; Claude supplies only the
 * hook, the proof line and which project or role to highlight. That keeps the
 * ask and the tone fixed, keeps the 300-character budget under our control
 * rather than the model's, and bounds what a hostile job description can reach.
 */
export async function draftNote(job: Job, userId: string, route: Route | null): Promise<string> {
  const profile = await profileSummary(userId);
  const contact = route || { name: 'there', role: `at ${job.company}`, why: 'no 1st-degree contact found yet' };
  const firstName = contact.name.split(' ')[0];
  const candidates = [...profile.projects.map((p) => p.title), ...profile.positions.map((p) => p.title)].filter(Boolean);
  const { mode } = await detectMode();

  if (mode === 'none') {
    return renderNote({
      firstName,
      role: job.role,
      company: job.company,
      highlight: candidates[0] || '',
      hook: `it maps closely to the systems I build today`,
      proof: `I ${profile.headline.toLowerCase()}`,
    });
  }

  const slots = await askJsonCached<Slots>('note', NOTE_SYSTEM, notePrompt(profile, job, contact));
  return renderNote({
    firstName,
    role: job.role,
    company: job.company,
    // Checked against the candidate's real titles: a note naming a project they
    // have never built is worse than one naming the wrong real project.
    highlight: resolveHighlight(slots.highlight, candidates),
    hook: slots.hook,
    proof: slots.proof,
  });
}
