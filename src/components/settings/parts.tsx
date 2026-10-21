'use client';

import type { ReactNode } from 'react';
import { ErrorNote } from '../ui';

/** Runs a request, shows the message on an error, loads the sections again. True when the request worked. */
export type Run = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;

/** The error of one section, with its own Retry. A section that failed does not stop the others. */
export function LoadError({ what, error, retry }: { what: string; error?: Error; retry: () => unknown }) {
  if (!error) return null;
  return <ErrorNote what={`Waypoint could not load ${what}.`} fix={`${error.message.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={() => { retry(); }} />;
}

/** The head of a section: its name, its state in one line, and its one primary action. */
export function SectionHead({ title, state, action }: { title: string; state: ReactNode; action?: ReactNode }) {
  return (
    <div className="st-head">
      <div className="st-head-text">
        <h2>{title}</h2>
        <p className="pf-sub">{state}</p>
      </div>
      {action && <div className="st-head-action">{action}</div>}
    </div>
  );
}

/** One calm row: a title and a line of text on the left, actions on the right. */
export function Row({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <li className="pf-row">
      <div className="pf-row-text">
        <span className="pf-row-title">{title}</span>
        {sub && <span className="pf-row-sub">{sub}</span>}
      </div>
      {children && <div className="pf-row-actions">{children}</div>}
    </li>
  );
}
