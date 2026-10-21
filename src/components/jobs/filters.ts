import { FILTER_GROUPS, POSTED_WINDOWS } from '@/lib/countries';

/** The part of a job card that the list reads. A JobCard fits this type. */
export interface ListJob {
  id: string;
  role: string;
  company: string;
  city: string;
  cc: string;
  mode: string;
  field: string;
  level: string;
  sponsor: boolean;
  priority: boolean;
  postedAt: string;
  days: number;
  match: number;
  /** Plain words for the first blocker of the posting, or null. */
  blocker: string | null;
  /** How many contacts can refer the user, and the name of the best one. */
  referrers: number;
  referrer: string | null;
}

export type Sort = 'match' | 'date';

export interface Filters {
  field: string;
  mode: string;
  level: string;
  posted: string;
  sponsorOnly: boolean;
  topOnly: boolean;
  sort: Sort;
}

/** The level option that stands for the levels in the profile. */
export const YOUR_LEVEL = 'Your level';

/**
 * Defaults to the last 7 days: an advert older than that is usually filled, and
 * a referral request against a filled role wastes a connection. The level is the
 * profile's own when the profile has one. Without a level the filter has nothing
 * to compare with, so it starts as Any.
 */
export function defaultFilters(levels: readonly string[]): Filters {
  return { field: 'All', mode: 'Any', level: levels.length ? YOUR_LEVEL : 'Any', posted: 'This week', sponsorOnly: false, topOnly: false, sort: 'match' };
}

/** No filter at all. The sort stays as the user set it. */
export const clearedFilters: Filters = { field: 'All', mode: 'Any', level: 'Any', posted: 'Any time', sponsorOnly: false, topOnly: false, sort: 'match' };

/** The groups of the filter sheet. "From LinkedIn" is now "Your level". */
export const FILTER_OPTIONS = FILTER_GROUPS.map((g) => ({
  key: g.key as 'field' | 'mode' | 'level' | 'posted',
  label: g.label,
  options: g.options.map((o) => (o === 'From LinkedIn' ? YOUR_LEVEL : o)) as string[],
}));

export interface ListContext {
  /** The country codes that are on. */
  onCcs: readonly string[];
  /** The levels of the profile. */
  levels: readonly string[];
  query: string;
}

type Key = 'field' | 'mode' | 'level' | 'posted' | 'sponsor' | 'top';

/** Each filter as one test, so that "what hides most" can try them one by one. */
const TESTS: Record<Key, (j: ListJob, f: Filters, levels: readonly string[]) => boolean> = {
  field: (j, f) => f.field === 'All' || j.field === f.field,
  mode: (j, f) => f.mode === 'Any' || j.mode === f.mode,
  level: (j, f, levels) => {
    if (f.level === 'Any') return true;
    if (f.level === YOUR_LEVEL) return levels.length === 0 || levels.includes(j.level);
    return j.level === f.level;
  },
  posted: (j, f) => j.days <= (POSTED_WINDOWS[f.posted] ?? Infinity),
  sponsor: (j, f) => !f.sponsorOnly || j.sponsor,
  top: (j, f) => !f.topOnly || j.priority,
};
const KEYS = Object.keys(TESTS) as Key[];

const matchesQuery = (j: ListJob, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || `${j.role} ${j.company} ${j.city}`.toLowerCase().includes(q);
};

/** The jobs that the list shows. "match" keeps the order from the server, which ranks by fit. */
export function filterJobs<T extends ListJob>(jobs: readonly T[], f: Filters, ctx: ListContext): T[] {
  const on = new Set(ctx.onCcs);
  const out = jobs.filter((j) => on.has(j.cc) && KEYS.every((k) => TESTS[k](j, f, ctx.levels)) && matchesQuery(j, ctx.query));
  return f.sort === 'date' ? out.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt)) : out;
}

/** How many filters differ from `base`. The list compares with the cleared filters. The sort does not count. */
export function activeFilterCount(f: Filters, base: Filters): number {
  return (['field', 'mode', 'level', 'posted'] as const).filter((k) => f[k] !== base[k]).length + Number(f.sponsorOnly !== base.sponsorOnly) + Number(f.topOnly !== base.topOnly);
}

