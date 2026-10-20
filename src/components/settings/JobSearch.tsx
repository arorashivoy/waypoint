'use client';

import { useRef, useState } from 'react';
import { patch } from '../api';
import type { FailedBoard, SearchSettings } from '../data';
import { Badge, Button, Field, Sheet } from '../ui';
import { plural, when } from './model';
import { LoadError, Row, SectionHead } from './parts';

export type CountryRow = { cc: string; name: string; rank: number; on: boolean; settle: string; bar: string; sites: string[]; count: string };

const MAX_FIELDS = 6;

/** The countries in the order of the user. A country that is paused gets no search. The onboarding wizard uses this list too. */
export function CountryList({ countries, onToggle }: { countries: CountryRow[]; onToggle: (cc: string, on: boolean) => void | Promise<unknown> }) {
  return (
    <ul className="pf-rows">
      {countries.map((c) => (
        <li key={c.cc} className="pf-row st-country" data-on={c.on}>
          <span className="st-rank" aria-hidden="true">{c.rank}</span>
          <div className="pf-row-text">
            <span className="pf-row-title">{c.name}</span>
            <span className="pf-row-sub">{c.settle}. {c.bar}.</span>
            <span className="pf-row-sub">{plural(Number(c.count) || 0, 'job')} in Waypoint</span>
          </div>
          <div className="pf-row-actions">
            <Button aria-pressed={c.on} className="st-toggle" onClick={() => onToggle(c.cc, !c.on)}>
              {c.on ? 'Searching' : 'Paused'}
              <span className="sr-only"> in {c.name}</span>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The job boards. A board that failed its last fetch shows the error next to its name. */
export function BoardList({ boards }: { boards: FailedBoard[] }) {
  if (boards.length === 0) return <p className="pf-note">Every job board works.</p>;
  return (
    <ul className="pf-rows">
      {boards.map((b) => (
        <Row key={b.board} title={b.board} sub={`${b.error ?? 'No error text.'} Last try ${when(b.fetchedAt)}.`}>
          <Badge tone="coral">Failed</Badge>
        </Row>
      ))}
    </ul>
  );
}

/** The fields and the visa status. The onboarding wizard uses this form too. */
export function SearchForm({ value, onSaved, setToast }: { value: SearchSettings; onSaved: (s: SearchSettings) => void | Promise<unknown>; setToast: (s: string) => void }) {
  const [fields, setFields] = useState(value.fields);
  const [visa, setVisa] = useState(value.visaStatus);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pf-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const saved = await patch<SearchSettings>('/api/settings/search', { fields, visaStatus: visa });
          setToast('Saved your job search settings.');
          await onSaved(saved);
        } catch (err) {
          setToast((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="pf-group">
        <legend className="pf-group-title">Fields, up to {MAX_FIELDS}</legend>
        {value.fieldChoices.map((f) => (
          <label key={f} className="pf-check">
            <input
              type="checkbox"
              checked={fields.includes(f)}
              disabled={!fields.includes(f) && fields.length >= MAX_FIELDS}
              onChange={(e) => setFields(e.target.checked ? [...fields, f] : fields.filter((x) => x !== f))}
            />
            {f}
          </label>
        ))}
      </fieldset>
      <Field label="Visa status" hint="Waypoint uses this to rank jobs. For example: I need a work visa for Germany.">
        {(c) => <input {...c} type="text" maxLength={200} value={visa} onChange={(e) => setVisa(e.target.value)} />}
      </Field>
      <div className="pf-actions pf-wide">
        <Button type="submit" variant="go" busy={busy}>Save</Button>
      </div>
    </form>
  );
}

type Props = {
  countries: CountryRow[];
  onToggle: (cc: string, on: boolean) => void | Promise<unknown>;
  globalSites: string[];
  careerLinks: { company: string; url: string }[];
  search: SearchSettings | null;
  searchError?: Error;
  retrySearch: () => unknown;
  boards?: FailedBoard[];
  boardsError?: Error;
  retryBoards: () => unknown;
  reload: () => unknown;
  setToast: (s: string) => void;
};

export default function JobSearch({ countries, onToggle, globalSites, careerLinks, search, searchError, retrySearch, boards, boardsError, retryBoards, reload, setToast }: Props) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const on = countries.filter((c) => c.on).length;
  const state = [
    `${on} of ${plural(countries.length, 'country', 'countries')} on`,
    search ? plural(search.fields.length, 'field') : null,
    search ? (search.visaStatus.trim() ? `visa: ${search.visaStatus.trim()}` : 'no visa note') : null,
  ].filter(Boolean).join(', ');
  return (
    <div className="pf-stack">
      <SectionHead
        title="Job search"
        state={<span style={{ overflowWrap: 'anywhere' }}>{state}</span>}
        action={search && <Button ref={opener} variant="go" onClick={() => setOpen(true)}>Edit fields and visa</Button>}
      />
      <LoadError what="your job search settings" error={searchError} retry={retrySearch} />

      <section className="pf-section" aria-labelledby="st-countries">
        <h3 id="st-countries" className="pf-group-title">Countries, in your order</h3>
        <CountryList countries={countries} onToggle={onToggle} />
      </section>

      <section className="pf-section" aria-labelledby="st-boards">
        <h3 id="st-boards" className="pf-group-title">Job boards</h3>
        <LoadError what="the job boards" error={boardsError} retry={retryBoards} />
        {boards ? <BoardList boards={boards} /> : !boardsError && <p className="pf-note">Loading the job boards…</p>}
        <p className="pf-note">
          Waypoint reads the company boards and the public job feeds on its own. LinkedIn, Indeed, StepStone and Glassdoor forbid scraping, so Waypoint does not fetch them. Search them by hand: {globalSites.join(', ')}.
        </p>
        {careerLinks.length > 0 && (
          <p className="pf-note">
            Career pages to open by hand:{' '}
            {careerLinks.map((l, i) => (
              <span key={l.company}>
                {i > 0 && ', '}
                <a href={l.url} target="_blank" rel="noreferrer">{l.company}</a>
              </span>
            ))}
            .
          </p>
        )}
      </section>

      {search && (
        <Sheet open={open} onClose={() => setOpen(false)} title="Fields and visa" opener={opener} className="pf-sheet">
          <SearchForm value={search} setToast={setToast} onSaved={async () => { setOpen(false); await reload(); }} />
        </Sheet>
      )}
    </div>
  );
}
