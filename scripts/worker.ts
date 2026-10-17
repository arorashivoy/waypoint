import { EnvError, env } from '@/lib/env';

try {
  env();
} catch (err) {
  if (err instanceof EnvError) {
    console.error(err.message);
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
  console.log(`Worker started (pid ${process.pid})`);
  await startWorker({ signal: ac.signal });
  console.log('Worker stopped');
}

void main();
