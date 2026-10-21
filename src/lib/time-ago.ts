/**
 * Relative times for the screens. The server sends ISO dates, because a text
 * such as "3 days ago" would change the body of a response each minute and
 * the ETag with it. The browser calls these with the date and the time now.
 */

/** Whole days between a date and now. */
export const daysSince = (iso: string, now = Date.now()) => Math.floor((now - Date.parse(iso)) / 86_400_000);

/** For a posting date: "today", "yesterday", "3 days ago", "2 weeks ago". */
export function ago(iso: string, now = Date.now()): string {
  const days = daysSince(iso, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}

/** For a message or a build: "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function longAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!(mins >= 1)) return 'just now';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
