import { z } from 'zod';

/**
 * The environment, checked one time.
 *
 * A missing key used to show up as a strange failure deep in a request. Now
 * the server refuses to start, and the message names the key and the fix.
 * Only the keys that this module reads are checked; other modules still read
 * their optional keys from process.env until their part of the migration.
 */

const empty = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const secretKey = z
  .string({ error: 'is missing. Run `npm run secret:new` and add the line it prints to .env' })
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    error: 'must be 32 bytes in base64. Run `npm run secret:new` to make one',
  });

const schema = z.object({
  DATABASE_URL: z.string({ error: 'is missing. Copy it from .env.example' }).min(1),
  WAYPOINT_SECRET_KEY: secretKey,
  ANTHROPIC_API_KEY: z.preprocess(empty, z.string().optional()),
  CLAUDE_CODE_OAUTH_TOKEN: z.preprocess(empty, z.string().optional()),
  WAYPOINT_CLAUDE_BIN: z.preprocess(empty, z.string().default('claude')),
  WAYPOINT_CLAUDE_TIMEOUT_MS: z.preprocess(empty, z.coerce.number().int().positive().default(120_000)),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const r = schema.safeParse(source);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join('.')} ${i.message}`);
  throw new EnvError(`The environment is not valid:\n${lines.join('\n')}`);
}

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
