import type { PrismaClient } from '@prisma/client';
import { db } from '../db';
import { COUNTRIES } from '../countries';
import { hashPassword, passwordProblem } from './password';
import { normEmail } from './users';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function currentAdmin(client: PrismaClient = db): Promise<{ email: string; name: string } | null> {
  return client.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { email: true, name: true } });
}

/**
 * Sets up the admin account:
 * - If an admin exists (the migration made the oldest user the admin), set its email, name and password.
 * - Else, if users exist, make the oldest user the admin.
 * - Else, make a new admin.
 * A new password ends all sessions of the admin.
 */
export async function setupAdmin(input: { email: string; name: string; password: string }, client: PrismaClient = db) {
  const email = normEmail(input.email);
  const name = input.name.trim().slice(0, 120);
  if (!EMAIL.test(email)) throw new Error('Enter a valid email address.');
  if (!name) throw new Error('Enter a name.');
  const problem = passwordProblem(input.password, { email, name });
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(input.password);

  const target =
    (await client.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } })) ??
    (await client.user.findFirst({ orderBy: { createdAt: 'asc' } }));

  if (target) {
    await client.user.update({ where: { id: target.id }, data: { email, name, passwordHash, role: 'admin', disabledAt: null } });
    await client.session.deleteMany({ where: { userId: target.id } });
    return { action: 'updated' as const, userId: target.id };
  }
  const user = await client.user.create({
    data: { email, name, passwordHash, role: 'admin', countries: { create: COUNTRIES.map((c, i) => ({ cc: c.cc, rank: i, on: true })) } },
  });
  return { action: 'created' as const, userId: user.id };
}
