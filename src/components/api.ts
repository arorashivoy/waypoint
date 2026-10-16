export type Json = Record<string, any>;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Set after the first 401, so the page goes to /login one time only. */
let redirecting = false;

export async function api<T = Json>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const text = await res.text();
  let data: Json = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (res.status === 401 && typeof window !== 'undefined' && !redirecting && window.location.pathname !== '/login') {
    redirecting = true;
    window.location.assign('/login?next=' + encodeURIComponent(window.location.pathname + window.location.search));
  }
  if (!res.ok) throw new ApiError(data.error || `${res.status} ${res.statusText}`, res.status);
  return data as T;
}

export const post = <T = Json>(url: string, body?: unknown) =>
  api<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T = Json>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const put = <T = Json>(url: string, body: unknown) => api<T>(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const del = <T = Json>(url: string) => api<T>(url, { method: 'DELETE' });

/** False when the clipboard is unavailable — it needs a secure context, which
 *  plain http over the LAN is not. The text is on screen either way. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The whole outbound flow is clipboard + a new tab, because LinkedIn's API
 * cannot send anything and automating the site risks the account.
 */
export async function copyAndOpen(text: string, url?: string | null) {
  await copyText(text);
  if (url) window.open(url, '_blank', 'noopener');
}

/**
 * Browsers allow a clipboard write or a new tab only shortly after a click, and
 * a referral takes far longer than that to draft (CV build plus Drive upload).
 * A ClipboardItem given a promise claims the clipboard during the click and is
 * filled in when the text arrives. A tab has no such escape hatch, so the caller
 * is told whether it was blocked and can offer a link instead.
 */
export async function draftCopyOpen<T extends { copy: string; open: string | null }>(draft: Promise<T>) {
  let copied: Promise<boolean>;
  try {
    copied = navigator.clipboard
      .write([new ClipboardItem({ 'text/plain': draft.then((r) => new Blob([r.copy], { type: 'text/plain' })) })])
      .then(() => true, () => false);
  } catch {
    copied = Promise.resolve(false);
  }
  const res = await draft;
  const ok = (await copied) || (await navigator.clipboard?.writeText(res.copy).then(() => true, () => false)) || false;
  // Not 'noopener' in the features string: with it window.open always returns
  // null, and a blocked popup would be indistinguishable from an opened one.
  const tab = res.open ? window.open(res.open, '_blank') : null;
  if (tab) tab.opener = null;
  return { res, copied: ok, opened: !!tab };
}
