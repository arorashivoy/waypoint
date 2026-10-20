import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SettingsScreen from '@/components/SettingsScreen';
import { BoardList } from '@/components/settings/JobSearch';
import { ClaudeStatusView } from '@/components/settings/ClaudeSection';
import { CLI_OFF_LINE, capLine, readSection, sectionQuery, visibleSections } from '@/components/settings/model';

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
