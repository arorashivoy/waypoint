import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  clearedFilters,
  defaultFilters,
  emptyCause,
  filterJobs,
  listLine,
  rowLine,
  type Filters,
  type ListJob,
} from '@/components/jobs/filters';
import { activeChips } from '@/components/jobs/FilterSheet';
import { blockerLine } from '@/lib/jobcheck-text';
import { isTyping, jobKeyAction, moveSelection } from '@/components/jobs/keys';

const job = (o: Partial<ListJob> & { id: string }): ListJob => ({
  role: 'Backend Engineer',
  company: 'Kestrel Pay',
  city: 'Berlin',
  cc: 'DE',
  mode: 'Hybrid',
  field: 'Backend',
  level: 'Mid',
  sponsor: false,
  priority: false,
  postedAt: '2026-10-10T00:00:00.000Z',
  days: 3,
  match: 80,
  blocker: null,
  referrers: 0,
  referrer: null,
  ...o,
});

const ctx = (o: Partial<{ onCcs: string[]; levels: string[]; query: string }> = {}) => ({ onCcs: ['DE', 'NL'], levels: ['Mid'], query: '', ...o });

describe('defaultFilters', () => {
  it('uses "Your level" only when the profile has levels', () => {
    expect(defaultFilters(['Mid']).level).toBe('Your level');
    expect(defaultFilters([]).level).toBe('Any');
  });
});

describe('filterJobs', () => {
  const jobs = [
    job({ id: 'a', level: 'Mid' }),
    job({ id: 'b', level: 'Senior' }),
    job({ id: 'c', level: 'Entry', cc: 'NL', days: 20 }),
    job({ id: 'd', cc: 'PL' }),
  ];
  const ids = (list: ListJob[]) => list.map((j) => j.id);

  it('keeps only jobs in countries that are on', () => {
    expect(ids(filterJobs(jobs, { ...clearedFilters, level: 'Any' }, ctx()))).toEqual(['a', 'b', 'c']);
  });

  it('"Your level" keeps only the levels of the profile', () => {
    expect(ids(filterJobs(jobs, { ...defaultFilters(['Mid']), posted: 'Any time' }, ctx()))).toEqual(['a']);
    expect(ids(filterJobs(jobs, { ...defaultFilters(['Mid']), posted: 'Any time' }, ctx({ levels: ['Mid', 'Senior'] })))).toEqual(['a', 'b']);
  });

  it('"Your level" acts like Any when the profile has no levels', () => {
    const f: Filters = { ...clearedFilters, level: 'Your level' };
    expect(ids(filterJobs(jobs, f, ctx({ levels: [] })))).toEqual(['a', 'b', 'c']);
  });

  it('filters by posted window, field, mode, visa and top companies', () => {
    expect(ids(filterJobs(jobs, { ...clearedFilters, posted: 'This week' }, ctx()))).toEqual(['a', 'b']);
    expect(ids(filterJobs(jobs, { ...clearedFilters, field: 'Trading' }, ctx()))).toEqual([]);
    expect(ids(filterJobs(jobs, { ...clearedFilters, mode: 'Remote' }, ctx()))).toEqual([]);
    const more = [job({ id: 'x', sponsor: true, priority: true }), job({ id: 'y' })];
    expect(ids(filterJobs(more, { ...clearedFilters, sponsorOnly: true }, ctx()))).toEqual(['x']);
    expect(ids(filterJobs(more, { ...clearedFilters, topOnly: true }, ctx()))).toEqual(['x']);
  });

  it('searches role, company and city without case', () => {
    const list = [job({ id: 'a', role: 'Kafka Engineer' }), job({ id: 'b', company: 'Halde', city: 'Amsterdam' })];
    expect(ids(filterJobs(list, clearedFilters, ctx({ query: 'KAFKA' })))).toEqual(['a']);
    expect(ids(filterJobs(list, clearedFilters, ctx({ query: 'amster' })))).toEqual(['b']);
  });

  it('keeps the order of the server for "match" and sorts by date for "date"', () => {
    const list = [job({ id: 'a', postedAt: '2026-10-01T00:00:00.000Z' }), job({ id: 'b', postedAt: '2026-10-09T00:00:00.000Z' })];
    expect(ids(filterJobs(list, { ...clearedFilters, sort: 'match' }, ctx()))).toEqual(['a', 'b']);
    expect(ids(filterJobs(list, { ...clearedFilters, sort: 'date' }, ctx()))).toEqual(['b', 'a']);
  });
});

