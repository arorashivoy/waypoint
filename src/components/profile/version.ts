'use client';

import { createContext, useContext, useMemo, useRef } from 'react';
import type { KeyedMutator } from 'swr';
import { STALE_PROFILE_MESSAGE } from '@/lib/profile/stale';
import { ApiError } from '../api';
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

/** The value for the context, from the profile data and its `mutate`. The Profile screen and the onboarding wizard use it. */
export function useProfileVersionValue(data: ProfileData | undefined, mutate: KeyedMutator<ProfileData>) {
  return useMemo(
    () => ({
      version: data?.version ?? 0,
      reload: async () => (await mutate()) as ProfileData | undefined,
      onStale: (e: unknown) => {
        if (e instanceof ApiError && e.status === 409 && e.message === STALE_PROFILE_MESSAGE) mutate();
      },
    }),
    [data?.version, mutate],
  );
}

/**
 * The version that a form sends. It is the version from the moment the user started the edit, not the latest
 * one: when another tab saves and this tab loads the new profile, the form must still get the 409.
 * A form with no edits has no base and follows the latest version.
 */
export const editVersion = (base: number | null, latest: number): number => base ?? latest;

/** The base after an edit starts. The first edit sets it. Later edits keep it. */
export const startEdit = (base: number | null, latest: number): number => base ?? latest;

/**
 * For a form that keeps edits. `begin` goes in every change handler. `send` gives the version for a write.
 * `rebase(v)` sets a new base (after "Load the new version" with the edits kept); `rebase(null)` ends the edit.
 * `startNow` takes the base when the form opens, for a form that copies its values from the profile once.
 */
export function useEditVersion(startNow = false) {
  const { version, reload } = useProfileVersion();
  const base = useRef<number | null>(startNow ? version : null);
  return {
    version: editVersion(base.current, version),
    reload,
    begin: () => {
      base.current = startEdit(base.current, version);
    },
    rebase: (v: number | null) => {
      base.current = v;
    },
  };
}
