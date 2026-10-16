const BASE = 'http://x.invalid';

/** Only a local path is a safe place to go after sign-in. */
export function safeNext(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/')) return '/';
  // The URL parser drops tab, LF and CR, so refuse any control character.
  if (/[\u0000-\u001f\u007f]/.test(v)) return '/';
  try {
    const u = new URL(v, BASE);
    return u.origin === BASE ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}
