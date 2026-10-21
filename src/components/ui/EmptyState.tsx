import { Button } from './Button';

export interface EmptyStateProps {
  /** Why the screen is empty, in one sentence. */
  cause: string;
  detail?: string;
  /** Leave it out when the user has nothing to do. */
  action?: { label: string; onClick?: () => void; href?: string };
}

export function EmptyState({ cause, detail, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-route" aria-hidden="true"><em /><i /></div>
      <p className="ui-empty-cause">{cause}</p>
      {detail && <p className="ui-empty-detail">{detail}</p>}
      {action && (action.href ? (
        <a className="btn go ui-btn" href={action.href}>{action.label}</a>
      ) : (
        <Button variant="go" onClick={action.onClick}>{action.label}</Button>
      ))}
    </div>
  );
}
