/**
 * The plain logic of the Profile screen, with no React, so the tests run it.
 * The tab names, the tab in the URL, the plurals, the names of buttons and the labels of draft facts.
 */

export const PROFILE_TABS = [
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'claims', label: 'Claims' },
  { id: 'imports', label: 'Imports' },
  { id: 'resume', label: 'Résumé' },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]['id'];

export const DEFAULT_TAB: ProfileTab = 'experience';

const isTab = (value: string | null): value is ProfileTab => PROFILE_TABS.some((t) => t.id === value);

/** The tab that a query string names. An unknown or missing name gives the first tab. */
export function readTab(search: string): ProfileTab {
  const raw = new URLSearchParams(search).get('tab');
  return isTab(raw) ? raw : DEFAULT_TAB;
}

/** The query string of the Profile place with a tab. The first tab has no `tab` part. */
export function tabQuery(tab: ProfileTab): string {
  return tab === DEFAULT_TAB ? '?view=profile' : `?view=profile&tab=${tab}`;
}

/** "1 item", "2 items". */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The accessible name of an action on one thing: "Remove Kestrel Pay". */
export function actionName(verb: string, name: string): string {
  return `${verb} ${name}`.trim();
}

/** What a claim search says when nothing matches. */
export function emptySearchText(query: string, noun = 'claim'): string {
  return `No ${noun} matches “${query.trim()}”.`;
}

/** The `accept` value of each file input. */
export const FILE_ACCEPT = {
  resume: '.pdf,.tex',
  linkedin: '.zip,.csv',
  yaml: '.yml,.yaml',
  ownTex: '.tex',
} as const;

/** Every key that a draft can hold, with the words that the user reads. */
export const FACT_LABELS: Record<string, string> = {
  id: 'ID',
  slug: 'ID',
  name: 'Name',
  headline: 'Headline',
  title: 'Title',
  company: 'Company',
  location: 'Location',
  start: 'Start',
  end: 'End',
  summary: 'Summary',
  bullets: 'Bullets',
  school: 'School',
  degree: 'Degree',
  field: 'Field',
  years: 'Years',
  aliases: 'Other names',
  org: 'Organisation',
  description: 'Description',
  url: 'Link',
  tex: 'LaTeX entry',
  source: 'Source',
  repoUrl: 'Repository',
  label: 'Label',
  kind: 'Kind',
  links: 'Related claims',
  evidence: 'Evidence',
  mentions: 'Seen in',
  value: 'Value',
  scaleMax: 'Highest possible value',
  higherIsBetter: 'A higher value is better',
};

/** The label of a key. A key that is not in the map gets its words split and written in sentence case. */
export function factLabel(key: string): string {
  const known = FACT_LABELS[key];
  if (known) return known;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** One value of a draft as text. A list shows its entries. A flag shows Yes or No. */
export function factText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((x) => (x && typeof x === 'object' ? factText((x as Record<string, unknown>).text ?? (x as Record<string, unknown>).match ?? (x as Record<string, unknown>).target ?? (x as Record<string, unknown>).surface ?? (x as Record<string, unknown>).to ?? JSON.stringify(x)) : String(x)))
      .join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** The facts of a draft that have a value, as label and text. */
export function factRows(value: unknown): { key: string; label: string; text: string }[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([key, v]) => ({ key, label: factLabel(key), text: factText(v) }));
}

/** What the claim list says when it has nothing to show: no claims at all, or no claim for the search. */
export function claimEmpty(total: number, query: string): { cause: string; search: boolean } {
  return query.trim() && total > 0 ? { cause: emptySearchText(query), search: true } : { cause: 'No claims yet.', search: false };
}

/** A draft as far as the accept rules care. */
export type DraftState = { id: string; warnings: string[]; warningsApproved: boolean };

/** A draft with a warning that the user has not checked. It never goes into an accept. */
export const isBlocked = (d: DraftState) => d.warnings.length > 0 && !d.warningsApproved;

/** The IDs that a bulk accept may send: no draft with an unchecked warning. */
export const readyIds = (list: DraftState[]): string[] => list.filter((d) => !isBlocked(d)).map((d) => d.id);

/** A batch shows this many drafts first. */
export const BATCH_PAGE = 10;

/** One run at a time. A second call while the first runs does nothing. It reads a plain flag, so two quick clicks cannot both start. */
export function makeGuard() {
  let running = false;
  return {
    busy: () => running,
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (running) return undefined;
      running = true;
      try {
        return await fn();
      } finally {
        running = false;
      }
    },
  };
}

/** Titles that are unique: the second "Route planner" becomes "Route planner (2)". For the names of buttons. */
export function uniqueNames(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((t) => {
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return n === 1 ? t : `${t} (${n})`;
  });
}

/** What a draft that merges into an item changes: the fields that differ, and the names of those that stay. */
export function mergeRows(existing: unknown, data: unknown): { changed: { key: string; label: string; now: string; draft: string }[]; same: string[] } {
  const now = new Map(factRows(existing).map((r) => [r.key, r]));
  const draft = new Map(factRows(data).map((r) => [r.key, r]));
  const keys = [...new Set([...draft.keys(), ...now.keys()])];
  const changed: { key: string; label: string; now: string; draft: string }[] = [];
  const same: string[] = [];
  for (const key of keys) {
    const a = now.get(key);
    const b = draft.get(key);
    if (a && b && a.text === b.text) same.push(a.label);
    else changed.push({ key, label: (a ?? b)!.label, now: a?.text ?? 'Nothing', draft: b?.text ?? 'Nothing' });
  }
  return { changed, same };
}

export const HISTORY_TITLE = 'Profile history';
