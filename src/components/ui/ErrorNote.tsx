import { Button } from './Button';

export interface ErrorNoteProps {
  /** What happened. */
  what: string;
  /** What the user can do. */
  fix: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Set only for an error that appears after an action. It makes screen readers announce it. */
  live?: boolean;
}

export function ErrorNote({ what, fix, onRetry, retryLabel = 'Try again', live }: ErrorNoteProps) {
  return (
    <div className="ui-error" role={live ? 'alert' : undefined}>
      <strong>{what}</strong>
      <span>{fix}</span>
      {onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
