import { db } from '@/lib/db';
import { fetchSignal } from '@/lib/fetch-timeout';
import { scrub } from '@/lib/log';

/** A board fetched less than this long ago is skipped, unless the user forces it. */
export const FEED_FRESH_MS = 6 * 3600_000;

const MAX_ERROR_LENGTH = 200;

export type FeedStatus = 'ok' | 'skipped' | 'not-modified';

/** Thrown when a board is not fetched or has no new data. The refresh reports it as a row with `got: 0`. */
export class FeedSkip extends Error {
  constructor(readonly status: 'skipped' | 'not-modified') {
    super(status);
  }
}

async function isFresh(board: string, now: Date): Promise<boolean> {
  const row = await db.feedFetch.findUnique({ where: { board } });
  return !!row && row.status !== 'failed' && now.getTime() - row.fetchedAt.getTime() < FEED_FRESH_MS;
}

/** Keeps the etag and the last-modified value of the stored row. */
export async function recordFailure(board: string, err: unknown, now: Date = new Date()): Promise<void> {
  const error = scrub((err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH)).slice(0, MAX_ERROR_LENGTH);
  await db.feedFetch.upsert({
    where: { board },
    update: { status: 'failed', error, fetchedAt: now },
    create: { board, status: 'failed', error, fetchedAt: now },
  });
}

/** Writes the success data of a fetch. The caller runs it after the jobs are stored. */
export type Commit = () => Promise<void>;

/**
 * Fetches the JSON of one board. A board fetched in the last 6 hours is skipped.
 * The request sends `If-None-Match` and `If-Modified-Since` from the stored values.
 * A failed request records `failed` at once and throws. The stored etag stays.
 * A good reply changes nothing yet. The caller runs `commit` after it stores the jobs,
 * so a failed store leaves the old etag and date, and the next refresh fetches again.
 */
export async function fetchBoard(
  board: string,
  url: string,
  init: RequestInit,
  opts: { force: boolean; now?: Date },
): Promise<{ status: 'ok'; json: any; commit: Commit } | { status: 'not-modified'; commit: Commit } | { status: 'skipped' }> {
  const now = opts.now ?? new Date();
  if (!opts.force && (await isFresh(board, now))) return { status: 'skipped' };

  const prev = await db.feedFetch.findUnique({ where: { board } });
  const headers = new Headers(init.headers);
  if (prev?.etag) headers.set('if-none-match', prev.etag);
  if (prev?.lastModified) headers.set('if-modified-since', prev.lastModified);

  try {
    const res = await fetch(url, { ...init, headers, signal: init.signal ?? fetchSignal() });
    if (res.status === 304) {
      const commit: Commit = async () => {
        await db.feedFetch.update({ where: { board }, data: { status: 'not-modified', error: null, fetchedAt: now } });
      };
      return { status: 'not-modified', commit };
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    const commit: Commit = async () => {
      await db.feedFetch.upsert({
        where: { board },
        update: { status: 'ok', error: null, fetchedAt: now, etag, lastModified },
        create: { board, status: 'ok', fetchedAt: now, etag, lastModified },
      });
    };
    return { status: 'ok', json, commit };
  } catch (e) {
    await recordFailure(board, e, now);
    throw e;
  }
}

/**
 * For a board with several requests or a POST. It gets the 6-hour skip and the
 * status, but no conditional headers.
 */
export async function withFeedStatus<T>(
  board: string,
  opts: { force: boolean; now?: Date },
  run: () => Promise<T>,
): Promise<{ value: T; commit: Commit }> {
  const now = opts.now ?? new Date();
  if (!opts.force && (await isFresh(board, now))) throw new FeedSkip('skipped');
  try {
    const value = await run();
    const commit: Commit = async () => {
      await db.feedFetch.upsert({
        where: { board },
        update: { status: 'ok', error: null, fetchedAt: now },
        create: { board, status: 'ok', fetchedAt: now },
      });
    };
    return { value, commit };
  } catch (e) {
    await recordFailure(board, e, now);
    throw e;
  }
}
