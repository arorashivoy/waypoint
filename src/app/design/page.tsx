import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { readSession } from '@/lib/auth/session';
import './design.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Style page - Waypoint' };

/** The style page is a server component. It reads the session from the cookie and gives the normal 404 to anyone but an admin. */
async function requireAdminPage() {
  const session = await readSession(new Request('http://localhost/design', { headers: { cookie: cookies().toString() } }));
  if (!session || session.user.role !== 'admin') notFound();
}

const COLOURS = [
  ['--night', '#121019', 'Ground, under the glows and the dot grid'],
  ['--glass', 'rgba(255,255,255,0.045)', 'Panels, sidebar, tab bar, fields'],
  ['--glass-hi', 'rgba(255,255,255,0.075)', 'Selected row, hover'],
  ['--edge', 'rgba(236,232,246,0.10)', 'Hairline borders on glass'],
  ['--text', '#ECE8F6', 'Text'],
  ['--soft', '#A7A1B8', 'Secondary text'],
  ['--mint', '#A6E4C4', 'Met, score ring, primary action'],
  ['--lav', '#C4B6F4', 'Route, links, focus, referrals'],
  ['--butter', '#EED596', 'Partial, warnings'],
  ['--coral', '#F2A0A0', 'Blockers, errors'],
  ['--ink-on', '#121019', 'Text on mint and lavender'],
] as const;

const SCALE = [
  ['13', 'var(--t-13)'],
  ['16', 'var(--t-16)'],
  ['20', 'var(--t-20)'],
  ['25', 'var(--t-25)'],
  ['31', 'var(--t-31)'],
] as const;

export default async function DesignPage() {
  await requireAdminPage();
  return (
    <main className="ds">
      <header>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          <span className="ds-mark" aria-hidden="true" />
          Style page
        </h1>
        <p className="ds-lede">The colours, type and parts of the part 6 direction. Only an admin can see this page.</p>
      </header>

      <section aria-labelledby="ds-colour">
        <h2 id="ds-colour">Colour</h2>
        <div className="ds-grid">
          {COLOURS.map(([name, value, use]) => (
            <div key={name} className="ds-sw glass">
              <i style={{ background: `var(${name})` }} />
              <b>{name}</b>
              <small>{value}</small>
              <small>{use}</small>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-type">
        <h2 id="ds-type">Type</h2>
        <div className="ds-type">
          {SCALE.map(([px, size]) => (
            <div key={px}>
              <small>{px} px</small>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2) var(--s5)', alignItems: 'baseline' }}>
                {Number(px) >= 20 && (
                  <span className="ds-head" style={{ fontSize: size }}>Syne, the night route</span>
                )}
                <span className="ds-body" style={{ fontSize: size }}>Onest, a job in Berlin</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-buttons">
        <h2 id="ds-buttons">Buttons and fields</h2>
        <div className="ds-stack">
          <div className="ds-wrap">
            <button className="btn go" type="button">Mark as applied</button>
            <button className="btn" type="button">Open the posting</button>
            <button className="btn link" type="button">Show all 9 requirements</button>
            <button className="btn go" type="button" disabled>Disabled</button>
          </div>
          <div className="ds-field">
            <label htmlFor="ds-url">Job link</label>
            <input id="ds-url" className="field" aria-invalid="true" aria-describedby="ds-url-msg" defaultValue="https://careers.example.com/123" />
            <span id="ds-url-msg" className="msg">Paste a link from Greenhouse, Lever, Ashby or Workable.</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-glass">
        <h2 id="ds-glass">Glass panel</h2>
        <div className="glass ds-panel ds-stack" style={{ maxWidth: 520 }}>
          <h3>Your way in</h3>
          <p style={{ color: 'var(--soft)' }}>Anna Weber can refer you. Panels use the glass fill, a hairline edge and a blur.</p>
        </div>
      </section>

      <section aria-labelledby="ds-route">
        <h2 id="ds-route">Route, score pill and ring</h2>
        <div className="ds-wrap" style={{ alignItems: 'flex-start', gap: 'var(--s6)' }}>
          <div>
            <ol className="ds-route">
              <li className="m"><span className="rq">4+ years of backend services in Java</span><span className="st m">Met</span><div className="ev">Ledger service at Orbit</div></li>
              <li className="p"><span className="rq">Kubernetes in production</span><span className="st p">Partial</span><div className="ev">A staging cluster in homelab-k8s</div></li>
              <li><span className="rq">Terraform</span><span className="st x">Missing</span></li>
            </ol>
            <p className="ds-blocker">Needs a Swiss work permit</p>
          </div>
          <div className="ds-stack" style={{ alignItems: 'flex-start' }}>
            <div className="ds-wrap">
              <span className="ds-pill hi">86</span>
              <span className="ds-pill mid">62</span>
              <span className="ds-pill lo">41</span>
            </div>
            <div className="ds-ring" role="img" aria-label="Match score 86">
              <div><b>86</b><small>match</small></div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-states">
        <h2 id="ds-states">States</h2>
        <div className="ds-states">
          <div className="glass ds-state">
            <h3>Loading</h3>
            {[0, 1, 2].map((i) => (
              <div key={i} className="ds-skel"><span className="t" /><span className="n" /><span className="r" /></div>
            ))}
          </div>
          <div className="glass ds-state">
            <h3>Empty</h3>
            <div className="ds-empty">
              <div className="dash" aria-hidden="true"><em /><i /></div>
              <p>Your filters hide all 48 jobs.</p>
              <small>The level filter shows only Senior and above.</small>
              <button className="btn go" type="button">Clear the filters</button>
            </div>
          </div>
          <div className="glass ds-state">
            <h3>Error</h3>
            <div className="ds-err" role="alert">
              <strong>Waypoint could not build your CV.</strong>
              <span>LaTeX stopped at line 42: an unknown command. Fix the line in your .tex file, then build again.</span>
              <button className="btn" type="button">Build again</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
