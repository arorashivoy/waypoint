export type ScoreTone = 'mint' | 'lav' | 'neutral';

/** Mint from 75, lavender from 50, neutral below. */
export function scoreTone(score: number): ScoreTone {
  if (score >= 75) return 'mint';
  if (score >= 50) return 'lav';
  return 'neutral';
}

export function ScorePill({ score }: { score: number }) {
  return (
    <span className={`ui-pill ui-pill-${scoreTone(score)}`} role="img" aria-label={`Match ${score} of 100`}>
      {score}
    </span>
  );
}
