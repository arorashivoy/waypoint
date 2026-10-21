import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { errorsFor, FIELDS, fromForm, summaryOf, targetOptions, toForm } from '@/components/profile/fields';
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
  BATCH_PAGE,
  isBlocked,
  makeGuard,
  mergeRows,
  readyIds,
  uniqueNames,
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
    expect(actionName('Accept', 'Backend Engineer at Kestrel Pay')).toContain('Kestrel Pay');
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
    expect(rows.map((r) => r.label)).toEqual(['Repository', 'A higher value is better', 'Highest possible value']);
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
    expect(names).toContain('Edit Backend Engineer at Kestrel Pay');
    expect(names).toContain('Remove Backend Engineer at Kestrel Pay');
    expect(names).toContain('Remove Developer at Norrvik');
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

describe('the accept rules for drafts', () => {
  const d = (id: string, warnings: string[] = [], warningsApproved = false) => ({ id, warnings, warningsApproved });

  it('never puts a draft with an unchecked warning into a bulk accept', () => {
    const list = [d('a'), d('b', ['hidden text']), d('c', ['hidden text'], true), d('d', [], true)];
    expect(list.filter(isBlocked).map((x) => x.id)).toEqual(['b']);
    expect(readyIds(list)).toEqual(['a', 'c', 'd']);
    expect(readyIds([d('x', ['w'])])).toEqual([]);
  });

  it('runs one action at a time: a second call while one runs does nothing', async () => {
    const guard = makeGuard();
    let release = () => {};
    const first = vi.fn(() => new Promise<string>((r) => { release = () => r('one'); }));
    const second = vi.fn(async () => 'two');
    const a = guard.run(first);
    expect(guard.busy()).toBe(true);
    expect(await guard.run(second)).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
    release();
    expect(await a).toBe('one');
    expect(guard.busy()).toBe(false);
    expect(await guard.run(second)).toBe('two');
  });

  it('frees the guard when an action fails', async () => {
    const guard = makeGuard();
    await expect(guard.run(async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(guard.busy()).toBe(false);
  });

  it('gives each draft with the same title its own button name', () => {
    const names = uniqueNames(['Route planner', 'Java', 'Route planner']);
    expect(names).toEqual(['Route planner', 'Java', 'Route planner (2)']);
    const all = names.flatMap((n) => ['Accept', 'Edit', 'Reject'].map((v) => actionName(v, n)));
    expect(new Set(all).size).toBe(all.length);
  });

  it('shows 10 drafts of a batch first', () => {
    expect(BATCH_PAGE).toBe(10);
  });
});

describe('the merge view', () => {
  it('shows only the fields that differ, and names the others', () => {
    const r = mergeRows(
      { id: 'a', title: 'Route planner', description: 'Old', bullets: ['x'] },
      { id: 'a', title: 'Route planner', description: 'New', bullets: ['x'], url: 'https://x.test' },
    );
    expect(r.same).toEqual(['ID', 'Title', 'Bullets']);
    expect(r.changed.map((c) => [c.label, c.now, c.draft])).toEqual([
      ['Description', 'Old', 'New'],
      ['Link', 'Nothing', 'https://x.test'],
    ]);
  });
});

describe('the form logic of the editor', () => {
  it('keeps the ID of a bullet when its line stays, and changes only a changed line', () => {
    const pos = doc.targets.positions[0];
    const withBullets = { ...pos, bullets: [{ id: 'b1', match: 'Cut latency', text: 'Cut latency by 40%.' }, { id: 'b2', match: 'Led', text: 'Led 3 people.' }] };
    const form = toForm('position', withBullets);
    expect(form.bullets).toBe('Cut latency by 40%.\nLed 3 people.');
    const next = fromForm('position', { ...form, bullets: 'Cut latency by 40%.\nLed 4 people.' }, withBullets, { evidence: [], listed: [] }) as any;
    expect(next.bullets.map((b: any) => b.id)).toEqual(['b1', 'b2']);
    expect(next.bullets[1].text).toBe('Led 4 people.');
  });

  it('turns an empty optional field into no field, and a number into a number', () => {
    const form = toForm('claim', null);
    const item = fromForm('claim', { ...form, label: 'GPA', kind: 'metric', value: '1.8', scaleMax: '5' }, null, { evidence: [], listed: [] }) as any;
    expect(item.slug).toBe('gpa');
    expect(item.value).toBe(1.8);
    expect(item.scaleMax).toBe(5);
  });

  it('reports a problem by field, and the first-save form of a position has problems', () => {
    const item = fromForm('position', toForm('position', null), null, { evidence: [], listed: [] });
    const e = errorsFor(doc, 'position', item, null);
    expect(e.count).toBeGreaterThan(0);
    expect(Object.keys(e.byField)).toEqual(expect.arrayContaining(['title']));
  });

  it('names the items and lists the targets of evidence', () => {
    expect(summaryOf('position', doc.targets.positions[0]).title).toBe('Backend Engineer at Kestrel Pay');
    // Words and commas, not middle dots.
    for (const kind of ['position', 'education', 'project', 'claim'] as const) {
      const list = kind === 'claim' ? doc.claims : kind === 'position' ? doc.targets.positions : kind === 'education' ? doc.targets.educations : doc.targets.projects;
      for (const item of list) expect(JSON.stringify(summaryOf(kind, item as never))).not.toContain('·');
    }
    expect(targetOptions(doc).map((t) => t.value)).toEqual(['position:kestrel', 'position:norrvik', 'education:tu', 'project:route-planner']);
  });
});
