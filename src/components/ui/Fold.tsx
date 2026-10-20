'use client';

import { useId, useState, type ReactNode } from 'react';

export interface FoldProps {
  title: string;
  /** One line that tells the state without opening the panel. */
  status: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  /** Under 640 px the header calls this and does not unfold (the screen opens a full page). */
  onOpen?: () => void;
}

export function Fold({ title, status, children, defaultOpen = false, onOpen }: FoldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  function toggle() {
    if (onOpen && typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) {
      onOpen();
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <div className="glass ui-fold" data-open={open}>
      <button type="button" className="ui-fold-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="ui-fold-text">
          <span className="ui-fold-title">{title}</span>
          <span className="ui-fold-status">{status}</span>
        </span>
        <svg className="ui-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={bodyId} className="ui-fold-body" hidden={!open}>{children}</div>
    </div>
  );
}
