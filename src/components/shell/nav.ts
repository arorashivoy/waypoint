export type Place = 'jobs' | 'pending' | 'profile' | 'settings';

export interface NavItem {
  key: Place;
  label: string;
}

/** The 4 places of the app. Every nav (sidebar, rail, tab bar) reads this list. */
export const NAV: readonly NavItem[] = [
  { key: 'jobs', label: 'Jobs' },
  { key: 'pending', label: 'Pending' },
  { key: 'profile', label: 'Profile' },
  { key: 'settings', label: 'Settings' },
];

export interface Location {
  view: Place;
  /** The open job. Only the Jobs place has one. */
  job: string | null;
}

const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isPlace(value: string | null): value is Place {
  return NAV.some((n) => n.key === value);
}

/** Read the place and the open job from a query string. Unknown values give Jobs. */
export function readLocation(search: string): Location {
  const params = new URLSearchParams(search);
  const raw = params.get('view');
  const view: Place = isPlace(raw) ? raw : 'jobs';
  const job = params.get('job');
  return { view, job: view === 'jobs' && job && JOB_ID.test(job) ? job : null };
}

/** The query string for a location. Jobs without an open job has none. */
export function writeLocation({ view, job }: Location): string {
  const params = new URLSearchParams();
  if (view !== 'jobs') params.set('view', view);
  else if (job) params.set('job', job);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * What a tap on a nav item does. The same place does nothing, so Back does not
 * step through copies of one place. Jobs with a job open closes the job.
 */
export function navAction(current: Location, target: Place): 'none' | 'close-job' | 'push' {
  if (target === current.view) return target === 'jobs' && current.job ? 'close-job' : 'none';
  return 'push';
}
