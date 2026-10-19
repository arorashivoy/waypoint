import pino from 'pino';

/** Paths of values that the logger removes. A secret never reaches the log. */
export const REDACT_PATHS = [
  'password', '*.password',
  'token', '*.token',
  'accessToken', '*.accessToken', 'refreshToken', '*.refreshToken', 'idToken', '*.idToken',
  'apiKey', '*.apiKey', 'api_key', '*.api_key', 'apikey', '*.apikey',
  'key', '*.key',
  'secret', '*.secret', 'clientSecret', '*.clientSecret', 'client_secret', '*.client_secret',
  'access_token', '*.access_token', 'refresh_token', '*.refresh_token', 'id_token', '*.id_token',
  'cookie', '*.cookie',
  'headers["x-api-key"]', 'headers["X-Api-Key"]', 'headers.authorization', 'headers.Authorization',
  'headers.cookie',
  'req.headers.cookie', 'req.headers.authorization',
];

// A secret name: password, secret, cookie, authorization, a name that ends in key, and a name that ends in "token".
const NAME = String.raw`[\w-]*(?:pass(?:word|wd)|secret|cookie|authori[sz]ation|key|token)`;
const SCRUBS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, '[removed]'],
  // key=value in a URL or in form text. The name may be part of a longer name (access_token, client_secret).
  [new RegExp(`(^|[?&\\s;,])(${NAME}|sig)=[^&\\s]+`, 'gi'), '$1$2=[removed]'],
  [/Bearer\s+\S+/gi, 'Bearer [removed]'],
  // JSON-style text: "token":"x" or 'secret': 'x'. The key stays, the value goes.
  [new RegExp(`(["']${NAME}["']\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi'), '$1"[removed]"'],
  [new RegExp(`(["']${NAME}["']\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`, 'gi'), "$1'[removed]'"],
  // Header text and inspect text: x-api-key: value, Authorization: value, { token: 'v' }.
  [new RegExp(`\\b(${NAME})(\\s*:\\s*)["']?[^\\s,;"'}]+["']?`, 'gi'), '$1$2[removed]'],
];

/** Removes keys, tokens and passwords from free text, such as an error message or a URL. */
export function scrub(text: string): string {
  return SCRUBS.reduce((t, [re, to]) => t.replace(re, to), text);
}

// A key name that holds a secret. "token" counts only at the end of the name, so inputTokens stays.
const SECRET_KEY = /pass(?:word|wd)|secret|cookie|authori[sz]ation|api[-_]?key|(?:^|[-_a-z])token$|^key$/i;
const MAX_DEPTH = 5;

/** Scrubs every string in a value. A secret key gives "[removed]". It stops at depth 5 and at a cycle. */
function scrubDeep(v: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof v === 'string') return scrub(v);
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return `[Buffer ${v.byteLength} bytes]`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
  if (v instanceof URL || v instanceof Map || v instanceof Set || v instanceof Headers) return scrub(v instanceof URL ? v.href : `[${v.constructor.name}]`);
  if (seen.has(v)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(v);
  const out: unknown = Array.isArray(v) ? [] : {};
  const rec = out as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    try {
      rec[k] = SECRET_KEY.test(k) ? '[removed]' : scrubDeep((v as Record<string, unknown>)[k], depth + 1, seen);
    } catch {
      rec[k] = '[unreadable]';
    }
  }
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
