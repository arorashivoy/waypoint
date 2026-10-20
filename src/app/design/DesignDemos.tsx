'use client';

import { useRef, useState } from 'react';
import {
  Badge, Button, EmptyState, ErrorNote, Field, Fold, Panel, Route, ScorePill, ScoreRing, Sheet, Skeleton, Tabs, TaskIndicator, Toast, WayIn,
} from '@/components/ui';

const ITEMS = [
  { status: 'met', label: '4+ years of backend services in Java', evidence: 'Ledger service at Orbit' },
  { status: 'partial', label: 'Kubernetes in production', evidence: 'A staging cluster in homelab-k8s' },
  { status: 'missing', label: 'Terraform' },
] as const;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The parts that need the browser: they hold state or take focus. */
export function DesignDemos({ sheetOpen = false }: { sheetOpen?: boolean }) {
  const [sheet, setSheet] = useState(sheetOpen);
  const [toast, setToastText] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const setToast = (text: string | null) => { setToastText(text); setNonce((n) => n + 1); };
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('https://careers.example.com/123');

  return (
    <>
      <section aria-labelledby="ds-buttons">
        <h2 id="ds-buttons">Buttons and fields</h2>
        <div className="ds-stack">
          <div className="ds-wrap">
            <Button variant="go">Mark as applied</Button>
            <Button>Open the posting</Button>
            <Button variant="link">Show all 9 requirements</Button>
            <Button variant="go" disabled>Disabled</Button>
            <Button variant="go" busy={busy} onClick={async () => { setBusy(true); await wait(1200); setBusy(false); }}>Check the job</Button>
            <Button confirm="Copied" onClick={async () => { await wait(200); setToast('Copied'); }}>Copy message</Button>
          </div>
          <div style={{ maxWidth: 420 }} className="ds-stack ds-form">
            <Field label="Job link" hint="Paste a link from Greenhouse, Lever, Ashby or Workable." error={url.includes('careers') ? 'This board needs a link to one posting.' : undefined}>
              {(c) => <input {...c} value={url} onChange={(e) => setUrl(e.target.value)} />}
            </Field>
            <Field label="Note to your contact" hint="Two or three sentences work best.">
              {(c) => <textarea {...c} defaultValue="" />}
            </Field>
            <Field label="Level">
              {(c) => (
                <select {...c} defaultValue="senior">
                  <option value="mid">Mid</option>
                  <option value="senior">Senior</option>
                </select>
              )}
            </Field>
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-glass">
        <h2 id="ds-glass">Panel, fold and way in</h2>
        <div className="ds-stack" style={{ maxWidth: 560 }}>
          <Panel title="Your way in">
            <WayIn contact="Anna Weber" company="Orbit Labs" />
            <p className="ds-sub">Anna Weber can refer you. Panels use the glass fill, a hairline edge and a blur.</p>
          </Panel>
          <Fold title="Your way in" status="Anna Weber can refer you"><WayIn contact="Anna Weber" company="Orbit Labs" /></Fold>
          <Fold title="Your CV" status="Ready, built 2 hours ago" defaultOpen><p>The CV is on file. Build it again after you change the profile.</p></Fold>
        </div>
      </section>

      <section aria-labelledby="ds-route">
        <h2 id="ds-route">Route, score pill and ring</h2>
        <div className="ds-wrap" style={{ alignItems: 'flex-start', gap: 'var(--s6)' }}>
          <Route items={[...ITEMS]} blockers={[{ label: 'Needs a Swiss work permit' }]} />
          <div className="ds-stack" style={{ alignItems: 'flex-start' }}>
            <div className="ds-wrap">
              <ScorePill score={86} />
              <ScorePill score={62} />
              <ScorePill score={41} />
              <Badge tone="coral">3</Badge>
              <Badge tone="mint">New</Badge>
              <Badge tone="lav">Referral</Badge>
              <Badge>12</Badge>
            </div>
            <ScoreRing score={86} />
            <TaskIndicator text="Checking 12 jobs" />
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-tabs">
        <h2 id="ds-tabs">Tabs and sheet</h2>
        <div className="ds-stack">
          <div className="ds-tabs-demo">
            <Tabs
              label="Profile sections"
              tabs={[
                { id: 'basics', label: 'Basics', panel: <p>Name, headline and the countries you work in.</p> },
                { id: 'work', label: 'Work', panel: <p>Your roles, with the evidence for each skill.</p> },
                { id: 'rules', label: 'CV rules', panel: <p>What the CV may and may not say.</p> },
              ]}
            />
          </div>
          <div className="ds-wrap">
            <Button ref={opener} variant="go" onClick={() => setSheet(true)}>Open the filters</Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-states">
        <h2 id="ds-states">States</h2>
        <div className="ds-states">
          <div className="glass ds-state">
            <h3>Loading</h3>
            <Skeleton rows={3} />
          </div>
          <div className="glass ds-state">
            <h3>Empty</h3>
            <EmptyState cause="Your filters hide all 48 jobs." detail="The level filter shows only Senior and above." action={{ label: 'Clear the filters', onClick: () => setToast('Filters cleared') }} />
          </div>
          <div className="glass ds-state">
            <h3>Error</h3>
            <ErrorNote what="Waypoint could not build your CV." fix="LaTeX stopped at line 42: an unknown command. Fix the line in your .tex file, then build again." onRetry={() => setToast('Building the CV')} retryLabel="Build again" />
          </div>
        </div>
      </section>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filters" opener={opener}>
        <Field label="Level" hint="Show jobs at this level and above.">
          {(c) => (
            <select {...c} defaultValue="senior" data-autofocus>
              <option value="mid">Mid</option>
              <option value="senior">Senior</option>
            </select>
          )}
        </Field>
        <Field label="City">{(c) => <input {...c} defaultValue="Berlin" />}</Field>
        <Button variant="go" onClick={() => setSheet(false)}>Show 48 jobs</Button>
      </Sheet>
      <Toast message={toast} nonce={nonce} onHide={() => setToastText(null)} />
    </>
  );
}
