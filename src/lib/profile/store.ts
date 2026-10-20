import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '../db';
import { HttpError } from '../auth/http';
import { checkOwnTex } from '../resume/own-tex';
import { STALE_PROFILE_MESSAGE } from './stale';
import { checkDoc, emptyDoc, type ClaimKind, type ClaimsDoc, type Depth, type ProjectSource, type Rel, type Surface } from './doc';

/**
 * The profile of each user, in the tables of spec 3.1.
 *
 * There is one write path: saveProfile checks the full document with
 * checkDoc, writes a revision of the state before the change, and replaces all
 * profile rows of the user in one transaction. A profile has some hundred
 * rows, so this is cheap, and a partial update cannot leave the tables in a
 * state that checkDoc refuses.
 */

export type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaClient;

const REVISIONS_KEPT = 50;

export class ProfileError extends HttpError {
  constructor(public errors: string[]) {
    super(422, 'The profile has errors. Fix them and save again.', { errors });
  }
}

/** The caller wrote from an older version of the profile than the one in the database. */
export class StaleProfileError extends HttpError {
  constructor() {
    super(409, STALE_PROFILE_MESSAGE);
  }
}

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * The document of one user, from the tables. Null when the user has no
 * ProfileMeta row. Each object has its keys in the order of the types in
 * doc.ts, because diffDocs compares with JSON.stringify.
 */
export async function readProfileDoc(client: Client, userId: string): Promise<ClaimsDoc | null> {
  const meta = await client.profileMeta.findUnique({ where: { userId } });
  if (!meta) return null;
  const [positions, educations, projects, claims] = await Promise.all([
    client.position.findMany({ where: { userId }, orderBy: { order: 'asc' }, include: { bullets: { orderBy: { order: 'asc' } } } }),
    client.education.findMany({ where: { userId }, orderBy: { order: 'asc' } }),
    client.projectItem.findMany({ where: { userId }, orderBy: { order: 'asc' } }),
    client.claim.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
      include: {
        linksFrom: { orderBy: { order: 'asc' }, include: { to: { select: { slug: true } } } },
        evidence: { orderBy: { order: 'asc' } },
        mentions: { orderBy: { order: 'asc' } },
      },
    }),
  ]);
  return {
    version: 1,
    profile: { name: meta.name, headline: meta.headline },
    targets: {
      projects: projects.map((p) => ({
        id: p.slug,
        title: p.title,
        org: p.org,
        description: p.description,
        url: p.url,
        tex: p.tex,
        bullets: parseList(p.bullets),
        // "manual" is the default, so it is not written out. A claims.yml
        // without a source gives the same data back.
        ...(p.source !== 'manual' ? { source: p.source as ProjectSource } : {}),
        repoUrl: p.repoUrl,
      })),
      positions: positions.map((p) => ({
        id: p.slug,
        title: p.title,
        company: p.company,
        location: p.location,
        start: p.start,
        end: p.end,
        summary: p.summary,
        bullets: p.bullets.map((b) => ({ id: b.slug, match: b.match, ...(b.text ? { text: b.text } : {}) })),
      })),
      educations: educations.map((e) => ({ id: e.slug, school: e.school, degree: e.degree, field: e.field, years: e.years, aliases: parseList(e.aliases) })),
    },
    claims: claims.map((c) => ({
      slug: c.slug,
      kind: c.kind as ClaimKind,
      label: c.label,
      aliases: parseList(c.aliases),
      links: c.linksFrom.map((l) => ({ to: l.to.slug, rel: l.rel as Rel, w: l.w })),
      evidence: c.evidence.map((e) => ({ target: e.target, depth: e.depth as Depth, ...(e.proof ? { proof: e.proof } : {}), ...(e.since ? { since: e.since } : {}) })),
      mentions: c.mentions.map((m) => ({ surface: m.surface as Surface, ...(m.url ? { url: m.url } : {}), listed: m.listed })),
      ...(c.value !== null ? { value: c.value } : {}),
      ...(c.scaleMax !== null ? { scaleMax: c.scaleMax } : {}),
      ...(c.higherIsBetter !== null ? { higherIsBetter: c.higherIsBetter } : {}),
    })),
  };
}

