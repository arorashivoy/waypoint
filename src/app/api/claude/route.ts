import { NextResponse } from 'next/server';
import { claudeStatus, clearFailures, credentialFor, failureKey } from '@/lib/claude';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  // The user hit "recheck" — assume they want a fresh probe, not the last error.
  const cred = await credentialFor(user.id);
  if (cred) clearFailures(failureKey(cred, user.id));
  return NextResponse.json(await claudeStatus(user.id));
});
