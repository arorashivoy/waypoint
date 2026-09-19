import { NextResponse } from 'next/server';
import { detectMode, clearClaudeAuthFailure, clearClaudeQuotaFailure } from '@/lib/claude';
import { requireUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  await requireUser();
  // The user hit "recheck" — assume they want a fresh probe, not the last error.
  clearClaudeAuthFailure();
  clearClaudeQuotaFailure();
  return NextResponse.json(await detectMode(true));
}
