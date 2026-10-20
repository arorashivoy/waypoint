import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsScreen from '@/components/SettingsScreen';
import { BoardList, CountryList } from '@/components/settings/JobSearch';
import DataSection from '@/components/settings/DataSection';
import JobsEmpty from '@/components/jobs/JobsEmpty';
import { Switch } from '@/components/ui';
import { changeCountry, saveCountry } from '@/components/settings/countries';
import { readLocation } from '@/components/shell/nav';
import { ClaudeStatusView } from '@/components/settings/ClaudeSection';
import { ADMIN_DELETE_NOTE, CLI_OFF_LINE, DELETE_TEXT, capLine, claudeDetail, openSection, readSection, sectionQuery, visibleSections } from '@/components/settings/model';

const me = (role: string) => ({ user: { name: 'Mira Okafor', email: 'mira@example.com', role }, countries: [], globalSites: [], careerLinks: [] });
const render = (role: string) => renderToStaticMarkup(h(SettingsScreen, { state: me(role), setToast: () => {}, toggleCountry: () => {} }));
const status = (over: Record<string, unknown> = {}) => ({
  mode: 'shared', detail: 'The shared API key', keyHint: null, sharedAvailable: true, capUsd: 5, sharedSpentUsd: 1.5, capReached: false, resetsAt: '2026-11-01T00:00:00.000Z', cliOff: false, ...over,
}) as any;

describe('the section in the URL', () => {
  it('lists the sections in order, with Admin last', () => {
    expect(visibleSections(true).map((s) => s.label)).toEqual(['Account', 'Claude', 'Job search', 'Integrations', 'Data', 'Admin']);
  });

  it('reads the section, and gives Account for a missing or unknown name', () => {
    expect(readSection('?view=settings&section=job-search', false)).toBe('job-search');
    expect(readSection('?view=settings', false)).toBe('account');
    expect(readSection('?view=settings&section=nope', true)).toBe('account');
  });

  it('writes the query, and the first section has no section part', () => {
    expect(sectionQuery('job-search')).toBe('?view=settings&section=job-search');
    expect(sectionQuery('account')).toBe('?view=settings');
  });

  it('does not open the Admin section for a member', () => {
    expect(readSection('?view=settings&section=admin', false)).toBe('account');
    expect(readSection('?view=settings&section=admin', true)).toBe('admin');
  });
});

describe('the Admin section', () => {
  it('is absent for a member', () => {
    const html = render('member');
    expect(html).toContain('Job search');
    expect(html).not.toMatch(/>Admin</);
    expect(visibleSections(false).map((s) => s.id)).not.toContain('admin');
  });

  it('is present for the admin', () => {
    expect(render('admin')).toMatch(/>Admin</);
  });
});

describe('the board failure line', () => {
  it('shows the error next to the board that failed', () => {
    const html = renderToStaticMarkup(h(BoardList, { boards: [{ board: 'greenhouse:kestrel', status: 'failed', fetchedAt: '2026-10-20T08:00:00.000Z', error: 'HTTP 503' }] }));
    expect(html).toContain('greenhouse:kestrel');
    expect(html).toContain('HTTP 503');
    expect(html).toContain('Failed');
  });

  it('says that every board works when none failed', () => {
    expect(renderToStaticMarkup(h(BoardList, { boards: [] }))).toContain('Every job board works.');
  });
});

describe('the Claude section', () => {
  it('shows the use against the cap and the reset date', () => {
    expect(capLine(status())).toBe('Shared key this month: $1.50 of $5.00. It resets on 1 November.');
    expect(renderToStaticMarkup(h(ClaudeStatusView, { claude: status(), isAdmin: false }))).toContain('$1.50 of $5.00');
  });

  it('has no cap line when there is no shared key', () => {
    expect(capLine(status({ sharedAvailable: false }))).toBeNull();
  });

  it('tells the admin that the CLI is off', () => {
    expect(CLI_OFF_LINE).toBe('Claude CLI is off: it failed its self-test. The reason is on the admin health page.');
    expect(renderToStaticMarkup(h(ClaudeStatusView, { claude: status({ mode: 'none', cliOff: true }), isAdmin: true }))).toContain(CLI_OFF_LINE);
    expect(renderToStaticMarkup(h(ClaudeStatusView, { claude: status({ mode: 'none', cliOff: false }), isAdmin: true }))).not.toContain(CLI_OFF_LINE);
  });
});

const country = (cc: string, name: string, rank: number, on: boolean) => ({ cc, name, rank, on, settle: 'Settled status in 5 years', bar: 'A bar', sites: [], count: '2' });

