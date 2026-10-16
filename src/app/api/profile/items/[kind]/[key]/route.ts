import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, HttpError, readJson, type RouteContext } from '@/lib/auth/http';
import { hasItem, itemKey, removeItem, upsertItem, type Item } from '@/lib/profile/apply';
import { parseItem } from '@/lib/profile/item-schemas';
import { changeProfile, KIND_LABEL, readKind } from '@/lib/profile/editor';

export const PUT = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  const kind = readKind(params);
  const item = parseItem(kind, (await readJson(req)).item) as Item;
  const key = params.key;
  const next = itemKey(kind, item);
  return NextResponse.json(
    await changeProfile(user.id, `Changed the ${KIND_LABEL[kind]} "${next}"`, (doc) => {
      if (!hasItem(doc, kind, key)) throw new HttpError(404, 'Not found.');
      if (next !== key && hasItem(doc, kind, next)) throw new HttpError(409, `A ${KIND_LABEL[kind]} with the ID "${next}" exists. Pick another ID.`);
      return upsertItem(doc, kind, key, item);
    }),
  );
});

export const DELETE = handle(async (req, { params }: RouteContext) => {
  const user = await requireUser(req);
  const kind = readKind(params);
  const key = params.key;
  return NextResponse.json(
    await changeProfile(user.id, `Removed the ${KIND_LABEL[kind]} "${key}"`, (doc) => {
      if (!hasItem(doc, kind, key)) throw new HttpError(404, 'Not found.');
      return removeItem(doc, kind, key);
    }),
  );
});