const cache = new Map<string, { version: number; doc: ClaimsDoc | null }>();

export function forgetProfile(userId: string): void {
  cache.delete(userId);
}

export async function profileVersion(userId: string): Promise<number> {
  const m = await db.profileMeta.findUnique({ where: { userId }, select: { version: true } });
  return m?.version ?? 0;
}

/**
 * The document of one user. The cache compares ProfileMeta.version, which each
 * write increments, so a write from another process (the worker of part 4)
 * shows at once. Do not change the returned object: other callers share it.
 */
export async function loadProfileDoc(userId: string): Promise<ClaimsDoc | null> {
  const version = await profileVersion(userId);
  const hit = cache.get(userId);
  if (hit && hit.version === version) return hit.doc;
  const doc = await readProfileDoc(db, userId);
  cache.set(userId, { version, doc });
  return doc;
}

async function writeRows(tx: Tx, userId: string, doc: ClaimsDoc): Promise<number> {
  await tx.claim.deleteMany({ where: { userId } });
  await tx.position.deleteMany({ where: { userId } });
  await tx.education.deleteMany({ where: { userId } });
  await tx.projectItem.deleteMany({ where: { userId } });

  const meta = await tx.profileMeta.upsert({
    where: { userId },
    create: { userId, name: doc.profile.name, headline: doc.profile.headline, version: 1 },
    update: { name: doc.profile.name, headline: doc.profile.headline, version: { increment: 1 } },
  });

  const positionIds = doc.targets.positions.map(() => randomUUID());
  await tx.position.createMany({
    data: doc.targets.positions.map((p, i) => ({
      id: positionIds[i],
      userId,
      slug: p.id,
      title: p.title,
      company: p.company,
      location: p.location ?? null,
      start: p.start,
      end: p.end ?? null,
      summary: p.summary ?? null,
      order: i,
    })),
  });
  await tx.positionBullet.createMany({
    data: doc.targets.positions.flatMap((p, i) => (p.bullets ?? []).map((b, j) => ({ positionId: positionIds[i], slug: b.id, match: b.match, text: b.text ?? null, order: j }))),
  });
  await tx.education.createMany({
    data: doc.targets.educations.map((e, i) => ({
      userId,
      slug: e.id,
      school: e.school,
      degree: e.degree ?? null,
      field: e.field ?? null,
      years: e.years ?? null,
      aliases: JSON.stringify(e.aliases ?? []),
      order: i,
    })),
  });
  await tx.projectItem.createMany({
    data: doc.targets.projects.map((p, i) => ({
      userId,
      slug: p.id,
      title: p.title,
      org: p.org ?? null,
      description: p.description ?? null,
      url: p.url ?? null,
      tex: p.tex ?? null,
      bullets: JSON.stringify(p.bullets ?? []),
      source: p.source ?? 'manual',
      repoUrl: p.repoUrl ?? null,
      order: i,
    })),
  });

  const claimIds = new Map(doc.claims.map((c) => [c.slug, randomUUID()]));
  const idOf = (slug: string) => claimIds.get(slug) as string;
  await tx.claim.createMany({
    data: doc.claims.map((c, i) => ({
      id: idOf(c.slug),
      userId,
      slug: c.slug,
      kind: c.kind,
      label: c.label,
      aliases: JSON.stringify(c.aliases),
      value: c.value ?? null,
      scaleMax: c.scaleMax ?? null,
      higherIsBetter: c.higherIsBetter ?? null,
      order: i,
    })),
  });
  await tx.claimLink.createMany({ data: doc.claims.flatMap((c) => c.links.map((l, j) => ({ fromId: idOf(c.slug), toId: idOf(l.to), rel: l.rel, w: l.w, order: j }))) });
  await tx.claimEvidence.createMany({
    data: doc.claims.flatMap((c) => c.evidence.map((e, j) => ({ claimId: idOf(c.slug), target: e.target, depth: e.depth, proof: e.proof ?? null, since: e.since ?? null, order: j }))),
  });
  await tx.claimMention.createMany({
    data: doc.claims.flatMap((c) => c.mentions.map((m, j) => ({ claimId: idOf(c.slug), surface: m.surface, url: m.url ?? null, listed: m.listed, order: j }))),
  });
  return meta.version;
}

