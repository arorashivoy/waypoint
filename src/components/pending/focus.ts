import type { SectionKey } from './sections';

/** The part of the DOM that focus needs. A test passes a small fake. */
export interface FocusDoc {
  activeElement: { closest?: (selector: string) => { getAttribute: (name: string) => string | null } | null; isConnected?: boolean } | null;
  body: unknown;
  getElementById: (id: string) => { focus: () => void } | null;
}

/** The section that holds the focused element, or null. */
export function focusedSection(doc: FocusDoc): SectionKey | null {
  const el = doc.activeElement;
  if (!el || el === doc.body || !el.closest) return null;
  return (el.closest('[data-section]')?.getAttribute('data-section') as SectionKey | null) ?? null;
}

/**
 * After an action, the item that held the focus can leave the page. Then the focus would fall to the page top.
 * This moves it to the heading of the section the item was in. It does nothing when the focus is still on a live element.
 */
export function keepFocus(doc: FocusDoc, section: SectionKey | null): void {
  if (!section) return;
  const el = doc.activeElement;
  if (el && el !== doc.body && el.isConnected !== false) return;
  doc.getElementById(`pn-${section}`)?.focus();
}
