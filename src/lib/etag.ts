import { createHash } from 'node:crypto';

const CACHE_CONTROL = 'private, no-cache';

/** The weak ETag of a JSON text: the first 27 characters of the base64url SHA-256. */
function etagOf(json: string): string {
  return `W/"${createHash('sha256').update(json).digest('base64url').slice(0, 27)}"`;
}

/** True if the `If-None-Match` list holds `etag` or `*`. A weak tag and a strong tag with the same value match. */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

/** Replies with JSON and an ETag. If the client already has this body, replies 304 with no body. */
export function jsonWithEtag(req: Request, body: unknown, init: ResponseInit = {}): Response {
  const json = JSON.stringify(body);
  const etag = etagOf(json);
  const headers = new Headers(init.headers);
  headers.set('ETag', etag);
  headers.set('Cache-Control', CACHE_CONTROL);
  if (matches(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set('Content-Type', 'application/json');
  return new Response(json, { ...init, headers });
}