describe('activeFilterCount', () => {
  it('is 0 for the cleared filters, and ignores the sort', () => {
    expect(activeFilterCount(clearedFilters, clearedFilters)).toBe(0);
    expect(activeFilterCount({ ...clearedFilters, sort: 'date' }, clearedFilters)).toBe(0);
  });
  it('counts the default filters that hide jobs, so "Clear the filters" gives 0', () => {
    expect(activeFilterCount(defaultFilters(['Mid']), clearedFilters)).toBe(2);
    expect(activeFilterCount(defaultFilters([]), clearedFilters)).toBe(1);
    expect(activeFilterCount({ ...defaultFilters(['Mid']), sort: 'date' }, clearedFilters)).toBe(2);
  });
  it('counts each filter and each switch', () => {
    expect(activeFilterCount({ ...clearedFilters, field: 'Backend', mode: 'Remote' }, clearedFilters)).toBe(2);
    expect(activeFilterCount({ ...clearedFilters, sponsorOnly: true, topOnly: true, posted: 'This week' }, clearedFilters)).toBe(3);
  });
});

describe('activeChips', () => {
  it('has no chip after the filters are cleared', () => {
    expect(activeChips(clearedFilters, clearedFilters)).toEqual([]);
  });
  it('has one chip for each filter that hides jobs, and each chip undoes its filter', () => {
    const chips = activeChips(defaultFilters(['Mid']), clearedFilters);
    expect(chips.map((c) => c.label)).toEqual(['Level: Your level', 'Posted: This week']);
    expect(chips[0].undo).toEqual({ level: 'Any' });
    expect(chips[1].undo).toEqual({ posted: 'Any time' });
  });
});

describe('blockerLine', () => {
  it('gives a plain lead for each blocker type, then the quote of the posting', () => {
    expect(blockerLine('citizenship', 'US citizens only')).toBe('Needs a work permit: “US citizens only”');
    expect(blockerLine('clearance', 'TS/SCI')).toBe('Needs a security clearance: “TS/SCI”');
    expect(blockerLine('language', 'Fluent German')).toBe('Needs a language: “Fluent German”');
    expect(blockerLine('location', 'On site in Zug')).toBe('Must work in a set place: “On site in Zug”');
    expect(blockerLine('seniority', '8+ years')).toBe('Needs more experience: “8+ years”');
    expect(blockerLine('other', 'Must own a car')).toBe('Has a hard requirement: “Must own a car”');
  });
  it('uses the "other" lead for an unknown type, and the lead alone for an empty quote', () => {
    expect(blockerLine('weird', 'x')).toBe('Has a hard requirement: “x”');
    expect(blockerLine('clearance', '  \n ')).toBe('Needs a security clearance');
  });
  it('cuts a long quote to 60 characters with an ellipsis and joins its lines', () => {
    const line = blockerLine('citizenship', `${'word '.repeat(30)}\nend`);
    expect(line.startsWith('Needs a work permit: “word word')).toBe(true);
    expect(line.endsWith('…”')).toBe(true);
    expect(line).not.toContain('\n');
    expect(line.length).toBeLessThanOrEqual('Needs a work permit: “”'.length + 61);
  });
});

describe('emptyCause', () => {
  const args = (o: Record<string, unknown> = {}) => ({
    jobs: [job({ id: 'a', level: 'Senior' }), job({ id: 'b', level: 'Senior' })],
    filters: defaultFilters(['Mid']),
    levels: ['Mid'],
    onCcs: ['DE'],
    query: '',
    shown: 0,
    ...o,
  });

  it('is null while the list has rows', () => {
    expect(emptyCause(args({ shown: 3 }))).toBeNull();
  });
  it('says when no country is on, before anything else', () => {
    expect(emptyCause(args({ onCcs: [], jobs: [] }))).toEqual({ kind: 'no-country' });
  });
  it('says when no job was fetched', () => {
    expect(emptyCause(args({ jobs: [] }))).toEqual({ kind: 'none-fetched' });
  });
  it('says when the filters hide every job and names the filter that hides most', () => {
    const jobs = [job({ id: 'a', level: 'Senior' }), job({ id: 'b', level: 'Senior', days: 20 }), job({ id: 'c', level: 'Senior', days: 20 })];
    const cause = emptyCause(args({ jobs }));
    expect(cause).toMatchObject({ kind: 'filters', total: 3, culprit: { key: 'level' } });
    expect((cause as any).culprit.text).toBe('The level filter shows only Mid.');
  });
  it('names the posted filter when it hides most', () => {
    const jobs = [job({ id: 'a', days: 20 }), job({ id: 'b', days: 20 }), job({ id: 'c', level: 'Senior' })];
    const cause = emptyCause(args({ jobs }));
    expect((cause as any).culprit).toMatchObject({ key: 'posted', text: 'The posted filter shows only jobs from this week.' });
  });
  it('says when a search finds nothing and the filters are not the cause', () => {
    const jobs = [job({ id: 'a' })];
    expect(emptyCause(args({ jobs, query: 'kafka' }))).toEqual({ kind: 'search', query: 'kafka' });
  });
});

