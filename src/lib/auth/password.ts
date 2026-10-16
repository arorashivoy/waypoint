import { hash, verify } from '@node-rs/argon2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Password hashes and rules.
 *
 * argon2id is the default algorithm of @node-rs/argon2. These are the OWASP
 * minimum values: 19 MiB of memory, 2 passes, 1 lane. One hash takes about
 * 0.2 s on a Raspberry Pi 4.
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 256;

export const hashPassword = (pw: string) => hash(pw, OPTIONS);

/** False for a wrong password and for a stored value that is not a hash. */
export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/**
 * Does the same work as a real check. Sign-in calls it when the email is
 * unknown, so the response time does not show which emails have accounts.
 */
export async function burnPasswordCheck(pw: string): Promise<void> {
  dummy ??= hashPassword('waypoint dummy password');
  await verifyPassword(await dummy, pw);
}

let common: Set<string> | null = null;

function commonPasswords(): Set<string> {
  common ??= new Set(
    readFileSync(join(process.cwd(), 'src/lib/auth/common-passwords.txt'), 'utf8')
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return common;
}

/** The first problem with a new password, or null if it is good. */
export function passwordProblem(pw: string, who: { email?: string | null; name?: string | null } = {}): string | null {
  if (pw.length < MIN_PASSWORD) return `Use ${MIN_PASSWORD} characters or more.`;
  if (pw.length > MAX_PASSWORD) return `Use ${MAX_PASSWORD} characters or fewer.`;
  const lower = pw.toLowerCase();
  if (commonPasswords().has(lower)) return 'This password is on a list of common passwords. Use a different one.';
  const email = who.email?.trim().toLowerCase();
  const local = email?.split('@')[0];
  const name = who.name?.trim().toLowerCase();
  if ((email && lower === email) || (local && lower === local) || (name && lower === name)) {
    return 'Do not use your name or email as the password.';
  }
  return null;
}
