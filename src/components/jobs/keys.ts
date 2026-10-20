export type JobKeyAction = 'search' | 'next' | 'previous' | 'close';

interface KeyInput {
  key: string;
  typing: boolean;
  sheetOpen: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * What a key does on the Jobs screen. `/` focuses the search. `j` and `k` move
 * the selection. Escape closes the open job. Letters do nothing while the person
 * types in a field or while a sheet is open (the sheet handles Escape itself).
 */
export function jobKeyAction(e: KeyInput): JobKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.sheetOpen) return null;
  if (e.key === 'Escape') return 'close';
  if (e.typing) return null;
  if (e.key === '/') return 'search';
  if (e.key === 'j') return 'next';
  if (e.key === 'k') return 'previous';
  return null;
}

/** True when the element takes text, so a letter key belongs to it. */
export function isTyping(el: { tagName: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  return el.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The job that j (next) or k (previous) selects. It stops at the ends. */
export function moveSelection(ids: readonly string[], current: string | null, dir: 'next' | 'previous'): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return ids[0];
  return ids[Math.max(0, Math.min(ids.length - 1, at + (dir === 'next' ? 1 : -1)))];
}
