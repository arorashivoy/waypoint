'use client';

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Index to focus after Tab (or Shift+Tab) inside the sheet. Wraps at both ends. */
export function trapIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

export interface FocusState {
  hiddenAncestor: boolean;
  inertAncestor: boolean;
  disabled: boolean;
  display: string;
  visibility: string;
}

/** True when a control can take focus now. Hidden, inert, disabled and display:none controls cannot. */
export function isFocusableState(s: FocusState): boolean {
  return !s.hiddenAncestor && !s.inertAncestor && !s.disabled && s.display !== 'none' && s.visibility !== 'hidden' && s.visibility !== 'collapse';
}

function focusState(el: HTMLElement): FocusState {
  const style = getComputedStyle(el);
  return {
    hiddenAncestor: el.closest('[hidden]') !== null,
    inertAncestor: el.closest('[inert]') !== null,
    disabled: (el as HTMLButtonElement).disabled === true,
    display: style.display,
    visibility: style.visibility,
  };
}

/** The controls inside a root that can take focus now, in document order. */
export function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => isFocusableState(focusState(el)));
}

export type SheetKeyAction = { type: 'close' } | { type: 'focus'; index: number } | { type: 'none' };

/** What a key does inside the open sheet. `index` is the focused item, or -1 when focus is outside the list. */
export function sheetKeyAction(key: string, shift: boolean, count: number, index: number): SheetKeyAction {
  if (key === 'Escape') return { type: 'close' };
  if (key !== 'Tab') return { type: 'none' };
  // With no control to focus, the trap keeps focus on the panel (index -1).
  if (count === 0) return { type: 'focus', index: -1 };
  const next = trapIndex(count, index, shift);
  const wraps = index < 0 || (shift ? next === count - 1 : next === 0);
  return wraps ? { type: 'focus', index: next } : { type: 'none' };
}

/** The element that gets focus back: the opener from the screen, else the last pointer target, else the active element. */
export function pickOpener<T extends { isConnected: boolean }>(prop: T | null | undefined, pointer: T | null, active: T | null): T | null {
  for (const el of [prop, pointer, active]) if (el && el.isConnected) return el;
  return null;
}

/* WebKit does not focus a button on click, so activeElement is body there. Record the last pointer target. */
let lastPointer: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('button, a[href], [tabindex]') : null;
      lastPointer = t;
    },
    true,
  );
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The element that opened the sheet. Focus goes back to it on close. */
  opener?: RefObject<HTMLElement | null> | HTMLElement | null;
  children?: ReactNode;
}

export function Sheet({ open, onClose, title, opener, children }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openerRef = useRef(opener);
  openerRef.current = opener;

  useEffect(() => {
    if (!open) return;
    const prop = openerRef.current && 'current' in openerRef.current ? openerRef.current.current : (openerRef.current as HTMLElement | null | undefined);
    const pointer = lastPointer && !panel.current?.contains(lastPointer) ? lastPointer : null;
    const back = pickOpener<HTMLElement>(prop, pointer, document.activeElement as HTMLElement | null);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? (panel.current ? visibleFocusables(panel.current)[0] : undefined);
    (first ?? panel.current)?.focus();

    // Focus never leaves the open sheet, and Esc works even when focus is not inside it.
    const onFocusIn = (e: FocusEvent) => {
      if (panel.current && e.target instanceof Node && !panel.current.contains(e.target)) {
        (visibleFocusables(panel.current)[0] ?? panel.current).focus();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      back?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !panel.current) return;
    const items = visibleFocusables(panel.current);
    const action = sheetKeyAction(event.key, event.shiftKey, items.length, items.indexOf(document.activeElement as HTMLElement));
    if (action.type !== 'focus') return;
    event.preventDefault();
    (action.index >= 0 ? items[action.index] : panel.current).focus();
  }

  return (
    <div className="ui-sheet" onKeyDown={onKeyDown}>
      <div className="ui-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="glass ui-sheet-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="ui-sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn link" onClick={onClose}>Close</button>
        </div>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>
  );
}
