import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { handle, readJson } from '@/lib/auth/http';
import { parseItem } from '@/lib/profile/item-schemas';
import { changeProfile } from '@/lib/profile/editor';

export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  const meta = parseItem('meta', await readJson(req)) as { name: string; headline: string };
  return NextResponse.json(await changeProfile(user.id, 'Changed the name and headline', (doc) => ({ ...doc, profile: { name: meta.name.trim(), headline: meta.headline.trim() } })));
});
