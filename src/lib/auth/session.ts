import type { NextResponse } from 'next/server';
import type { Session, User } from '@prisma/client';
import { db } from '../db';
import { SESSION_COOKIE } from './cookie-name';
import { hashToken, newToken } from './tokens';

export const SESSION_MS = 30 * 24 * 3600_000;
/** Each request moves the expiry forward, but writes at most one time each hour. */
export const TOUCH_MS = 3600_000;
/** The browser keeps the cookie for 400 days (the browser maximum). The
 *  database row decides when the session ends. */
const COOKIE_MAX_AGE_SEC = 400 * 24 * 3600;

export async function createSession(userId: string, userAgent: string | null): Promise<string> {
  const { token, hash } = newToken();
  await db.session.create({
    data: { tokenHash: hash, userId, expiresAt: new Date(Date.now() + SESSION_MS), userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return token;
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The session of this request, or null. Ends a session that expired or whose user is disabled. */
export async function readSession(req: Request): Promise<{ user: User; session: Session } | null> {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  if (!token) return null;
  const found = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!found) return null;
  const { user, ...session } = found;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || user.disabledAt) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() >= TOUCH_MS) {
    session.lastSeenAt = new Date(now);
    session.expiresAt = new Date(now + SESSION_MS);
    await db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt } });
  }
  return { user, session };
}

export async function endSession(id: string): Promise<void> {
  await db.session.deleteMany({ where: { id } });
}

export async function endUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

/** Behind a tunnel the browser uses https, but Next.js sees plain http. */
/** True behind an https tunnel, for an https request, or when the public URL is https. */
export function isHttps(req: Request): boolean {
  const fwd = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim();
  const publicUrl = process.env.WAYPOINT_PUBLIC_URL?.trim().toLowerCase() ?? '';
  return fwd === 'https' || new URL(req.url).protocol === 'https:' || publicUrl.startsWith('https:');
}

export function setSessionCookie(res: NextResponse, token: string, req: Request): void {
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: COOKIE_MAX_AGE_SEC });
}

export function clearSessionCookie(res: NextResponse, req: Request): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: 0 });
}