/**
 * Checks that the profile is still at the version that the caller loaded. The
 * check is a write that matches only that version, so it takes the database
 * lock: of 2 writes that start together, the second sees the new version and
 * fails. Version 0 means "no profile yet"; there the unique key of ProfileMeta
 * stops the second write.
 */
async function assertVersion(tx: Tx, userId: string, expected: number): Promise<void> {
  if (expected === 0) {
    if (await tx.profileMeta.findUnique({ where: { userId }, select: { userId: true } })) throw new StaleProfileError();
    return;
  }
  const held = await tx.profileMeta.updateMany({ where: { userId, version: expected }, data: { version: expected } });
  if (held.count !== 1) throw new StaleProfileError();
}

/**
 * The one write path for a profile. It refuses a document with errors
 * (ProfileError, 422) and changes nothing then. `extra` runs in the same
 * transaction, after the rows are written; if it throws, nothing is saved.
 * `expectedVersion` is the version that the caller loaded. If the profile has
 * another version now, the write fails with StaleProfileError (409).
 */
export async function saveProfile(
  userId: string,
  next: ClaimsDoc,
  note: string,
  extra?: (tx: Tx) => Promise<void>,
  expectedVersion?: number,
): Promise<{ warnings: string[]; version: number }> {
  const check = checkDoc(next);
  if (!check.doc) throw new ProfileError(check.errors);
  const doc = check.doc;
  // The LaTeX of a project goes into the CV source as it is, so it passes the same checks as an own .tex file.
  const texErrors = doc.targets.projects.flatMap((p, i) => {
    const r = p.tex ? checkOwnTex(p.tex) : null;
    return r && !r.ok ? r.reasons.map((reason) => `targets.projects[${i}].tex: ${reason}`) : [];
  });
  if (texErrors.length) throw new ProfileError(texErrors);
  try {
    const version = await db.$transaction(
      async (tx) => {
        if (expectedVersion !== undefined) await assertVersion(tx, userId, expectedVersion);
        const before = await readProfileDoc(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
        await tx.profileRevision.create({ data: { userId, snapshot: JSON.stringify(before ?? emptyDoc(user.name)), note: note.slice(0, 300) } });
        const v = await writeRows(tx, userId, doc);
        const old = await tx.profileRevision.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: REVISIONS_KEPT, select: { id: true } });
        if (old.length) await tx.profileRevision.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
        if (extra) await extra(tx);
        return v;
      },
      { timeout: 20_000 },
    );
    // The base résumé of the template follows the profile. The import is late: resume.ts reads this module.
    await (await import('../resume/base')).queueBaseResume(userId);
    return { warnings: check.warnings, version };
  } catch (e) {
    // Two first writes at once: the second fails on the unique key of ProfileMeta.
    if (expectedVersion === 0 && (e as { code?: string }).code === 'P2002') throw new StaleProfileError();
    throw e;
  } finally {
    forgetProfile(userId);
  }
}

export async function listRevisions(userId: string): Promise<{ id: string; note: string; createdAt: Date }[]> {
  return db.profileRevision.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: REVISIONS_KEPT, select: { id: true, note: true, createdAt: true } });
}

/** Puts the state of a revision back. The restore writes a revision too, so it can be undone. */
export async function restoreRevision(userId: string, id: string, expectedVersion?: number): Promise<{ warnings: string[]; version: number }> {
  const rev = await db.profileRevision.findFirst({ where: { id, userId } });
  if (!rev) throw new HttpError(404, 'Not found.');
  const day = rev.createdAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return saveProfile(userId, JSON.parse(rev.snapshot) as ClaimsDoc, `Restored the profile from ${day} UTC`, undefined, expectedVersion);
}
