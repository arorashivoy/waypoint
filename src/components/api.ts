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

/**
 * The whole outbound flow is clipboard + a new tab, because LinkedIn's API
 * cannot send anything and automating the site risks the account.
 */
export async function copyAndOpen(text: string, url?: string | null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard needs a secure context; the text is on screen either way.
  }
  if (url) window.open(url, '_blank', 'noopener');
}
