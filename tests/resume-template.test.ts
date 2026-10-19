import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const latex = vi.hoisted(() => ({ real: false, compiled: [] as string[] }));
vi.mock('@/lib/latex', async (orig) => {
  const actual = await orig<typeof import('@/lib/latex')>();
  return {
    ...actual,
    findEngine: vi.fn((forced?: string | null) => (latex.real ? actual.findEngine(forced) : ({ program: 'pdflatex', bin: '/usr/bin/pdflatex' } as never))),
    compileLatex: vi.fn(async (opts: Parameters<typeof actual.compileLatex>[0]) => {
      if (latex.real) return actual.compileLatex(opts);
      latex.compiled.push(opts.source);
      mkdirSync(dirname(opts.outPdf), { recursive: true });
      writeFileSync(opts.outPdf, '%PDF-fake');
    }),
  };
});

import { publishCv, NO_RESUME } from '@/lib/cv';
import { db } from '@/lib/db';
import { baseFailure, ensureBaseResume } from '@/lib/resume/base';
import { compileLatex } from '@/lib/latex';
import { checkOwnTex } from '@/lib/resume/own-tex';
import { baseOrder, bestProjects, escapeLatex, renderTemplate, templateAssetsDir } from '@/lib/resume/template';
import { buildResume, resumeConfig } from '@/lib/resume';
import { checkDoc, type ClaimsDoc } from '@/lib/profile/doc';
import { saveProfile } from '@/lib/profile/store';
import { findOnPath } from '@/lib/exec';
import { makeUser } from './helpers/http';

let dir: string;
const saved = process.env.WAYPOINT_USERS_DIR;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'resume-template-'));
  process.env.WAYPOINT_USERS_DIR = dir;
});
afterAll(() => {
  if (saved === undefined) delete process.env.WAYPOINT_USERS_DIR;
  else process.env.WAYPOINT_USERS_DIR = saved;
  rmSync(dir, { recursive: true, force: true });
});

const project = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, org: null, description: null, url: null, tex: null, bullets: [], repoUrl: null, ...extra });
const claim = (slug: string, kind: string, evidence: { target: string; depth: string; since?: string }[]) => ({ slug, kind, label: slug.toUpperCase(), aliases: [], links: [], evidence, mentions: [] });

/** A profile with three projects. `deep` has the most and the deepest evidence. */
function sampleDoc(): ClaimsDoc {
  const raw = {
    version: 1,
    profile: { name: 'Jane Doe', headline: 'Backend engineer' },
    targets: {
      projects: [
        project('shallow', 'Shallow tool', { bullets: ['A small tool.'] }),
        project('deep', 'Deep system', { org: 'Acme', description: 'A big system.', bullets: ['Built it.', 'Ran it.'] }),
        project('mid', 'Mid service'),
      ],
      positions: [
        { id: 'job', title: 'Engineer', company: 'Acme', location: 'Berlin', start: '2023-01', end: null, summary: null, bullets: [{ id: 'b1', match: 'first thing written', text: 'Wrote the first thing.' }, { id: 'b2', match: 'second thing written', text: 'Wrote the second thing.' }] },
      ],
      educations: [{ id: 'uni', school: 'Uni', degree: 'BSc', field: 'CS', years: '2018-2022', aliases: [] }],
    },
    claims: [
      claim('kafka', 'skill', [{ target: 'project:deep', depth: 'built' }, { target: 'position:job/b2', depth: 'used' }]),
      claim('go', 'language', [{ target: 'project:deep', depth: 'built' }, { target: 'project:mid', depth: 'used' }]),
      claim('rust', 'skill', [{ target: 'project:mid', depth: 'mentioned' }]),
      claim('docker', 'skill', [{ target: 'project:shallow', depth: 'mentioned' }]),
    ],
  };
  const check = checkDoc(raw);
  if (!check.doc) throw new Error(check.errors.join('\n'));
  return check.doc;
}

