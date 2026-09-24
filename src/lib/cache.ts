import { createHash } from 'node:crypto';
import { db } from './db';
import { ask, extractJson, MODEL } from './claude';

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
 *  collide — it cannot occur in a JS string that came from a prompt template. */
export function cacheKey(system: string, prompt: string, model = MODEL) {
  return createHash('sha256').update(`${model}\0${system}\0${prompt}`).digest('hex');
}

/** Kinds are for pruning and for keeping the reply path out; they are not part
 *  of the key, so mislabelling costs a statistic, never a wrong answer. */
export type CacheKind = 'analysis' | 'note' | 'referral';

/** Concurrent callers with the same key share one in-flight call, so a refresh
 *  that queues two copies of the same advert side by side still asks once. */
const inFlight = new Map<string, Promise<string>>();

export async function askCached(kind: CacheKind, system: string, prompt: string): Promise<string> {
  const key = cacheKey(system, prompt);

  const hit = await db.llmCache.findUnique({ where: { key } });
  if (hit) {
    // usedAt drives pruning: a hot entry written months ago is the one worth
    // keeping, so recency of use is the signal, not recency of creation.
    await db.llmCache.update({ where: { key }, data: { hits: { increment: 1 }, usedAt: new Date() } });
    return hit.value;
  }

  let work = inFlight.get(key);
  if (!work) {
    work = (async () => {
      const value = await ask(system, prompt);
      // Only a successful call is written. Caching a throw would remember one
      // rate limit forever.
      await db.llmCache.upsert({
        where: { key },
        update: { usedAt: new Date() },
        create: { key, kind, model: MODEL, value },
      });
      return value;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, work);
  }
  return work;
}

/** The raw text is what gets stored, not the parsed object, so a fix to
 *  `extractJson` replays against every cached reply instead of needing a
 *  re-call. Parsing is free; the model call is not. */
export async function askJsonCached<T>(kind: CacheKind, system: string, prompt: string): Promise<T> {
  return extractJson(await askCached(kind, system, prompt)) as T;
}

export async function cacheStats() {
  const [entries, agg] = await Promise.all([
    db.llmCache.count(),
    db.llmCache.aggregate({ _sum: { hits: true } }),
  ]);
  return { entries, hits: agg._sum.hits || 0 };
}

/** Keeps the newest `keep` entries by last use. SQLite on one machine, so a
 *  manual call from a script is enough; there is no scheduler to hang this on. */
export async function pruneCache(keep = 5000) {
  const survivors = await db.llmCache.findMany({
    orderBy: { usedAt: 'desc' },
    take: keep,
    select: { key: true },
  });
  const { count } = await db.llmCache.deleteMany({ where: { key: { notIn: survivors.map((s) => s.key) } } });
  return count;
}
