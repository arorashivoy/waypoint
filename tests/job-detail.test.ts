import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { latexLogExcerpt } from '@/lib/latex-log';
import { BLOCKER_LABEL, LEGITIMACY_LABEL } from '@/lib/jobcheck-text';
import { topRequirements, type Requirement } from '@/components/job/requirements';
import { builtAgo } from '@/components/job/time';
import { JobBody } from '@/components/job/JobBody';
import { cliOffNote, suggestBlockedNote } from '@/components/job/CvSection';
import type { JobDetailState, JobView } from '@/components/job/types';

describe('latexLogExcerpt', () => {
  const dir = '/data/users/u1/resumes';

  it('keeps at most 20 lines', () => {
    const log = Array.from({ length: 60 }, (_, i) => `! line ${i + 1}`).join('\n');
    const lines = latexLogExcerpt(log, dir).split('\n');
    expect(lines).toHaveLength(20);
    expect(lines[19]).toBe('! line 20');
  });

  it('cuts a path outside the user folder to its base name', () => {
    expect(latexLogExcerpt('! File /home/x/other/file.tex not found', dir)).toBe('! File file.tex not found');
  });

  it('keeps the relative form of a path under the user folder', () => {
    expect(latexLogExcerpt(`! Error in ${dir}/sub/cv.tex line 4`, dir)).toBe('! Error in sub/cv.tex line 4');
    expect(latexLogExcerpt(`(${dir}/cv.tex`, dir)).toBe('(cv.tex');
  });

  it('leaves no absolute path', () => {
    const out = latexLogExcerpt('(/usr/share/texlive/a.sty (/etc/passwd) /tmp/x/y.log\n/var/lib/z', dir);
    expect(out).not.toMatch(/(^|[\s(])\/[\w.]/);
    expect(out).toContain('a.sty');
    expect(out).toContain('passwd');
  });

  it('keeps text that only has a slash inside a word', () => {
    expect(latexLogExcerpt('! Missing } and/or {', dir)).toBe('! Missing } and/or {');
  });
});

describe('topRequirements', () => {
  const r = (text: string, importance: 'must' | 'nice'): Requirement => ({ text, importance, status: 'met', evidence: [] });

  it('gives the first 3 must items in the order of the posting', () => {
    const reqs = [r('a', 'nice'), r('b', 'must'), r('c', 'must'), r('d', 'must'), r('e', 'must')];
    expect(topRequirements(reqs).map((x) => x.text)).toEqual(['b', 'c', 'd']);
  });

  it('fills up with nice items only when fewer than 3 must items exist', () => {
    const reqs = [r('a', 'nice'), r('b', 'must'), r('c', 'nice'), r('d', 'nice')];
    expect(topRequirements(reqs).map((x) => x.text)).toEqual(['b', 'a', 'c']);
  });

  it('copes with an empty list', () => {
    expect(topRequirements([])).toEqual([]);
  });
});

describe('reworded labels', () => {
  it('does not say what the user lacks in the seniority label', () => {
    expect(BLOCKER_LABEL.seniority).toBe('Asks for more years of work than the posting expects from a new hire');
    expect(BLOCKER_LABEL.seniority).not.toMatch(/\byou\b/);
  });
  it('names the place in the location label', () => {
    expect(BLOCKER_LABEL.location).toBe('Needs you to work in a set place');
  });
  it('does not use "put up" for a reposted job', () => {
    expect(LEGITIMACY_LABEL.reposted).toBe('looks like an old post that the company listed again');
  });
});

const view = (o: Partial<JobView> = {}): JobView => ({
  id: 'j1',
  role: 'Backend Engineer, Payments',
  company: 'Kestrel Pay',
  city: 'Berlin',
  cc: 'DE',
  place: 'DE · Berlin',
  url: 'https://example.test/job',
  sourceList: 'Greenhouse',
  mode: 'Hybrid',
  visa: '',
  postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  summary: 'A strong match.',
  by: 'claude',
  blockers: [],
  legitimacy: [],
  requirements: [
    { text: 'Java services', importance: 'must', status: 'met', evidence: ['Ledger'] },
    { text: 'Kafka', importance: 'must', status: 'met', evidence: [] },
    { text: 'Kubernetes', importance: 'must', status: 'partial', evidence: [] },
    { text: 'Go', importance: 'must', status: 'missing', evidence: [] },
  ],
  parts: [{ label: 'Skills', points: 40 }],
  must: ['Java'],
  projects: [{ rank: '1', n: 'settlement-pipeline', why: 'Kafka' }],
  routes: [{ name: 'Anna Weber', init: 'AW', role: 'Engineering Manager', why: 'Works at Kestrel Pay', best: true }],
  match: 86,
  analysing: null,
  warning: null,
  referral: null,
  alumni: null,
  wording: null,
  isSent: false,
  isApplied: false,
  cv: null,
  ...o,
});

const noop = async () => true;
const state = (job: JobView, o: Partial<JobDetailState> = {}): JobDetailState => ({
  job,
  cv: job.cv,
  wording: job.wording,
  busy: null,
  cvBusy: null,
  cvError: null,
  blocked: false,
  wayError: null,
  cvRev: 0,
  claudeNote: null,
  findContact: vi.fn(async () => {}),
  findAlumni: vi.fn(async () => {}),
  markApplied: vi.fn(async () => {}),
  generate: noop,
  refine: noop,
  reset: noop,
  suggest: noop,
  decide: noop,
  setToast: () => {},
  ...o,
});

const render = (job: JobView, o: Partial<JobDetailState> = {}, props: { part?: 'wayin' | 'cv' | null } = {}) =>
  renderToStaticMarkup(h(JobBody, { d: state(job, o), part: props.part ?? null, onPart: () => {}, onClose: () => {} }));

describe('the job detail', () => {
  it('shows header, fit, way in, CV and apply bar in this order', () => {
    const html = render(view());
    const at = ['jd-header', 'jd-fit', 'jd-wayin', 'jd-cv', 'jd-bar'].map((c) => html.indexOf(`class="${c}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('opens the posting in a new tab, safely', () => {
    const html = render(view());
    expect(html).toMatch(/<a [^>]*href="https:\/\/example.test\/job"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Posted 3 days ago');
  });

  it('shows 3 requirements first and a button for the rest', () => {
    const html = render(view());
    expect(html).toContain('Java services');
    expect(html).toContain('Kubernetes');
    expect(html).not.toContain('>Go<');
    expect(html).toContain('Show all 4 requirements');
  });

  it('lists each blocker with its quote', () => {
    const html = render(view({ blockers: [{ type: 'citizenship', quote: 'A Belgian work permit is required.' }] }));
    expect(html).toContain('A Belgian work permit is required.');
    expect(html).toContain(BLOCKER_LABEL.citizenship);
  });

  it('shows the injection warning when the posting has one', () => {
    expect(render(view({ warning: 'This posting has text that tries to give instructions to an AI.' }))).toContain('tries to give instructions to an AI');
    expect(render(view())).not.toContain('tries to give instructions');
  });

  it('shows posting text as text, not as a tag', () => {
    const html = render(view({ summary: 'Hello <script>alert(1)</script>', blockers: [{ type: 'other', quote: '<img src=x onerror=alert(1)>' }] }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it('says that Claude is reading while the job is analysed', () => {
    expect(render(view({ analysing: 't1' }))).toContain('Claude is reading the description');
  });

  it('has Open and Download links for the PDF with the right href', () => {
    const html = render(view({ cv: { pdfUrl: '/api/resume/app1', driveUrl: null, lead: 'the settlement pipeline', chat: [] } }));
    expect(html).toMatch(/<a [^>]*href="\/api\/resume\/app1"[^>]*>Open<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/api\/resume\/app1"[^>]*download[^>]*>Download<\/a>/);
  });

  it('says in one line whether the CV is built', () => {
    expect(render(view())).toContain('Not built yet.');
    expect(render(view({ cv: { pdfUrl: '/api/resume/a', driveUrl: null, lead: 'x', chat: [] } }))).not.toContain('Not built yet.');
  });

  it('says in one line who can refer the user', () => {
    expect(render(view())).toContain('Anna Weber can refer you');
    expect(render(view({ routes: [] }))).toContain('No contact at Kestrel Pay yet');
  });

  it('shows a LaTeX failure next to Build', () => {
    const cv = { pdfUrl: '/api/resume/a', driveUrl: null, lead: null, tailored: false, reason: 'the CV did not compile: pdflatex failed:\n! Undefined control sequence.', chat: [] };
    const html = render(view({ cv }));
    expect(html).toContain('! Undefined control sequence.');
    expect(html).toContain('class="ui-error');
  });

  it('marks the open part for the phone screen', () => {
    expect(render(view(), {}, { part: 'wayin' })).toContain('data-part="wayin"');
    expect(render(view())).not.toContain('data-part');
  });
});

describe('Suggest wording without Claude', () => {
  it('names the failed self-test of the CLI', () => {
    expect(cliOffNote(true)).toBe('Claude CLI is off: it failed its self-test. The admin can read the reason on the health page.');
    expect(cliOffNote(false)).toBe('Add an API key in Settings to use Claude.');
    expect(suggestBlockedNote({ mode: 'none', cliOff: true })).toBe(cliOffNote(true));
    expect(suggestBlockedNote({ mode: 'none' })).toBe(cliOffNote(false));
    expect(suggestBlockedNote({ mode: 'own' })).toBeNull();
  });
});

describe('builtAgo', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('counts minutes, hours and days', () => {
    expect(builtAgo('2026-10-20T11:59:40Z', now)).toBe('just now');
    expect(builtAgo('2026-10-20T11:55:00Z', now)).toBe('5 minutes ago');
    expect(builtAgo('2026-10-20T10:00:00Z', now)).toBe('2 hours ago');
    expect(builtAgo('2026-10-19T11:00:00Z', now)).toBe('1 day ago');
  });
});
