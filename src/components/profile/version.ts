'use client';

import { createContext, useContext } from 'react';
import type { ProfileData } from '../data';

/**
 * The profile version that the screen loaded. Each write sends it. If another
 * tab changed the profile since, the server answers 409. A form with edits shows
 * the message with a "Load the new version" button (`reload`) and keeps the edits
 * until the user acts. A write with no edits calls `onStale`, which loads the new version.
 */
export const ProfileVersionContext = createContext<{
  version: number;
  /** Loads the profile again. It gives the new data. */
  reload: () => Promise<ProfileData | undefined>;
  /** For a write that has no edits to keep: loads the profile again if the error is the stale error. */
  onStale: (error: unknown) => void;
}>({ version: 0, reload: async () => undefined, onStale: () => {} });

export const useProfileVersion = () => useContext(ProfileVersionContext);
