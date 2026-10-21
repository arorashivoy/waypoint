'use client';

import type { ButtonHTMLAttributes } from 'react';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked' | 'aria-label'> {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name. It names the thing and never the state, for example "Search in Germany". */
  label: string;
  /** The words next to the track. The default is On and Off. */
  onText?: string;
  offText?: string;
}

/** An on/off setting. The state shows as a word and as a track with a thumb. */
export function Switch({ checked, onChange, label, onText = 'On', offText = 'Off', className, type = 'button', ...rest }: SwitchProps) {
  return (
    <button {...rest} type={type} role="switch" aria-checked={checked} aria-label={label} className={['ui-switch', className].filter(Boolean).join(' ')} onClick={() => onChange(!checked)}>
      <span className="ui-switch-track" aria-hidden="true"><span className="ui-switch-thumb" /></span>
      <span className="ui-switch-text" aria-hidden="true">{checked ? onText : offText}</span>
    </button>
  );
}
