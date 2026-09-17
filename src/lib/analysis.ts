import type { Job } from '@prisma/client';
import { db } from './db';
import { askJson, detectMode } from './claude';
import { ANALYSE_SYSTEM, analysePrompt, NOTE_SYSTEM, notePrompt } from './prompts';
import { profileSummary } from './user';
import { fieldFit, levelFit, matchScore, rankRoutes, routeLabel, type Route } from './match';
import { ALWAYS_ON_CV, CV_COUNTRY_RULES, PROJECT_PICKS } from './countries';
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

const STRONG_FIELDS = ['Finance tech', 'Backend'];

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
  // and handed a paid-search marketing role a 65% score.
  const candidates = [
    ['Securities lending or financing domain', /securities lending|stock loan|collateral management|repo desk|prime brokerage|post-trade/i],
    ['Production systems at scale', /high[- ]throughput|low[- ]latency|production services|scalab(le|ility)|high availability/i],
    ['Java or Spring', /\bjava\b|spring boot|\bjvm\b/i],
    ['Python', /\bpython\b|\bdjango\b|\bfastapi\b/i],
    ['C++', /\bc\+\+\b|\bcpp\b/i],
    ['Distributed systems', /distributed systems|\bkafka\b|microservices|event[- ]driven/i],
    ['ROS 2 and SLAM', /\bros ?2\b|\bslam\b|point cloud|motion planning/i],
    ['Machine learning', /\bbert\b|transformer|pytorch|tensorflow|machine learning engineer|deep learning/i],
    ['Strong algorithms and maths', /data structures and algorithms|numerical method|linear algebra|competitive programming/i],
  ] as const;

  const requirements: { t: string; ok: boolean }[] =
    field === 'Other'
      ? [{ t: 'A software engineering role', ok: false }]
      : candidates
          .filter(([, re]) => re.test(job.description) || re.test(job.role))
          .slice(0, 5)
          .map(([t, re]) => ({ t, ok: re.test(haystack) }));

  // A posting that names none of these is outside the profile's vocabulary, so
  // nothing is credited until Claude has actually read it.
  if (requirements.length < 2) requirements.push({ t: 'Core skills named in the posting', ok: false });

  const lead = PROJECT_PICKS.find((p) => job.field.startsWith(p.role.split(',')[0].split(' ')[0]))?.lead;
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
      ALWAYS_ON_CV[1],
    ].filter(Boolean),
    projects,
    by: 'heuristic',
  };
}

export async function analyseJob(job: Job, userId: string, force = false): Promise<Analysis> {
  if (job.analysis && !force) return JSON.parse(job.analysis) as Analysis;

  const profile = await profileSummary(userId);
  let analysis: Analysis;

  const { mode } = await detectMode();
  if (mode === 'none') {
    analysis = heuristicAnalysis(job, profile);
  } else {
    try {
      const out = await askJson<Omit<Analysis, 'by'>>(ANALYSE_SYSTEM, analysePrompt(profile, job));
      analysis = { ...out, requirements: out.requirements || [], must: out.must || [], projects: out.projects || [], by: 'claude' };
    } catch {
      analysis = heuristicAnalysis(job, profile);
    }
  }

  await db.job.update({
    where: { id: job.id },
    data: {
      analysis: JSON.stringify(analysis),
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
  const raw = matchScore(analysis.requirements, fieldFit(analysis.field, STRONG_FIELDS), levelFit(analysis.level, profile.levels));
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

export async function draftNote(job: Job, userId: string, route: Route | null): Promise<string> {
  const profile = await profileSummary(userId);
  const contact = route || { name: 'there', role: `at ${job.company}`, why: 'no 1st-degree contact found yet' };
  const { mode } = await detectMode();

  if (mode === 'none') {
    const firstName = contact.name.split(' ')[0];
    const base = `Hi ${firstName}, I ${profile.headline.toLowerCase()} and saw the ${job.role} role at ${job.company}. It maps closely to the systems I build today. Would you be open to referring me?`;
    return base.slice(0, 300);
  }

  const { note } = await askJson<{ note: string }>(NOTE_SYSTEM, notePrompt(profile, job, contact));
  return (note || '').slice(0, 300);
}
