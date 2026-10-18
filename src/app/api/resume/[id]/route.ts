import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { NO_RESUME, buildCv } from '@/lib/cv';
import { isAdmin } from '@/lib/user';
import { resumeConfig } from '@/lib/resume';

/**
 * The CV for one application, tailored to its posting and to any refinement
 * made with "Refine with Claude".
 *
 * The route does not compile. The worker builds the PDF (a `cv` task). `buildResume` keys the
 * file on a hash of the rendered LaTeX, so the route works out the expected path again.
 * If that file is missing (for example after a failed compile), the route serves the base PDF.
 * If neither file exists, it answers 404. The application id scopes the route to its owner.
 */
export const GET = handle<{ params: { id: string } }>(async (req, { params }) => {
  const user = await requireUser(req);
  const app = await db.application.findFirst({ where: { id: params.id, userId: user.id }, include: { job: true } });
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const resume = await buildCv(app, app.job, { compile: false });
  if (!resume || !resume.path) {
    return NextResponse.json({ error: (await isAdmin(user.id)) ? 'No CV configured. Set RESUME_PDF, and RESUME_TEX to tailor it.' : NO_RESUME }, { status: 404 });
  }

  let path = resume.path;
  let tailored = resume.tailored;
  if (!existsSync(path)) {
    const base = (await resumeConfig(user.id)).pdf;
    if (base && existsSync(base)) {
      path = base;
      tailored = false;
    }
  }
  if (!existsSync(path)) {
    return NextResponse.json({ error: 'The CV is not built yet. Build it first.' }, { status: 404 });
  }

  const name = `${user.name.replace(/[^\w]+/g, '_')}_${app.job.company.replace(/[^\w]+/g, '_')}.pdf`;
  try {
    const file = readFileSync(path);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
        // A tailored CV is derived from a posting that can change under it.
        'Cache-Control': 'no-store',
        'X-Waypoint-Tailored': String(tailored),
      },
    });
  } catch {
    return NextResponse.json({ error: `Could not read ${basename(path)}` }, { status: 500 });
  }
});
