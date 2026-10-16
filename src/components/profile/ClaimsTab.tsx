'use client';

import { useMemo, useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import ItemList from './ItemList';

type Props = { doc: ClaimsDoc; warnings: string[]; onSaved: (reply: any) => void; setToast: (s: string) => void };

export default function ClaimsTab({ doc, warnings, onSaved, setToast }: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? doc.claims.filter((c) => `${c.label} ${c.slug} ${c.aliases.join(' ')}`.toLowerCase().includes(q)) : doc.claims;
  }, [doc.claims, query]);
  return (
    <>
      <label className="label" htmlFor="claim-search">Find a claim</label>
      <input id="claim-search" className="field" style={{ marginBottom: 16 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Java, Kafka, GPA…" />
      {warnings.length > 0 && (
        <details className="card" style={{ padding: 16, marginBottom: 20 }}>
          <summary>{warnings.length} suggestion{warnings.length === 1 ? '' : 's'} for the profile</summary>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>{warnings.map((w) => <li key={w} style={{ fontSize: 14 }}>{w}</li>)}</ul>
        </details>
      )}
      <ItemList kind="claim" title={`Claims (${doc.claims.length})`} empty="No claims yet. A claim is a skill, a language, a metric, a credential or an award, with the work that shows it." items={shown} doc={doc} onSaved={onSaved} setToast={setToast} />
    </>
  );
}
