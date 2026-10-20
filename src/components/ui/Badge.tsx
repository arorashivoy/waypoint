import type { ReactNode } from 'react';

export type Tone = 'coral' | 'mint' | 'lav' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}
