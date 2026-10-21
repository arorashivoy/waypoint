import { db } from '../db';
import { log } from '@/lib/log';

export const FIFTEEN_MINUTES = 15 * 60_000;

/**
 * Counts one try against `key`. Refuses when `max` tries are already in the
 * current window. The counts are in the database, so a restart keeps them.
 */
export async function hitLimit(key: string, max: number, windowMs: number, now = new Date()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const result = await tryHit(key, max, windowMs, now);
  // A false X-Forwarded-For makes a new key for each try. Remove old rows
  // on about 1 call in 100, so that the table stays small. A failure here
  // must not change the limit decision.
  if (Math.random() < 0.01) {
    try {
      await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
    } catch (e) {
      log.error({ err: e }, 'rate-limit cleanup failed');
    }
  }
  return result;
}

/** Each step is one conditional write, so parallel calls cannot pass `max`. */
async function tryHit(key: string, max: number, windowMs: number, now: Date): Promise<{ ok: boolean; retryAfterSec: number }> {
  const windowEdge = new Date(now.getTime() - windowMs);
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1. Count a try in the current window, if there is room.
    const counted = await db.rateLimit.updateMany({
      where: { key, windowStart: { gt: windowEdge }, count: { lt: max } },
      data: { count: { increment: 1 } },
    });
    if (counted.count === 1) return { ok: true, retryAfterSec: 0 };

    // 2. Start a new window if the old one has ended.
    const reset = await db.rateLimit.updateMany({
      where: { key, windowStart: { lte: windowEdge } },
      data: { count: 1, windowStart: now },
    });
    if (reset.count === 1) return { ok: true, retryAfterSec: 0 };

    // 3. The row is in its window and full, or it does not exist.
    const row = await db.rateLimit.findUnique({ where: { key } });
    if (row) {
      if (row.windowStart > windowEdge && row.count >= max) {
        return { ok: false, retryAfterSec: Math.ceil((row.windowStart.getTime() + windowMs - now.getTime()) / 1000) };
      }
      continue; // The row changed between the steps. Try again.
    }
    try {
      await db.rateLimit.create({ data: { key, count: 1, windowStart: now } });
      return { ok: true, retryAfterSec: 0 };
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== 'P2002') throw e;
      // Another call made the row first. Try again.
    }
  }
  return { ok: false, retryAfterSec: Math.ceil(windowMs / 1000) };
}

export async function clearLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** The last X-Forwarded-For entry: the nearest proxy (the tunnel) adds it.
 *  A client can write the entries before it, so they are not used. Sign-in
 *  also counts tries for each email and for all clients together. */
export function clientIp(headers: Headers): string {
  return (headers.get('x-forwarded-for') ?? '').split(',').at(-1)!.trim() || 'local';
}
