import { db } from './db';
import { COUNTRIES, GLOBAL_SITES } from './countries';
import { makeJobViewer } from './analysis';
import { detectMode, claudeAuthFailure, claudeQuotaFailure } from './claude';
import { analysisProgress } from './queue';
import { profileSummary } from './user';
import { claimsFailure, loadClaims } from './claims';
import { projectPicks } from './resume';
import { watchlist } from './sources';

const ago = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
};

const shortAgo = (d: Date) => {
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};

// An export can carry several thousand 1st-degree connections. The counts and
// the company breakdown are computed in the database over all of them; only the
// list itself is capped, and the Profile screen says when it has been.
const CONTACT_LIMIT = 500;

export async function buildState(userId: string) {
  const prefs = await db.countryPref.findMany({ where: { userId }, orderBy: { rank: 'asc' } });
  const onCcs = prefs.filter((p) => p.on).map((p) => p.cc);

  const [user, jobs, apps, claude, profile, contactRows, contactCount, contactsByCompany, lastImportRow] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    // Paused countries are dropped here rather than in the browser, so the cap
    // is spent on listings the user can actually see.
    db.job.findMany({ where: { cc: { in: onCcs } }, orderBy: { postedAt: 'desc' }, take: 400 }),
    db.application.findMany({ where: { userId }, include: { job: true, outreach: { orderBy: { createdAt: 'desc' } } } }),
    detectMode(),
    profileSummary(userId),
    db.contact.findMany({ where: { userId }, orderBy: [{ connectedAt: 'desc' }, { lastName: 'asc' }], take: CONTACT_LIMIT }),
    db.contact.count({ where: { userId } }),
    db.contact.groupBy({ by: ['company'], where: { userId }, _count: { _all: true } }),
    db.profileImport.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const appByJob = new Map(apps.map((a) => [a.jobId, a]));
  const counts = new Map<string, number>();
  for (const g of await db.job.groupBy({ by: ['cc'], _count: { _all: true } })) counts.set(g.cc, g._count._all);

  const view = await makeJobViewer(userId);
  const jobCards = jobs.map((j) => {
      const { analysis, match, provisional, path } = view(j);
      const app = appByJob.get(j.id);
      return {
        id: j.id,
        role: j.role,
        company: j.company,
        city: j.city,
        cc: j.cc,
        place: `${j.cc} · ${j.city}`,
        mode: analysis.mode,
        field: analysis.field,
        level: analysis.level,
        sponsor: analysis.sponsor,
        visa: analysis.visa,
        url: j.url,
        source: j.source,
        priority: j.priority,
        posted: ago(j.postedAt),
        days: Math.floor((Date.now() - j.postedAt.getTime()) / 86_400_000),
        match,
        provisional,
        matchLabel: provisional ? `~${match}% est.` : `${match}% match`,
        path,
        isSent: !!app && app.status !== 'draft',
        isApplied: app?.status === 'applied',
        analysed: analysis.by === 'claude',
      };
  });

  // Ranked by fit, not by date. With several hundred live listings a
  // recency-first list buries the handful worth reading, and a posting Claude
  // has read always outranks a keyword estimate at the same score.
  //
  // A priority company sorts as if it scored PRIORITY_LIFT higher, so it wins
  // among jobs of similar fit but a clearly better fit elsewhere still wins. The
  // lift is applied to the sort key only; the score shown is the real one.
  const PRIORITY_LIFT = 10;
  const key = (j: (typeof jobCards)[number]) => j.match + (j.priority ? PRIORITY_LIFT : 0);
  jobCards.sort((a, b) => key(b) - key(a) || Number(a.provisional) - Number(b.provisional) || a.days - b.days);

  const needs = apps.flatMap((a) =>
    a.outreach
      .filter((o) => (o.kind === 'accepted' || o.kind === 'replied') && !o.handled && !o.certain)
      .map((o) => ({
        id: o.id,
        kind: o.kind === 'accepted' ? 'Accepted' : 'Replied',
        init: o.contactInit || '??',
        who: o.contactName || 'Contact',
        org: o.org || `${a.job.company} · ${a.job.city}`,
        role: a.job.role,
        when: shortAgo(o.createdAt),
        quote: o.incoming || '',
        draftLabel: o.kind === 'accepted' ? 'Referral message, drafted from the posting' : 'Suggested reply',
        draft: o.body,
        reason: o.reason || '',
        action: o.kind === 'accepted' ? 'Send referral' : 'Send reply',
        contactUrl: o.contactUrl,
      })),
  );

  const awaiting = apps
    .filter((a) => a.status === 'sent')
    .map((a) => {
      const sent = a.outreach.find((o) => o.kind === 'request');
      return {
        id: a.id,
        jobId: a.jobId,
        init: sent?.contactInit || '??',
        who: sent?.contactName || 'Contact',
        org: `${a.job.company} · ${a.job.city}`,
        role: a.job.role,
        when: `Sent ${ago(sent?.createdAt || a.updatedAt)}`,
        why: sent?.reason || '',
        contactUrl: sent?.contactUrl,
      };
    });

  const auto = apps.flatMap((a) =>
    a.outreach
      .filter((o) => o.kind === 'replied' && o.certain)
      .map((o) => ({
        id: o.id,
        init: o.contactInit || '??',
        who: o.contactName || 'Contact',
        org: o.org || `${a.job.company} · ${a.job.city}`,
        quote: o.incoming || '',
        sent: o.body,
        why: o.reason || 'Sent on its own: everything it asked for was already on file.',
        handled: o.handled,
        contactUrl: o.contactUrl,
      })),
  );

  // Which CV went to which company, carried through to the screen he opens
  // before an interview. Kept for every application that has one, not only the
  // applied ones, because the question comes up as soon as a reply does.
  const appliedList = apps
    .filter((a) => a.status === 'applied')
    .map((a) => ({
      id: a.id,
      role: a.job.role,
      company: a.job.company,
      city: a.job.city,
      cvUrl: a.cvUrl,
      cvLead: a.cvLead,
      cvSent: a.cvSentAt ? shortAgo(a.cvSentAt) : null,
    }));

  const contacts = contactRows.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    init: [c.firstName[0], c.lastName[0]].filter(Boolean).join('').toUpperCase() || '??',
    position: c.position || '',
    company: c.company || '',
    profileUrl: c.profileUrl,
    connectedAt: c.connectedAt ? c.connectedAt.toISOString() : null,
    connected: c.connectedAt ? c.connectedAt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '',
  }));

  const topContactCompanies = contactsByCompany
    .filter((g) => (g.company || '').trim())
    .map((g) => ({ company: g.company as string, count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company))
    .slice(0, 10);

  let importCounts: Record<string, number> = {};
  if (lastImportRow) {
    try {
      importCounts = JSON.parse(lastImportRow.counts);
    } catch {
      importCounts = {};
    }
  }

  return {
    analysing: analysisProgress(userId),
    user: {
      name: user.name,
      email: user.email,
      initials: user.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
      picture: user.picture,
      linkedin: user.linkedin,
      headline: profile.headline,
    },
    claude: { ...claude, authFailure: claudeAuthFailure(), quotaFailure: claudeQuotaFailure() },
    claims: claimsFailure(),
    countries: COUNTRIES.map((c) => {
      const pref = prefs.find((p) => p.cc === c.cc);
      return { ...c, on: pref ? pref.on : true, count: String(counts.get(c.cc) || 0) };
    }),
    globalSites: GLOBAL_SITES,
    careerLinks: (await watchlist()).flatMap((e) => (e.ats === 'link' ? [{ company: e.company, url: e.url }] : [])),
    jobs: jobCards,
    needs,
    awaiting,
    auto,
    appliedList,
    profile: [
      { label: 'Experience', items: profile.positions.map((p) => ({ t: p.title, o: `${p.company}${p.location ? ` · ${p.location}` : ''}`, d: p.summary || p.years || '', y: p.years || '' })) },
      { label: 'Education', items: profile.educations.map((e) => ({ t: [e.degree, e.field].filter(Boolean).join(' ') || e.school, o: e.school, d: e.years || '' })) },
      { label: 'Projects', items: profile.projects.map((p) => ({ t: p.title, o: p.org || 'Personal project', d: p.description || '' })) },
    ],
    skills: profile.skills,
    contacts,
    contactCount,
    contactLimit: CONTACT_LIMIT,
    topContactCompanies,
    lastImport: lastImportRow
      ? { filename: lastImportRow.filename, createdAt: lastImportRow.createdAt.toISOString(), counts: importCounts }
      : null,
    picks: projectPicks(loadClaims()),
    levels: profile.levels,
  };
}

export type AppState = Awaited<ReturnType<typeof buildState>>;
