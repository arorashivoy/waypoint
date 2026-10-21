import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { readSession } from '@/lib/auth/session';
import { DesignDemos } from './DesignDemos';
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
  ['--glass', 'rgba(255, 255, 255, 0.045)', 'Panels, sidebar, tab bar, fields'],
  ['--glass-hi', 'rgba(255, 255, 255, 0.075)', 'Selected row, hover'],
  ['--edge', 'rgba(236, 232, 246, 0.10)', 'Hairline borders on glass'],
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

export default async function DesignPage({ searchParams }: { searchParams: { sheet?: string } }) {
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

      <DesignDemos sheetOpen={searchParams.sheet === '1'} />
    </main>
  );
}
