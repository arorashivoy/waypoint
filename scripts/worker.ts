import { EnvError, env } from '@/lib/env';
import { log } from '@/lib/log';

try {
  env();
} catch (err) {
  if (err instanceof EnvError) {
    log.error({ err }, 'bad environment');
    process.exit(1);
  }
  throw err;
}

async function main() {
  // Load the worker after env() passes, so a missing key gives a clear message.
  const { startWorker } = await import('@/lib/tasks/worker');
  const { retestCliWhenOff, runCliSelfTestAtStart } = await import('@/lib/claude/selftest');
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // Each start runs the CLI canary again. A fail turns CLI mode off.
  await runCliSelfTestAtStart(undefined, ac.signal);
  // After a fail with no verdict (a time-out, a failed call), the canary runs again later.
  // retestCliWhenOff decides when. Only one canary runs at a time.
  let testing = false;
  const retest = setInterval(() => {
    if (testing || ac.signal.aborted) return;
    testing = true;
    void retestCliWhenOff(undefined, ac.signal).finally(() => {
      testing = false;
    });
  }, 30_000);
  log.info('worker started');
  try {
    await startWorker({ signal: ac.signal });
  } finally {
    clearInterval(retest);
  }
  log.info('worker stopped');
}

void main();
