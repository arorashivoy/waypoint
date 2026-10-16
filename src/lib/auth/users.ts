import type { User } from '@prisma/client';
import { db } from '../db';
import { COUNTRIES } from '../countries';
import { HttpError } from './http';
import { hashPassword, passwordProblem } from './password';
import { endUserSessions } from './session';

export const normEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Makes a user with a checked password and the default country list. */
export async function createUser(input: { email: string; name: string; password: string; role?: 'admin' | 'member' }): Promise<User> {
  const email = normEmail(input.email);
  const name = input.name.trim().slice(0, 120);
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!name) throw new HttpError(400, 'Enter your name.');
  const problem = passwordProblem(input.password, { email, name });
  if (problem) throw new HttpError(400, problem);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: input.role ?? 'member',
        countries: { create: COUNTRIES.map((c, i) => ({ cc: c.cc, rank: i, on: true })) },
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'An account with this email already exists.');
    throw e;
  }
}

/** Sets a new password and ends all sessions of the user except `keepSessionId`. */
export async function setPassword(userId: string, password: string, keepSessionId?: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const problem = passwordProblem(password, user);
  if (problem) throw new HttpError(400, problem);
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  await endUserSessions(userId, keepSessionId);
}
