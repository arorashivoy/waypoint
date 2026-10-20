'use client';

import { useEffect, useRef } from 'react';

export const TOAST_MS = 4000;

/** Starts the hide timer. It reads the handler when the time ends, so a new handler does not restart it. Returns the cancel function. */
export function scheduleHide(handler: { current: () => void }, ms: number = TOAST_MS): () => void {
  const timer = setTimeout(() => handler.current(), ms);
  return () => clearTimeout(timer);
}

export interface ToastProps {
  /** The confirmation to show. Null hides the toast. */
  message: string | null;
  /** Called after 4 seconds. The owner sets the message to null. */
  onHide: () => void;
  /** Change this number to show the same message again: the timer restarts. */
  nonce?: number;
}

/** One polite live region. It only repeats a confirmation that the action already gave. */
export function Toast({ message, onHide, nonce }: ToastProps) {
  const handler = useRef(onHide);
  handler.current = onHide;
  useEffect(() => {
    if (!message) return;
    return scheduleHide(handler);
  }, [message, nonce]);
  return (
    <div className="ui-toast-region" role="status" aria-live="polite">
      {message && <div key={nonce} className="ui-toast">{message}</div>}
    </div>
  );
}
