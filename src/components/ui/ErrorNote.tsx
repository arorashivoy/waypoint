import { Button } from './Button';

export interface ErrorNoteProps {
  /** What happened. */
  what: string;
  /** What the user can do. */
  fix: string;
  /** Text to read as it is, for example the first lines of a LaTeX log. */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Set only for an error that appears after an action. It makes screen readers announce it. */
  live?: boolean;
}

export function ErrorNote({ what, fix, detail, onRetry, retryLabel = 'Try again', live }: ErrorNoteProps) {
  return (
    <div className="ui-error" role={live ? 'alert' : undefined}>
      <strong>{what}</strong>
      <span>{fix}</span>
      {detail && <pre className="ui-error-detail">{detail}</pre>}
      {onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
