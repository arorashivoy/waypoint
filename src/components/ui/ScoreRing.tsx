import type { CSSProperties } from 'react';

export function ScoreRing({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className="ui-ring" role="img" aria-label={`Match ${value} of 100`} style={{ '--v': value } as CSSProperties}>
      <div aria-hidden="true">
        <b>{value}</b>
        <small>match</small>
      </div>
    </div>
  );
}
