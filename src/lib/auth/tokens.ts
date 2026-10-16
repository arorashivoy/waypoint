import { createHash, randomBytes } from 'node:crypto';

/** A token for a cookie or a link: 32 random bytes. Store only `hash`. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
