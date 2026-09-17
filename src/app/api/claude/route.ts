import { NextResponse } from 'next/server';
import { detectMode } from '@/lib/claude';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await detectMode(true));
}
