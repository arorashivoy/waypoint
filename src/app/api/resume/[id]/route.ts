import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { NO_RESUME, buildCv } from '@/lib/cv';
import { isAdmin } from '@/lib/user';

/**
 * The CV for one application, tailored to its posting and to any refinement
 * made with "Refine with Claude".
 *
 * The route does not compile. The worker builds the PDF (a `cv` task). The route works out
 * the expected path and serves the file, or answers 404 if the file is not there yet.
 *
 * Rebuilt rather than stored against the application row: `buildResume` keys
 * its output on a hash of the rendered LaTeX, so an unchanged selection is a
 * cache hit and a CV edited in the meantime is picked up without a stale copy
 * being served. The application id scopes it to this user, who must own it.
 */
export const GET = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const app = await db.application.findFirst({ where: { id: params.id, userId: user.id }, include: { job: true } });
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const resume = await buildCv(app, app.job, { compile: false });
  if (!resume || !resume.path) {
    return NextResponse.json({ error: (await isAdmin(user.id)) ? 'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.' : NO_RESUME }, { status: 404 });
  }

  if (!existsSync(resume.path)) {
    return NextResponse.json({ error: 'The CV is not built yet. Build it first.' }, { status: 404 });
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
});
