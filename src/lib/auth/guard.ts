import { HttpError } from './http';
import { readSession } from './session';

/** The one check that all API routes use. */
export async function requireSession(req: Request) {
  const s = await readSession(req);
  if (!s) throw new HttpError(401, 'Sign in to continue.');
  return s;
}

export async function requireUser(req: Request) {
  return (await requireSession(req)).user;
}

export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Only the admin can do this.');
  return user;
}
