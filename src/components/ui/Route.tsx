import type { CSSProperties } from 'react';

export type StopStatus = 'met' | 'partial' | 'missing';

export interface RouteItem {
  status: StopStatus;
  label: string;
  evidence?: string;
}

export interface RouteProps {
  items: RouteItem[];
  blockers?: { label: string }[];
  /** The number of all requirements, when the route shows only the top ones. */
  total?: number;
}

const WORD: Record<StopStatus, string> = { met: 'Met', partial: 'Partial', missing: 'Missing' };
const DRAW_MS = 300;

/**
 * The text form for screen readers, for example "2 of 3 met, 1 partial. 1 blocker: Needs a Swiss work permit."
 * When the route shows only the top stops of a longer list, it says so: "Top 3 of 9 requirements: 1 met, 2 missing."
 */
export function routeSummary(items: RouteItem[], blockers: { label: string }[] = [], total = items.length): string {
  if (items.length === 0 && blockers.length === 0) return 'No requirements.';
  const count = (s: StopStatus) => items.filter((i) => i.status === s).length;
  const parts = [total > items.length ? `Top ${items.length} of ${total} requirements: ${count('met')} met` : `${count('met')} of ${items.length} met`];
  if (count('partial')) parts.push(`${count('partial')} partial`);
  if (count('missing')) parts.push(`${count('missing')} missing`);
  let text = `${parts.join(', ')}.`;
  if (blockers.length) {
    text += ` ${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'}: ${blockers.map((b) => b.label).join('; ')}.`;
  }
  return text;
}

export function Route({ items, blockers = [], total }: RouteProps) {
  const step = items.length > 0 ? Math.round(DRAW_MS / items.length) : 0;
  return (
    <div className="ui-route-wrap">
      <p className="sr-only">{routeSummary(items, blockers, total)}</p>
      {blockers.length > 0 && (
        <ul className="ui-blockers">
          {blockers.map((b, i) => (
            <li key={`${i}-${b.label}`}>{b.label}</li>
          ))}
        </ul>
      )}
      <ol className="ui-route">
        {items.map((item, i) => (
          <li key={`${i}-${item.label}`} className={`ui-stop ui-stop-${item.status}`} style={{ '--d': `${i * step}ms` } as CSSProperties}>
            <span className="ui-stop-label">{item.label}</span>
            <span className="ui-stop-word">{WORD[item.status]}</span>
            {item.evidence && <span className="ui-stop-ev">{item.evidence}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
