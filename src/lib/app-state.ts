import type { z } from 'zod';
import { db } from './db';

/** The value of a key, checked with the schema. A missing key or a bad value gives null. */
export async function getState<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  const row = await db.appState.findUnique({ where: { key } });
  if (!row) return null;
  try {
    const r = schema.safeParse(JSON.parse(row.value));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function setState(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  await db.appState.upsert({ where: { key }, create: { key, value: text }, update: { value: text } });
}
