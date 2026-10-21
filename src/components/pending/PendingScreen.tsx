'use client';

import { ErrorNote } from '../ui';
import type { PendingData } from './sections';
import PendingSections from './PendingSections';
import { usePendingActions } from './usePendingActions';

interface Props {
  data?: PendingData;
  error?: Error;
  onRetry: () => void;
  refresh: () => Promise<unknown>;
  setToast: (s: string) => void;
  onJobs: () => void;
}

/** Pending. The title stays on screen while the sections load or fail. */
export default function PendingScreen({ data, error, onRetry, refresh, setToast, onJobs }: Props) {
  const actions = usePendingActions(refresh, setToast);
  return (
    <>
      <header className="screen-head">
        <h1 className="display">Pending</h1>
        <p className="sub">
          Waypoint cannot see your LinkedIn inbox. When someone replies, paste it here. Waypoint marks an answer safe to send only when it was already on file.
        </p>
      </header>
      {error && !data ? (
        <div className="pn-error">
          <ErrorNote live what="Waypoint could not load Pending." fix={`${error.message.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={onRetry} />
        </div>
      ) : (
        <PendingSections data={data} actions={actions} onJobs={onJobs} />
      )}
    </>
  );
}
