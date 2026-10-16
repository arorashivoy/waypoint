import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkYaml, type ClaimsDoc, type PositionTarget } from '@/lib/profile/doc';
import { errorsFor, fromForm, targetOptions, toForm } from '@/components/profile/fields';

const sample = (): ClaimsDoc => checkYaml(readFileSync('tests/fixtures/claims-sample.yml', 'utf8')).doc!;
const none = { evidence: [], listed: [] };

describe('profile form logic', () => {
  it('turns a position into form fields and back without loss', () => {
    const p = sample().targets.positions[0];
    const back = fromForm('position', toForm('position', p), p, none) as PositionTarget;
    expect(back).toEqual({ ...p, bullets: [{ id: 'ledger', match: 'rebuilt the ledger service' }] });
  });

  it('keeps the ID of a bullet whose text did not change and makes an ID for a new line', () => {
    const p = sample().targets.positions[0];
    const form = { ...toForm('position', p), bullets: 'rebuilt the ledger service\nShipped the payments API in Go' };
    const back = fromForm('position', form, p, none) as PositionTarget;
    expect(back.bullets).toEqual([
      { id: 'ledger', match: 'rebuilt the ledger service' },
      { id: 'shipped-the-payments-api-in-go', match: 'Shipped the payments API in Go', text: 'Shipped the payments API in Go' },
    ]);
  });

  it('makes an ID from the title for a new item', () => {
    const item = fromForm('project', { title: 'My CLI Tool', id: '' }, null, none);
    expect(item).toMatchObject({ id: 'my-cli-tool', title: 'My CLI Tool' });
  });

  it('puts each check error next to its field', () => {
    const doc = sample();
    const p = { ...doc.targets.positions[0], start: '2024/3' };
    const e = errorsFor(doc, 'position', p, 'acme-dev');
    expect(e.byField.start?.[0]).toMatch(/YYYY/);
    expect(e.count).toBe(1);
  });

  it('finds the errors of a new claim by its slug', () => {
    const doc = sample();
    const c = fromForm('claim', { label: 'Go', kind: 'language', slug: 'go' }, null, { evidence: [{ target: 'project:missing', depth: 'used' }], listed: ['resume'] });
    const e = errorsFor(doc, 'claim', c, null);
    expect(e.byField.evidence?.[0]).toMatch(/project:missing/);
  });

  it('lists the evidence targets, bullets too', () => {
    expect(targetOptions(sample()).map((o) => o.value)).toEqual(['position:acme-dev', 'position:acme-dev/ledger', 'education:tu', 'project:parser']);
  });
});
