import { Badge } from '../ui';
import { NavIcon } from './icons';
import { NAV } from './nav';
import type { ShellProps } from './types';

/** Phone: the floating glass bar. CSS shows it under 640 px. */
export default function TabBar({ place, go, needsCount }: ShellProps) {
  return (
    <nav className="sh-tabbar" aria-label="Places">
      {NAV.map((n) => (
        <button key={n.key} type="button" className="sh-tab" aria-current={place === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
          <NavIcon place={n.key} />
          <span>{n.label}</span>
          {n.key === 'pending' && needsCount > 0 && (
            <span className="sh-tab-badge">
              <Badge tone="coral">{needsCount}</Badge>
              <span className="sr-only"> need you</span>
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
