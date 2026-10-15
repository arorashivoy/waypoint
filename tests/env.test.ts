import { describe, expect, it } from 'vitest';
import { parseEnv, EnvError } from '@/lib/env';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ok = { DATABASE_URL: 'file:../data/waypoint.db', WAYPOINT_SECRET_KEY: KEY };

describe('parseEnv', () => {
  it('accepts the two required keys and fills defaults', () => {
    const e = parseEnv(ok);
    expect(e.WAYPOINT_CLAUDE_BIN).toBe('claude');
    expect(e.WAYPOINT_CLAUDE_TIMEOUT_MS).toBe(120_000);
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('names a missing secret key and says how to make one', () => {
    expect(() => parseEnv({ DATABASE_URL: ok.DATABASE_URL })).toThrow(EnvError);
    expect(() => parseEnv({ DATABASE_URL: ok.DATABASE_URL })).toThrow(/WAYPOINT_SECRET_KEY.*npm run secret:new/s);
  });

  it('refuses a secret key that is not 32 bytes of base64', () => {
    expect(() => parseEnv({ ...ok, WAYPOINT_SECRET_KEY: 'short' })).toThrow(/WAYPOINT_SECRET_KEY/);
  });

  it('treats an empty API key as not set', () => {
    expect(parseEnv({ ...ok, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('reads the timeout as a number', () => {
    expect(parseEnv({ ...ok, WAYPOINT_CLAUDE_TIMEOUT_MS: '9000' }).WAYPOINT_CLAUDE_TIMEOUT_MS).toBe(9000);
  });
});
