/** A board or Drive fetch stops after 30 seconds, so one slow server cannot hold the worker. */
export const FETCH_TIMEOUT_MS = 30_000;

/** A new signal for each fetch. It aborts the fetch, and the read of the body, at the limit. */
export const fetchSignal = (): AbortSignal => AbortSignal.timeout(FETCH_TIMEOUT_MS);
