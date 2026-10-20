import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guard';
import { HttpError, handle, readJson } from '@/lib/auth/http';
import { OnboardingSchema, getOnboarding, saveOnboarding } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return NextResponse.json(await getOnboarding(user.id));
});

export const PATCH = handle(async (req) => {
  const user = await requireUser(req);
  const parsed = OnboardingSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'The onboarding state is not valid.');
  return NextResponse.json(await saveOnboarding(user.id, parsed.data));
});
