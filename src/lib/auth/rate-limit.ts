import { db } from '../db';

export const FIFTEEN_MINUTES = 15 * 60_000;

/**
 * Counts one try against `key`. Refuses when `max` tries are already in the
 * current window. The counts are in the database, so a restart keeps them.
 */
export async function hitLimit(key: string, max: number, windowMs: number, now = new Date()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const result = await db.$transaction(async (tx) => {
    const row = await tx.rateLimit.findUnique({ where: { key } });
    if (!row || now.getTime() - row.windowStart.getTime() >= windowMs) {
      await tx.rateLimit.upsert({ where: { key }, create: { key, count: 1, windowStart: now }, update: { count: 1, windowStart: now } });
      return { ok: true, retryAfterSec: 0 };
    }
    if (row.count >= max) {
      return { ok: false, retryAfterSec: Math.ceil((row.windowStart.getTime() + windowMs - now.getTime()) / 1000) };
    }
    await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return { ok: true, retryAfterSec: 0 };
  });
  // A false X-Forwarded-For makes a new key for each try. Remove old rows
  // on about 1 call in 100, so that the table stays small.
  if (Math.random() < 0.01) {
    await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
  }
  return result;
}

export async function clearLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** The first X-Forwarded-For entry. The tunnel sets it. It can be false, so
 *  sign-in also counts tries for each email. */
export function clientIp(headers: Headers): string {
  return (headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
}
