import { getOnboarding } from './onboarding';
import { visibleTo } from './job-scope';
import { db } from './db';
import { COUNTRIES, GLOBAL_SITES } from './countries';
import { makeJobViewer } from './analysis';
import { claudeStatus } from './claude';
import { analysisProgress } from './queue';
import { claimsFor, profileSummary } from './user';
import { projectPicks } from './resume';
import { isAlumniRequest } from './match';
import { watchlist } from './sources';
import { blockerLine } from './jobcheck-text';

// An export can carry several thousand 1st-degree connections. The counts and
// the company breakdown are computed in the database over all of them; only the
// list itself is capped, and the Profile screen says when it has been.
const CONTACT_LIMIT = 500;

/**
 * The data of the screens, in 3 builders (one route each) and the profile
 * view. No builder writes a relative time such as "3 days ago": the text would
 * change each minute and so would the ETag. Dates go out as ISO text, and
 * the client turns them into words (src/lib/time-ago.ts).
 */

/** The user, Claude, the countries and the progress of the analysis. The shell needs only this. */
export async function buildMe(userId: string) {
  const [prefs, user, claude, profile, counts, needsCount, analysing, onboarding] = await Promise.all([
    db.countryPref.findMany({ where: { userId }, orderBy: { rank: 'asc' } }),
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    claudeStatus(userId),
    profileSummary(userId),
    db.job.groupBy({ by: ['cc'], where: visibleTo(userId), _count: { _all: true } }),
    db.outreachEvent.count({ where: { application: { userId }, kind: 'replied', handled: false, certain: false } }),
    analysisProgress(userId),
    getOnboarding(userId),
  ]);
  const countByCc = new Map(counts.map((g) => [g.cc, g._count._all]));
  return {
    analysing,
    user: {
      name: user.name,
      email: user.email,
      role: user.role,
      initials: user.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
      picture: user.picture,
      linkedin: user.linkedin,
      headline: profile.headline,
    },
    claude,
    countries: COUNTRIES.map((c) => {
      const pref = prefs.find((p) => p.cc === c.cc);
      return { ...c, on: pref ? pref.on : true, count: String(countByCc.get(c.cc) || 0) };
    }),
    globalSites: GLOBAL_SITES,
    careerLinks: (await watchlist()).flatMap((e) => (e.ats === 'link' ? [{ company: e.company, url: e.url }] : [])),
    needsCount,
    levels: profile.levels,
    onboarding,
  };
}

/** The job cards of the user, ranked by fit. */
export async function buildJobs(userId: string) {
  const prefs = await db.countryPref.findMany({ where: { userId, on: true } });
  const onCcs = prefs.map((p) => p.cc);

  const [jobs, apps, view] = await Promise.all([
    // Paused countries are dropped here rather than in the browser, so the cap
    // is spent on listings the user can actually see.
    db.job.findMany({ where: { cc: { in: onCcs }, ...visibleTo(userId) }, orderBy: { postedAt: 'desc' }, take: 400 }),
    db.application.findMany({ where: { userId }, select: { jobId: true, status: true } }),
    makeJobViewer(userId),
  ]);
  const appByJob = new Map(apps.map((a) => [a.jobId, a]));

  const cards = jobs.map((j) => {
    const { analysis, match, provisional, path, routes } = view(j);
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
      postedAt: j.postedAt.toISOString(),
      match,
      provisional,
      matchLabel: provisional ? `~${match}% est.` : `${match}% match`,
      path,
      isSent: !!app && app.status !== 'draft',
      isApplied: app?.status === 'applied',
      analysed: analysis.by === 'claude',
      // The list needs only this flag. The detail route sends the full check.
      hasBlocker: analysis.blockers.length > 0,
      // The row shows one line for the first blocker (its type and the posting's own words), else one for the contacts who can refer the user.
      blocker: analysis.blockers.length ? blockerLine(analysis.blockers[0].type, analysis.blockers[0].quote) : null,
      referrers: routes.length,
      referrer: routes[0]?.name ?? null,
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
  const key = (j: (typeof cards)[number]) => j.match + (j.priority ? PRIORITY_LIFT : 0);
  const posted = (j: (typeof cards)[number]) => Date.parse(j.postedAt);
  cards.sort((a, b) => key(b) - key(a) || Number(a.provisional) - Number(b.provisional) || posted(b) - posted(a));
  return { jobs: cards };
}

/** The Pending screen: what waits for the user, what is out, what the answers were, and what was applied. */
export async function buildPending(userId: string) {
  const apps = await db.application.findMany({ where: { userId }, include: { job: true, outreach: { orderBy: { createdAt: 'desc' } } } });

  const needs = apps.flatMap((a) =>
    a.outreach
      .filter((o) => o.kind === 'replied' && !o.handled && !o.certain)
      .map((o) => ({
        id: o.id,
        kind: 'Replied',
        init: o.contactInit || '??',
        who: o.contactName || 'Contact',
        org: o.org || `${a.job.company}, ${a.job.city}`,
        role: a.job.role,
        createdAt: o.createdAt.toISOString(),
        quote: o.incoming || '',
        draftLabel: 'Suggested reply',
        draft: o.body,
        reason: o.reason || '',
        action: 'Send reply',
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
        org: `${a.job.company}, ${a.job.city}`,
        role: a.job.role,
        sentAt: (sent?.createdAt || a.updatedAt).toISOString(),
        why: sent?.reason || '',
        contactUrl: sent?.contactUrl,
        // A note to a stranger, so the next step is their accepting, after
        // which the referral message with the CV can go.
        alumni: isAlumniRequest(sent),
      };
    });

  const auto = apps.flatMap((a) =>
    a.outreach
      .filter((o) => o.kind === 'replied' && o.certain)
      .map((o) => ({
        id: o.id,
        init: o.contactInit || '??',
        who: o.contactName || 'Contact',
        org: o.org || `${a.job.company}, ${a.job.city}`,
        quote: o.incoming || '',
        sent: o.body,
        why: o.reason || 'Everything it asked for was already on file.',
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
      cvSentAt: a.cvSentAt ? a.cvSentAt.toISOString() : null,
    }));

  return { needs, awaiting, auto, appliedList };
}

/** What Profile and Résumé show besides the profile document: the summary, the picks, the contacts and the last import. */
export async function buildProfileView(userId: string) {
  const [profile, contactRows, contactCount, contactsByCompany, lastImportRow, claims] = await Promise.all([
    profileSummary(userId),
    db.contact.findMany({ where: { userId }, orderBy: [{ connectedAt: 'desc' }, { lastName: 'asc' }], take: CONTACT_LIMIT }),
    db.contact.count({ where: { userId } }),
    db.contact.groupBy({ by: ['company'], where: { userId }, _count: { _all: true } }),
    db.profileImport.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    claimsFor(userId),
  ]);

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
    picks: projectPicks(claims),
  };
}
