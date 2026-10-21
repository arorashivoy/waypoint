import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
}

export function Panel({ title, className, children, ...rest }: PanelProps) {
  return (
    <section {...rest} className={['glass', 'ui-panel', className].filter(Boolean).join(' ')}>
      {title && <h3 className="ui-panel-title">{title}</h3>}
      {children}
    </section>
  );
}
