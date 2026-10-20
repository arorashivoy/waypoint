'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type TabsOrientation = 'horizontal' | 'vertical';

/** Index to move to for a key, or null when the key does nothing. */
export function nextTabIndex(count: number, current: number, key: string, orientation: TabsOrientation = 'horizontal'): number | null {
  if (count <= 0) return null;
  const [prev, next] = orientation === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (key === next) return (current + 1) % count;
  if (key === prev) return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

export interface TabsProps {
  label: string;
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  orientation?: TabsOrientation;
}

/** Layout-neutral: the screen decides if the list runs across or down. */
export function Tabs({ label, tabs, value, defaultValue, onChange, orientation = 'horizontal' }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? tabs[0]?.id);
  const selected = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(id: string) {
    setInner(id);
    onChange?.(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((t) => t.id === selected);
    const next = nextTabIndex(tabs.length, current, event.key, orientation);
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="ui-tabs" data-orientation={orientation}>
      <div role="tablist" aria-label={label} aria-orientation={orientation} className="ui-tablist" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === selected}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={t.id === selected ? 0 : -1}
            className="ui-tab"
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={t.id !== selected} tabIndex={0} className="ui-tabpanel">
          {t.panel}
        </div>
      ))}
    </div>
  );
}
