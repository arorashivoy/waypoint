import { Badge, TaskIndicator } from '../ui';
import { BrandMark, ChevronIcon, NavIcon } from './icons';
import { NAV } from './nav';
import type { ShellProps } from './types';

/** Desktop: the glass sidebar. */
export default function Sidebar({ place, go, needsCount, task, user, claudeLine, onCollapse }: ShellProps & { user: { name: string; initials: string }; claudeLine: string; onCollapse: () => void }) {
  return (
    <aside className="sh-sidebar" aria-label="Waypoint">
      <div className="sh-brand">
        <BrandMark />
        <span className="sh-brand-name">Waypoint</span>
        <button type="button" className="sh-collapse" onClick={onCollapse} aria-label="Close the sidebar">
          <ChevronIcon dir="left" />
        </button>
      </div>

      <nav className="sh-nav" aria-label="Places">
        {NAV.map((n) => (
          <button key={n.key} type="button" className="sh-nav-item" aria-current={place === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
            <NavIcon place={n.key} />
            <span className="grow">{n.label}</span>
            {n.key === 'pending' && needsCount > 0 && (
              <>
                <Badge tone="coral">{needsCount}</Badge>
                <span className="sr-only"> need you</span>
              </>
            )}
          </button>
        ))}
      </nav>

      {task && (
        <div className="sh-work">
          <TaskIndicator text={task} />
        </div>
      )}

      <div className="sh-user">
        <span className="avatar" aria-hidden="true">{user.initials}</span>
        <div className="stack sh-user-text">
          <span className="sh-user-name">{user.name}</span>
          <span className="sh-user-claude">{claudeLine}</span>
        </div>
      </div>
    </aside>
  );
}
