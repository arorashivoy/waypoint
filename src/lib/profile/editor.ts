import { db } from '../db';
import { HttpError } from '../auth/http';
import { emptyDoc, type ClaimsDoc } from './doc';
import { ITEM_KINDS, type ItemKind } from './apply';
import { loadProfileDoc, saveProfile } from './store';

/** The `kind` route parameter, or 404. */
export function readKind(params: Record<string, string>): ItemKind {
  const kind = params.kind as ItemKind;
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) throw new HttpError(404, 'Not found.');
  return kind;
}

export const KIND_LABEL: Record<ItemKind, string> = { position: 'position', education: 'education', project: 'project', claim: 'claim' };

/** Loads the profile (or an empty one), applies one edit, and saves it. The reply carries the saved document. */
export async function changeProfile(userId: string, note: string, edit: (doc: ClaimsDoc) => ClaimsDoc) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const doc = (await loadProfileDoc(userId)) ?? emptyDoc(user.name);
  const r = await saveProfile(userId, edit(doc), note);
  return { ok: true as const, warnings: r.warnings, version: r.version, doc: (await loadProfileDoc(userId)) as ClaimsDoc };
}
