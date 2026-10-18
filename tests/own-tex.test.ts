import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const compile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/gdrive', async (orig) => ({
  ...(await orig<typeof import('@/lib/gdrive')>()),
  shareResume: vi.fn(async () => ({ url: 'https://drive.test/f', id: 'd1', reason: null })),
}));
vi.mock('@/lib/user', async (orig) => ({
  ...(await orig<typeof import('@/lib/user')>()),
  claimsFor: vi.fn(async () => ({ claims: [], targets: { projects: [], positions: [], educations: [] } }) as never),
}));
vi.mock('@/lib/latex', async (orig) => ({
  ...(await orig<typeof import('@/lib/latex')>()),
  compileLatex: compile,
  findEngine: vi.fn(() => ({ program: 'pdflatex', bin: '/usr/bin/pdflatex' }) as never),
}));

import { DRIVE_ADMIN_ONLY, publishCv } from '@/lib/cv';
import { shareResume } from '@/lib/gdrive';
import { checkOwnTex, ownTexDir, ownTexPath } from '@/lib/resume/own-tex';
import { db } from '@/lib/db';
import { buildResume, resumeConfig } from '@/lib/resume';
import { getSettings } from '@/lib/settings';
import * as route from '@/app/api/resume/own-tex/route';
import { ctx, formRequest, makeUser, request } from './helpers/http';

let dir: string;
const saved = process.env.WAYPOINT_USERS_DIR;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'own-tex-'));
  process.env.WAYPOINT_USERS_DIR = dir;
});
afterAll(() => {
  if (saved === undefined) delete process.env.WAYPOINT_USERS_DIR;
  else process.env.WAYPOINT_USERS_DIR = saved;
  rmSync(dir, { recursive: true, force: true });
});

const GOOD = '\\documentclass{article}\n\\begin{document}\nJane Doe\n\\input{sections/exp}\n\\end{document}\n';

const upload = async (cookie: string, text: string, name = 'cv.tex') => {
  const form = new FormData();
  form.set('file', new File([text], name, { type: 'text/x-tex' }));
  return route.PUT(await formRequest('/api/resume/own-tex', form, { cookie, method: 'PUT' }), ctx());
};

