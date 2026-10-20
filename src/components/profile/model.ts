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
  mentions: 'Where it shows',
  value: 'Value',
  scaleMax: 'Top of the scale',
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
