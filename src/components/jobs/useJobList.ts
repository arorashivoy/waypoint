'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobCard, Me } from '../data';
import { activeFilterCount, clearedFilters, defaultFilters, emptyCause, filterJobs, listLine, YOUR_LEVEL, type Filters } from './filters';
import { isTyping, jobKeyAction, moveSelection } from './keys';

interface Args {
  me: Me;
  jobs: JobCard[] | undefined;
  selected: string | null;
  openJob: (id: string) => void;
  closeJob: () => void;
}

/** The state of the list: search, filters, the rows that show, the open job and the keys. */
export function useJobList({ me, jobs, selected, openJob, closeJob }: Args) {
  const [q, setQ] = useState('');
  // Null means "the defaults", so they follow the levels of the profile until the user picks a filter.
  const [picked, setPicked] = useState<Filters | null>(null);
  const defaults = useMemo(() => defaultFilters(me.levels), [me.levels]);
  const filters = picked ?? defaults;
  const searchRef = useRef<HTMLInputElement>(null);
  // Set by j and k. The list scrolls to the new row only then, not on the first load.
  const scrollPending = useRef(false);

  const onCcs = useMemo(() => me.countries.filter((c) => c.on).map((c) => c.cc), [me.countries]);
  const all = useMemo(() => jobs ?? [], [jobs]);
  const shown = useMemo(() => filterJobs(all, filters, { onCcs, levels: me.levels, query: q }), [all, filters, onCcs, me.levels, q]);
  const cause = jobs
    ? emptyCause({ jobs: all, filters, levels: me.levels, onCcs, query: q, shown: shown.length })
    : null;

  const countryNames = me.countries.filter((c) => c.on).map((c) => c.name);
  const yourLevelOnly = filters.level === YOUR_LEVEL && me.levels.length > 0;
  const line = listLine(countryNames, shown.length, filters.sort, yourLevelOnly);

  // The open job comes from the URL, so a filter that hides it does not swap it for another job.
  const activeId = selected ?? shown[0]?.id ?? null;

  const change = useCallback((patch: Partial<Filters>) => setPicked({ ...(picked ?? defaults), ...patch }), [picked, defaults]);
  const clear = useCallback(() => setPicked({ ...clearedFilters, sort: (picked ?? defaults).sort }), [picked, defaults]);

  // The keys. A ref holds the latest values, so the listener binds one time.
  const live = useRef({ shown, activeId, selected, openJob, closeJob });
  live.current = { shown, activeId, selected, openJob, closeJob };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target as HTMLElement | null);
      const action = jobKeyAction({
        key: e.key,
        typing,
        sheetOpen: document.querySelector('[aria-modal="true"]') !== null,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      });
      if (!action) return;
      const now = live.current;
      if (action === 'search') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (action === 'close') {
        if (typing) (e.target as HTMLElement).blur();
        else if (now.selected && window.matchMedia('(max-width: 1023px)').matches) now.closeJob();
      } else {
        const next = moveSelection(now.shown.map((j) => j.id), now.activeId, action);
        if (!next) return;
        e.preventDefault();
        if (next !== now.activeId) {
          scrollPending.current = true;
          now.openJob(next);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return {
    q, setQ, searchRef, scrollPending,
    filters, defaults, change, clear,
    filterCount: activeFilterCount(filters, clearedFilters),
    all, shown, cause, line, activeId,
  };
}