describe('checkOwnTex', () => {
  it('accepts a plain file and a relative \\input', () => {
    expect(checkOwnTex(GOOD)).toEqual({ ok: true });
    expect(checkOwnTex('\\input sections/exp.tex')).toEqual({ ok: true });
    expect(checkOwnTex('\\color[rgb]{0.2,0.2,0.2}x \\color{black} \\textcolor[HTML]{102030}{x}')).toEqual({ ok: true });
  });

  const refused: [string, string][] = [
    ['\\write18', '\\immediate\\write18{ls}'],
    ['\\immediate\\write', '\\immediate\\write\\x{y}'],
    ['\\openin', '\\openin5=secret'],
    ['\\openout', '\\openout5=x.txt'],
    ['\\catcode', '\\catcode`\\%=12'],
    ['shellesc', '\\usepackage{shellesc}'],
    ['shellesc in a list', '\\usepackage[a]{graphicx, shellesc}'],
    ['\\csname', '\\csname foo\\endcsname'],
    ['\\if0', '\\if00 hidden \\fi'],
    ['\\phantom', '\\phantom{Secret text}'],
    ['^^ notation', '^^5cwrite18'],
    ['absolute path', '\\input{/etc/passwd}'],
    ['dotdot', '\\include{../x}'],
    ['tilde', '\\InputIfFileExists{~/x}{}{}'],
    ['unbraced absolute', '\\input /etc/passwd'],
    ['a macro as path', '\\input{\\foo}'],
    ['pipe', '\\input{|ls}'],
    ['white', '\\color{white} x'],
    ['textcolor white', '\\textcolor{white}{x}'],
    ['rgb near white', '\\color[rgb]{0.95,0.99,1}x'],
    ['RGB near white', '\\textcolor[RGB]{250,245,240}{x}'],
    ['HTML near white', '\\color[HTML]{F5F0FF}x'],
    ['gray near white', '\\color[gray]{0.97}x'],
    ['defined near white', '\\definecolor{pale}{rgb}{1,1,0.96}\n\\textcolor{pale}{x}'],
    ['\\directlua', '\\directlua{io.open("/etc/passwd")}'],
    ['\\luaexec', '\\luaexec{x}'],
    ['\\luadirect', '\\luadirect{x}'],
    ['\\latelua', '\\latelua{x}'],
    ['\\lua_now', '\\ExplSyntaxOn \\lua_now:e { x }'],
    ['\\lua_shipout', '\\lua_shipout:e { x }'],
    ['\\tex_directlua', '\\tex_directlua:D{x}'],
    ['luacode package', '\\usepackage{luacode}'],
    ['luacode environment', '\\begin{luacode*}x\\end{luacode*}'],
    ['white!95', '\\color{white!95}x'],
    ['white!98!black', '\\textcolor{white!98!black}{x}'],
    ['black!3 (mostly white)', '\\color{black!3}x'],
    ['cmyk white', '\\color[cmyk]{0,0,0,0}x'],
    ['Gray 15', '\\color[Gray]{15}x'],
    ['rgb with spaces', '\\color[rgb]{1 1 1}x'],
    ['colorlet', '\\colorlet{p}{white}\\textcolor{p}{x}'],
    ['colorlet mix', '\\colorlet{p}{white!96}\\color{p}x'],
    ['definecolor named', '\\definecolor{p}{named}{white}\\color{p}x'],
    ['definecolor cmyk', '\\definecolor{p}{cmyk}{0,0,0,0.02}\\color{p}x'],
    ['comment before the argument', '\\textcolor%\n{white}{x}'],
    ['hphantom', '\\hphantom{Secret}'],
    ['vphantom', '\\vphantom{Secret}'],
    ['scalebox', '\\scalebox{0.01}{Secret}'],
    ['resizebox', '\\resizebox{0.05\\textwidth}{!}{Secret}'],
    ['hidden marker iffalse', '\\iffalse secret \\fi'],
    ['hidden marker comment', '\\begin{comment}x\\end{comment}'],
    ['hidden marker tiny font', '\\fontsize{2}{3}\\selectfont x'],
  ];
  for (const [name, text] of refused) {
    it(`refuses ${name}`, () => {
      const r = checkOwnTex(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.length).toBeGreaterThan(0);
    });
  }

  it('allows a near-white definition that nothing uses, and mid colours', () => {
    expect(checkOwnTex('\\definecolor{pale}{rgb}{1,1,0.96}')).toEqual({ ok: true });
    expect(checkOwnTex('\\color[rgb]{0.95,0.5,1}x')).toEqual({ ok: true });
    expect(checkOwnTex('\\color[HTML]{F5F0A0}x')).toEqual({ ok: true });
    expect(checkOwnTex('\\color{white!50!black}x \\color{black!80} \\color[cmyk]{0,0,0,1} \\scalebox{0.9}{x} 100\\% \\hspace{1pt}')).toEqual({ ok: true });
    expect(checkOwnTex('% \\directlua{x}\nHello')).toEqual({ ok: true });
  });

  it('refuses a file over 1 MB and checks long input fast', () => {
    expect(checkOwnTex('a'.repeat(1024 * 1024 + 1)).ok).toBe(false);
    const t = Date.now();
    checkOwnTex('\\color[rgb]{' + '1,'.repeat(200_000) + '\\input{' + ' '.repeat(300_000));
    checkOwnTex('\\definecolor{a}{rgb}{' + '9'.repeat(500_000));
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('/api/resume/own-tex', () => {
  it('saves a good file, sets the mode, and reads it back', async () => {
    const u = await makeUser();
    const res = await upload(u.cookie, GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'own-tex', hasOwnTex: true });
    expect(readFileSync(ownTexPath(u.user.id), 'utf8')).toBe(GOOD);
    expect(readdirSync(ownTexDir(u.user.id))).toEqual(['own.tex']);
    const get = await route.GET(request('/api/resume/own-tex', { cookie: u.cookie }), ctx());
    expect(await get.json()).toEqual({ mode: 'own-tex', hasOwnTex: true });
    expect((await getSettings(u.user.id)).ownTex).toBe('own.tex');
  });

  it('answers 400 with the reason, saves nothing, and keeps the old file', async () => {
    const u = await makeUser();
    const bad = await upload(u.cookie, '\\immediate\\write18{id}');
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error).toContain('\\write18');
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(existsSync(ownTexPath(u.user.id))).toBe(false);
    expect((await getSettings(u.user.id)).resumeMode).toBe('template');

    await upload(u.cookie, GOOD);
    expect((await upload(u.cookie, '\\catcode`\\a=1')).status).toBe(400);
    expect(readFileSync(ownTexPath(u.user.id), 'utf8')).toBe(GOOD);
  });

  it('refuses a file that is not a .tex text file', async () => {
    const u = await makeUser();
    expect((await upload(u.cookie, GOOD, 'cv.pdf')).status).toBe(400);
    expect((await upload(u.cookie, '%PDF-1.4 x', 'cv.tex')).status).toBe(400);
  });

  it('DELETE removes the file and sets the mode to template', async () => {
    const u = await makeUser();
    await upload(u.cookie, GOOD);
    const res = await route.DELETE(request('/api/resume/own-tex', { method: 'DELETE', cookie: u.cookie }), ctx());
    expect(await res.json()).toEqual({ mode: 'template', hasOwnTex: false });
    expect(existsSync(ownTexPath(u.user.id))).toBe(false);
  });

  it('keeps the file of each user apart', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await upload(a.cookie, GOOD);
    const seen = await route.GET(request('/api/resume/own-tex', { cookie: b.cookie }), ctx());
    expect(await seen.json()).toEqual({ mode: 'template', hasOwnTex: false });
    await upload(b.cookie, `${GOOD}% B\n`);
    expect(readFileSync(ownTexPath(a.user.id), 'utf8')).toBe(GOOD);
    await route.DELETE(request('/api/resume/own-tex', { method: 'DELETE', cookie: b.cookie }), ctx());
    expect(existsSync(ownTexPath(a.user.id))).toBe(true);
  });
});

describe('resumeConfig and buildResume', () => {
  it('gives a member with an own .tex that file, and a member without one no source', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await upload(a.cookie, GOOD);
    expect(await resumeConfig(a.user.id)).toMatchObject({ pdf: null, tex: ownTexPath(a.user.id), assetsDir: null });
    expect(await resumeConfig(b.user.id)).toMatchObject({ pdf: null, tex: null, assetsDir: null });
  });

  it('keeps RESUME_TEX and RESUME_PDF for the admin only', async () => {
    const admin = await makeUser('admin');
    const member = await makeUser();
    vi.stubEnv('RESUME_TEX', '/srv/cv/cv.tex');
    vi.stubEnv('RESUME_PDF', '/srv/cv/cv.pdf');
    try {
      expect(await resumeConfig(admin.user.id)).toMatchObject({ tex: '/srv/cv/cv.tex', pdf: '/srv/cv/cv.pdf', assetsDir: '/srv/cv' });
      expect(await resumeConfig(member.user.id)).toMatchObject({ tex: null, pdf: null });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('compiles the own source of a member', async () => {
    const m = await makeUser();
    await upload(m.cookie, GOOD);
    compile.mockClear();
    const doc = { claims: [], targets: { projects: [], positions: [], educations: [] } } as never;
    const out = join(dir, 'out');
    const r = await buildResume(m.user.id, doc, 'Rust engineer', 'app1', {}, { outDir: out });
    expect(r?.path).toMatch(/app1-[0-9a-f]{16}\.pdf$/);
    expect(compile).toHaveBeenCalledTimes(1);
    const arg = (compile.mock.calls[0] as unknown as [{ source: string; assetsDir: string }])[0];
    expect(arg.source).toContain('Jane Doe');
    expect(arg.assetsDir).toBeNull();
  });

  it('gives a member with no source no CV', async () => {
    const m = await makeUser();
    expect(await buildResume(m.user.id, null, 'x', 'app2', {}, { outDir: dir })).toBeNull();
  });
});

describe('publishCv', () => {
  it('never calls Drive for a member, and gives the reason', async () => {
    const m = await makeUser();
    await upload(m.cookie, GOOD);
    const job = await db.job.create({ data: { externalId: `ot-${m.user.id}`, source: 'Test', role: 'Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test' } });
    const app = await db.application.create({ data: { userId: m.user.id, jobId: job.id } });
    vi.mocked(shareResume).mockClear();
    const out = await publishCv(app, job);
    expect(out.resume?.path).toBeTruthy();
    expect(shareResume).not.toHaveBeenCalled();
    expect(out).toMatchObject({ driveUrl: null, driveReason: DRIVE_ADMIN_ONLY });
  });
});
