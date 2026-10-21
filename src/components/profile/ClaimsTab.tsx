'use client';

import { useMemo, useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { Field, Fold } from '../ui';
import ItemList from './ItemList';
import { claimEmpty, countOf } from './model';

type Props = { doc: ClaimsDoc; warnings: string[]; onSaved: (reply: any) => void; setToast: (s: string) => void };

export default function ClaimsTab({ doc, warnings, onSaved, setToast }: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? doc.claims.filter((c) => `${c.label} ${c.slug} ${c.aliases.join(' ')}`.toLowerCase().includes(q)) : doc.claims;
  }, [doc.claims, query]);
  const empty = claimEmpty(doc.claims.length, query);
  return (
    <div className="pf-stack">
      {doc.claims.length > 0 && (
        <Field label="Find a claim">
          {(c) => <input {...c} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Java, Kafka, GPA…" />}
        </Field>
      )}
      {warnings.length > 0 && (
        <Fold title="Suggestions for the profile" status={countOf(warnings.length, 'suggestion')}>
          <ul className="pf-plain">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Fold>
      )}
      <ItemList
        kind="claim"
        title={query.trim() && doc.claims.length ? `Claims (${shown.length} of ${doc.claims.length})` : `Claims (${doc.claims.length})`}
        noun="claim"
        primary
        empty={
          empty.search
            ? { cause: empty.cause, detail: 'Check the spelling, or clear the search.', none: true }
            : { cause: empty.cause, detail: 'A claim is a skill, a language, a metric, a credential or an award, with the work that shows it.' }
        }
        items={shown}
        doc={doc}
        onSaved={onSaved}
        setToast={setToast}
      />
    </div>
  );
}
