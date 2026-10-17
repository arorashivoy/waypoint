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

/** A logger that writes JSON lines to `stream` (the default is standard output). */
export function makeLogger(stream?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      redact: { paths: REDACT_PATHS, censor: '[removed]' },
      base: { pid: process.pid },
    },
    stream,
  );
}

/** The logger of the app. It is silent in tests, unless the test makes its own logger. */
export const log: pino.Logger = process.env.VITEST
  ? pino({ level: 'silent' })
  : makeLogger();
