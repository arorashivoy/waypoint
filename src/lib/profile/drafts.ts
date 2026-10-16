import { db } from '../db';
import { HttpError } from '../auth/http';
import { checkForInjection } from '../injection';
import { checkDoc, diffDocs, emptyDoc, type ClaimsDoc, type DiffLine } from './doc';
import { applyDrafts, findItem, itemKey, ITEM_KINDS, type DraftType, type Item, type ItemKind } from './apply';
import { parseItem } from './item-schemas';
import { loadProfileDoc, ProfileError, saveProfile } from './store';

/**
 * Drafts (spec 3.3). No importer changes the profile. Each one makes drafts,
 * and the profile changes only when the user accepts them. A draft with a
 * warning (an injection signal, hidden text) waits until the user approves
 * the warning or edits the draft.
 */

export const MAX_PENDING = 500;
const MAX_SCAN = 5000;
const KEEP_DONE_DAYS = 30;

export type NewDraft = { type: DraftType; data: unknown; warnings?: string[] };
export type DraftView = {
  id: string;
  batchId: string;
  source: string;
  type: DraftType;
  data: unknown;
  warnings: string[];
  warningsApproved: boolean;
  matches: string | null;
  existing: unknown | null;
  diff: DiffLine[] | null;
  createdAt: string;
};