describe('escapeLatex', () => {
  it.each([
    ['\\', '\\textbackslash{}'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['$', '\\$'],
    ['&', '\\&'],
    ['#', '\\#'],
    ['%', '\\%'],
    ['_', '\\_'],
    ['^', '\\textasciicircum{}'],
    ['~', '\\textasciitilde{}'],
    ['<', '\\textless{}'],
    ['>', '\\textgreater{}'],
    ['|', '\\textbar{}'],
  ])('escapes %s', (ch, out) => {
    expect(escapeLatex(`a${ch}b`)).toBe(`a${out}b`);
  });

  it('replaces the nine code points that T1 cannot print', () => {
    expect(escapeLatex('ĦħĸĿŀŉŦŧſ')).toBe('HhkLlnTts');
    expect(escapeLatex('Łódź 🚀')).toBe('Łódź');
  });

  it('turns a newline into a space and removes control characters', () => {
    expect(escapeLatex('one\n\ntwo\tthree\u0000\u0007four')).toBe('one two threefour');
  });

  it('leaves no single backslash that starts a macro', () => {
    const out = escapeLatex('\\input{/etc/passwd} \\write18{id} %x $y$');
    expect(out.replace(/\\(textbackslash\{\}|[{}$&#%_])/g, '')).not.toMatch(/\\/);
  });
});

describe('renderTemplate', () => {
  it('renders a project title with a macro as text', () => {
    const doc = sampleDoc();
    doc.targets.projects[0].title = '\\input{/etc/passwd}';
    const tex = renderTemplate(doc, {}, { projects: ['shallow'], bullets: [], skills: [] });
    expect(tex).toContain('\\textbackslash{}input\\{/etc/passwd\\}');
    expect(tex).not.toMatch(/\\input\b/);
    expect(checkOwnTex(tex)).toEqual({ ok: true });
  });

  it('shows the picked projects in the picked order and no others', () => {
    const tex = renderTemplate(sampleDoc(), {}, { projects: ['mid', 'deep'], bullets: ['job/b2'], skills: ['go'] });
    expect(tex.indexOf('Mid service')).toBeGreaterThan(-1);
    expect(tex.indexOf('Mid service')).toBeLessThan(tex.indexOf('Deep system'));
    expect(tex).not.toContain('Shallow tool');
    expect(tex).toContain('Wrote the second thing.');
    expect(tex).not.toContain('Wrote the first thing.');
    expect(tex).toContain('GO');
    expect(tex).not.toContain('KAFKA');
  });

  it('renders a profile with no projects', () => {
    const doc = sampleDoc();
    doc.targets.projects = [];
    doc.claims = [];
    const tex = renderTemplate(doc, {}, baseOrder(doc));
    expect(tex).not.toContain('PROJECTS');
    expect(tex).toContain('\\begin{document}');
    expect(checkOwnTex(tex)).toEqual({ ok: true });
  });

  it('passes checkOwnTex for the full sample', () => {
    const doc = sampleDoc();
    expect(checkOwnTex(renderTemplate(doc, {}, baseOrder(doc)))).toEqual({ ok: true });
  });
});

describe('bestProjects', () => {
  it('puts the project with the most and deepest evidence first', () => {
    expect(bestProjects(sampleDoc())).toEqual(['deep', 'mid', 'shallow']);
  });

  it('returns at most 4, breaks a tie by the newest date and then the title', () => {
    const doc = sampleDoc();
    doc.targets.projects = ['e', 'd', 'c', 'b', 'a'].map((id) => project(id, `Title ${id}`) as never);
    doc.claims = [claim('x', 'skill', [{ target: 'project:c', depth: 'used', since: '2024-01' }, { target: 'project:d', depth: 'used', since: '2025-01' }])] as never;
    const best = bestProjects(doc);
    expect(best).toHaveLength(4);
    expect(best.slice(0, 2)).toEqual(['d', 'c']);
    expect(best.slice(2)).toEqual(['a', 'b']);
  });
});

describe('base résumé', () => {
  const doc = sampleDoc();

  it('compiles once for one profile version and again after a profile save', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, doc, 'First');
    latex.compiled.length = 0;
    const first = await ensureBaseResume(user.id);
    expect('path' in first && first.path).toMatch(/resumes\/base-1\.pdf$/);
    expect(await ensureBaseResume(user.id)).toEqual(first);
    expect(latex.compiled).toHaveLength(1);
    expect(latex.compiled[0]).toContain('Deep system');

    await saveProfile(user.id, { ...doc, profile: { ...doc.profile, headline: 'Changed' } }, 'Second');
    const second = await ensureBaseResume(user.id);
    expect('path' in second && second.path).toMatch(/base-2\.pdf$/);
    expect(latex.compiled).toHaveLength(2);
    expect(readdirSync(join(dir, user.id, 'resumes')).filter((f) => f.startsWith('base-'))).toEqual(['base-2.pdf']);
  });

  it('stores the reason of a failed build with no key in it', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, doc, 'First');
    vi.mocked(compileLatex).mockRejectedValueOnce(new Error('pdflatex failed: x-api-key: plainkey123456 and sk-ant-api03-ABCDEF'));
    const out = await ensureBaseResume(user.id);
    expect(out).toMatchObject({ why: expect.stringContaining('[removed]') });
    const reason = await baseFailure(user.id);
    expect(reason).not.toMatch(/plainkey123456|sk-ant-api03/);
    expect(reason).toContain('[removed]');
  });

  it('queues one base task after a profile save, once', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, doc, 'First');
    await saveProfile(user.id, doc, 'Second');
    const tasks = await db.task.findMany({ where: { userId: user.id, kind: 'cv' } });
    expect(tasks).toHaveLength(1);
    expect(JSON.parse(tasks[0].payload)).toEqual({ action: 'base' });
    expect(tasks[0].dedupeKey).toBe(`cv-base:${user.id}`);
  });

  it('gives a member with a profile and no .tex a base CV, not NO_RESUME', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, doc, 'First');
    const job = await db.job.create({ data: { externalId: `rt-${user.id}`, source: 'Test', role: 'Engineer', company: 'Co', city: 'Berlin', cc: 'XA', url: 'https://x.test' } });
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id } });

    // The base CV is not built yet: a web request does not compile and asks the worker.
    const early = await publishCv(app, job, { compile: false });
    expect(early.resume).toBeNull();
    expect(early.driveReason).toMatch(/being built/);

    // The worker compiles the tailored CV.
    const built = await publishCv(app, job);
    expect(built.resume?.path).toMatch(/\.pdf$/);
    expect(built.driveReason).not.toBe(NO_RESUME);

    // Now a request without compile finds the base PDF.
    const path = (await ensureBaseResume(user.id)) as { path: string };
    expect((await resumeConfig(user.id)).pdf).toBe(path.path);
    const again = await publishCv(app, job, { compile: false });
    expect(again.resume?.path).toBeTruthy();
  });

  it('gives NO_RESUME to a member with no position and no project', async () => {
    const { user } = await makeUser();
    const empty = checkDoc({ version: 1, profile: { name: 'N', headline: '' }, targets: { projects: [], positions: [], educations: [] }, claims: [] }).doc!;
    await saveProfile(user.id, empty, 'Empty');
    expect(await ensureBaseResume(user.id)).toEqual({ why: NO_RESUME });
    const job = await db.job.create({ data: { externalId: `rt-e-${user.id}`, source: 'Test', role: 'Engineer', company: 'Co', city: 'Berlin', cc: 'XB', url: 'https://x.test' } });
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id } });
    expect((await publishCv(app, job)).driveReason).toBe(NO_RESUME);
  });

  it('gives a user with an own .tex no template base', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, doc, 'First');
    mkdirSync(join(dir, user.id, 'resumes'), { recursive: true });
    writeFileSync(join(dir, user.id, 'resumes', 'own.tex'), '\\documentclass{article}\\begin{document}x\\end{document}');
    await db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, resumeMode: 'own-tex', ownTex: 'own.tex' }, update: { resumeMode: 'own-tex', ownTex: 'own.tex' } });
    const cfg = await resumeConfig(user.id);
    expect(cfg).toMatchObject({ own: true, template: false, pdf: null, assetsDir: templateAssetsDir() });
    expect(await ensureBaseResume(user.id)).toMatchObject({ why: expect.any(String) });
    expect(existsSync(join(dir, user.id, 'resumes', 'base-1.pdf'))).toBe(false);
  });

  it('renders the template with the posting order for a tailored CV', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, doc, 'First');
    latex.compiled.length = 0;
    const r = await buildResume(user.id, doc, 'We need Rust and Go', 'app-t', {}, { outDir: join(dir, 'out') });
    expect(r?.path).toMatch(/app-t-[0-9a-f]{16}\.pdf$/);
    expect(latex.compiled).toHaveLength(1);
    expect(latex.compiled[0].indexOf('Mid service')).toBeLessThan(latex.compiled[0].indexOf('Shallow tool'));
  });

  it('keeps RESUME_TEX for an admin who never chose, and gives the template to an admin who removed the source', async () => {
    const admin = await makeUser('admin');
    vi.stubEnv('RESUME_TEX', '/srv/cv/cv.tex');
    try {
      expect(await resumeConfig(admin.user.id)).toMatchObject({ tex: '/srv/cv/cv.tex', template: false });
      await db.userSettings.create({ data: { userId: admin.user.id, resumeMode: 'template' } });
      expect(await resumeConfig(admin.user.id)).toMatchObject({ tex: null, template: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('a failed base build', () => {
  it('is shown, not queued again, and cleared by a new version', async () => {
    const { user } = await makeUser();
    const doc = sampleDoc();
    await saveProfile(user.id, doc, 'First');
    vi.mocked(compileLatex).mockRejectedValueOnce(new Error('pdflatex failed: ! Bad thing in /etc/secret/x.tex\nsecond line'));
    const r = await ensureBaseResume(user.id);
    expect(r).toEqual({ why: 'pdflatex failed: ! Bad thing in <path>' });
    expect(await baseFailure(user.id)).toBe('pdflatex failed: ! Bad thing in <path>');

    const job = await db.job.create({ data: { externalId: `rt-f-${user.id}`, source: 'Test', role: 'Engineer', company: 'Co', city: 'Berlin', cc: 'XC', url: 'https://x.test' } });
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id } });
    await db.task.deleteMany({ where: { userId: user.id } });
    const shown = await publishCv(app, job, { compile: false });
    expect(shown.driveReason).toBe('Waypoint could not build your base résumé: pdflatex failed: ! Bad thing in <path>');
    expect(await db.task.count({ where: { userId: user.id } })).toBe(0);

    // A profile save is a new version: the failure is gone and a base task is queued.
    await saveProfile(user.id, { ...doc, profile: { ...doc.profile, headline: 'New' } }, 'Second');
    expect(await baseFailure(user.id)).toBeNull();
    expect(await db.task.count({ where: { userId: user.id, kind: 'cv' } })).toBe(1);
    expect(await ensureBaseResume(user.id)).toHaveProperty('path');
  });

  it('blocks a new build for 30 minutes, then lets one pass', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sampleDoc(), 'First');
    const now = Date.now();
    const at = (minutes: number) => db.appState.upsert({ where: { key: `base-failed:${user.id}` }, create: { key: `base-failed:${user.id}`, value: '' }, update: {} }).then(() =>
      db.appState.update({ where: { key: `base-failed:${user.id}` }, data: { value: JSON.stringify({ version: 1, reason: 'timeout', at: now - minutes * 60_000 }) } }));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await at(29);
      expect(await ensureBaseResume(user.id)).toEqual({ why: 'timeout' });
      await db.task.deleteMany({ where: { userId: user.id } });
      await (await import('@/lib/resume/base')).queueBaseResume(user.id);
      expect(await db.task.count({ where: { userId: user.id } })).toBe(0);

      await at(31);
      expect(await baseFailure(user.id)).toBeNull();
      await (await import('@/lib/resume/base')).queueBaseResume(user.id);
      expect(await db.task.count({ where: { userId: user.id } })).toBe(1);
      expect(await ensureBaseResume(user.id)).toHaveProperty('path');
    } finally {
      clock.mockRestore();
    }
  });

  it('a good build clears the record', async () => {
    const { user } = await makeUser();
    await saveProfile(user.id, sampleDoc(), 'First');
    await db.appState.create({ data: { key: `base-failed:${user.id}`, value: JSON.stringify({ version: 0, reason: 'old', at: Date.now() }) } });
    expect(await ensureBaseResume(user.id)).toHaveProperty('path');
    expect(await db.appState.count({ where: { key: `base-failed:${user.id}` } })).toBe(0);
  });
});

