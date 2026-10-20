import { Button } from '../ui';

/** The sticky bar at the bottom: mark the job as applied. On a wide screen it also links to the posting. */
export function ApplyBar({ url, applied, onApply }: { url: string; applied: boolean; onApply: () => Promise<void> }) {
  return (
    <div className="jd-bar">
      <a className="btn jd-bar-open" href={url} target="_blank" rel="noopener noreferrer">Open the posting</a>
      {/* The confirm text shows after the state flips, so it names the new state. */}
      <Button variant={applied ? 'plain' : 'go'} confirm={applied ? 'Marked as applied' : 'Marked as not applied'} onClick={onApply}>
        {applied ? 'Undo applied' : 'Mark as applied'}
      </Button>
    </div>
  );
}
