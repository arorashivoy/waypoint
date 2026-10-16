import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db } from './db';
import { env } from './env';

/**
 * Secrets of each user: the Anthropic key, the GitHub token and the Drive
 * refresh token. AES-256-GCM with WAYPOINT_SECRET_KEY. The additional data
 * is "<userId>:<kind>", so a row copied to another user does not decrypt.
 */

export type SecretKind = 'anthropic' | 'github' | 'gdrive';
export type Sealed = { iv: string; tag: string; data: string; keyVersion: number };

const KEY_VERSION = 1;
const TAG_BYTES = 16;

const masterKey = () => Buffer.from(env().WAYPOINT_SECRET_KEY, 'base64');

export function seal(plain: string, aad: string, key: Buffer = masterKey()): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

export function unseal(sealed: Sealed, aad: string, key: Buffer = masterKey()): string {
  if (sealed.keyVersion !== KEY_VERSION) throw new Error(`Unknown secret key version ${sealed.keyVersion}.`);
  // GCM accepts a short tag, and a 4-byte tag is easy to guess. Only the full 16 bytes count.
  const tag = Buffer.from(sealed.tag, 'base64');
  if (tag.length !== TAG_BYTES) throw new Error(`The secret has a ${tag.length}-byte tag. It must have ${TAG_BYTES} bytes.`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}

const aadOf = (userId: string, kind: SecretKind) => `${userId}:${kind}`;

export async function saveSecret(userId: string, kind: SecretKind, value: string): Promise<void> {
  const sealed = seal(value, aadOf(userId, kind));
  const last4 = value.slice(-4);
  await db.userSecret.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, ...sealed, last4 },
    update: { ...sealed, last4 },
  });
}

/** Null if there is no secret, or if it does not decrypt (the log says why). */
export async function readSecret(userId: string, kind: SecretKind): Promise<string | null> {
  const row = await db.userSecret.findUnique({ where: { userId_kind: { userId, kind } } });
  if (!row) return null;
  try {
    return unseal(row, aadOf(userId, kind));
  } catch (e) {
    console.error(`[secrets] cannot decrypt the ${kind} secret of user ${userId}:`, (e as Error).message);
    return null;
  }
}

/** The last 4 characters, for Settings. Never the secret. */
export async function secretHint(userId: string, kind: SecretKind): Promise<string | null> {
  const row = await db.userSecret.findUnique({ where: { userId_kind: { userId, kind } }, select: { last4: true } });
  return row?.last4 ?? null;
}

export async function deleteSecret(userId: string, kind: SecretKind): Promise<void> {
  await db.userSecret.deleteMany({ where: { userId, kind } });
}
