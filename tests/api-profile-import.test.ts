import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { POST as importExport } from '@/app/api/profile/import/route';
import { MAX_EXPORT_BYTES, MAX_UNPACKED_BYTES, parseExport } from '@/lib/linkedin-import';
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
  it('refuses an upload without Content-Length with 413', async () => {
    const { cookie } = await makeUser();
    const res = await importExport(await formRequest('/api/profile/import', csvForm(), { cookie, headers: { 'content-length': null } }), ctx());
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'The file is larger than 50 MB.' });
  });

  it('refuses a Content-Length that is not a number with 413', async () => {
    const { cookie } = await makeUser();
    const res = await importExport(await formRequest('/api/profile/import', csvForm(), { cookie, headers: { 'content-length': 'lots' } }), ctx());
    expect(res.status).toBe(413);
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
