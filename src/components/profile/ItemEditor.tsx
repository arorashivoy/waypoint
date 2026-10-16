'use client';

import { useMemo, useState } from 'react';
import { DEPTHS, SURFACES, type Claim, type ClaimsDoc, type Depth, type Evidence, type Surface } from '@/lib/profile/doc';
import type { Item, ItemKind } from '@/lib/profile/apply';
import { ApiError, post, put } from '../api';
import { errorsFor, FIELDS, fromForm, targetOptions, toForm } from './fields';

type Props = {
  kind: ItemKind;
  doc: ClaimsDoc;
  itemKey: string | null;
  item: Item | null;
  /** 'profile' saves to the profile. A draft ID saves the draft, which the user accepts later. */
  mode: 'profile' | { draftId: string };
  onDone: (reply: any) => void;
  onCancel: () => void;
};

const Errors = ({ list }: { list?: string[] }) =>
  list?.length ? (
    <ul className="err" role="alert">
      {list.map((e) => <li key={e}>{e}</li>)}
    </ul>
  ) : null;

export default function ItemEditor({ kind, doc, itemKey: key, item, mode, onDone, onCancel }: Props) {
  const [form, setForm] = useState(() => toForm(kind, item));
  const claim = kind === 'claim' ? (item as Claim | null) : null;
  const [evidence, setEvidence] = useState<Evidence[]>(() => claim?.evidence ?? []);
  const [listed, setListed] = useState<Surface[]>(() => (claim?.mentions ?? []).filter((m) => m.listed).map((m) => m.surface));
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const next = useMemo(() => fromForm(kind, form, item, { evidence, listed }), [kind, form, item, evidence, listed]);
  const errs = useMemo(() => errorsFor(doc, kind, next, mode === 'profile' ? key : null), [doc, kind, next, key, mode]);
  const targets = useMemo(() => targetOptions(doc), [doc]);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setServerErrors([]);
    try {
      const reply =
        mode === 'profile'
          ? key === null
            ? await post(`/api/profile/items/${kind}`, { item: next })
            : await put(`/api/profile/items/${kind}/${encodeURIComponent(key)}`, { item: next })
          : await put(`/api/profile/drafts/${encodeURIComponent(mode.draftId)}`, { data: next });
      onDone(reply);
    } catch (e) {
      setServerErrors(e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" style={{ gap: 14, padding: 18 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
      {FIELDS[kind].map((f) => {
        const id = `f-${kind}-${f.key}`;
        const value = form[f.key];
        return (
          <div key={f.key} className="form-row">
            {f.kind === 'bool' ? (
              <label className="row" style={{ gap: 8 }}>
                <input id={id} type="checkbox" checked={value === true} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            ) : (
              <>
                <label className="label" htmlFor={id}>{f.label}</label>
                {f.kind === 'textarea' || f.kind === 'lines' ? (
                  <textarea id={id} className="note-area" rows={f.kind === 'lines' ? 4 : 3} value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.kind === 'select' ? (
                  <select id={id} className="field" value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input id={id} className="field" type={f.kind === 'number' ? 'number' : 'text'} step="any" value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </>
            )}
            {f.hint && <span className="hint">{f.hint}</span>}
            <Errors list={errs.byField[f.key]} />
          </div>
        );
      })}

      {kind === 'claim' && (
        <>
          <div className="form-row">
            <span className="label">Evidence</span>
            {evidence.map((e, i) => (
              <div key={i} className="evidence-row">
                <select aria-label="Evidence target" className="field" value={e.target} onChange={(ev) => setEvidence((list) => list.map((x, j) => (j === i ? { ...x, target: ev.target.value } : x)))}>
                  <option value="">Choose the work that shows it</option>
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <select aria-label="Depth" className="field" value={e.depth} onChange={(ev) => setEvidence((list) => list.map((x, j) => (j === i ? { ...x, depth: ev.target.value as Depth } : x)))}>
                  {DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input aria-label="Proof sentence" className="field" maxLength={200} placeholder="Proof: one sentence, 200 characters or fewer" value={e.proof ?? ''} onChange={(ev) => setEvidence((list) => list.map((x, j) => (j === i ? { ...x, proof: ev.target.value || undefined } : x)))} />
                <span className="hint mono">{(e.proof ?? '').length}/200</span>
                <button type="button" className="btn" onClick={() => setEvidence((list) => list.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setEvidence((list) => [...list, { target: '', depth: 'used' }])}>Add evidence</button>
            <Errors list={errs.byField.evidence} />
          </div>
          <fieldset className="form-row" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Where it shows</legend>
            <div className="surface-grid">
              {SURFACES.map((s) => (
                <label key={s} className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={listed.includes(s)} onChange={(e) => setListed((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))} />
                  <span style={{ fontSize: 14 }}>{s}</span>
                </label>
              ))}
            </div>
            <Errors list={errs.byField.mentions} />
          </fieldset>
        </>
      )}

      {mode !== 'profile' && errs.count > 0 && <span className="hint">These problems stop the accept. You can save the draft now and fix them later.</span>}
      <Errors list={[...errs.other, ...serverErrors]} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-dark" type="submit" disabled={busy || (mode === 'profile' && errs.count > 0)}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
