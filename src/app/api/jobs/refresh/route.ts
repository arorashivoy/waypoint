import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/user';
import { fetchAll } from '@/lib/sources';
import { queueAnalysis } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const QUERIES = ['software engineer', 'backend engineer', 'securities', 'robotics engineer'];

export async function POST() {
  const user = await requireUser();
  const prefs = await db.countryPref.findMany({ where: { userId: user.id, on: true } });
  const ccs = prefs.map((p) => p.cc);
  if (!ccs.length) return NextResponse.json({ added: 0, report: [], note: 'Every country is paused.' });

  const { jobs, report } = await fetchAll(ccs, QUERIES);

  const known = new Set(
    (await db.job.findMany({ where: { externalId: { in: jobs.map((j) => j.externalId) } }, select: { externalId: true } }))
      .map((j) => j.externalId),
  );
  for (const j of jobs) {
    await db.job.upsert({
      where: { externalId: j.externalId },
      update: { fetchedAt: new Date(), postedAt: j.postedAt, description: j.description, url: j.url },
      create: j,
    });
  }
  const added = jobs.filter((j) => !known.has(j.externalId)).length;

  // Kicks off in the background; the client polls /api/state for progress.
  const analysing = await queueAnalysis(user.id);

  return NextResponse.json({ added, total: jobs.length, report, analysing });
}
