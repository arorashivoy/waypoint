import { ErrorNote, Skeleton } from '../ui';
import { BrandMark } from './icons';

/** Full-screen state while the first state loads, or when it failed to load. */
export default function Loading({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <main className="sh-loading">
      <div className="sh-brand">
        <BrandMark />
        <span className="sh-brand-name">Waypoint</span>
      </div>
      {error ? (
        <ErrorNote live what="Waypoint could not load your data." fix={`${error} Check your connection, then try again.`} onRetry={onRetry} />
      ) : (
        <Skeleton rows={4} />
      )}
    </main>
  );
}
