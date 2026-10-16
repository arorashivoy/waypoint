const BASE = 'http://x.invalid';

/** Only a local path is a safe place to go after sign-in. */
export function safeNext(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/')) return '/';
  // The URL parser drops tab, LF and CR, so refuse any control character.
  if (/[\u0000-\u001f\u007f]/.test(v)) return '/';
  try {
    const u = new URL(v, BASE);
    if (u.origin !== BASE) return '/';
    // Dot segments can leave a path that starts with two slashes, which is a different host.
    const out = u.pathname.replace(/^\/+/, '/') + u.search + u.hash;
    return out.startsWith('//') || out.startsWith('/\\') ? '/' : out;
  } catch {
    return '/';
  }
}
