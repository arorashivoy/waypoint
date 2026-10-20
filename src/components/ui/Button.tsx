'use client';

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';

export type ButtonVariant = 'go' | 'plain' | 'link';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: ButtonVariant;
  /** Shows a small spinner and sets aria-busy. The button does not fire while busy. */
  busy?: boolean;
  /** Text to show for 2 seconds after an async onClick resolves, for example "Copied". */
  confirm?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
}

const CONFIRM_MS = 2000;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'plain', busy = false, confirm, onClick, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handle(event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const result = onClick?.(event);
    if (confirm && result && typeof (result as Promise<unknown>).then === 'function') {
      try {
        await result;
      } catch {
        return;
      }
      setConfirmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirmed(false), CONFIRM_MS);
    }
  }

  const cls = ['btn', 'ui-btn', variant === 'plain' ? '' : variant, className].filter(Boolean).join(' ');
  return (
    <>
      <button {...rest} ref={ref} type={type} className={cls} disabled={disabled} aria-busy={busy || undefined} onClick={handle}>
        {busy && <span className="ui-spin" aria-hidden="true" />}
        {confirm ? (
          // Both texts share one cell, so the button keeps its width when the text swaps.
          <span className="ui-btn-swap">
            <span data-on={!confirmed} aria-hidden={confirmed}>{children}</span>
            <span data-on={confirmed} aria-hidden={!confirmed}>{confirm}</span>
          </span>
        ) : (
          children
        )}
      </button>
      {confirm && <span className="sr-only" role="status" aria-live="polite">{confirmed ? confirm : ''}</span>}
    </>
  );
});
