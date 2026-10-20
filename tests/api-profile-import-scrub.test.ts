import { describe, expect, it, vi } from 'vitest';

// The archive parser fails with a message that holds a secret. The route must not return it.
vi.mock('@/lib/linkedin-import', async (orig) => ({
  ...(await orig<typeof import('@/lib/linkedin-import')>()),
  parseExport: vi.fn(() => {
    throw new Error('bad entry: api_key=plainkey123456');
  }),
}));

import { POST as importExport } from '@/app/api/profile/import/route';
import { ctx, formRequest, makeUser } from './helpers/http';

describe('POST /api/profile/import error text', () => {
  it('scrubs the parse error', async () => {
    const { cookie } = await makeUser();
    const form = new FormData();
    form.set('file', new File(['First Name,Last Name\nA,B\n'], 'Connections.csv'));
    const res = await importExport(await formRequest('/api/profile/import', form, { cookie }), ctx());
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain('Could not read that archive');
    expect(error).not.toContain('plainkey123456');
    expect(error).toContain('[removed]');
  });
});
