import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Files of each user live in data/users/<userId>/ (spec 2.6). A path comes only
 * from the session's userId and names that the server makes; a user never
 * supplies a path. Tests set WAYPOINT_USERS_DIR to a temporary folder.
 */

const USER_ID = /^[a-z0-9]{8,40}$/;

export function usersRoot(): string {
  return resolve(process.env.WAYPOINT_USERS_DIR || join(process.cwd(), 'data', 'users'));
}

function checked(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('Not a user ID.');
  return join(usersRoot(), userId);
}

export function userDir(userId: string, sub?: 'imports' | 'resumes'): string {
  const base = checked(userId);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  chmodSync(base, 0o700);
  if (!sub) return base;
  const dir = join(base, sub);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function removeUserDir(userId: string): void {
  rmSync(checked(userId), { recursive: true, force: true });
}
