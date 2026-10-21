/**
 * Same-origin checks. Edge-safe (the middleware imports this file), so it
 * reads process.env directly and not through env().
 *
 * Behind zrok, the Host header can be localhost:<port> while the browser
 * sends the public URL as Origin. WAYPOINT_PUBLIC_URL names that URL.
 */

const first = (v: string | null) => (v ?? '').split(',')[0].trim();

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** True when the Origin header names this app. A missing Origin is false. */
export function sameOrigin(req: Request): boolean {
  const origin = hostOf(req.headers.get('origin') ?? undefined);
  if (!origin) return false;
  const allowed = [first(req.headers.get('host')), first(req.headers.get('x-forwarded-host')), hostOf(process.env.WAYPOINT_PUBLIC_URL)];
  return allowed.some((h) => !!h && h === origin);
}

/** The base URL for links that the admin sends (invites, password resets). */
export function publicBase(req: Request): string {
  const configured = process.env.WAYPOINT_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const proto = first(req.headers.get('x-forwarded-proto')) || new URL(req.url).protocol.replace(':', '');
  const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host')) || new URL(req.url).host;
  return `${proto}://${host}`;
}
