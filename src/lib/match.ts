import type { Contact } from '@prisma/client';

export type Requirement = { t: string; ok: boolean };

/**
 * match % = 20·(requirements met) + 40·(field fit) + 40·(level fit).
 *
 * Requirements are weighted *low on purpose*. A job posting's requirement list
 * is a wish-list, not a bar: teams routinely list every technology they touch
 * plus a few they aspire to, and the resulting composite candidate frequently
 * does not exist. So a low R is weak evidence of unsuitability — it is often a
 * fact about how the posting was written rather than about the candidate. A
 * noisy, systematically inflated signal should not drive the ranking.
 *
 * Field and level are far harder to inflate. A posting is either in securities
 * finance or it is not; it is either pitched at Senior or it is not. They are
 * coarse, but they are honest, so they carry 80 of the 100 points and decide the
 * order. R is kept as a tiebreaker: between two roles in the right area at the
 * right level, the one you already evidence more of ranks first.
 *
 * What a score means, therefore: "how well does this match the kind of role and
 * seniority I want", not "am I ready for it". The per-requirement list on the
 * job detail screen is where readiness is judged, by eye.
 *
 * Consequence to keep in view: field and level together (80) outweigh a full
 * requirements match (20). A job meeting none of its stated requirements but in
 * the right area at the right level scores 80; a job meeting every one of them
 * but labelled Robotics against a Mid profile, posted at Senior, scores
 * 20 + 40·0.3 + 40·0.5 = 52.
 *
 * Known leak: fieldFit is 0 for a posting that is not a software role, but
 * levelFit still pays out, so a marketing or site-manager listing collects 40
 * points from a seniority label that means nothing for it.
 *
 * Worked example: 3 of 4 requirements met, field matches, level is adjacent
 * (posting Senior, candidate Mid) → 20·0.75 + 40·1 + 40·0.5 = 15 + 40 + 20 = 75.
 */
export function matchScore(reqs: Requirement[], fieldFit: number, levelFit: number): number {
  const ratio = reqs.length ? reqs.filter((r) => r.ok).length / reqs.length : 0;
  return Math.round(20 * ratio + 40 * fieldFit + 40 * levelFit);
}

const LEVEL_ORDER = ['Entry', 'Mid', 'Senior'];

export function levelFit(jobLevel: string, profileLevels: string[]): number {
  if (profileLevels.includes(jobLevel)) return 1;
  const j = LEVEL_ORDER.indexOf(jobLevel);
  const near = profileLevels.some((l) => Math.abs(LEVEL_ORDER.indexOf(l) - j) === 1);
  return near ? 0.5 : 0;
}

export function fieldFit(jobField: string, strongFields: string[]): number {
  if (strongFields.includes(jobField)) return 1;
  if (jobField === 'Backend') return 0.6; // Backend overlaps almost everything the profile has
  if (jobField === 'Other') return 0; // not a software role at all
  return 0.3;
}

