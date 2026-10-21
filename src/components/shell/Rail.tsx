import { Badge, TaskIndicator } from '../ui';
import { BrandMark, ChevronIcon, NavIcon } from './icons';
import { NAV } from './nav';
import type { ShellProps } from './types';

/** Tablet: icons with a short label. On a desktop it shows when the sidebar is collapsed. */
export default function Rail({ place, go, needsCount, task, initials, onExpand }: ShellProps & { initials: string; onExpand: () => void }) {
  return (
    <aside className="sh-rail" aria-label="Waypoint">
      <div className="sh-rail-brand">
        <BrandMark />
        <span className="sr-only">Waypoint</span>
      </div>
      <nav className="sh-rail-nav" aria-label="Places">
        {NAV.map((n) => (
          <button key={n.key} type="button" className="sh-rail-item" aria-current={place === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
            <NavIcon place={n.key} />
            <span>{n.label}</span>
            {n.key === 'pending' && needsCount > 0 && (
              <span className="sh-rail-badge">
                <Badge tone="coral">{needsCount}</Badge>
                <span className="sr-only"> need you</span>
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="sh-rail-foot">
        {task && <span className="sh-rail-task"><TaskIndicator text={task} silent /></span>}
        <button type="button" className="sh-collapse sh-expand" onClick={onExpand} aria-label="Open the sidebar">
          <ChevronIcon dir="right" />
        </button>
        <span className="avatar" aria-hidden="true">{initials}</span>
      </div>
    </aside>
  );
}
