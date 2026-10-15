/** Next.js calls this one time when the server starts. A bad environment
 *  stops the server here, with the key named, before any request runs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { env } = await import('./lib/env');
  try {
    env();
  } catch (err) {
    // Next 14.2 logs a failed hook and keeps serving, so exit here.
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
