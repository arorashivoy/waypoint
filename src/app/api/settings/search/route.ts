import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { HttpError, handle, readJson } from '@/lib/auth/http';
import { FIELD_CHOICES, SettingsSchema, getSettings, saveSearchSettings } from '@/lib/settings';

async function answer(userId: string) {
  const s = await getSettings(userId);
  return NextResponse.json({ fields: s.fields, visaStatus: s.visaStatus, fieldChoices: [...FIELD_CHOICES] });
}

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return answer(user.id);
});

export const PATCH = handle(async (req) => {
  const user = await requireUser(req);
  const parsed = SettingsSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'The settings are not valid.');
  await saveSearchSettings(user.id, parsed.data);
  return answer(user.id);
});
