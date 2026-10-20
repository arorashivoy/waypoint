import { TaskIndicator } from '../ui';
import { BrandMark, ChevronIcon } from './icons';

/** Phone: the strip at the top. It holds "‹ Jobs" while a job is open, and the task pill. */
export default function TopBar({ task, jobOpen, onBack }: { task: string | null; jobOpen: boolean; onBack: () => void }) {
  return (
    <header className="sh-topbar">
      {jobOpen ? (
        <button type="button" className="sh-back" onClick={onBack}>
          <ChevronIcon dir="left" />
          Jobs
        </button>
      ) : (
        <div className="sh-topbar-brand">
          <BrandMark />
          <span>Waypoint</span>
        </div>
      )}
      {task && (
        <span className="sh-pill">
          <TaskIndicator text={task} />
        </span>
      )}
    </header>
  );
}
