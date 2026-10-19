import pino from 'pino';

/** Paths of values that the logger removes. A secret never reaches the log. */
export const REDACT_PATHS = [
  'password', '*.password',
  'token', '*.token',
  'apiKey', '*.apiKey',
  'key', '*.key',
  'secret', '*.secret',
  'cookie', '*.cookie',
  'headers.cookie', 'headers.authorization',
  'req.headers.cookie', 'req.headers.authorization',
];

const SCRUBS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, '[removed]'],
  [/\b(app_key|api_key|key|token|password)=[^&\s]+/gi, '$1=[removed]'],
  [/Bearer\s+\S+/gi, 'Bearer [removed]'],
  // JSON-style text: "token":"x" or 'secret': 'x'. The key stays, the value goes.
  [/(["'](?:token|api_?key|password|secret|key|cookie|authorization)["']\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[removed]"'],
  [/(["'](?:token|api_?key|password|secret|key|cookie|authorization)["']\s*:\s*)'(?:\\.|[^'\\])*'/gi, "$1'[removed]'"],
  [/\b(x-api-key\s*:\s*)[^\s,;"']+/gi, '$1[removed]'],
];

/** Removes keys, tokens and passwords from free text, such as an error message or a URL. */
export function scrub(text: string): string {
  return SCRUBS.reduce((t, [re, to]) => t.replace(re, to), text);
}

const SECRET_KEY = /password|token|api_?key|secret|cookie|authorization|^key$/i;
const MAX_DEPTH = 5;

/** Scrubs every string in a value. A secret key gives "[removed]". It stops at depth 5 and at a cycle. */
function scrubDeep(v: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof v === 'string') return scrub(v);
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(v);
  const out: unknown = Array.isArray(v) ? [] : {};
  const rec = out as Record<string, unknown>;
  for (const [k, x] of Object.entries(v)) rec[k] = SECRET_KEY.test(k) ? '[removed]' : scrubDeep(x, depth + 1, seen);
  seen.delete(v);
  return out;
}

/** Like the standard `err` serializer, but it scrubs every text value inside the error, also in `cause` and `errors`. */
export function serializeErr(e: unknown): unknown {
  if (!(e instanceof Error)) return scrubDeep(e, 0, new WeakSet());
  return scrubDeep({ ...pino.stdSerializers.err(e) }, 0, new WeakSet());
}

const scrubField = (v: unknown) => (typeof v === 'string' ? scrub(v) : v);

/** A logger that writes JSON lines to `stream` (the default is standard output). */
export function makeLogger(stream?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      redact: { paths: REDACT_PATHS, censor: '[removed]' },
      serializers: { err: serializeErr, error: scrubField, message: scrubField },
      base: { pid: process.pid },
    },
    stream,
  );
}

/** The logger of the app. It is silent in tests, unless the test makes its own logger. */
export const log: pino.Logger = process.env.VITEST
  ? pino({ level: 'silent' })
  : makeLogger();
