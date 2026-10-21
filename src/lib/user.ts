import { db } from './db';
import { profileFromClaims, type ClaimsDoc, type ResolvedProfile } from './claims';
import { loadProfileDoc } from './profile/store';

export async function isAdmin(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return u?.role === 'admin';
}

/** The profile document of one user, from the profile tables. It is null until the user saves or accepts a first item. */
export async function claimsFor(userId: string): Promise<ClaimsDoc | null> {
  return loadProfileDoc(userId);
}

/**
 * The profile that every prompt uses. It comes from the profile tables only.
 * An import (LinkedIn, résumé, GitHub, YAML) makes drafts. The profile
 * changes only when the user accepts a draft.
 */
export async function profileSummary(userId: string): Promise<ResolvedProfile> {
  const doc = await claimsFor(userId);
  if (doc) return profileFromClaims(doc);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return emptyProfile(user.name);
}

/** The profile of a user who has not accepted any profile item yet. */
export function emptyProfile(name: string): ResolvedProfile {
  return { name, headline: 'No profile yet', positions: [], educations: [], projects: [], skills: [], levels: [], currentEmployer: '', schools: [], interests: [], school: null };
}
