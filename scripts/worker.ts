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
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  log.info('worker started');
  await startWorker({ signal: ac.signal });
  log.info('worker stopped');
}

void main();