describe('the Switch', () => {
  it('is a switch with a fixed name, a checked state and the words On and Off', () => {
    const on = renderToStaticMarkup(h(Switch, { checked: true, onChange: () => {}, label: 'Search in Germany' }));
    const off = renderToStaticMarkup(h(Switch, { checked: false, onChange: () => {}, label: 'Search in Germany' }));
    expect(on).toMatch(/role="switch"/);
    expect(on).toMatch(/aria-checked="true"/);
    expect(off).toMatch(/aria-checked="false"/);
    expect(on).toMatch(/aria-label="Search in Germany"/);
    expect(off).toMatch(/aria-label="Search in Germany"/);
    expect(on).toContain('>On<');
    expect(off).toContain('>Off<');
  });
});

describe('the country list', () => {
  const html = renderToStaticMarkup(h(CountryList, { countries: [country('DE', 'Germany', 1, true), country('NL', 'Netherlands', 2, false)], onToggle: () => {} }));

  it('keeps the order of the user', () => {
    expect(html.indexOf('Germany')).toBeGreaterThan(-1);
    expect(html.indexOf('Germany')).toBeLessThan(html.indexOf('Netherlands'));
  });

  it('gives each country a switch with a name that does not change with the state', () => {
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Search in Germany"|aria-label="Search in Germany"[^>]*aria-checked="true"/);
    expect(html).toMatch(/aria-label="Search in Netherlands"/);
    expect(html).not.toMatch(/aria-label="[^"]*(Paused|Searching)/);
  });

  it('calls the toggle with the country and the new choice, and returns no error', async () => {
    const toggle = vi.fn(async () => {});
    expect(await changeCountry({ cc: 'NL', name: 'Netherlands' }, true, toggle)).toBeNull();
    expect(toggle).toHaveBeenCalledWith('NL', true);
  });

  it('returns an error text that names the country when the change fails', async () => {
    const text = await changeCountry({ cc: 'DE', name: 'Germany' }, false, async () => { throw new Error('The server is down'); });
    expect(text).toBe('Waypoint could not change Germany. The server is down. The switch is back to its old state.');
  });
});

describe('saveCountry', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('posts the country and the choice to /api/countries', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await saveCountry('DE', false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/countries');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ cc: 'DE', on: false });
  });
});

describe('the delete-account text', () => {
  it('says the exact consequence in plain words', () => {
    expect(DELETE_TEXT).toContain('deletes your profile, drafts, applications, contacts, keys and files now');
    expect(DELETE_TEXT).toContain('You cannot undo this.');
  });

  it('shows the delete row to a member and a reason to the admin', () => {
    const member = renderToStaticMarkup(h(DataSection, { isAdmin: false, setToast: () => {} }));
    const admin = renderToStaticMarkup(h(DataSection, { isAdmin: true, setToast: () => {} }));
    expect(member).toContain('Delete my account');
    expect(member).not.toContain(ADMIN_DELETE_NOTE);
    expect(admin).toContain(ADMIN_DELETE_NOTE);
    expect(admin).not.toContain('Delete my account');
  });
});

describe('the Jobs empty state "Turn on a country"', () => {
  it('has an action, and the action opens Settings on the Job search section', () => {
    const html = renderToStaticMarkup(h(JobsEmpty, { cause: { kind: 'no-country' } as any, onSettings: () => {}, onRefresh: () => {}, onClearFilters: () => {}, onClearSearch: () => {} }));
    expect(html).toContain('Turn on a country to see jobs.');
    const go = vi.fn();
    const history = { replaceState: vi.fn() };
    openSection(go, 'job-search', history, '/');
    expect(go).toHaveBeenCalledWith('settings');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?view=settings&section=job-search');
    const url = history.replaceState.mock.calls[0][2] as string;
    expect(readLocation(url.slice(1)).view).toBe('settings');
    expect(readSection(url.slice(1), false)).toBe('job-search');
  });
});

describe('the Admin section for a member', () => {
  it('has no tab, no panel text and no way in through the URL', () => {
    const html = render('member');
    expect(html).not.toMatch(/>Admin</);
    expect(html).not.toContain('Invite a user');
    expect(visibleSections(false).some((x) => x.id === 'admin')).toBe(false);
    expect(readSection('?view=settings&section=admin', false)).toBe('account');
  });
});

describe('the Claude status text', () => {
  it('points to this section instead of Settings', () => {
    expect(claudeDetail('Add an API key in Settings to use Claude.')).toBe('Add an API key here to use Claude.');
  });
});
