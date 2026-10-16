import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

const ADMIN_DOC = { sentinel: 'admin-only-claims' };
vi.mock('@/lib/claims', async (orig) => ({
  ...(await orig<typeof import('@/lib/claims')>()),
  loadClaims: vi.fn(() => ADMIN_DOC),
}));
vi.mock('@/lib/claude/credential', async (orig) => ({
  ...(await orig<typeof import('@/lib/claude/credential')>()),
  credentialFor: vi.fn(async () => null),
}));

import { db } from '@/lib/db';
import { claimsFor } from '@/lib/user';
import { analyseJob, jobView } from '@/lib/analysis';
import { buildCv, publishCv } from '@/lib/cv';
import { checkExportUpload } from '@/lib/linkedin-import';
import { makeUser } from './helpers/http';

const job = () =>
  db.job.create({
    data: { externalId: `iso-${randomBytes(6).toString('hex')}`, source: 'Test', role: 'Backend Engineer', company: 'Acme', city: 'Berlin', cc: 'DE', url: 'https://x.test', description: 'Java and Kotlin services.' },
  });

describe('claimsFor', () => {
  it('gives claims.yml to the admin only', async () => {
    const admin = await makeUser('admin');
    const member = await makeUser('member');
    expect(await claimsFor(admin.user.id)).toBe(ADMIN_DOC);
    expect(await claimsFor(member.user.id)).toBeNull();
  });
});

describe('analyses', () => {
  it("writes the analysis of user A only to A's row", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const j = await job();
    await analyseJob(j, a.user.id);
    const rows = await db.jobAnalysis.findMany({ where: { jobId: j.id } });
    expect(rows.map((r) => r.userId)).toEqual([a.user.id]);
    expect(rows[0].tries).toBe(1);
    const viewB = await jobView(j, b.user.id);
    expect(viewB.provisional).toBe(true);
  });

  it('does not change the global job fields', async () => {
    const a = await makeUser();
    const j = await job();
    await analyseJob(j, a.user.id);
    const after = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    expect({ field: after.field, mode: after.mode, level: after.level, visa: after.visa }).toEqual({ field: j.field, mode: j.mode, level: j.level, visa: j.visa });
  });
});

describe('résumé', () => {
  beforeEach(() => {
    vi.stubEnv('RESUME_PDF', '/tmp/admin-resume.pdf');
  });

  it("never gives the admin's résumé to a member", async () => {
    const member = await makeUser('member');
    const j = await job();
    const app = await db.application.create({ data: { userId: member.user.id, jobId: j.id } });
    expect(await buildCv(app, j)).toBeNull();
    const p = await publishCv(app, j);
    expect(p.resume).toBeNull();
    expect(p.driveReason).toMatch(/No résumé/);
    vi.unstubAllEnvs();
  });
});

describe('checkExportUpload', () => {
  it('accepts a zip and a CSV file', async () => {
    const zip = new File([Buffer.from('PK\x03\x04rest-of-zip')], 'export.zip');
    expect((await checkExportUpload(zip)).subarray(0, 2).toString()).toBe('PK');
    const csv = new File(['First Name,Last Name\nA,B\n'], 'Connections.csv');
    expect((await checkExportUpload(csv)).length).toBeGreaterThan(0);
  });

  it('refuses a file with a false name and a file over 50 MB', async () => {
    const exe = new File([Buffer.from('MZ\x90\x00binary\x00\x00')], 'Connections.csv');
    await expect(checkExportUpload(exe)).rejects.toMatchObject({ status: 400 });
    const pdf = new File([Buffer.from('%PDF-1.7')], 'export.zip');
    await expect(checkExportUpload(pdf)).rejects.toMatchObject({ status: 400 });
    const big = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'export.zip');
    await expect(checkExportUpload(big)).rejects.toMatchObject({ status: 413 });
  });
});
