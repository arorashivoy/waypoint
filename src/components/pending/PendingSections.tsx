'use client';

import type { ReactNode } from 'react';
import { Badge, EmptyState, Panel, Skeleton } from '../ui';
import AppliedItem from './AppliedItem';
import AwaitingItem from './AwaitingItem';
import NeedsItem from './NeedsItem';
import SafeItem from './SafeItem';
import { EMPTY_TEXT, pendingSections, type PendingData, type SectionKey } from './sections';
import type { PendingActions } from './usePendingActions';

const TITLES: Record<SectionKey, string> = { needs: 'Needs you', awaiting: 'Waiting for a reply', safe: 'Safe to send', applied: 'Applied' };

/** One glass panel: the title, a quiet count, and the items or the empty state. */
function Section({ id, title, count, loading, onJobs, children }: { id: SectionKey; title: string; count: number; loading?: boolean; onJobs: () => void; children?: ReactNode }) {
  const empty = EMPTY_TEXT[id];
  return (
    <Panel className="pn-sec" data-section={id} aria-labelledby={`pn-${id}`}>
      <div className="pn-head">
        <h2 id={`pn-${id}`} className="ui-panel-title" tabIndex={-1}>{title}</h2>
        {/* An empty section says so in words, so it shows no 0. */}
        {!loading && count > 0 && (id === 'needs'
          ? <Badge tone="coral">{count}<span className="sr-only"> {count === 1 ? 'item needs' : 'items need'} you</span></Badge>
          : <span className="pn-count">{count}<span className="sr-only"> {count === 1 ? 'item' : 'items'}</span></span>)}
      </div>
      <div className="pn-body">
        {loading ? <Skeleton rows={2} /> : count === 0 ? (
          <EmptyState cause={empty.cause} detail={empty.detail} action={empty.action ? { label: empty.action, onClick: onJobs } : undefined} />
        ) : (
          <ul className="pn-list">{children}</ul>
        )}
      </div>
    </Panel>
  );
}

/** The 4 sections: stacked on a phone, 2 × 2 on a tablet, 4 columns on a desktop. CSS does the layout. */
export default function PendingSections({ data, actions, onJobs }: { data: PendingData | undefined; actions: PendingActions; onJobs: () => void }) {
  if (!data) {
    return (
      <div className="pn-grid">
        {(Object.keys(TITLES) as SectionKey[]).map((k) => <Section key={k} id={k} title={TITLES[k]} count={0} loading onJobs={onJobs} />)}
      </div>
    );
  }
  const counts = Object.fromEntries(pendingSections(data).map((s) => [s.key, s.count])) as Record<SectionKey, number>;
  return (
    <div className="pn-grid">
      <Section id="needs" title={TITLES.needs} count={counts.needs} onJobs={onJobs}>
        {data.needs.map((n) => <NeedsItem key={n.id} item={n} actions={actions} />)}
      </Section>
      <Section id="awaiting" title={TITLES.awaiting} count={counts.awaiting} onJobs={onJobs}>
        {data.awaiting.map((a) => <AwaitingItem key={a.id} item={a} actions={actions} />)}
      </Section>
      <Section id="safe" title={TITLES.safe} count={counts.safe} onJobs={onJobs}>
        {data.auto.map((r) => <SafeItem key={r.id} item={r} actions={actions} />)}
      </Section>
      <Section id="applied" title={TITLES.applied} count={counts.applied} onJobs={onJobs}>
        {data.appliedList.map((p) => <AppliedItem key={p.id} item={p} />)}
      </Section>
    </div>
  );
}
