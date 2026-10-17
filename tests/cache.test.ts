import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { cacheKey, pruneCacheBySize } from '@/lib/cache';
import { handlers } from '@/lib/tasks/handlers';

describe('cacheKey', () => {
  it('changes when the prompt version changes', () => {
    expect(cacheKey('v1', 'S', 'P')).not.toBe(cacheKey('v2', 'S', 'P'));
  });
  it('changes when the model changes', () => {
    expect(cacheKey('v1', 'S', 'P', 'claude-sonnet-5')).not.toBe(cacheKey('v1', 'S', 'P', 'claude-sonnet-5-5'));
  });
  it('cannot collide by moving text between system and prompt', () => {
    expect(cacheKey('v1', 'ab', 'c')).not.toBe(cacheKey('v1', 'a', 'bc'));
  });
});

// The test files share one database. Each test uses its own `kind`, so the prune sees only its own rows.
async function seed(sizes: number[]) {
  const kind = `test-${randomBytes(6).toString('hex')}`;
  const keys: string[] = [];
  for (const [i, size] of sizes.entries()) {
    const key = `${kind}-${i}`;
    keys.push(key);
    await db.llmCache.create({ data: { key, kind, model: 'm', value: 'x'.repeat(size), usedAt: new Date(Date.UTC(2026, 0, 1 + i)) } });
  }
  return { kind, keys };
}

describe('pruneCacheBySize', () => {
  it('removes the least recently used rows first', async () => {
    const { kind, keys } = await seed([1000, 1000, 1000]);
    // The first row is the newest, so the second row is the oldest.
    await db.llmCache.update({ where: { key: keys[0] }, data: { usedAt: new Date(Date.UTC(2027, 0, 1)) } });
    expect(await pruneCacheBySize(2500, kind)).toBe(1);
    const left = (await db.llmCache.findMany({ where: { kind }, select: { key: true } })).map((r) => r.key).sort();
    expect(left).toEqual([keys[0], keys[2]].sort());
  });

  it('does nothing under the limit', async () => {
    const { kind } = await seed([1000, 1000, 1000]);
    expect(await pruneCacheBySize(3000, kind)).toBe(0);
    expect(await db.llmCache.count({ where: { kind } })).toBe(3);
  });

  it('works through more than one batch of 200 rows', async () => {
    const { kind } = await seed(Array.from({ length: 450 }, () => 10));
    expect(await pruneCacheBySize(1000, kind)).toBe(350);
    expect(await db.llmCache.count({ where: { kind } })).toBe(100);
  });

  it('does not touch rows of another kind', async () => {
    const a = await seed([1000, 1000]);
    const b = await seed([1000]);
    expect(await pruneCacheBySize(0, a.kind)).toBe(2);
    expect(await db.llmCache.count({ where: { kind: b.kind } })).toBe(1);
  });
});

describe('maintenance handler', () => {
  it('returns the count of pruned rows', async () => {
    const out = (await handlers.get('maintenance')!.run({}, {} as never, new AbortController().signal)) as { pruned: number };
    expect(typeof out.pruned).toBe('number');
  });
});
