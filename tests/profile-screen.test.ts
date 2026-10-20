import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '@/components/profile/fields';
import { ITEM_KINDS } from '@/lib/profile/apply';
import {
  actionName,
  countOf,
  DEFAULT_TAB,
  emptySearchText,
  FACT_LABELS,
  factLabel,
  factRows,
  FILE_ACCEPT,
  PROFILE_TABS,
  readTab,
  tabQuery,
} from '@/components/profile/model';
import ClaimsTab from '@/components/profile/ClaimsTab';
import ExperienceTab from '@/components/profile/ExperienceTab';
import ImportsTab from '@/components/profile/ImportsTab';
import ItemList from '@/components/profile/ItemList';
import ResumeTab from '@/components/profile/ResumeTab';
import { nextTabIndex } from '@/components/ui';
import type { ClaimsDoc } from '@/lib/profile/doc';

const doc: ClaimsDoc = {
  version: 1,
  profile: { name: 'Mira Okafor', headline: 'Backend engineer' },
  targets: {
    projects: [{ id: 'route-planner', title: 'Route planner', org: 'Side project' }],
    positions: [
      { id: 'kestrel', title: 'Backend Engineer', company: 'Kestrel Pay', start: '2022-03' },
      { id: 'norrvik', title: 'Developer', company: 'Norrvik', start: '2020-01', end: '2022-02' },
    ],
    educations: [{ id: 'tu', school: 'TU Berlin' }],
  },
  claims: [],
};
const noop = () => {};
const inputs = (html: string) => [...html.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
const acceptOf = (tag: string) => /accept="([^"]*)"/.exec(tag)?.[1];

describe('the tab in the URL', () => {
  it('lists Experience, Projects, Claims, Imports and Résumé in this order', () => {
    expect(PROFILE_TABS.map((t) => t.label)).toEqual(['Experience', 'Projects', 'Claims', 'Imports', 'Résumé']);
  });

  it('reads the tab, and gives the first tab for an unknown or missing name', () => {
    expect(readTab('?view=profile&tab=claims')).toBe('claims');
    expect(readTab('?view=profile&tab=resume')).toBe('resume');
    expect(readTab('?view=profile')).toBe(DEFAULT_TAB);
    expect(readTab('?view=profile&tab=nope')).toBe(DEFAULT_TAB);
    expect(readTab('')).toBe(DEFAULT_TAB);
  });

  it('writes a short query and round-trips for every tab', () => {
    expect(tabQuery('experience')).toBe('?view=profile');
    expect(tabQuery('claims')).toBe('?view=profile&tab=claims');
    for (const t of PROFILE_TABS) expect(readTab(tabQuery(t.id))).toBe(t.id);
  });

  it('moves with Home and End on the tabs', () => {
    expect(nextTabIndex(PROFILE_TABS.length, 2, 'Home')).toBe(0);
    expect(nextTabIndex(PROFILE_TABS.length, 2, 'End')).toBe(PROFILE_TABS.length - 1);
    expect(nextTabIndex(PROFILE_TABS.length, 0, 'ArrowDown', 'vertical')).toBe(1);
  });
});

describe('plurals and names', () => {
  it('counts with the right form', () => {
    expect(countOf(0, 'item')).toBe('0 items');
    expect(countOf(1, 'item')).toBe('1 item');
    expect(countOf(2, 'draft')).toBe('2 drafts');
    expect(`Dropped ${countOf(1, 'item')}`).toBe('Dropped 1 item');
  });

  it('puts the item name in the name of an action', () => {
    expect(actionName('Remove', 'Route planner')).toBe('Remove Route planner');
    expect(actionName('Accept', 'Backend Engineer · Kestrel Pay')).toContain('Kestrel Pay');
  });

  it('says which claim does not match, not that there are no claims', () => {
    expect(emptySearchText('kafka')).toBe('No claim matches “kafka”.');
    expect(emptySearchText('  go ')).not.toMatch(/yet/);
  });
});

describe('the labels of draft facts', () => {
  it('has a label for every key that a draft can hold', () => {
    const keys = new Set<string>(['name', 'headline', 'links', 'evidence', 'mentions', 'source', 'repoUrl', 'slug', 'id']);
    for (const kind of ITEM_KINDS) for (const f of FIELDS[kind]) keys.add(f.key);
    expect([...keys].filter((k) => !(k in FACT_LABELS))).toEqual([]);
  });

  it('shows no raw key', () => {
    const rows = factRows({ repoUrl: 'https://github.com/a/b', higherIsBetter: true, scaleMax: 10, empty: '', none: null, list: [] });
    expect(rows.map((r) => r.label)).toEqual(['Repository', 'A higher value is better', 'Top of the scale']);
    expect(rows[1].text).toBe('Yes');
    expect(factLabel('someNewKey')).toBe('Some new key');
  });
});

describe('the file inputs', () => {
  const imports = renderToStaticMarkup(h(ImportsTab, { doc, version: 1, state: {}, changed: async () => {}, setToast: noop, onCount: noop }));
  const resume = renderToStaticMarkup(h(ResumeTab, { state: { picks: [] }, version: 1, changed: async () => {}, setToast: noop }));

  it('lets the Imports tab pick a résumé, a LinkedIn archive and a YAML file', () => {
    expect(inputs(imports).map(acceptOf)).toEqual([FILE_ACCEPT.resume, FILE_ACCEPT.yaml, FILE_ACCEPT.linkedin]);
    expect(FILE_ACCEPT.resume).toBe('.pdf,.tex');
    expect(FILE_ACCEPT.linkedin.split(',')).toContain('.zip');
    expect(FILE_ACCEPT.yaml).toBe('.yml,.yaml');
  });

  it('lets the Résumé tab pick an own .tex file', () => {
    expect(inputs(resume).map(acceptOf)).toEqual(['.tex']);
  });
});

describe('the names of the buttons', () => {
  const render = (kind: 'position' | 'project', items: any[]) =>
    renderToStaticMarkup(h(ItemList, { kind, title: 'T', noun: kind, empty: { cause: 'x' }, items, doc, onSaved: noop, setToast: noop }));

  it('gives each Edit and Remove button its own name', () => {
    const html = render('position', doc.targets.positions);
    const names = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toContain('Edit Backend Engineer · Kestrel Pay');
    expect(names).toContain('Remove Backend Engineer · Kestrel Pay');
    expect(names).toContain('Remove Developer · Norrvik');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the empty states', () => {
  it('says which cause the empty claim list has, and does not blame a search that is empty', () => {
    const html = renderToStaticMarkup(h(ClaimsTab, { doc, warnings: [], onSaved: noop, setToast: noop }));
    expect(html).toContain('No claims yet.');
    expect(html).not.toContain('No claim matches');
  });

  it('shows the add action of an empty Experience tab', () => {
    const empty = { ...doc, targets: { projects: [], positions: [], educations: [] } };
    const html = renderToStaticMarkup(h(ExperienceTab, { doc: empty, levels: [], onSaved: noop, setToast: noop }));
    expect(html).toContain('No positions yet.');
    expect(html).toContain('Add a position');
  });
});
