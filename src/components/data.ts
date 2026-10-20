'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import useSWR, { useSWRConfig, type SWRConfiguration, type SWRResponse } from 'swr';
import type { ClaimsDoc } from '@/lib/profile/doc';
import type { buildJobs, buildMe, buildPending, buildProfileView } from '@/lib/state';
import { ago, daysSince, shortAgo } from '@/lib/time-ago';
import { api } from './api';

/**
 * The data of the screens, one SWR hook for each route.
 *
 * - A request is aborted when the last screen that uses its key unmounts.
 *   SWR does not do this by itself. The abort shows in the cache as an error
 *   with the name AbortError. The hooks hide that error, and the next mount
 *   loads the key again.
 * - A failed request is not repeated at once. Each screen shows its own Retry.
 * - A screen loads again when the window gets focus.
 */

export type Me = Awaited<ReturnType<typeof buildMe>>;
export type JobCard = Awaited<ReturnType<typeof buildJobs>>['jobs'][number] & { posted: string; days: number };
export type Pending = Awaited<ReturnType<typeof buildPending>>;
export type ProfileView = Awaited<ReturnType<typeof buildProfileView>>;
export type ProfileData = { doc: ClaimsDoc; warnings: string[]; version: number; pendingDrafts: number; view: ProfileView };

export const KEYS = {
  me: '/api/me',
  jobs: '/api/jobs/list',
  pending: '/api/pending',
  profile: '/api/profile',
} as const;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** The requests in flight, by key, and how many mounted hooks use each key. */
const watched = new Map<string, { users: number; controller: AbortController | null }>();
const watchOf = (key: string) => {
  let w = watched.get(key);
  if (!w) watched.set(key, (w = { users: 0, controller: null }));
  return w;
};

function useData<T>(key: string | null, config: SWRConfiguration<T> = {}): SWRResponse<T> {
  useEffect(() => {
    if (!key) return;
    const w = watchOf(key);
    w.users += 1;
    return () => {
      w.users -= 1;
      // A short delay: React in development unmounts and mounts a screen at once, and that must not abort its request.
      setTimeout(() => {
        if (w.users > 0) return;
        w.controller?.abort();
        w.controller = null;
      }, 50);
    };
  }, [key]);

  const res = useSWR<T>(
    key,
    (url: string) => {
      const controller = new AbortController();
      watchOf(url).controller = controller;
      return api<T>(url, { signal: controller.signal });
    },
    { shouldRetryOnError: false, revalidateOnFocus: true, ...config },
  );
  // An abort that reaches a mounted screen (a quick unmount and mount) is not an error: load the key again.
  const aborted = isAbort(res.error);
  const { mutate } = res;
  useEffect(() => {
    if (aborted && key) mutate();
  }, [aborted, key, mutate]);
  return { ...res, error: aborted ? undefined : res.error } as SWRResponse<T>;
}

/** The shell data. It loads again every 4 s while Claude reads jobs, and not at all otherwise. */
export function useMe() {
  return useData<Me>(KEYS.me, { refreshInterval: (me) => (me?.analysing?.running ? 4000 : 0) });
}

/** The job cards. The scores change while Claude reads jobs, so they follow the same clock as useMe. */
export function useJobs() {
  const running = useMe().data?.analysing?.running;
  const res = useData<{ jobs: Omit<JobCard, 'posted' | 'days'>[] }>(KEYS.jobs, { refreshInterval: running ? 4000 : 0 });
  // The 2 polls run on their own clocks. When the check ends, load the list one more time, so no card keeps an estimate.
  const wasRunning = useRef(false);
  const { mutate } = res;
  useEffect(() => {
    if (wasRunning.current && !running) mutate();
    wasRunning.current = !!running;
  }, [running, mutate]);
  const data = useMemo(
    () => res.data && { jobs: res.data.jobs.map((j) => ({ ...j, posted: ago(j.postedAt), days: daysSince(j.postedAt) })) as JobCard[] },
    [res.data],
  );
  return { ...res, data };
}

export function usePending() {
  const res = useData<Pending>(KEYS.pending);
  const data = res.data && {
    ...res.data,
    needs: res.data.needs.map((n) => ({ ...n, when: shortAgo(n.createdAt) })),
    awaiting: res.data.awaiting.map((a) => ({ ...a, when: `Sent ${ago(a.sentAt)}` })),
    appliedList: res.data.appliedList.map((p) => ({ ...p, cvSent: p.cvSentAt ? shortAgo(p.cvSentAt) : null })),
  };
  return { ...res, data };
}

export function useProfile() {
  return useData<ProfileData>(KEYS.profile);
}

export type SessionRow = { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string };
export type ClaudeStatus = { mode: 'own' | 'shared' | 'cli' | 'none'; detail: string; keyHint: string | null; sharedAvailable: boolean; capUsd: number; sharedSpentUsd: number; capReached: boolean; resetsAt: string; cliOff?: boolean };
export type FailedBoard = { board: string; status: string; fetchedAt: string; error: string | null };
export type SearchSettings = { fields: string[]; visaStatus: string; fieldChoices: string[] };
export type UserRow = { id: string; email: string; name: string; role: string; disabled: boolean; createdAt: string; lastSeenAt: string | null; sharedSpentUsd: number };

const SETTINGS = {
  sessions: '/api/account/sessions',
  claude: '/api/account/claude',
  github: '/api/account/github',
  feeds: '/api/feeds',
  search: '/api/settings/search',
  users: '/api/admin/users',
} as const;

/**
 * The Settings sections, each with its own request. One failed request (the
 * job boards, for example) shows an error in its own section only. The other
 * sections still render. `reload` loads every section again.
 */
export function useSettings(isAdmin: boolean) {
  const { mutate } = useSWRConfig();
  const sessions = useData<{ sessions: SessionRow[] }>(SETTINGS.sessions);
  const claude = useData<ClaudeStatus>(SETTINGS.claude);
  const github = useData<{ hint: string | null }>(SETTINGS.github);
  const feeds = useData<FailedBoard[]>(SETTINGS.feeds);
  const search = useData<SearchSettings>(SETTINGS.search);
  const users = useData<{ users: UserRow[] }>(isAdmin ? SETTINGS.users : null);
  const reload = useCallback(async () => {
    await Promise.all(Object.values(SETTINGS).map((key) => mutate(key)));
  }, [mutate]);
  return { sessions, claude, github, feeds, search, users, reload };
}

/** Loads the data of every screen again. Call it after a change that moves scores, lists or counts. */
export function useRefresh() {
  const { mutate } = useSWRConfig();
  return useCallback(async () => {
    await Promise.all(Object.values(KEYS).map((key) => mutate(key)));
  }, [mutate]);
}
