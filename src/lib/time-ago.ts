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

/** For a message time: "5 min ago", "3 h ago", "2 d ago". */
export function shortAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}
