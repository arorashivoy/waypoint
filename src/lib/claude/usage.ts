import { db } from '../db';
import type { Usage } from './types';

export type UsageSource = 'own' | 'shared' | 'cli';

/** Months are UTC months, so the reset date is the same for all users. */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export async function recordUsage(userId: string, credential: UsageSource, kind: string, usage: Usage): Promise<void> {
  await db.llmUsage.create({
    data: {
      userId,
      credential,
      kind,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costUsd: usage.costUsd,
    },
  });
}

/** The cost in USD of the user's calls this month, for one credential or for all. */
export async function monthSpend(userId: string, credential?: UsageSource, now = new Date()): Promise<number> {
  const r = await db.llmUsage.aggregate({
    where: { userId, createdAt: { gte: monthStart(now) }, ...(credential ? { credential } : {}) },
    _sum: { costUsd: true },
  });
  return r._sum.costUsd ?? 0;
}

/** The shared-key cost of each user this month, for the admin list. */
export async function sharedSpendByUser(now = new Date()): Promise<Map<string, number>> {
  const rows = await db.llmUsage.groupBy({
    by: ['userId'],
    where: { credential: 'shared', createdAt: { gte: monthStart(now) } },
    _sum: { costUsd: true },
  });
  return new Map(rows.map((r) => [r.userId, r._sum.costUsd ?? 0]));
}
