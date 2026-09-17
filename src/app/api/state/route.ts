import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/user';
import { buildState } from '@/lib/state';
import { accessCodeRequired } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ signedIn: false, requiresCode: accessCodeRequired() });
  return NextResponse.json({ signedIn: true, ...(await buildState(user.id)) });
}
