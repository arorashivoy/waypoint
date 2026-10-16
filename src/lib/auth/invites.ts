import type { Invite, User } from '@prisma/client';
import { db } from '../db';
import { HttpError } from './http';
import { hashToken, newToken } from './tokens';
import { createUser, normEmail, setPassword } from './users';

export const INVITE_MS = 7 * 24 * 3600_000;

const GONE = 'This link is not valid. It expired or was used. Ask the admin for a new link.';

export type TokenInfo = { kind: 'invite' | 'reset'; email: string | null; name: string | null };

async function live(token: string): Promise<(Invite & { user: User | null }) | null> {
  if (!token || token.length > 100) return null;
  const row = await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  if (row.kind === 'reset' && !row.user) return null;
  return row;
}

export async function createInvite(adminId: string, email?: string | null): Promise<string> {
  const fixed = email ? normEmail(email) : null;
  if (fixed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fixed)) throw new HttpError(400, 'Enter a valid email address.');
  if (fixed && (await db.user.findUnique({ where: { email: fixed } }))) throw new HttpError(409, 'An account with this email already exists.');
  const { token, hash } = newToken();
  await db.invite.create({ data: { tokenHash: hash, kind: 'invite', email: fixed, createdById: adminId, expiresAt: new Date(Date.now() + INVITE_MS) } });
  return token;
}

export async function createReset(adminId: string, userId: string): Promise<string> {
  await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { token, hash } = newToken();
  await db.invite.create({ data: { tokenHash: hash, kind: 'reset', userId, createdById: adminId, expiresAt: new Date(Date.now() + INVITE_MS) } });
  return token;
}

export async function inspectToken(token: string): Promise<TokenInfo | null> {
  const row = await live(token);
  if (!row) return null;
  return row.kind === 'reset'
    ? { kind: 'reset', email: row.user!.email, name: row.user!.name }
    : { kind: 'invite', email: row.email, name: null };
}

/** Marks the link as used. Only one of 2 requests at the same time gets true. */
async function claim(id: string): Promise<boolean> {
  const r = await db.invite.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  return r.count === 1;
}

const release = (id: string) => db.invite.update({ where: { id }, data: { usedAt: null } });

export async function redeemInvite(token: string, input: { email?: unknown; name: unknown; password: unknown }): Promise<User> {
  const row = await live(token);
  if (!row || row.kind !== 'invite' || !(await claim(row.id))) throw new HttpError(404, GONE);
  try {
    return await createUser({ email: row.email ?? normEmail(input.email), name: String(input.name ?? ''), password: String(input.password ?? '') });
  } catch (e) {
    // A weak password or a used email: give the link back, so the user can try again.
    await release(row.id);
    throw e;
  }
}

export async function redeemReset(token: string, password: unknown): Promise<User> {
  const row = await live(token);
  if (!row || row.kind !== 'reset' || !(await claim(row.id))) throw new HttpError(404, GONE);
  try {
    await setPassword(row.userId!, String(password ?? ''));
  } catch (e) {
    await release(row.id);
    throw e;
  }
  await db.invite.updateMany({ where: { userId: row.userId, kind: 'reset', usedAt: null }, data: { usedAt: new Date() } });
  return db.user.findUniqueOrThrow({ where: { id: row.userId! } });
}
