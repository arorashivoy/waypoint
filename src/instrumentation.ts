/** Next.js calls this one time when the server starts. A bad environment
 *  stops the server here, with the key named, before any request runs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { env } = await import('./lib/env');
  env();
}
