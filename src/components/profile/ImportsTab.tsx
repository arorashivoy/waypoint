'use client';

import { useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { Fold } from '../ui';
import DraftList from './DraftList';
import ImportSources from './ImportSources';
import LinkedInPanel from './LinkedInPanel';

type Props = { doc: ClaimsDoc; version: number; state: any; changed: () => Promise<void>; setToast: (s: string) => void; onCount: (n: number) => void; /** How many drafts wait. With drafts, the import panels fold, so the drafts lead. */ drafts?: number; onAccepted?: () => void };

export default function ImportsTab({ doc, state, changed, setToast, onCount, drafts = 0, onAccepted }: Props) {
  const [listKey, setListKey] = useState(0);
  const imported = async () => {
    setListKey((k) => k + 1);
    await changed();
  };

  return (
    <div className="pf-stack">
      <section className="pf-section" aria-labelledby="pf-drafts-h">
        <div className="pf-head"><h2 id="pf-drafts-h">Drafts</h2></div>
        <DraftList key={listKey} doc={doc} changed={changed} setToast={setToast} onCount={onCount} onAccepted={onAccepted} />
      </section>

      {drafts > 0 ? (
        <Fold title="Import more" status="A résumé, GitHub or a claims.yml file">
          <div className="pf-stack-tight">
            <ImportSources imported={imported} setToast={setToast} />
          </div>
        </Fold>
      ) : (
        <section className="pf-section" aria-labelledby="pf-import-h">
          <div className="pf-head"><h2 id="pf-import-h">Import</h2></div>
          <div className="pf-box">
            <ImportSources imported={imported} setToast={setToast} />
          </div>
        </section>
      )}

      <LinkedInPanel state={state} refresh={imported} setToast={setToast} folded={drafts > 0} />
    </div>
  );
}
