import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { ctx, request } from './helpers/http';

describe('GET /api/health', () => {
  it('answers without a session and shows no user data', async () => {
    const res = await GET(request('/api/health'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: 'waypoint', status: 'ok' });
  });
});