const parseJson = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** One warning for each kind of injection signal in the strings of `data`. */
export function scanWarnings(data: unknown): string[] {
  const out = new Set<string>();
  let n = 0;
  let capped = false;
  const walk = (v: unknown) => {
    if (n > MAX_SCAN) {
      capped = true;
      return;
    }
    if (typeof v === 'string') {
      n++;
      const c = checkForInjection(v);
      if (c.suspicious) out.add(`Check this text before you accept it: ${c.why}.`);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(data);
  if (capped) out.add('This draft is too large to check fully. Check all of its text before you accept it.');
  return [...out];
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The key of the item that a draft would replace: the same key, or a similar title. */
function findMatch(doc: ClaimsDoc | null, type: DraftType, data: unknown): string | null {
  if (!doc || !(ITEM_KINDS as readonly string[]).includes(type)) return null;
  const kind = type as ItemKind;
  const item = data as Item;
  const key = itemKey(kind, item);
  if (findItem(doc, kind, key)) return key;
  const d = data as Record<string, unknown>;
  if (kind === 'position') return doc.targets.positions.find((p) => norm(p.title) === norm(d.title) && norm(p.company) === norm(d.company))?.id ?? null;
  if (kind === 'education') return doc.targets.educations.find((e) => norm(e.school) === norm(d.school) || (e.aliases ?? []).some((a) => norm(a) === norm(d.school)))?.id ?? null;
  if (kind === 'project') return doc.targets.projects.find((p) => norm(p.title) === norm(d.title))?.id ?? null;
  return doc.claims.find((c) => norm(c.label) === norm(d.label) || c.aliases.some((a) => norm(a) === norm(d.label)))?.slug ?? null;
}

export async function createDrafts(userId: string, batch: { batchId: string; source: string; items: NewDraft[]; warnings?: string[] }): Promise<number> {
  const pending = await db.profileDraft.count({ where: { userId, status: 'pending' } });
  if (pending + batch.items.length > MAX_PENDING) throw new HttpError(409, `More than ${MAX_PENDING} drafts would wait. Accept or reject some drafts first.`);
  await db.profileDraft.deleteMany({ where: { userId, status: { not: 'pending' }, updatedAt: { lt: new Date(Date.now() - KEEP_DONE_DAYS * 86_400_000) } } });

  const doc = await loadProfileDoc(userId);
  const rows = batch.items.map((item) => {
    const data = parseItem(item.type, item.data);
    if (item.type === 'profile') {
      const c = checkDoc(data);
      if (!c.doc) throw new ProfileError(c.errors);
    }
    const warnings = [...new Set([...(batch.warnings ?? []), ...(item.warnings ?? []), ...scanWarnings(data)])];
    return {
      userId,
      batchId: batch.batchId,
      source: batch.source,
      type: item.type,
      data: JSON.stringify(data),
      warnings: JSON.stringify(warnings),
      matches: findMatch(doc, item.type, data),
    };
  });
  if (rows.length) await db.profileDraft.createMany({ data: rows });
  return rows.length;
}

export async function listDrafts(userId: string): Promise<DraftView[]> {
  const [rows, doc] = await Promise.all([
    db.profileDraft.findMany({ where: { userId, status: 'pending' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_PENDING }),
    loadProfileDoc(userId),
  ]);
  return rows.map((r) => {
    const type = r.type as DraftType;
    const data = parseJson<unknown>(r.data, null);
    const kind = (ITEM_KINDS as readonly string[]).includes(type) ? (type as ItemKind) : null;
    return {
      id: r.id,
      batchId: r.batchId,
      source: r.source,
      type,
      data,
      warnings: parseJson<string[]>(r.warnings, []),
      warningsApproved: r.warningsApproved,
      matches: r.matches,
      existing: doc && kind && r.matches ? findItem(doc, kind, r.matches) : type === 'meta' && doc ? doc.profile : null,
      diff: type === 'profile' ? diffDocs(doc, data as ClaimsDoc) : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** The draft IDs of a request body: 1 to 200 strings. */
export function readIds(body: Record<string, unknown>): string[] {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || ids.some((x) => typeof x !== 'string' || x.length > 40)) {
    throw new HttpError(400, 'Send "ids": a list of 1 to 200 draft IDs.');
  }
  return [...new Set(ids as string[])];
}

export async function acceptDrafts(userId: string, ids: string[]): Promise<{ warnings: string[] }> {
  const rows = await db.profileDraft.findMany({ where: { userId, id: { in: ids }, status: 'pending' } });
  if (rows.length !== ids.length) throw new HttpError(404, 'Not found.');
  if (rows.some((r) => r.type === 'profile') && rows.length > 1) throw new HttpError(400, 'Accept the YAML import on its own.');
  if (rows.some((r) => parseJson<string[]>(r.warnings, []).length && !r.warningsApproved)) {
    throw new HttpError(409, 'Review the warnings on a draft before you accept it.');
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const doc = (await loadProfileDoc(userId)) ?? emptyDoc(user.name);
  const next = applyDrafts(
    doc,
    rows.map((r) => ({ type: r.type as DraftType, data: parseJson<unknown>(r.data, null), matches: r.matches })),
  );
  const sources = [...new Set(rows.map((r) => r.source))].join(', ');
  const note = `Accepted ${rows.length} draft${rows.length === 1 ? '' : 's'} from ${sources}`;
  const r = await saveProfile(userId, next, note, async (tx) => {
    await tx.profileDraft.updateMany({ where: { userId, id: { in: ids }, status: 'pending' }, data: { status: 'accepted' } });
  });
  return { warnings: r.warnings };
}

export async function rejectDrafts(userId: string, ids: string[]): Promise<number> {
  const r = await db.profileDraft.updateMany({ where: { userId, id: { in: ids }, status: 'pending' }, data: { status: 'rejected' } });
  return r.count;
}

export async function editDraft(userId: string, id: string, raw: unknown): Promise<DraftView> {
  const row = await db.profileDraft.findFirst({ where: { id, userId, status: 'pending' } });
  if (!row) throw new HttpError(404, 'Not found.');
  const type = row.type as DraftType;
  const data = parseItem(type, raw);
  if (type === 'profile') {
    const c = checkDoc(data);
    if (!c.doc) throw new ProfileError(c.errors);
  }
  // The user read and changed the text, so only the scan of the new text stays.
  await db.profileDraft.update({
    where: { id },
    data: { data: JSON.stringify(data), warnings: JSON.stringify(scanWarnings(data)), warningsApproved: false, matches: findMatch(await loadProfileDoc(userId), type, data) },
  });
  const view = (await listDrafts(userId)).find((d) => d.id === id);
  if (!view) throw new HttpError(404, 'Not found.');
  return view;
}

export async function approveWarnings(userId: string, id: string): Promise<void> {
  const r = await db.profileDraft.updateMany({ where: { id, userId, status: 'pending' }, data: { warningsApproved: true } });
  if (!r.count) throw new HttpError(404, 'Not found.');
}
