'use client';

import type { RefObject } from 'react';
import { Button, Sheet } from '../ui';
import { clearedFilters, FILTER_OPTIONS, YOUR_LEVEL, type Filters } from './filters';

interface Props {
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLElement | null>;
  filters: Filters;
  levels: readonly string[];
  /** How many jobs the list shows with these filters. */
  count: number;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}

/** The filters that hide jobs now, each with the patch that removes it. */
export function activeChips(f: Filters, base: Filters): { id: string; label: string; undo: Partial<Filters> }[] {
  const chips: { id: string; label: string; undo: Partial<Filters> }[] = [];
  if (f.field !== base.field) chips.push({ id: 'field', label: `Field: ${f.field}`, undo: { field: base.field } });
  if (f.mode !== base.mode) chips.push({ id: 'mode', label: `Work mode: ${f.mode}`, undo: { mode: base.mode } });
  if (f.level !== base.level) chips.push({ id: 'level', label: `Level: ${f.level}`, undo: { level: base.level } });
  if (f.posted !== base.posted) chips.push({ id: 'posted', label: `Posted: ${f.posted}`, undo: { posted: base.posted } });
  if (f.sponsorOnly !== base.sponsorOnly) chips.push({ id: 'sponsor', label: 'Sponsors a visa', undo: { sponsorOnly: base.sponsorOnly } });
  if (f.topOnly !== base.topOnly) chips.push({ id: 'top', label: 'Top companies', undo: { topOnly: base.topOnly } });
  return chips;
}

export default function FilterSheet({ open, onClose, opener, filters, levels, count, onChange, onClear }: Props) {
  const chips = activeChips(filters, clearedFilters);
  return (
    <Sheet open={open} onClose={onClose} title="Filters" opener={opener}>
      {chips.length > 0 && (
        <div className="fs-active">
          <ul className="fs-chips" aria-label="Active filters">
            {chips.map((c) => (
              <li key={c.id}>
                <button type="button" className="fs-chip" aria-label={`Remove the filter ${c.label}`} onClick={() => onChange(c.undo)}>
                  {c.label}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="link" onClick={onClear}>Clear the filters</Button>
        </div>
      )}

      {FILTER_OPTIONS.map((g) => (
        <div key={g.key} role="group" aria-label={g.label} className="fs-group">
          <span className="fs-label">{g.label}</span>
          <div className="fs-options">
            {g.options.map((o) => (
              <button key={o} type="button" className="chip" data-on={filters[g.key] === o} aria-pressed={filters[g.key] === o} onClick={() => onChange({ [g.key]: o })}>
                {o}
              </button>
            ))}
          </div>
          {g.key === 'level' && (
            <p className="fs-hint">
              {levels.length ? `${YOUR_LEVEL} means ${levels.join(' and ')}.` : 'Add your level in Profile to use this filter.'}
            </p>
          )}
        </div>
      ))}

      <div role="group" aria-label="Show only" className="fs-group">
        <span className="fs-label">Show only</span>
        <div className="fs-options">
          <button type="button" className="chip" data-on={filters.sponsorOnly} aria-pressed={filters.sponsorOnly} onClick={() => onChange({ sponsorOnly: !filters.sponsorOnly })}>
            Sponsors a visa
          </button>
          <button type="button" className="chip" data-on={filters.topOnly} aria-pressed={filters.topOnly} onClick={() => onChange({ topOnly: !filters.topOnly })}>
            Top companies
          </button>
        </div>
      </div>

      <div role="group" aria-label="Sort" className="fs-group">
        <span className="fs-label">Sort</span>
        <div className="fs-options">
          {([['match', 'Best match'], ['date', 'Newest']] as const).map(([value, label]) => (
            <button key={value} type="button" className="chip" data-on={filters.sort === value} aria-pressed={filters.sort === value} onClick={() => onChange({ sort: value })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="fs-foot">
        <Button variant="go" onClick={onClose}>
          Show {count} {count === 1 ? 'job' : 'jobs'}
        </Button>
      </div>
    </Sheet>
  );
}
