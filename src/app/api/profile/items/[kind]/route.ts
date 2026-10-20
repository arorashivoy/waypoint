import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson, type RouteContext } from '@/lib/auth/http';
import { hasItem, itemKey, upsertItem, type Item } from '@/lib/profile/apply';
import { parseItem } from '@/lib/profile/item-schemas';
import { changeProfile, KIND_LABEL, readKind, readVersion } from '@/lib/profile/editor';

export const POST = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  const kind = readKind(params);
  const body = await readJson(req);
  const version = readVersion(req, body);
  const item = parseItem(kind, body.item) as Item;
  const key = itemKey(kind, item);
  return NextResponse.json(
    await changeProfile(user.id, `Added the ${KIND_LABEL[kind]} "${key}"`, (doc) => {
      if (hasItem(doc, kind, key)) throw new HttpError(409, `A ${KIND_LABEL[kind]} with the ID "${key}" exists. Pick another ID.`);
      return upsertItem(doc, kind, null, item);
    }, version),
  );
});
