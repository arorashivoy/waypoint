'use client';

import { useEffect } from 'react';

export const TOAST_MS = 4000;

export interface ToastProps {
  /** The confirmation to show. Null hides the toast. */
  message: string | null;
  /** Called after 4 seconds. The owner sets the message to null. */
  onHide: () => void;
}

/** One polite live region. It only repeats a confirmation that the action already gave. */
export function Toast({ message, onHide }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onHide, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, onHide]);
  return (
    <div className="ui-toast-region" role="status" aria-live="polite">
      {message && <div className="ui-toast">{message}</div>}
    </div>
  );
}
