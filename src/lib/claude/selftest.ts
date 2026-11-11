import { z } from 'zod';
import { clearState, getState, setState } from '../app-state';
import { log, scrub } from '../log';
import { cliBinary, cliSelfTest, type SelfTestVerdict } from './cli';

const KEY = 'cliDisabled';
// `retry` and `fails` are set only after a fail that is not a verdict (see SelfTestVerdict).
const schema = z.object({ reason: z.string(), at: z.string(), retry: z.boolean().optional(), fails: z.number().int().optional() });

type Disabled = z.infer<typeof schema>;
type Test = (signal?: AbortSignal) => Promise<SelfTestVerdict>;
export type SelfTestRun = { ran: false } | { ran: true; ok: true } | { ran: true; ok: false; why: string };

/** Why CLI mode is off, or null when it is on. The worker sets this when the self-test fails. */
export function cliDisabled(): Promise<Disabled | null> {
  return getState(KEY, schema);
}

/** One canary call and its stored result. `fails` is the count of fails with `retry` before this call. It never throws. */
async function run(test: Test, signal: AbortSignal | undefined, fails: number, now: Date): Promise<SelfTestRun> {
  let verdict: SelfTestVerdict;
  try {
    verdict = await test(signal);
  } catch (e) {
    verdict = { ok: false, why: e instanceof Error ? e.message : 'The self-test threw an error.' };
  }
  // The worker is stopping. A stopped canary is not a fail, so the stored verdict stays as it was.
  if (signal?.aborted) return { ran: false };
  try {
    if (verdict.ok) {
      await clearState(KEY);
      log.info('claude cli self-test passed; cli mode is on');
      return { ran: true, ok: true };
    }
    const reason = scrub(verdict.why.slice(0, 300));
    const again = verdict.retry ? { retry: true, fails: fails + 1 } : {};
    await setState(KEY, { reason, at: now.toISOString(), ...again });
    log.error({ reason, ...again }, 'claude cli self-test failed; cli mode is off');
    return { ran: true, ok: false, why: reason };
  } catch (e) {
    // The database failed. Keep the worker alive and report a fail.
    log.error({ err: e }, 'claude cli self-test could not save its result');
    return { ran: true, ok: false, why: e instanceof Error ? e.message : 'The result was not saved.' };
  }
}

/**
 * Run the canary once, when the worker starts. A fail turns CLI mode off. It never throws: an
 * error counts as a fail. `signal` stops the canary when the worker gets SIGTERM during the start.
 *
 * A fail with a verdict (a tool ran, a tool call was denied, a file was named, another model
 * answered) keeps CLI mode off until the next start passes. A fail with no verdict (a time-out,
 * a failed call, an answer that is not NONE) gets later tests: see `retestCliWhenOff`.
 */
export async function runCliSelfTestAtStart(test: Test = cliSelfTest, signal?: AbortSignal): Promise<SelfTestRun> {
  if (!cliBinary()) return { ran: false };
  return run(test, signal, 0, new Date());
}

/** The wait before the next test: 1 minute after each of the first 2 fails, then 10 minutes. */
export const RETEST_SOON_MS = 60_000;
export const RETEST_MS = 600_000;
const SOON_FAILS = 3;

/**
 * Test again while CLI mode is off after a fail with no verdict. The worker calls this often.
 * The canary runs only when the wait is over. CLI mode goes on only when a canary passes, so
 * the rule of the first test does not change. A slow start of the Pi, a network that was not
 * ready or a used-up quota no longer keeps CLI mode off until someone restarts the worker.
 * It never throws.
 */
export async function retestCliWhenOff(test: Test = cliSelfTest, signal?: AbortSignal, now: Date = new Date()): Promise<SelfTestRun> {
  let off: Disabled | null;
  try {
    off = cliBinary() ? await cliDisabled() : null;
  } catch {
    return { ran: false };
  }
  if (!off?.retry) return { ran: false };
  const fails = off.fails ?? 1;
  const wait = fails < SOON_FAILS ? RETEST_SOON_MS : RETEST_MS;
  const since = now.getTime() - Date.parse(off.at);
  if (!Number.isNaN(since) && since < wait) return { ran: false };
  return run(test, signal, fails, now);
}
