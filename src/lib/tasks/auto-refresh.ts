import { z } from 'zod';
import { db } from '@/lib/db';
import { getState, setState } from '@/lib/app-state';
import { enqueue } from '@/lib/tasks/queue';

/**
 * The worker starts one refresh for each user each day, at this hour (India time) or later.
 * If the worker is off at this hour, the refresh starts when the worker starts, on the same day.
 */
export const AUTO_REFRESH_HOUR = 7;

// India has one time zone with no summer time: UTC + 5 hours 30 minutes.
const INDIA_OFFSET_MS = 330 * 60_000;
const KEY = 'autoRefreshDay';
const Day = z.object({ day: z.string() });

/** The date (YYYY-MM-DD) and the hour (0 to 23) in India at an instant. */
export function indiaDay(now: Date): { day: string; hour: number } {
  const local = new Date(now.getTime() + INDIA_OFFSET_MS);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/**
 * Queues the refresh of the day for each active user who has a country on. It returns the number of users.
 * It queues nothing before the hour, and nothing a second time on the same day.
 * The task is the task of the Refresh button (same payload, same dedupe key). So a refresh that is open
 * already is not queued again, and the refresh sends the same maximum of new jobs to Claude.
 * `scope` is for tests only: only that user, with a day of its own.
 */
export async function queueDailyRefresh(now: Date = new Date(), scope?: { userId?: string }): Promise<number> {
  const { day, hour } = indiaDay(now);
  if (hour < AUTO_REFRESH_HOUR) return 0;
  const key = scope?.userId ? `${KEY}:${scope.userId}` : KEY;
  if ((await getState(key, Day))?.day === day) return 0;
  const users = await db.user.findMany({
    where: { disabledAt: null, countries: { some: { on: true } }, ...(scope?.userId ? { id: scope.userId } : {}) },
    select: { id: true },
  });
  for (const u of users) {
    await enqueue({ kind: 'refresh', userId: u.id, payload: { force: false }, dedupeKey: `refresh:${u.id}` });
  }
  // The day is stored after the tasks. If a write fails, the next check queues again, and the dedupe key stops a second task.
  await setState(key, { day });
  return users.length;
}