describe('listLine', () => {
  it('says that no country is on', () => {
    expect(listLine([], 0, 'match')).toBe('No country is on.');
  });
  it('names 1 and 2 countries', () => {
    expect(listLine(['Germany'], 1, 'match')).toBe('1 job in Germany, best match first');
    expect(listLine(['Germany', 'Netherlands'], 48, 'match')).toBe('48 jobs in Germany and the Netherlands, best match first');
    expect(listLine(['Germany', 'Ireland'], 0, 'date')).toBe('0 jobs in Germany and Ireland, newest first');
  });
  it('names 2 countries and counts the rest', () => {
    expect(listLine(['Germany', 'Netherlands', 'Ireland', 'Belgium', 'Poland'], 9, 'match')).toBe('9 jobs in Germany, the Netherlands and 3 more countries, best match first');
    expect(listLine(['Germany', 'Ireland', 'Belgium'], 9, 'match')).toBe('9 jobs in Germany, Ireland and 1 more country, best match first');
  });
  it('can say that only the level of the profile shows', () => {
    expect(listLine(['Germany'], 4, 'match', true)).toBe('4 jobs in Germany, best match first. Shows jobs at your level.');
  });
});

describe('rowLine', () => {
  it('is null without a referral or a blocker', () => {
    expect(rowLine(job({ id: 'a' }))).toBeNull();
  });
  it('names one contact, or counts several', () => {
    expect(rowLine(job({ id: 'a', referrers: 1, referrer: 'Anna Weber' }))).toEqual({ kind: 'referral', text: 'Anna Weber can refer you' });
    expect(rowLine(job({ id: 'a', referrers: 2, referrer: 'Anna Weber' }))).toEqual({ kind: 'referral', text: '2 contacts can refer you' });
  });
  it('shows the blocker, and the blocker wins over a referral', () => {
    expect(rowLine(job({ id: 'a', blocker: 'Needs a security clearance' }))).toEqual({ kind: 'blocker', text: 'Needs a security clearance' });
    expect(rowLine(job({ id: 'a', blocker: 'Needs a security clearance', referrers: 1, referrer: 'Anna Weber' }))).toMatchObject({ kind: 'blocker' });
  });
});

describe('jobKeyAction', () => {
  const key = (k: string, o: Record<string, unknown> = {}) => jobKeyAction({ key: k, typing: false, sheetOpen: false, ...o });
  it('maps / j k and Escape', () => {
    expect(key('/')).toBe('search');
    expect(key('j')).toBe('next');
    expect(key('k')).toBe('previous');
    expect(key('Escape')).toBe('close');
  });
  it('ignores the keys while the person types in a field', () => {
    expect(key('/', { typing: true })).toBeNull();
    expect(key('j', { typing: true })).toBeNull();
    expect(key('k', { typing: true })).toBeNull();
  });
  it('lets Escape through while typing, so a search field can give up focus', () => {
    expect(key('Escape', { typing: true })).toBe('close');
  });
  it('ignores the keys while a sheet is open, and with a modifier', () => {
    expect(key('j', { sheetOpen: true })).toBeNull();
    expect(key('/', { ctrlKey: true })).toBeNull();
    expect(key('j', { metaKey: true })).toBeNull();
    expect(key('x')).toBeNull();
  });
});

describe('isTyping', () => {
  it('is true for fields and false for other elements', () => {
    expect(isTyping({ tagName: 'INPUT' })).toBe(true);
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTyping({ tagName: 'SELECT' })).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('moveSelection', () => {
  const ids = ['a', 'b', 'c'];
  it('moves one row and stops at the ends', () => {
    expect(moveSelection(ids, 'a', 'next')).toBe('b');
    expect(moveSelection(ids, 'c', 'next')).toBe('c');
    expect(moveSelection(ids, 'b', 'previous')).toBe('a');
    expect(moveSelection(ids, 'a', 'previous')).toBe('a');
  });
  it('starts at the first row when nothing is selected, and is null for an empty list', () => {
    expect(moveSelection(ids, null, 'next')).toBe('a');
    expect(moveSelection(ids, 'gone', 'previous')).toBe('a');
    expect(moveSelection([], 'a', 'next')).toBeNull();
  });
});
