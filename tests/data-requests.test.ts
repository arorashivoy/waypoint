import { describe, expect, it } from 'vitest';
import { abortRequests, endRequest, startRequest } from '@/components/data';

describe('the requests in flight for a key', () => {
  it('aborts an older request too, not only the newest one', () => {
    const key = `/api/test-${Math.random()}`;
    const older = startRequest(key);
    const newer = startRequest(key);
    abortRequests(key);
    expect(older.signal.aborted).toBe(true);
    expect(newer.signal.aborted).toBe(true);
  });

  it('forgets a request that ended, so a later abort does not touch it', () => {
    const key = `/api/test-${Math.random()}`;
    const done = startRequest(key);
    endRequest(key, done);
    const live = startRequest(key);
    abortRequests(key);
    expect(done.signal.aborted).toBe(false);
    expect(live.signal.aborted).toBe(true);
  });
});
