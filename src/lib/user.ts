import { cookies } from 'next/headers';
import { db } from './db';
import { COUNTRIES } from './countries';
import { inferLevels } from './match';
import { loadClaims, profileFromClaims, schoolOf, type ResolvedProfile } from './claims';
import type { ProfileSummary } from './prompts';
import { SESSION_COOKIE } from './auth/cookie-name';

export async function ensureUser(email: string, name: string, picture?: string, linkedin?: string) {
  const user = await db.user.upsert({
    where: { email },
    update: { name, picture, linkedin },
    create: { email, name, picture, linkedin },
  });
  const existing = await db.countryPref.count({ where: { userId: user.id } });
  if (!existing) {
    await db.countryPref.createMany({
      data: COUNTRIES.map((c, i) => ({ userId: user.id, cc: c.cc, rank: i, on: true })),
    });
  }
  return user;
}

export async function currentUser() {
  const id = cookies().get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return db.user.findUnique({ where: { id } });
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('unauthenticated');
  return user;
}

/**
 * The profile every prompt is built from.
 *
 * `data/profile/claims.yml` wins whenever it is present and valid. It is the
 * only account of him that he wrote and vouched for: it says what is actually
 * evidenced, with a proof sentence per claim, where a LinkedIn export says
 * whatever a 2022 undergraduate happened to list and whatever endorsements
 * accumulated since.
 *
 * The import remains the fallback, so the app works on a fresh checkout with
 * nothing but a LinkedIn archive — and so an invalid claims file degrades to a
 * consistent, known-provenance profile rather than a half-read one. `loadClaims`
 * logs loudly in that case; `npm run check:claims` is the gate that stops it
 * reaching runtime at all.
 */
export async function profileSummary(userId: string): Promise<ResolvedProfile> {
  const claims = loadClaims();
  if (claims) return profileFromClaims(claims);

  const [user, positions, educations, projects, skills] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    db.position.findMany({ where: { userId }, orderBy: { startedAt: 'desc' } }),
    db.education.findMany({ where: { userId } }),
    db.projectItem.findMany({ where: { userId } }),
    db.skill.findMany({ where: { userId } }),
  ]);

  const fmt = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'present');

  return {
    name: user.name,
    headline: positions[0] ? `${positions[0].title} at ${positions[0].company}` : 'No experience imported yet',
    positions: positions.map((p) => ({
      title: p.title,
      company: p.company,
      location: p.location,
      summary: p.summary,
      years: `${fmt(p.startedAt)} – ${fmt(p.endedAt)}`,
    })),
    educations: educations.map((e) => ({ school: e.school, degree: e.degree, field: e.field, years: e.years })),
    projects: projects.map((p) => ({ title: p.title, org: p.org, description: p.description, tags: p.tags })),
    skills: skills.map((s) => s.name),
    levels: inferLevels(positions),
    currentEmployer: positions[0]?.company || '',
    schools: educations.map((e) => e.school),
    // Education.csv can carry a school-leaving certificate beside the degree,
    // and its rows come in no particular order.
    school: schoolOf(educations.find((e) => e.degree) || educations[0]),
    interests: [...new Set(projects.flatMap((p) => (p.tags || '').split(',').map((t) => t.trim()).filter(Boolean)))],
  };
}
