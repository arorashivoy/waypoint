import { NextResponse, type NextRequest } from 'next/server';

/** An error with an HTTP status. `handle` sends it to the client as { error }. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type RouteContext = { params: Record<string, string> };

/**
 * The wrapper for every API route. An HttpError becomes JSON with its status.
 * A Prisma "record not found" (P2025) becomes 404, and so does a
 * "foreign key failed" (P2003): a write that names a job ID that does not exist. Any other error is logged
 * and becomes a 500 with a fixed message, so paths and stack details stay on
 * the server.
 */
export function handle<C = RouteContext>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      const code = (e as { code?: string } | null)?.code;
      if (code === 'P2025' || code === 'P2003') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      console.error('[api]', req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ error: 'Something went wrong. The server log has the details.' }, { status: 500 });
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