const and = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''));

const POSTED_TEXT: Record<string, string> = { 'This week': 'this week', 'Last 2 weeks': 'the last 2 weeks', 'Last 30 days': 'the last 30 days' };

function culpritText(key: Key, f: Filters, levels: readonly string[]): string {
  switch (key) {
    case 'field': return `The field filter shows only ${f.field}.`;
    case 'mode': return `The work mode filter shows only ${f.mode}.`;
    case 'level': return `The level filter shows only ${f.level === YOUR_LEVEL ? and(levels) : f.level}.`;
    case 'posted': return `The posted filter shows only jobs from ${POSTED_TEXT[f.posted] ?? f.posted}.`;
    case 'sponsor': return 'The visa filter shows only jobs that sponsor a visa.';
    case 'top': return 'The top companies filter shows only top companies.';
  }
}

export type EmptyCause =
  | { kind: 'no-country' }
  | { kind: 'none-fetched' }
  | { kind: 'filters'; total: number; culprit: { key: Key; text: string } | null }
  | { kind: 'search'; query: string };

/** Why the list has no row, or null when it has one. The causes come in this order. */
export function emptyCause(a: { jobs: readonly ListJob[]; filters: Filters; levels: readonly string[]; onCcs: readonly string[]; query: string; shown: number }): EmptyCause | null {
  if (a.shown > 0) return null;
  if (a.onCcs.length === 0) return { kind: 'no-country' };
  const inCountries = a.jobs.filter((j) => a.onCcs.includes(j.cc));
  if (inCountries.length === 0) return { kind: 'none-fetched' };
  const left = inCountries.filter((j) => KEYS.every((k) => TESTS[k](j, a.filters, a.levels)));
  if (left.length === 0) {
    let culprit: { key: Key; text: string } | null = null;
    let most = 0;
    for (const key of KEYS) {
      const hidden = inCountries.filter((j) => !TESTS[key](j, a.filters, a.levels)).length;
      if (hidden > most) {
        most = hidden;
        culprit = { key, text: culpritText(key, a.filters, a.levels) };
      }
    }
    return { kind: 'filters', total: inCountries.length, culprit };
  }
  return { kind: 'search', query: a.query.trim() };
}

const THE = new Set(['Netherlands', 'Philippines', 'United Kingdom', 'United States']);
const named = (name: string) => (THE.has(name) ? `the ${name}` : name);

/** One plain line that says what the list shows. */
export function listLine(countries: readonly string[], count: number, sort: Sort, yourLevel = false): string {
  if (countries.length === 0) return 'No country is on.';
  const rest = countries.length - 2;
  const places = countries.length <= 2 ? and(countries.map(named)) : `${countries.slice(0, 2).map(named).join(', ')} and ${rest} more ${rest === 1 ? 'country' : 'countries'}`;
  const line = `${count} ${count === 1 ? 'job' : 'jobs'} in ${places}, ${sort === 'match' ? 'best match first' : 'newest first'}`;
  return yourLevel ? `${line}. Shows jobs at your level.` : line;
}

export type RowLine = { kind: 'referral' | 'blocker'; text: string };

/** The 4th line of a row: a blocker, else a referral, else none. */
export function rowLine(j: Pick<ListJob, 'blocker' | 'referrers' | 'referrer'>): RowLine | null {
  if (j.blocker) return { kind: 'blocker', text: j.blocker };
  if (j.referrers > 1) return { kind: 'referral', text: `${j.referrers} contacts can refer you` };
  if (j.referrers === 1 && j.referrer) return { kind: 'referral', text: `${j.referrer} can refer you` };
  return null;
}

/** The text a screen reader reads for a row. */
export function rowLabel(j: ListJob & { provisional?: boolean }): string {
  const line = rowLine(j);
  return `${j.role} at ${j.company}, ${j.city}. Match ${j.match}.${j.provisional ? ' This is an estimate.' : ''}${line ? ` ${line.text}.` : ''}`;
}
