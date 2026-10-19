import { statfs } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { db } from './db';
import { cliBinary } from './claude/cli';
import { cliDisabled } from './claude/selftest';
import { env } from './env';
import { lastBeat } from './tasks/queue';

export type Check = { ok: boolean; detail: string };
export type Checks = { db: Check; worker: Check; claude: Check; disk: Check };

export const WORKER_MAX_AGE_MS = 90_000;
export const DISK_MIN_FREE_BYTES = 1_073_741_824;

/** Run one check. If it throws, the check reports a failure and the others still run. */
async function guarded(fn: () => Promise<Check>): Promise<Check> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, detail: `The check failed: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown error'}` };
  }
}

/** The folder of the database file. Prisma reads a relative path from the prisma/ folder. */
function databaseFolder(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) return process.cwd();
  const file = url.slice('file:'.length).split('?')[0];
  if (!file) return process.cwd();
  return dirname(isAbsolute(file) ? file : resolve(process.cwd(), 'prisma', file));
}

async function statfsWithFallback(folder: string) {
  try {
    return await statfs(folder);
  } catch {
    return statfs(process.cwd());
  }
}

/**
 * Check the database, the worker, Claude and the disk.
 * `opts.beatId` is for tests only. It names a heartbeat row other than the worker's.
 */
export async function runChecks(now: Date = new Date(), opts: { beatId?: string } = {}): Promise<Checks> {
  const [database, worker, claude, disk] = await Promise.all([
    guarded(async () => {
      await db.$queryRawUnsafe('SELECT 1');
      return { ok: true, detail: 'The database answers.' };
    }),
    guarded(async () => {
      const beat = await lastBeat(opts.beatId);
      if (!beat) return { ok: false, detail: 'The worker has not sent a heartbeat.' };
      const age = now.getTime() - beat.getTime();
      return age <= WORKER_MAX_AGE_MS
        ? { ok: true, detail: `The last heartbeat was ${Math.max(0, Math.round(age / 1000))} seconds ago.` }
        : { ok: false, detail: `The last heartbeat was ${Math.round(age / 1000)} seconds ago. The limit is 90.` };
    }),
    guarded(async () => {
      const off = cliBinary() ? await cliDisabled() : null;
      const cliNote = off ? ` The Claude CLI is off: it failed its self-test at ${off.at}.` : '';
      if (env().ANTHROPIC_API_KEY) return { ok: true, detail: `The shared API key is set.${cliNote}` };
      if (cliBinary() && !off) return { ok: true, detail: 'The Claude CLI is available to the admin.' };
      const own = await db.userSecret.count({ where: { kind: 'anthropic' } });
      if (own > 0) return { ok: true, detail: `At least one user saved an API key.${cliNote}` };
      return off
        ? { ok: false, detail: `The Claude CLI failed its self-test at ${off.at}: ${off.reason}` }
        : { ok: false, detail: 'No shared key, no CLI and no user key.' };
    }),
    guarded(async () => {
      const s = await statfsWithFallback(databaseFolder());
      const free = Number(s.bavail) * Number(s.bsize);
      return free > DISK_MIN_FREE_BYTES
        ? { ok: true, detail: `${Math.floor(free / 1_048_576)} MB free.` }
        : { ok: false, detail: `${Math.floor(free / 1_048_576)} MB free. The minimum is 1024 MB.` };
    }),
  ]);
  return { db: database, worker, claude, disk };
}

export const overall = (c: Checks): 'ok' | 'degraded' => (Object.values(c).every((x) => x.ok) ? 'ok' : 'degraded');
