import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { POST as importExport } from '@/app/api/profile/import/route';
import { db } from '@/lib/db';
import { listDrafts } from '@/lib/profile/drafts';
import { linkedinDrafts, MAX_EXPORT_BYTES, MAX_UNPACKED_BYTES, parseExport } from '@/lib/linkedin-import';
import { ctx, formRequest, makeUser } from './helpers/http';

const CONNECTIONS = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nNew,Person,,,Beta,Dev,01 Jan 2025\n';

const csvForm = () => {
  const form = new FormData();
  form.set('file', new File([CONNECTIONS], 'Connections.csv'));
  return form;
};

/** A small zip whose central directory claims that each entry unpacks to `claimed` bytes. */
function zipThatClaims(claimed: number): Buffer {
  const zip = new AdmZip();
  zip.addFile('Connections.csv', Buffer.from(CONNECTIONS));
  zip.addFile('Positions.csv', Buffer.from('Company Name,Title\nAcme,Dev\n'));
  const buf = zip.toBuffer();
  // Central directory header: signature PK\x01\x02, uncompressed size at byte 24.
  for (let at = buf.indexOf('PK\x01\x02', 0, 'latin1'); at !== -1; at = buf.indexOf('PK\x01\x02', at + 4, 'latin1')) {
    buf.writeUInt32LE(claimed, at + 24);
  }
  return buf;
}

describe('POST /api/profile/import: size checks before the body is read', () => {
  it('refuses an upload without Content-Length with 411', async () => {
    const { cookie } = await makeUser();
    const res = await importExport(await formRequest('/api/profile/import', csvForm(), { cookie, headers: { 'content-length': null } }), ctx());
    expect(res.status).toBe(411);
    expect(await res.json()).toEqual({ error: 'Send the file with a Content-Length header.' });
  });

  it('refuses a Content-Length that is not a number with 400', async () => {
    const { cookie } = await makeUser();
    const res = await importExport(await formRequest('/api/profile/import', csvForm(), { cookie, headers: { 'content-length': 'lots' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('refuses a Content-Length above 50 MB plus 1 MB with 413', async () => {
    const { cookie } = await makeUser();
    const big = String(MAX_EXPORT_BYTES + 1024 * 1024 + 1);
    const res = await importExport(await formRequest('/api/profile/import', csvForm(), { cookie, headers: { 'content-length': big } }), ctx());
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'The file is larger than 50 MB.' });
  });

  it('accepts a correct Content-Length', async () => {
    const { cookie } = await makeUser();
    const res = await importExport(await formRequest('/api/profile/import', csvForm(), { cookie }), ctx());
    expect(res.status).toBe(200);
  });

  it('refuses a zip that unpacks to more than 200 MB with 413', async () => {
    const { cookie } = await makeUser();
    const form = new FormData();
    form.set('file', new File([new Uint8Array(zipThatClaims(150 * 1024 * 1024))], 'export.zip'));
    const res = await importExport(await formRequest('/api/profile/import', form, { cookie }), ctx());
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/200 MB/);
  });
});

describe('parseExport: unpacked size', () => {
  it('refuses the archive from the header sizes, before it unpacks an entry', () => {
    expect(MAX_UNPACKED_BYTES).toBe(200 * 1024 * 1024);
    expect(() => parseExport(zipThatClaims(150 * 1024 * 1024))).toThrow(/200 MB/);
  });

  it('reads an archive under the cap', () => {
    const zip = new AdmZip();
    zip.addFile('Connections.csv', Buffer.from(CONNECTIONS));
    expect(parseExport(zip.toBuffer()).contacts).toHaveLength(1);
  });
});

function archive(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text, 'utf8'));
  return zip.toBuffer();
}

const FULL = {
  'Profile.csv': 'First Name,Last Name,Headline\nTest,User,Backend engineer at Acme\n',
  'Positions.csv': 'Company Name,Title,Description,Location,Started On,Finished On\nAcme,Developer,Builds things.,Berlin,Mar 2024,\n',
  'Education.csv': 'School Name,Start Date,End Date,Notes,Degree Name\nTU,2019,2023,CS,BSc\n',
  'Projects.csv': 'Title,Description,Url,Started On,Finished On\nParser,Fast.,javascript:alert(1),,\n',
  'Skills.csv': 'Name\nJava\nJava\n',
  'Connections.csv': 'Notes:\n"x"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAda,L,https://linkedin.test/ada,,Acme,Engineer,01 Jan 2024\n',
};

const upload = (files: Record<string, string>) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(archive(files))], 'export.zip', { type: 'application/zip' }));
  return form;
};

describe('linkedinDrafts', () => {
  it('turns the archive into drafts in the claims.yml shape', () => {
    const drafts = linkedinDrafts(parseExport(archive(FULL)), 'Test User');
    expect(drafts.map((d) => d.type)).toEqual(['meta', 'position', 'education', 'project', 'claim', 'claim']);
    expect(drafts[1].data).toEqual({ id: 'acme-developer', title: 'Developer', company: 'Acme', location: 'Berlin', start: '2024-03', end: null, summary: 'Builds things.', bullets: [] });
    expect(drafts[3].data).toMatchObject({ id: 'parser', url: null, source: 'linkedin' });
    expect((drafts[5].data as { slug: string }).slug).toBe('java-2');
  });
});

describe('POST /api/profile/import makes drafts', () => {
  it('replaces the contacts, makes drafts and leaves the profile alone', async () => {
    const u = await makeUser();
    const res = await importExport(await formRequest('/api/profile/import', upload(FULL), { cookie: u.cookie }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, scope: 'full', drafts: 6 });
    expect(await db.contact.count({ where: { userId: u.user.id } })).toBe(1);
    expect(await db.profileMeta.findUnique({ where: { userId: u.user.id } })).toBeNull();
    const drafts = await listDrafts(u.user.id);
    expect(new Set(drafts.map((d) => d.batchId)).size).toBe(1);
    expect(drafts.every((d) => d.source === 'linkedin')).toBe(true);
  });

  it('keeps the contacts when the archive has no connections', async () => {
    const u = await makeUser();
    await db.contact.create({ data: { userId: u.user.id, firstName: 'Old', lastName: 'Contact' } });
    const { 'Connections.csv': _omitted, ...noConnections } = FULL;
    const res = await importExport(await formRequest('/api/profile/import', upload(noConnections), { cookie: u.cookie }), ctx());
    expect(res.status).toBe(200);
    expect(await db.contact.count({ where: { userId: u.user.id } })).toBe(1);
  });

  it('refuses an archive with neither connections nor profile data', async () => {
    const u = await makeUser();
    expect((await importExport(await formRequest('/api/profile/import', upload({ 'Other.csv': 'A\n1\n' }), { cookie: u.cookie }), ctx())).status).toBe(400);
  });
});
