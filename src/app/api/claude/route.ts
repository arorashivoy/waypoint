import { NextResponse } from 'next/server';
import { detectMode, clearClaudeAuthFailure, clearClaudeQuotaFailure } from '@/lib/claude';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireUser(req);
  // The user hit "recheck" — assume they want a fresh probe, not the last error.
  clearClaudeAuthFailure();
  clearClaudeQuotaFailure();
  return NextResponse.json(await detectMode(true));
});
