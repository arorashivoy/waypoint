import { CLAIM_KINDS, checkDoc, slugify, type Claim, type ClaimsDoc, type Evidence, type PositionTarget, type Surface } from '@/lib/profile/doc';
import { itemKey, upsertItem, type Item, type ItemKind } from '@/lib/profile/apply';

/**
 * The form logic of the profile editor, with no React, so the tests run it.
 * The forms check each change with the same checkDoc as the server (spec 3.4).
 */

export type FieldKind = 'text' | 'textarea' | 'lines' | 'select' | 'number' | 'bool';
export type FieldSpec = { key: string; label: string; kind: FieldKind; options?: readonly string[]; hint?: string };
export type FormState = Record<string, string | boolean>;

export const FIELDS: Record<ItemKind, FieldSpec[]> = {
  position: [
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'company', label: 'Company', kind: 'text' },
    { key: 'location', label: 'Location', kind: 'text' },
    { key: 'start', label: 'Start', kind: 'text', hint: 'YYYY-MM or YYYY' },
    { key: 'end', label: 'End', kind: 'text', hint: 'YYYY-MM or YYYY. Leave it empty for a current job.' },
    { key: 'summary', label: 'Summary', kind: 'textarea' },
    { key: 'bullets', label: 'Bullets', kind: 'lines', hint: 'One bullet on each line.' },
    { key: 'id', label: 'ID', kind: 'text', hint: 'Lowercase words with hyphens. Evidence uses it.' },
  ],
  education: [
    { key: 'school', label: 'School', kind: 'text' },
    { key: 'degree', label: 'Degree', kind: 'text' },
    { key: 'field', label: 'Field', kind: 'text' },
    { key: 'years', label: 'Years', kind: 'text' },
    { key: 'aliases', label: 'Short names', kind: 'lines', hint: 'One on each line, 4 characters or more. Contacts write the school this way.' },
    { key: 'id', label: 'ID', kind: 'text', hint: 'Lowercase words with hyphens. Evidence uses it.' },
  ],
  project: [
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'org', label: 'Organisation', kind: 'text' },
    { key: 'description', label: 'Description', kind: 'textarea' },
    { key: 'url', label: 'Link', kind: 'text', hint: 'http:// or https://' },
    { key: 'bullets', label: 'Bullets', kind: 'lines', hint: 'One bullet on each line, at most 8.' },
    { key: 'tex', label: 'LaTeX entry', kind: 'textarea', hint: 'Only for an own .tex résumé: one \\item entry.' },
    { key: 'id', label: 'ID', kind: 'text', hint: 'Lowercase words with hyphens. Evidence uses it.' },
  ],
  claim: [
    { key: 'label', label: 'Label', kind: 'text' },
    { key: 'kind', label: 'Kind', kind: 'select', options: CLAIM_KINDS },
    { key: 'aliases', label: 'Other names', kind: 'lines', hint: 'One on each line.' },
    { key: 'value', label: 'Value', kind: 'number', hint: 'Only for a metric or a credential.' },
    { key: 'scaleMax', label: 'Top of the scale', kind: 'number' },
    { key: 'higherIsBetter', label: 'A higher value is better', kind: 'bool' },
    { key: 'slug', label: 'ID', kind: 'text', hint: 'Lowercase words with hyphens.' },
  ],
};

/** Fields that are text in the document but can be empty: an empty form value leaves the field out. */
const OPTIONAL = new Set(['location', 'end', 'summary', 'degree', 'field', 'years', 'org', 'description', 'url', 'tex']);

export function toForm(kind: ItemKind, item: Item | null): FormState {
  const form: FormState = {};
  for (const f of FIELDS[kind]) {
    const v = item ? (item as Record<string, unknown>)[f.key] : undefined;
    if (f.kind === 'bool') form[f.key] = v === true;
    else if (f.kind === 'lines') {
      const list = (Array.isArray(v) ? v : []) as unknown[];
      form[f.key] = list.map((x) => (typeof x === 'string' ? x : String((x as { text?: string; match?: string }).text ?? (x as { match?: string }).match ?? ''))).join('\n');
    } else form[f.key] = v === undefined || v === null ? (f.key === 'kind' ? 'skill' : '') : String(v);
  }
  return form;
}

