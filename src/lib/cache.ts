import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { askJson, extractJson, MODEL, type AskRequest, type CallContext } from './claude';

/**
 * A content-addressed cache in front of `ask`.
 *
 * The key is a hash of the exact triple that goes to the model — model id,
 * system prompt, user prompt — and nothing else. That choice is the whole
 * design: the alternative, keying on the job row, has to enumerate the inputs
 * an answer depends on, and it always misses one. Here every dependency is
 * inside the rendered prompt by construction, so an edited description, a
 * re-imported profile, a reworded prompt in `prompts.ts` and a model change all
 * produce a different key without anyone remembering to bump a version.
 *
 * It also deduplicates across rows for free: one advert syndicated to Greenhouse
 * and Arbeitnow is two Job rows with different externalIds but one prompt, so
 * the second listing is a hit rather than a second call.
 */

/** NUL separates the operands so no re-partitioning of the concatenation can
 *  collide. The prompt version is part of the key, so a reworded prompt can
 *  never get an old reply. */
export function cacheKey(version: string, system: string, prompt: string, model = MODEL) {
  return createHash('sha256').update(`${model}\0${version}\0${system}\0${prompt}`).digest('hex');
}

/** Kinds are for pruning and for keeping the reply path out; they are not part
 *  of the key, so mislabelling costs a statistic, never a wrong answer. */
export type CacheKind = 'job-check' | 'analysis' | 'note' | 'referral' | 'resume-import' | 'github-import' | 'refine';

/** Concurrent callers with the same key share one in-flight call, so a refresh
 *  that queues two copies of the same advert side by side still asks once. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * The cache stores the raw JSON text, not the parsed object, so a schema fix
 * reads every stored reply again for free. A stored reply that no longer
 * matches the schema is a miss, not an error.
 *
 * `perUser` puts the user ID into the key. The imports and the refine chat use it:
 * their prompt holds the private text of one user, so the reply of one user never
 * goes to another user.
 */
export async function askJsonCached<T>(kind: CacheKind, version: string, req: AskRequest<T>, ctx: CallContext, opts: { perUser?: boolean } = {}): Promise<T> {
  const key = cacheKey(opts.perUser ? `${version}\0user:${ctx.userId}` : version, req.system, req.prompt);

  const hit = await db.llmCache.findUnique({ where: { key } });
  if (hit) {
    const parsed = req.schema.safeParse(safeJson(hit.value));
    if (parsed.success) {
      // usedAt drives pruning: a hot entry written months ago is the one worth
      // keeping, so recency of use is the signal, not recency of creation.
      await db.llmCache.update({ where: { key }, data: { hits: { increment: 1 }, usedAt: new Date() } });
      return parsed.data as T;
    }
  }

  let work = inFlight.get(key) as Promise<T> | undefined;
  if (!work) {
    work = (async () => {
      const { data, raw } = await askJson(req, ctx);
      // Only a successful call is written. Caching a throw would remember one
      // rate limit forever.
      await db.llmCache.upsert({
        where: { key },
        update: { value: raw, usedAt: new Date() },
        create: { key, kind, model: MODEL, value: raw },
      });
      return data;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, work);
  }
  return work;
}

function safeJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}

export async function cacheStats() {
  const [entries, agg] = await Promise.all([
    db.llmCache.count(),
    db.llmCache.aggregate({ _sum: { hits: true } }),
  ]);
  return { entries, hits: agg._sum.hits || 0 };
}

/** The size limit of the cache: 50 MB. */
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;

const PRUNE_BATCH = 200;

/**
 * Deletes the rows with the oldest `usedAt` until the sum of `length(value)` is at or under `maxBytes`.
 * SQLite counts characters. The replies are mostly ASCII, so this is close to bytes.
 * `kind` is for tests only. If it is set, the sum and the delete use only the rows of that kind.
 * Returns the count of deleted rows.
 */
export async function pruneCacheBySize(maxBytes = CACHE_MAX_BYTES, kind?: string): Promise<number> {
  const scope = kind === undefined ? Prisma.empty : Prisma.sql`WHERE kind = ${kind}`;
  const [row] = await db.$queryRaw<{ total: number | bigint | null }[]>`SELECT SUM(length(value)) AS total FROM LlmCache ${scope}`;
  let total = Number(row?.total ?? 0);
  let deleted = 0;
  while (total > maxBytes) {
    const rows = await db.$queryRaw<{ key: string; size: number | bigint }[]>`
      SELECT key, length(value) AS size FROM LlmCache ${scope} ORDER BY usedAt ASC, key ASC LIMIT ${PRUNE_BATCH}`;
    if (!rows.length) break;
    const keys: string[] = [];
    for (const r of rows) {
      if (total <= maxBytes) break;
      keys.push(r.key);
      total -= Number(r.size);
    }
    deleted += (await db.llmCache.deleteMany({ where: { key: { in: keys } } })).count;
  }
  return deleted;
}
