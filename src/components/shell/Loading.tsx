import { Skeleton } from '../ui';
import { BrandMark } from './icons';

/** Full-screen state while the first state loads. */
export default function Loading() {
  return (
    <main className="sh-loading">
      <div className="sh-brand">
        <BrandMark />
        <span className="sh-brand-name">Waypoint</span>
      </div>
      <Skeleton rows={4} />
    </main>
  );
}
