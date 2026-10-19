import { z } from 'zod';
import { clearState, getState, setState } from '../app-state';
import { log } from '../log';
import { cliBinary, cliSelfTest } from './cli';

const KEY = 'cliDisabled';
const schema = z.object({ reason: z.string(), at: z.string() });

type Disabled = z.infer<typeof schema>;
type Verdict = { ok: true } | { ok: false; why: string };
export type SelfTestRun = { ran: false } | { ran: true; ok: true } | { ran: true; ok: false; why: string };

/** Why CLI mode is off, or null when it is on. The worker sets this when the self-test fails. */
export function cliDisabled(): Promise<Disabled | null> {
  return getState(KEY, schema);
}

/**
 * Run the canary once, when the worker starts. A fail turns CLI mode off until
 * the next start passes. It never throws: an error counts as a fail.
 */
export async function runCliSelfTestAtStart(test: () => Promise<Verdict> = cliSelfTest): Promise<SelfTestRun> {
  if (!cliBinary()) return { ran: false };
  let verdict: Verdict;
  try {
    verdict = await test();
  } catch (e) {
    verdict = { ok: false, why: e instanceof Error ? e.message : 'The self-test threw an error.' };
  }
  try {
    if (verdict.ok) {
      await clearState(KEY);
      log.info('claude cli self-test passed; cli mode is on');
      return { ran: true, ok: true };
    }
    const reason = verdict.why.slice(0, 300);
    await setState(KEY, { reason, at: new Date().toISOString() });
    log.error({ reason }, 'claude cli self-test failed; cli mode is off');
    return { ran: true, ok: false, why: verdict.why };
  } catch (e) {
    // The database failed. Keep the worker alive and report a fail.
    log.error({ err: e }, 'claude cli self-test could not save its result');
    return { ran: true, ok: false, why: e instanceof Error ? e.message : 'The result was not saved.' };
  }
}
