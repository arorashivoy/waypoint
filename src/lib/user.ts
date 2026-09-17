import { cookies } from 'next/headers';
import { db } from './db';
import { COUNTRIES } from './countries';
import { inferLevels } from './match';
import type { ProfileSummary } from './prompts';

export const SESSION_COOKIE = 'waypoint_user';

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

export async function profileSummary(userId: string): Promise<ProfileSummary & { levels: string[]; currentEmployer: string; schools: string[]; interests: string[] }> {
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
    interests: [...new Set(projects.flatMap((p) => (p.tags || '').split(',').map((t) => t.trim()).filter(Boolean)))],
  };
}
