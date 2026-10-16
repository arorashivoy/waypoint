import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '@/lib/auth/password';
import { currentAdmin, setupAdmin } from '@/lib/auth/admin-setup';
import { applyMigrations } from './setup/migrate';

async function withDb(fn: (c: PrismaClient) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-admin-'));
  const c = new PrismaClient({ datasourceUrl: `file:${join(dir, 'a.db')}?connection_limit=1` });
  try {
    await applyMigrations(c);
    await fn(c);
  } finally {
    await c.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}

const PW = 'amber lantern forest 9021';

describe('setupAdmin', () => {
  it('makes the first admin in an empty database', async () => {
    await withDb(async (c) => {
      expect(await currentAdmin(c)).toBeNull();
      const r = await setupAdmin({ email: ' Me@Example.com ', name: 'Me', password: PW }, c);
      expect(r.action).toBe('created');
      const u = await c.user.findUniqueOrThrow({ where: { id: r.userId } });
      expect(u).toMatchObject({ email: 'me@example.com', role: 'admin' });
      expect(await verifyPassword(u.passwordHash!, PW)).toBe(true);
      expect(await c.countryPref.count({ where: { userId: u.id } })).toBeGreaterThan(0);
    });
  });

  it('sets the password of the migrated admin and ends its sessions', async () => {
    await withDb(async (c) => {
      const old = await c.user.create({ data: { email: 'you@local', name: 'Your Name', role: 'admin' } });
      await c.session.create({ data: { tokenHash: 'h', userId: old.id, expiresAt: new Date(Date.now() + 1e6) } });
      expect(await currentAdmin(c)).toEqual({ email: 'you@local', name: 'Your Name' });
      const r = await setupAdmin({ email: 'me@example.com', name: 'Me', password: PW }, c);
      expect(r).toEqual({ action: 'updated', userId: old.id });
      const u = await c.user.findUniqueOrThrow({ where: { id: old.id } });
      expect(u.email).toBe('me@example.com');
      expect(await verifyPassword(u.passwordHash!, PW)).toBe(true);
      expect(await c.session.count({ where: { userId: old.id } })).toBe(0);
    });
  });

  it('makes the oldest user the admin when no admin exists', async () => {
    await withDb(async (c) => {
      const a = await c.user.create({ data: { email: 'a@x.test', name: 'A', createdAt: new Date('2024-01-01') } });
      await c.user.create({ data: { email: 'b@x.test', name: 'B', createdAt: new Date('2025-01-01') } });
      const r = await setupAdmin({ email: 'a@x.test', name: 'A', password: PW }, c);
      expect(r).toEqual({ action: 'updated', userId: a.id });
      expect((await c.user.findUniqueOrThrow({ where: { id: a.id } })).role).toBe('admin');
    });
  });

  it('refuses a weak password and a bad email', async () => {
    await withDb(async (c) => {
      await expect(setupAdmin({ email: 'me@example.com', name: 'Me', password: 'short' }, c)).rejects.toThrow(/12 characters/);
      await expect(setupAdmin({ email: 'not-an-email', name: 'Me', password: PW }, c)).rejects.toThrow(/valid email/);
    });
  });
});
