'use client';

export default function CountriesScreen({ state, toggleCountry }: { state: any; toggleCountry: (cc: string, on: boolean) => void }) {
  return (
    <>
      <header className="screen-head">
        <h1 className="display">Countries and job boards</h1>
        <span className="sub">Ranked by your list · every board is searched for each country you keep on</span>
      </header>

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '16px var(--gutter) 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="label" style={{ letterSpacing: '0.08em' }}>All countries</span>
          {state.globalSites.map((s: string) => (
            <span key={s} style={{ fontSize: 14, padding: '6px 10px', borderRadius: 6, background: 'var(--chip)' }}>{s}</span>
          ))}
        </div>

        {state.careerLinks.length > 0 && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="label" style={{ letterSpacing: '0.08em' }}>★ Search by hand</span>
            {state.careerLinks.map((l: { company: string; url: string }) => (
              <a key={l.company} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, padding: '6px 10px', borderRadius: 6, background: 'var(--chip)', color: 'inherit' }}>
                {l.company} careers ↗
              </a>
            ))}
          </div>
        )}

        <div className="three-col">
          {state.countries.map((c: any) => (
            <div key={c.cc} className="panel stack" style={{ gap: 12, padding: 20, borderRadius: 12, opacity: c.on ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span className="mono" style={{ fontSize: 13, color: 'var(--muted-3)' }}>{c.rank}</span>
                <span className="display grow" style={{ fontSize: 24, fontWeight: 700 }}>{c.name}</span>
                <button
                  onClick={() => toggleCountry(c.cc, !c.on)}
                  aria-pressed={c.on}
                  style={{
                    minHeight: 44, padding: '0 12px', borderRadius: 22,
                    border: '1px solid var(--ink)',
                    background: c.on ? 'var(--ink)' : 'transparent',
                    color: c.on ? 'var(--ground)' : 'var(--ink)',
                    fontSize: 13,
                  }}
                >
                  {c.on ? 'Searching' : 'Paused'}
                </button>
              </div>
              <div className="stack" style={{ gap: 2, fontSize: 14 }}>
                <span>{c.settle}</span>
                <span style={{ color: 'var(--muted)' }}>{c.bar}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {c.sites.map((s: string) => (
                  <span key={s} className="tag tag-outline">{s}</span>
                ))}
              </div>
              <span className="mono" style={{ fontSize: 12, color: 'var(--muted-3)' }}>{c.count} live in Waypoint</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 760, margin: 0 }}>
          The boards listed on each card are where you search by hand — LinkedIn, Indeed, StepStone and Glassdoor all
          forbid scraping, so Waypoint links out rather than fetching them, and the same goes for Meta careers. What it
          does fetch automatically: the companies in <code>config/watchlist.json</code> through the Greenhouse, Lever,
          Ashby, Workable and SmartRecruiters public APIs, Google&apos;s jobs feed, and the Microsoft, Amazon, Apple and
          Workday careers sites, plus Arbeitnow for Germany, The Muse, and Adzuna if you set <code>ADZUNA_APP_ID</code>. Companies
          marked ★ are read first and rank above others of similar fit.
        </p>
      </div>
    </>
  );
}
