'use client';

import { useId, type ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  className: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** Gets the props to spread on an input, a textarea or a select. */
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const base = useId();
  const id = `${base}-ctl`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-err`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, className: 'field', 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error && <p id={errorId} className="ui-field-err">{error}</p>}
      {hint && <p id={hintId} className="ui-field-hint">{hint}</p>}
    </div>
  );
}
