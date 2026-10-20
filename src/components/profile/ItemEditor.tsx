'use client';

import { useMemo, useRef, useState } from 'react';
import { DEPTHS, SURFACES, type Claim, type ClaimsDoc, type Depth, type Evidence, type Surface } from '@/lib/profile/doc';
import type { Item, ItemKind } from '@/lib/profile/apply';
import { ApiError, post, put } from '../api';
import { STALE_PROFILE_MESSAGE } from '@/lib/profile/stale';
import { Button, Field, Fold } from '../ui';
import Problems, { fieldProblem } from './Problems';
import { countOf } from './model';
import { useProfileVersion } from './version';
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

export default function ItemEditor({ kind, doc, itemKey: key, item, mode, onDone, onCancel }: Props) {
  const [form, setForm] = useState(() => toForm(kind, item));
  const claim = kind === 'claim' ? (item as Claim | null) : null;
  const [evidence, setEvidence] = useState<Evidence[]>(() => claim?.evidence ?? []);
  const [listed, setListed] = useState<Surface[]>(() => (claim?.mentions ?? []).filter((m) => m.listed).map((m) => m.surface));
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // A field shows its problem after the user changes it, or after a Save that the checks stopped. A blank form starts calm.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [tried, setTried] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { version, reload } = useProfileVersion();

  const next = useMemo(() => fromForm(kind, form, item, { evidence, listed }), [kind, form, item, evidence, listed]);
  const errs = useMemo(() => errorsFor(doc, kind, next, mode === 'profile' ? key : null), [doc, kind, next, key, mode]);
  const targets = useMemo(() => targetOptions(doc), [doc]);
  const set = (k: string, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTouched((t) => new Set(t).add(k));
  };
  const seen = (k: string) => (tried || touched.has(k) ? errs.byField[k] : undefined);

  const save = async () => {
    if (mode === 'profile' && errs.count > 0) {
      setTried(true);
      // Move focus to the first field with a problem, once it shows.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    setServerErrors([]);
    try {
      const reply =
        mode === 'profile'
          ? key === null
            ? await post(`/api/profile/items/${kind}`, { item: next, version })
            : await put(`/api/profile/items/${kind}/${encodeURIComponent(key)}`, { item: next, version })
          : await put(`/api/profile/drafts/${encodeURIComponent(mode.draftId)}`, { data: next });
      onDone(reply);
    } catch (e) {
      setServerErrors(e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} className="pf-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {FIELDS[kind].map((f) => {
        const id = `f-${kind}-${f.key}`;
        const value = form[f.key];
        const wide = f.kind === 'textarea' || f.kind === 'lines';
        if (f.kind === 'bool') {
          return (
            <label key={f.key} className="pf-check" htmlFor={id}>
              <input id={id} type="checkbox" checked={value === true} onChange={(e) => set(f.key, e.target.checked)} />
              <span>{f.label}</span>
            </label>
          );
        }
        return (
          <div key={f.key} className={wide ? 'pf-wide' : undefined}>
            <Field label={f.label} hint={f.hint} error={fieldProblem(seen(f.key))}>
              {(c) =>
                f.kind === 'textarea' || f.kind === 'lines' ? (
                  <textarea {...c} rows={f.kind === 'lines' ? 4 : 3} value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.kind === 'select' ? (
                  <select {...c} value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input {...c} type={f.kind === 'number' ? 'number' : 'text'} step="any" value={String(value ?? '')} onChange={(e) => set(f.key, e.target.value)} />
                )
              }
            </Field>
          </div>
        );
      })}

      {kind === 'claim' && (
        <>
          <div className="pf-wide pf-group">
            <Fold title="Evidence" status={countOf(evidence.length, 'proof', 'proofs')} defaultOpen={evidence.length === 0}>
            <div className="pf-group">
            {evidence.map((e, i) => (
              <div key={i} className="pf-evidence">
                <div className="pf-wide">
                  <Field label="Evidence target">
                    {(c) => (
                      <select {...c} value={e.target} onChange={(ev) => setEvidence((list) => list.map((x, j) => (j === i ? { ...x, target: ev.target.value } : x)))}>
                        <option value="">Choose the work that shows it</option>
                        {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    )}
                  </Field>
                </div>
                <Field label="Depth">
                  {(c) => (
                    <select {...c} value={e.depth} onChange={(ev) => setEvidence((list) => list.map((x, j) => (j === i ? { ...x, depth: ev.target.value as Depth } : x)))}>
                      {DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  )}
                </Field>
                <div className="pf-wide">
                  <Field label="Proof sentence" hint={`${(e.proof ?? '').length} of 200 characters. One sentence.`}>
                    {(c) => <input {...c} type="text" maxLength={200} value={e.proof ?? ''} onChange={(ev) => setEvidence((list) => list.map((x, j) => (j === i ? { ...x, proof: ev.target.value || undefined } : x)))} />}
                  </Field>
                </div>
                <div className="pf-wide">
                  <Button aria-label={`Remove evidence ${i + 1}`} onClick={() => setEvidence((list) => list.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              </div>
            ))}
            <div><Button onClick={() => setEvidence((list) => [...list, { target: '', depth: 'used' }])}>Add evidence</Button></div>
            </div>
            </Fold>
            <Problems list={tried || evidence.length > 0 ? errs.byField.evidence : undefined} />
          </div>
          <fieldset className="pf-wide pf-group">
            <legend className="pf-group-title">Seen in</legend>
            <div className="pf-surfaces">
              {SURFACES.map((s) => (
                <label key={s} className="pf-check">
                  <input type="checkbox" checked={listed.includes(s)} onChange={(e) => setListed((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
            <Problems list={tried || listed.length > 0 ? errs.byField.mentions : undefined} />
          </fieldset>
        </>
      )}

      <div className="pf-wide pf-stack-tight">
        {mode !== 'profile' && errs.count > 0 && <p className="pf-note">These problems stop the accept. You can save the draft now and fix them later.</p>}
        <Problems list={tried || touched.size > 0 ? errs.other : undefined} />
        <Problems live list={serverErrors} />
        {serverErrors.includes(STALE_PROFILE_MESSAGE) && (
          <div><Button onClick={async () => { if (await reload()) setServerErrors([]); }}>Load the new version</Button></div>
        )}
      </div>
      <div className="pf-wide pf-actions">
        <Button variant="go" type="submit" busy={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
