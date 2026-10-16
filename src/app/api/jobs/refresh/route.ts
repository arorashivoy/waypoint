import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { fetchAll } from '@/lib/sources';
import { queueAnalysis } from '@/lib/queue';
import { claimsFor } from '@/lib/user';
import { searchQueries } from '@/lib/resume';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const prefs = await db.countryPref.findMany({ where: { userId: user.id, on: true } });
  const ccs = prefs.map((p) => p.cc);
  if (!ccs.length) return NextResponse.json({ added: 0, report: [], note: 'Every country is paused.' });

  const { jobs, report } = await fetchAll(ccs, searchQueries(await claimsFor(user.id)));

  const known = new Set(
    (await db.job.findMany({ where: { externalId: { in: jobs.map((j) => j.externalId) } }, select: { externalId: true } }))
      .map((j) => j.externalId),
  );
  for (const j of jobs) {
    await db.job.upsert({
      where: { externalId: j.externalId },
      // An undated listing keeps the date it was first seen rather than being
      // re-stamped today on every refresh.
      update: { fetchedAt: new Date(), ...(j.postedAt && { postedAt: j.postedAt }), description: j.description, url: j.url, priority: j.priority },
      create: { ...j, postedAt: j.postedAt ?? new Date() },
    });
  }
  const added = jobs.filter((j) => !known.has(j.externalId)).length;

  // Kicks off in the background; the client polls /api/state for progress.
  const analysing = await queueAnalysis(user.id);

  return NextResponse.json({ added, total: jobs.length, report, analysing });
});