/** Engineering Analyst with a few years maps to Entry and Mid, per the brief. */
export function inferLevels(positions: { title: string; startedAt?: Date | null; endedAt?: Date | null }[]): string[] {
  if (!positions.length) return ['Entry', 'Mid'];
  const years = positions.reduce((sum, p) => {
    const start = p.startedAt ? p.startedAt.getTime() : Date.now();
    const end = p.endedAt ? p.endedAt.getTime() : Date.now();
    return sum + Math.max(0, end - start) / (365.25 * 24 * 3600 * 1000);
  }, 0);
  const senior = positions.some((p) => /\b(senior|staff|principal|lead|vp|vice president|director)\b/i.test(p.title));
  if (senior || years >= 8) return ['Mid', 'Senior'];
  if (years >= 3) return ['Entry', 'Mid'];
  return ['Entry', 'Mid'];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(inc|ltd|llc|gmbh|se|sa|nv|bv|plc|group|services|bank|europe|technology|technologies)\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * Whether a contact's headline names a school.
 *
 * A substring test is wrong here in both directions. "IIIT-D" as a plain
 * substring hits "IIIT Dharwad", and the full registered name — "Indraprastha
 * Institute of Information Technology Delhi" — appears in nobody's headline,
 * which is why the alumnus branch almost never fired before. So: match on word
 * boundaries over the normalised text, and let `ctx.schools` carry the short
 * forms people actually write (IIIT Delhi, IIITD) alongside the official name.
 *
 * Terms under four characters are refused outright: a two-letter token matches
 * half the connection list, and one false alum outranks a genuine ex-colleague
 * under the ordering above.
 */
function mentionsTerm(headline: string, term: string): boolean {
  const t = norm(term);
  if (t.length < 4) return false;
  return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(norm(headline));
}

export type Route = {
  init: string;
  name: string;
  role: string;
  why: string;
  best: boolean;
  profileUrl: string | null;
  score: number;
};

export type RouteContext = {
  company: string;
  field: string;
  currentEmployer: string;
  schools: string[];
  interests: string[];
};

/**
 * Ranking, highest first:
 *   alumnus at the company > former colleague at the company > 1st-degree at the
 *   company > shared interest > everyone else. Only 1st-degree connections exist
 *   in a LinkedIn export, so a company with no connection gets an honest empty
 *   list rather than an invented person.
 *
 * Alumni (110) outrank former colleagues (105), which still outrank a plain
 * 1st-degree connection at the company (100) — the gaps are kept narrow so the
 * recruiter penalty (-25) continues to sink a talent-acquisition contact below
 * all three.
 *
 * Alumni outrank former colleagues on his instruction. The two branches are
 * therefore also *ordered* — the chain below tests alumnus first — because a
 * contact who is both an IIIT-D graduate and ex-Goldman is common, and an
 * `else if` chain silently awards whichever branch it reaches first regardless
 * of the scores attached to them. Reordering the numbers without reordering the
 * tests would have changed nothing for exactly the contacts this is aimed at.
 */
export function rankRoutes(contacts: Contact[], ctx: RouteContext): Route[] {
  const target = norm(ctx.company);
  const employer = norm(ctx.currentEmployer);

  const routes = contacts
    .map((c) => {
      const company = norm(c.company || '');
      if (!company || !target) return null;
      const atCompany = company === target || company.includes(target) || target.includes(company);
      if (!atCompany) return null;

      const position = c.position || '';
      let score = 100;
      let why = '1st-degree connection at the company';

      const alum = ctx.schools.find((s) => mentionsTerm(position, s));
      if (alum) {
        score = 110;
        why = `1st-degree · ${alum} alum`;
      } else if (employer && (company.includes(employer) || norm(position).includes(employer))) {
        score = 105;
        why = `1st-degree · same ${ctx.currentEmployer} org`;
      } else if (ctx.interests.some((i) => norm(position).includes(norm(i)))) {
        score = 90;
        why = `1st-degree · shared interest: ${ctx.interests.find((i) => norm(position).includes(norm(i)))}`;
      }
      // `\brecruit\b` never matched "Recruiter" or "Recruiting", so the penalty
      // had been silently dead. It matters more now that alumni score 110: a
      // recruiter who happens to be an alumnus would otherwise top the list.
      if (/\b(recruit\w*|talent|sourcer)\b/i.test(position)) { score -= 25; why += ' · recruiter'; }

      const name = `${c.firstName} ${c.lastName}`.trim();
      return {
        init: `${c.firstName[0] || '?'}${c.lastName[0] || ''}`.toUpperCase(),
        name,
        role: [position, c.company].filter(Boolean).join(' · '),
        why,
        best: false,
        profileUrl: c.profileUrl,
        score,
      } as Route;
    })
    .filter((r): r is Route => !!r)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (routes[0]) routes[0].best = true;
  return routes;
}

/** The label the job card shows for how you would get in. */
export function routeLabel(routes: Route[], company: string): string {
  if (!routes.length) return `No 1st-degree contact at ${company}`;
  return routes[0].why.replace(/^1st-degree · /, '').replace(/^1st-degree connection at the company$/, '1st-degree connection');
}

/**
 * Where to look for an alumnus when no connection works at the company.
 *
 * Waypoint cannot run this search itself — LinkedIn has no people-search API
 * and scraping it breaks the User Agreement — so this is a link the user opens
 * and picks from. It uses the people search's own Company and School fields
 * rather than `keywords`: a keyword matches anywhere on a profile, so a
 * company keyword also returns people who left it years ago or only mention
 * it, while the Company field matches the current employer. The school's
 * registered name and its short form are both offered, since profiles carry
 * either.
 *
 * Legal suffixes are dropped because a board lists "Stripe, Inc." and a
 * profile says "Stripe", and the keyword filter is literal.
 */
export function alumniSearch(school: { name: string; short: string }, company: string) {
  const name = company.replace(/[,\s]+(inc|ltd|llc|gmbh|ag|se|sa|nv|bv|b\.v|n\.v|plc|limited)\.?$/i, '').trim() || company;
  const schools = [...new Set([school.name, school.short])].map((s) => `"${s}"`).join(' OR ');
  const q = new URLSearchParams({ company: `"${name}"`, schoolFreetext: schools, origin: 'FACETED_SEARCH' });
  return `https://www.linkedin.com/search/results/people/?${q}`;
}

/** Marks an outreach row as a note to an alumnus rather than a message to a
 *  connection — the reply and acceptance paths differ, and there is no column
 *  for it because the distinction lives only until they accept. */
export const ALUMNI_REASON = 'Alumni request · not a connection yet';
export const isAlumniRequest = (o: { reason: string | null } | null | undefined) => o?.reason === ALUMNI_REASON;
