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
];

/** Removes keys, tokens and passwords from free text, such as an error message or a URL. */
export function scrub(text: string): string {
  return SCRUBS.reduce((t, [re, to]) => t.replace(re, to), text);
}

/** Like the standard `err` serializer, but it scrubs the message, the stack and the text properties. */
export function serializeErr(e: unknown): unknown {
  if (!(e instanceof Error)) return typeof e === 'string' ? scrub(e) : e;
  const out: Record<string, unknown> = { ...pino.stdSerializers.err(e) };
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string') out[k] = scrub(v);
  return out;
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