const lines = (v: unknown) => String(v ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

export function fromForm(kind: ItemKind, form: FormState, previous: Item | null, extra: { evidence: Evidence[]; listed: Surface[] }): Item {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[kind]) {
    const v = form[f.key];
    if (f.kind === 'bool') out[f.key] = v === true;
    else if (f.kind === 'lines') out[f.key] = lines(v);
    else if (f.kind === 'number') out[f.key] = String(v ?? '').trim() === '' ? undefined : Number(v);
    else {
      const s = String(v ?? '').trim();
      out[f.key] = s === '' && OPTIONAL.has(f.key) ? undefined : s;
    }
  }
  const keyField = kind === 'claim' ? 'slug' : 'id';
  if (!out[keyField]) out[keyField] = slugify(String(out.title ?? out.school ?? out.label ?? ''), new Set(), kind);

  if (kind === 'position') {
    // A line that is the text (or the match) of an old bullet keeps that bullet and its ID.
    const old = (previous as PositionTarget | null)?.bullets ?? [];
    const taken = new Set(old.map((b) => b.id));
    out.bullets = (out.bullets as string[]).map((text) => {
      const same = old.find((b) => (b.text ?? b.match) === text);
      return same ?? { id: slugify(text.slice(0, 40), taken, 'bullet'), match: text.slice(0, 80), text };
    });
  }
  if (kind === 'claim') {
    const prev = previous as Claim | null;
    if (!['metric', 'credential'].includes(String(out.kind))) {
      delete out.value;
      delete out.scaleMax;
    }
    if (out.kind !== 'metric') delete out.higherIsBetter;
    out.links = prev?.links ?? [];
    out.evidence = extra.evidence;
    // Keep the URL of a mention that stays listed; a surface the user turns off is not listed.
    const before = new Map((prev?.mentions ?? []).map((m) => [m.surface, m]));
    out.mentions = [
      ...extra.listed.map((s) => ({ ...(before.get(s) ?? { surface: s }), listed: true })),
      ...(prev?.mentions ?? []).filter((m) => !extra.listed.includes(m.surface)).map((m) => ({ ...m, listed: false })),
    ];
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as Item;
}

const listOf = (doc: ClaimsDoc, kind: ItemKind): Item[] => (kind === 'claim' ? doc.claims : kind === 'position' ? doc.targets.positions : kind === 'education' ? doc.targets.educations : doc.targets.projects);

/** The checkDoc errors of one item if it goes into the document, by field. */
export function errorsFor(doc: ClaimsDoc, kind: ItemKind, item: Item, key: string | null) {
  const before = listOf(doc, kind);
  const index = key === null ? before.length : before.findIndex((x) => itemKey(kind, x) === key);
  const prefixes = kind === 'claim' ? [`claims[${(item as Claim).slug}]`, `claims[${index}]`] : [`targets.${kind}s[${index}]`];
  const byField: Record<string, string[]> = {};
  const other: string[] = [];
  let count = 0;
  for (const e of checkDoc(upsertItem(doc, kind, key, item)).errors) {
    const colon = e.indexOf(': ');
    const path = e.slice(0, colon);
    const prefix = prefixes.find((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`));
    if (!prefix) continue;
    count++;
    const field = path.slice(prefix.length).replace(/^\./, '').split(/[.[]/)[0];
    const msg = e.slice(colon + 2);
    if (field) (byField[field] ??= []).push(msg);
    else other.push(msg);
  }
  return { byField, other, count };
}

export function targetOptions(doc: ClaimsDoc): { value: string; label: string }[] {
  return [
    ...doc.targets.positions.flatMap((p) => [
      { value: `position:${p.id}`, label: `${p.title} · ${p.company}` },
      ...(p.bullets ?? []).map((b) => ({ value: `position:${p.id}/${b.id}`, label: `  — ${(b.text ?? b.match).slice(0, 60)}` })),
    ]),
    ...doc.targets.educations.map((e) => ({ value: `education:${e.id}`, label: e.school })),
    ...doc.targets.projects.map((p) => ({ value: `project:${p.id}`, label: p.title })),
  ];
}

export function summaryOf(kind: ItemKind, item: Item): { title: string; sub: string } {
  const x = item as Record<string, any>;
  if (kind === 'position') return { title: `${x.title} · ${x.company}`, sub: `${x.start ?? '?'} – ${x.end ?? 'present'}${x.location ? ` · ${x.location}` : ''}` };
  if (kind === 'education') return { title: x.school, sub: [x.degree, x.field, x.years].filter(Boolean).join(' · ') };
  if (kind === 'project') return { title: x.title, sub: [x.org, x.source && x.source !== 'manual' ? `from ${x.source}` : null].filter(Boolean).join(' · ') };
  return { title: x.label, sub: `${x.kind} · ${(x.evidence ?? []).length} evidence` };
}
