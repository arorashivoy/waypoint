import type { Place } from './nav';

/** What the 3 navs and the top bar need. Waypoint builds it once. */
export interface ShellProps {
  place: Place;
  go: (place: Place) => void;
  needsCount: number;
  /** "Checking 12 jobs", or null when nothing runs. */
  task: string | null;
}
