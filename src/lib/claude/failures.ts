/**
 * The last auth and quota failure of each credential, for the banners in the
 * UI. The key is "cli", "shared" or "own:<userId>", so a bad own key of one
 * user does not show a banner to the others. A version check passes even
 * after `claude login` expires, so a failure shows only when a call runs.
 * The flag stays until a call with that credential succeeds or the user
 * presses "recheck".
 */
type Failure = { message: string; at: number };

const auth = new Map<string, Failure>();
const quota = new Map<string, Failure>();

export const claudeAuthFailure = (key: string) => auth.get(key) ?? null;
export const claudeQuotaFailure = (key: string) => quota.get(key) ?? null;
export const setAuthFailure = (key: string, message: string) => { auth.set(key, { message, at: Date.now() }); };
export const setQuotaFailure = (key: string, message: string) => { quota.set(key, { message, at: Date.now() }); };
export const clearFailures = (key: string) => { auth.delete(key); quota.delete(key); };