describe('a real compile', () => {
  const have = !!findOnPath('pdflatex');

  it.skipIf(!have)('compiles the template with every special character in the profile', async () => {
    const doc = sampleDoc();
    doc.profile.name = 'Jane \\ { } $ & # % _ ^ ~ < > | [ ] Doe';
    doc.targets.projects[1].title = '\\input{/etc/passwd} \\write18{id}';
    doc.targets.projects[1].description = 'Line one\n\nLine two with emoji 🚀 and ünïcode';
    doc.targets.projects[1].bullets = ['[x] starts with a bracket', '100% of $5 & more_things'];
    const out = join(dir, 'real', 'base.pdf');
    latex.real = true;
    try {
      const { compileLatex, findEngine } = await import('@/lib/latex');
      const engine = findEngine('pdflatex')!;
      await compileLatex({ source: renderTemplate(doc, {}, baseOrder(doc)), assetsDir: templateAssetsDir(), outPdf: out, engine, timeoutMs: 60_000 });
    } finally {
      latex.real = false;
    }
    expect(existsSync(out)).toBe(true);
  }, 90_000);

  it.skipIf(!have)('compiles every code point of U+00A0 to U+017F in one field', async () => {
    const all = Array.from({ length: 0x17f - 0xa0 + 1 }, (_, i) => String.fromCodePoint(0xa0 + i)).join('');
    const doc = sampleDoc();
    doc.targets.projects[1].description = all;
    doc.profile.headline = all;
    const out = join(dir, 'real-all', 'base.pdf');
    latex.real = true;
    try {
      const { compileLatex: real, findEngine } = await import('@/lib/latex');
      await real({ source: renderTemplate(doc, {}, baseOrder(doc)), assetsDir: templateAssetsDir(), outPdf: out, engine: findEngine('pdflatex')!, timeoutMs: 60_000 });
    } finally {
      latex.real = false;
    }
    expect(existsSync(out)).toBe(true);
  }, 90_000);
});
