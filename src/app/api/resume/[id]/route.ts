import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';
import { loadClaims } from '@/lib/claims';
import { buildResume } from '@/lib/resume';

export const maxDuration = 300;

/**
 * The CV for one application, tailored to its posting.
 *
 * Rebuilt rather than stored against the application row: `buildResume` keys
 * its output on a hash of the rendered LaTeX, so an unchanged selection is a
 * cache hit and a CV edited in the meantime is picked up without a stale copy
 * being served. The application id scopes it to this user, who must own it.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const app = await db.application.findFirst({ where: { id: params.id, userId: user.id }, include: { job: true } });
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const resume = await buildResume(loadClaims(), `${app.job.role}\n${app.job.description}`, app.id);
  if (!resume || !resume.path) {
    return NextResponse.json({ error: 'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.' }, { status: 404 });
  }

  const name = `${user.name.replace(/[^\w]+/g, '_')}_${app.job.company.replace(/[^\w]+/g, '_')}.pdf`;
  try {
    const file = readFileSync(resume.path);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
        // A tailored CV is derived from a posting that can change under it.
        'Cache-Control': 'no-store',
        'X-Waypoint-Tailored': String(resume.tailored),
      },
    });
  } catch {
    return NextResponse.json({ error: `Could not read ${basename(resume.path)}` }, { status: 500 });
  }
}
