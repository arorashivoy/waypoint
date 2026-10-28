import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latexLogExcerpt } from '@/lib/latex-log';
import { cleanLog, compileLatex, findEngine } from '@/lib/latex';
import { BLOCKER_LABEL, LEGITIMACY_LABEL } from '@/lib/jobcheck-text';
import { topRequirements, type Requirement } from '@/components/job/requirements';
import { longAgo as builtAgo } from '@/lib/time-ago';
import { JobBody } from '@/components/job/JobBody';
import { cliOffNote, errorParts, suggestBlockedNote } from '@/components/job/CvSection';
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

  it('does not let ".." climb out of the user folder', () => {
    expect(latexLogExcerpt(`! File ${dir}/../../etc/shadow not found`, dir)).toBe('! File shadow not found');
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
  it('hedges the seniority label, so it claims no fact about the user', () => {
    expect(BLOCKER_LABEL.seniority).toBe('Asks for more years of work than you may have');
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
  recruiter: null,
  coldEmail: null,
  alumni: null,
  wording: null,
  answers: null,
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
  answers: job.answers,
  answersBusy: null,
  answersError: null,
  cvError: null,
  blocked: false,
  wayError: null,
  applyError: null,
  cvRev: 0,
  claudeNote: null,
  findContact: vi.fn(async () => {}),
  findAlumni: vi.fn(async () => {}),
  findRecruiter: vi.fn(async () => {}),
  draftEmail: vi.fn(async () => {}),
  approveEmail: vi.fn(async () => {}),
  markApplied: vi.fn(async () => {}),
  generate: noop,
  refine: noop,
  reset: noop,
  suggest: noop,
  decide: noop,
  original: noop,
  answer: noop,
  refineAnswers: noop,
  saveAnswers: noop,
  setToast: () => {},
  ...o,
});

const render = (job: JobView, o: Partial<JobDetailState> = {}, props: { part?: 'wayin' | 'cv' | 'answers' | null } = {}) =>
  renderToStaticMarkup(h(JobBody, { d: state(job, o), part: props.part ?? null, onPart: () => {}, onClose: () => {} }));

describe('the recruiter email', () => {
  it('shows the find button, also for a job that is marked as applied', () => {
    const html = render(view({ isApplied: true }));
    expect(html).toContain('Find the recruiter’s email');
  });
  it('shows the draft button once a recruiter is found', () => {
    const html = render(view({ isApplied: true, recruiter: { name: 'Mia Fischer', email: 'mia@kestrel.test', why: 'Talent Acquisition, 92% sure' } }));
    expect(html).toContain('Mia Fischer');
    expect(html).toContain('Draft a cold email');
  });
  it('shows the approve button for a draft that is not approved', () => {
    const html = render(view({ recruiter: { name: 'Mia Fischer', email: 'mia@kestrel.test', why: null }, coldEmail: { id: 'e1', name: 'Mia Fischer', email: 'mia@kestrel.test', subject: 'Subject', body: 'Body', approved: false } }));
    expect(html).toContain('Approve and open Gmail');
    expect(html).not.toContain('Open in Gmail');
  });
});

describe('the job detail', () => {
  it('shows header, fit, way in, CV and apply bar in this order', () => {
    const html = render(view());
    const at = ['jd-header', 'jd-fit', 'jd-wayin', 'jd-cv', 'jd-answers', 'jd-bar'].map((c) => html.indexOf(`class="${c}`));
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

  it('shows a failed apply next to the button, with Try again', () => {
    const html = render(view(), { applyError: 'The server is not reachable.' });
    expect(html).toContain('The server is not reachable.');
    expect(html).toContain('Try again');
    expect(render(view())).not.toContain('Try again');
  });

  it('opens the fold of the part in the URL, so a turn to landscape keeps the place', () => {
    const html = render(view(), {}, { part: 'cv' });
    expect(html).toMatch(/<section class="jd-cv">[\s\S]*?data-open="true"/);
    expect(html).toMatch(/<section class="jd-wayin">[\s\S]*?data-open="false"/);
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

describe('the polish of the job detail', () => {
  const cv = { pdfUrl: '/api/resume/a', driveUrl: null, lead: 'x', chat: [] };

  it('hides the refine field when Claude cannot run, and says why', () => {
    const off = render(view({ cv }), { claudeNote: 'Add an API key in Settings to use Claude.' });
    expect(off).not.toContain('What to change');
    expect(off).toContain('Add an API key in Settings to use Claude.');
    expect(render(view({ cv }))).toContain('What to change');
  });

  it('lists what the written CV changed, with Use my original on each line', () => {
    const changes = [{ id: 'g/v', kind: 'bullet' as const, old: 'Built a Python validator', now: 'Built a Python validator for test evidence' }];
    const html = render(view({ cv: { ...cv, changes, droppedLines: [{ id: 'g/v', why: 'the technology "kubernetes" is not in the bullet or the proofs' }] } }));
    expect(html).toContain('What changed');
    expect(html).toMatch(/class="[^"]*jd-struck[^"]*"[^>]*>Built a Python validator</);
    expect(html).toContain('Built a Python validator for test evidence');
    expect(html).toContain('Use my original');
    expect(html).toContain('Not used');
    expect(html).toContain('the technology &quot;kubernetes&quot; is not in the bullet or the proofs');
  });

  it('shows no change list when nothing changed', () => {
    expect(render(view({ cv: { ...cv, changes: [], droppedLines: [] } }))).not.toContain('What changed');
  });

  it('says one time why Claude cannot run, above the Claude tools', () => {
    const note = 'Add an API key in Settings to use Claude.';
    // Count in the CV section only: the questions section says the same on its own screen.
    const off = render(view({ cv }), { claudeNote: note }).split('class="jd-answers')[0];
    expect(off.split(note).length - 1).toBe(1);
    expect(off.indexOf(note)).toBeLessThan(off.indexOf('Refine with Claude'));
    expect(off).toContain('aria-describedby="jd-claude-note"');
  });

  it('tells the user what to do after a LaTeX failure', () => {
    const p = errorParts('pdflatex failed:\n! Undefined control sequence.\nl.42 \\x');
    expect(p.what).toBe('The CV did not build (pdflatex failed).');
    expect(p.fix).toBe('Correct the line below in your .tex file, then press Rebuild CV.');
    expect(p.detail).toBe('! Undefined control sequence.\nl.42 \\x');
    expect(errorParts('The server is not reachable.').fix).toBe('The server is not reachable.');
  });

  it('uses the reason of the server when the shared key is at its cap', () => {
    expect(suggestBlockedNote({ mode: 'none', detail: 'You used this month\'s limit of $5.00 on the shared key. It resets on 1 Nov.' })).toContain('It resets on 1 Nov.');
    expect(suggestBlockedNote({ mode: 'none', cliOff: true, detail: 'x' })).toBe(cliOffNote(true));
  });

  it('writes the visa note as its own sentence', () => {
    expect(render(view({ visa: 'Sponsorship not stated' }))).toContain('Kestrel Pay, Berlin, hybrid. Sponsorship not stated. Posted');
  });

  it('shows a legitimacy flag as a quiet line, not a box', () => {
    const html = render(view({ legitimacy: ['reposted'] }));
    expect(html).toMatch(/class="jd-flag"[^>]*>[^<]*old post/);
  });

  it('keeps the score parts in a quiet fold', () => {
    expect(render(view())).toMatch(/class="ui-fold ui-fold-quiet"[\s\S]*How this score was made/);
  });

  it('names the referral action by what it does', () => {
    expect(render(view())).toContain('Draft the request');
    expect(render(view())).not.toContain('Send request');
  });

  it('shows the PDF page note when a CV has more pages than the preview', async () => {
    const { pageNote } = await import('@/components/job/PdfPreview');
    expect(pageNote(3)).toBeNull();
    expect(pageNote(4)).toBeNull();
    expect(pageNote(7)).toBe('Page 1 to 4 of 7. Use Open to see all.');
  });
});

describe('the application questions section', () => {
  const answers = {
    questions: '1. Why us?\n2. Notice period?',
    text: 'Q1. I like releases.\nQ2. [ADD: your notice period]',
    chat: [{ role: 'claude' as const, text: 'One gap: notice period.' }, { role: 'you' as const, text: 'make Q1 shorter' }],
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  };

  it('comes after the CV and before the apply bar', () => {
    const html = render(view());
    expect(html.indexOf('class="jd-cv')).toBeLessThan(html.indexOf('class="jd-answers'));
    expect(html.indexOf('class="jd-answers')).toBeLessThan(html.indexOf('class="jd-bar'));
  });

  it('asks for the questions first and has no answer box yet', () => {
    const html = render(view());
    expect(html).toContain('Application questions');
    expect(html).toContain('Paste the questions of the form');
    expect(html).toContain('Answer with Claude');
    expect(html).toContain('0 of 4000 characters');
    expect(html).not.toContain('Copy all');
    expect(html).not.toContain('What to change');
  });

  it('shows the saved questions, the answer in an editable box, Copy all, Save changes and the chat', () => {
    const html = render(view({ answers }));
    expect(html).toContain('Answered 2 hours ago');
    expect(html).toContain('1. Why us?');
    expect(html).toContain('Q1. I like releases.');
    expect(html).toContain('Copy all');
    expect(html).toContain('Save changes');
    expect(html).toContain('One gap: notice period.');
    expect(html).toMatch(/jd-turn jd-turn-you">make Q1 shorter/);
    expect(html).toContain('What to change');
    expect(html).toContain('Change the answers, 1 change');
  });

  it('works for a job that is marked as applied', () => {
    const html = render(view({ isApplied: true, isSent: true, answers }));
    expect(html).toContain('Answer with Claude');
    expect(html).toContain('Copy all');
  });

  it('shows the text of the answers as text, not as a tag', () => {
    const html = render(view({ answers: { ...answers, text: 'Hello <script>alert(1)</script>' } }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('disables the buttons and says why when Claude cannot run', () => {
    const note = 'Add an API key in Settings to use Claude.';
    const html = render(view({ answers }), { claudeNote: note });
    expect(html).toContain(note);
    expect(html).toContain('aria-describedby="jd-answers-note"');
    expect(html).not.toContain('What to change');
  });

  it('shows the error of an answers action next to the button', () => {
    const html = render(view(), { answersError: 'Not sent to Claude: it asks for the system prompt. Remove that text.' });
    expect(html).toContain('Claude could not answer.');
    expect(html).toContain('Remove that text.');
  });

  it('opens the fold of the part in the URL, and marks the part for the phone screen', () => {
    const html = render(view(), {}, { part: 'answers' });
    expect(html).toMatch(/<section class="jd-answers">[\s\S]*?data-open="true"/);
    expect(html).toContain('data-part="answers"');
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

describe('the pdf.js worker', () => {
  it('is served from public/ as a copy of the package file', () => {
    const pkg = readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
    expect(readFileSync('public/pdfjs/pdf.worker.min.mjs').equals(pkg)).toBe(true);
  });
});

describe('the LaTeX error the server sends', () => {
  it('cleanLog keeps only error lines, at most 20, with no host path', () => {
    const log = ['This is pdfTeX', ...Array.from({ length: 40 }, (_, i) => `! Error ${i} in /home/x/secret/a.tex`)].join('\n');
    const out = cleanLog(log, '/tmp/waypoint-cv-abc');
    expect(out.split('\n')).toHaveLength(20);
    expect(out).not.toMatch(/\/home|\/tmp/);
    expect(out).toContain('a.tex');
  });

  it('cleanLog keeps the line number after each error and the error lines of tectonic', () => {
    const log = ['This is pdfTeX', '! Undefined control sequence.', '<argument> \\resumeItemm', 'l.42 \\resumeItemm{x}', 'l.50 not this one', 'error: tailored.tex:7: Missing $ inserted', 'warning: ignored'].join('\n');
    expect(cleanLog(log, '/tmp/w').split('\n')).toEqual(['! Undefined control sequence.', 'l.42 \\resumeItemm{x}', 'error: tailored.tex:7: Missing $ inserted']);
  });

  it.skipIf(!findEngine())('a failed compile throws only the excerpt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jd-'));
    try {
      const err = await compileLatex({ source: '\\documentclass{article}\\begin{document}\\badcommand \\input{/etc/hostname}\\end{document}', assetsDir: null, outPdf: join(dir, 'o.pdf'), engine: findEngine()!, timeoutMs: 60_000 }).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      expect(err!.message.split('\n').length).toBeLessThanOrEqual(21);
      expect(err!.message).not.toMatch(/(^|[\s(])\/[\w.]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
