export type Json = Record<string, any>;

export async function api<T = Json>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data as T;
}

export const post = <T = Json>(url: string, body?: unknown) =>
  api<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T = Json>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

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
