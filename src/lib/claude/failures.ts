/**
 * The last auth and quota failures, for the banners in the UI.
 *
 * A version check passes even after `claude login` expires, so an auth failure
 * shows only when a call runs. These flags keep it until a call succeeds or the
 * user presses "recheck".
 */
type Failure = { message: string; at: number } | null;

let auth: Failure = null;
let quota: Failure = null;

export const claudeAuthFailure = () => auth;
export const claudeQuotaFailure = () => quota;
export const clearClaudeAuthFailure = () => { auth = null; };
export const clearClaudeQuotaFailure = () => { quota = null; };
export const setAuthFailure = (message: string) => { auth = { message, at: Date.now() }; };
export const setQuotaFailure = (message: string) => { quota = { message, at: Date.now() }; };
export const clearFailures = () => { auth = null; quota = null; };
