import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { log } from '@/lib/log';

/** An error with an HTTP status. `handle` sends it to the client as { error, ...details }. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

/** An incoming request ID is kept only if it has this form. */
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export type RouteContext = { params: Record<string, string> };

/**
 * The wrapper for every API route. An HttpError becomes JSON with its status.
 * A Prisma "record not found" (P2025) becomes 404, and so does a
 * "foreign key failed" (P2003): a write that names a job ID that does not exist. Any other error is logged
 * with the request ID and becomes a 500 with a fixed message, so paths and stack details stay on
 * the server. Each response has an x-request-id header.
 */
export function handle<C = RouteContext>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const incoming = req.headers.get('x-request-id');
    const reqId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const done = (res: Response): Response => {
      res.headers.set('x-request-id', reqId);
      return res;
    };
    try {
      return done(await fn(req, ctx));
    } catch (e) {
      if (e instanceof HttpError) return done(NextResponse.json({ error: e.message, ...e.details }, { status: e.status }));
      const code = (e as { code?: string } | null)?.code;
      if (code === 'P2025' || code === 'P2003') return done(NextResponse.json({ error: 'Not found.' }, { status: 404 }));
      log.error({ reqId, method: req.method, path: req.nextUrl.pathname, err: e }, 'request failed');
      return done(NextResponse.json({ error: 'Something went wrong. The server log has the details.' }, { status: 500 }));
    }
  };
}

/** The JSON body as an object. Any other body is a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.');
  return body as Record<string, unknown>;
}
