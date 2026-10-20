import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { buildMe, buildPending } from '@/lib/state';
import { EMPTY_TEXT, needsCount, pendingSections, type PendingData } from '@/components/pending/sections';
import PendingSections from '@/components/pending/PendingSections';
import { makeUser } from './helpers/http';

const person = { init: 'AW', who: 'Anna Weber', org: 'Kestrel Pay · Berlin', role: 'Backend Engineer' };
const data = (o: Partial<PendingData> = {}): PendingData => ({
  needs: [
    { id: 'n1', kind: 'Replied', ...person, createdAt: '2026-10-19T10:00:00.000Z', when: '5 min ago', quote: 'Can you start in March?', draftLabel: 'Suggested reply', draft: 'Hello Anna', reason: 'The start date is not on file.', action: 'Send reply', contactUrl: null },
    { id: 'n2', kind: 'Replied', ...person, who: 'Lars Ek', createdAt: '2026-10-19T09:00:00.000Z', when: '1 h ago', quote: 'Salary?', draftLabel: 'Suggested reply', draft: 'Hello Lars', reason: '', action: 'Send reply', contactUrl: null },
  ],
  awaiting: [{ id: 'a1', jobId: 'j1', ...person, sentAt: '2026-10-18T10:00:00.000Z', when: 'Sent yesterday', why: '', contactUrl: null, alumni: true }],
  auto: [{ id: 's1', init: 'MB', who: 'Mia Berg', org: 'Norrvik', quote: 'Which visa?', sent: 'No visa needed.', why: 'It was on file.', handled: false, contactUrl: null }],
  appliedList: [{ id: 'p1', role: 'Data Engineer', company: 'Brightwell', city: 'Lisbon', cvUrl: 'https://x.test/cv', cvLead: 'Spark', cvSentAt: '2026-10-19T10:00:00.000Z', cvSent: '1 d ago' }],
  ...o,
} as PendingData);

const noop = async () => true;
const actions = { busy: null, errors: {}, send: noop, draftReferral: noop, submitReply: noop };
const render = (d: PendingData) => renderToStaticMarkup(h(PendingSections, { data: d, actions, onJobs: () => {} }));

describe('pendingSections', () => {
  it('lists the sections in order, "Needs you" first, with their counts', () => {
    expect(pendingSections(data()).map((s) => [s.key, s.title, s.count])).toEqual([
      ['needs', 'Needs you', 2],
      ['awaiting', 'Waiting for a reply', 1],
      ['safe', 'Safe to send', 1],
      ['applied', 'Applied', 1],
    ]);
  });

  it('counts zero for an empty section', () => {
    const counts = pendingSections(data({ needs: [], awaiting: [], auto: [], appliedList: [] })).map((s) => s.count);
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it('gives each section an empty cause and one action', () => {
    for (const key of ['needs', 'awaiting', 'safe', 'applied'] as const) {
      expect(EMPTY_TEXT[key].cause).toMatch(/\.$/);
      expect(EMPTY_TEXT[key].action).toBe('See the jobs');
    }
    expect(EMPTY_TEXT.needs.cause).toBe('Nothing needs you now.');
  });
});

describe('the needs-you count', () => {
  it('is the number that the shell shows in its badge', async () => {
    const { user } = await makeUser();
    const job = await db.job.create({ data: { externalId: `pend-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' } });
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: 'sent' } });
    const o = (kind: string, certain: boolean, handled: boolean) => ({ applicationId: app.id, kind, certain, handled, body: 'x' });
    await db.outreachEvent.createMany({ data: [o('replied', false, false), o('replied', false, false), o('replied', true, false), o('replied', false, true), o('request', false, false)] });
    const [me, pending] = await Promise.all([buildMe(user.id), buildPending(user.id)]);
    expect(needsCount(pending)).toBe(2);
    expect(needsCount(pending)).toBe(me.needsCount);
  });
});

describe('PendingSections markup', () => {
  it('shows the sections in order', () => {
    const html = render(data());
    const at = ['Needs you', 'Waiting for a reply', 'Safe to send', 'Applied'].map((t) => html.indexOf(`>${t}</h2>`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('gives each needs-you item one primary action', () => {
    const html = render(data());
    const needs = html.slice(html.indexOf('data-section="needs"'), html.indexOf('data-section="awaiting"'));
    const items = needs.split('<li').slice(1);
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.match(/class="btn ui-btn go/g)).toHaveLength(1);
  });

  it('shows the count of needs-you in a coral badge', () => {
    expect(render(data())).toContain('ui-badge-coral');
    expect(render(data({ needs: [] }))).not.toContain('ui-badge-coral');
  });

  it('shows an empty state with a cause and an action in an empty section', () => {
    const html = render(data({ needs: [], awaiting: [], auto: [], appliedList: [] }));
    for (const key of ['needs', 'awaiting', 'safe', 'applied'] as const) expect(html).toContain(EMPTY_TEXT[key].cause);
    expect(html.match(/See the jobs/g)).toHaveLength(4);
  });

  it('renders text from the other side as text', () => {
    const html = render(data({ needs: [{ ...data().needs[0], quote: '<img src=x onerror=alert(1)>' }] }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
