import { db } from './db';
import { loadClaims, profileFromClaims, type ClaimsDoc, type ResolvedProfile } from './claims';

export async function isAdmin(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return u?.role === 'admin';
}

/**
 * The claims document of one user. Until part 3 moves profiles into the
 * database, data/profile/claims.yml is the admin's file, so only the admin
 * gets it. A member's profile comes from the LinkedIn import tables.
 */
export async function claimsFor(userId: string): Promise<ClaimsDoc | null> {
  return (await isAdmin(userId)) ? loadClaims() : null;
}

/**
 * The profile every prompt is built from.
 *
 * It comes from the profile tables (Task 4) or, for the admin until then,
 * from data/profile/claims.yml. There is no LinkedIn fallback, because the
 * LinkedIn import now makes drafts that the user must accept first.
 */
export async function profileSummary(userId: string): Promise<ResolvedProfile> {
  const claims = await claimsFor(userId);
  if (claims) return profileFromClaims(claims);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return emptyProfile(user.name);
}

/** The profile of a user who has not accepted any profile item yet. */
export function emptyProfile(name: string): ResolvedProfile {
  return { name, headline: 'No profile yet', positions: [], educations: [], projects: [], skills: [], levels: [], currentEmployer: '', schools: [], interests: [], school: null };
}
