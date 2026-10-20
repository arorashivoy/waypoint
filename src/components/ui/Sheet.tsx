'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Index to focus after Tab (or Shift+Tab) inside the sheet. Wraps at both ends. */
export function trapIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const next = trapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    const atEdge = event.shiftKey ? next === items.length - 1 : next === 0;
    if (atEdge || !panel.current.contains(document.activeElement)) {
      event.preventDefault();
      items[next].focus();
    }
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
