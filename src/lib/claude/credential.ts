import { db } from '../db';
import { env } from '../env';
import { readSecret, secretHint } from '../secrets';
import { cliBinary } from './cli';
import { claudeAuthFailure, claudeQuotaFailure } from './failures';
import type { Credential } from './types';
import { monthSpend, nextReset } from './usage';

/**
 * Which account pays for a call (spec 2.8):
 * 1. the user's own API key,
 * 2. ANTHROPIC_API_KEY, while the user's cost on it this month is below
 *    WAYPOINT_SHARED_MONTHLY_USD,
 * 3. the claude CLI with the admin's Pro subscription, for the admin only.
 *    A Pro subscription is for one person, so a member never uses it.
 */

export type ClaudeMode = 'own' | 'shared' | 'cli' | 'none';

export type ClaudeStatus = {
  mode: ClaudeMode;
  detail: string;
  keyHint: string | null;
  sharedAvailable: boolean;
  capUsd: number;
  sharedSpentUsd: number;
  capReached: boolean;
  resetsAt: string;
  authFailure: { message: string; at: number } | null;
  quotaFailure: { message: string; at: number } | null;
};

export async function credentialFor(userId: string): Promise<Credential | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, disabledAt: true } });
  if (!user || user.disabledAt) return null;
  const own = await readSecret(userId, 'anthropic');
  if (own) return { kind: 'api', key: own, source: 'own' };
  const shared = env().ANTHROPIC_API_KEY;
  if (shared && (await monthSpend(userId, 'shared')) < env().WAYPOINT_SHARED_MONTHLY_USD) return { kind: 'api', key: shared, source: 'shared' };
  if (user.role === 'admin' && cliBinary()) return { kind: 'cli' };
  return null;
}

export const failureKey = (cred: Credential, userId: string) => (cred.kind === 'cli' ? 'cli' : cred.source === 'shared' ? 'shared' : `own:${userId}`);

const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export async function claudeStatus(userId: string): Promise<ClaudeStatus> {
  const capUsd = env().WAYPOINT_SHARED_MONTHLY_USD;
  const sharedAvailable = !!env().ANTHROPIC_API_KEY;
  const [sharedSpentUsd, keyHint, cred] = await Promise.all([monthSpend(userId, 'shared'), secretHint(userId, 'anthropic'), credentialFor(userId)]);
  const reset = nextReset();
  const capReached = sharedAvailable && sharedSpentUsd >= capUsd;
  const base = { keyHint, sharedAvailable, capUsd, sharedSpentUsd, capReached, resetsAt: reset.toISOString() };

  if (!cred) {
    const detail = capReached
      ? `You used this month's limit of ${usd(capUsd)} on the shared key. It resets on ${day(reset)}. Add your own API key in Settings to continue now.`
      : 'Add an API key in Settings to use Claude.';
    return { ...base, mode: 'none', detail, authFailure: null, quotaFailure: null };
  }

  const key = failureKey(cred, userId);
  const failures = { authFailure: claudeAuthFailure(key), quotaFailure: claudeQuotaFailure(key) };
  if (cred.kind === 'cli') return { ...base, ...failures, mode: 'cli', detail: 'Claude Code CLI · the admin subscription' };
  if (cred.source === 'own') return { ...base, ...failures, mode: 'own', detail: `Your API key (ends in ${keyHint ?? '????'})` };
  return { ...base, ...failures, mode: 'shared', detail: `The shared API key · ${usd(sharedSpentUsd)} of ${usd(capUsd)} used this month` };
}
