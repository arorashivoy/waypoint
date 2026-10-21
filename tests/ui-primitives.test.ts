import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  EmptyState,
  type FieldControlProps,
  isFocusableState,
  pickOpener,
  scheduleHide,
  sheetKeyAction,
  TOAST_MS,
  ErrorNote,
  Field,
  Fold,
  nextTabIndex,
  Panel,
  Route,
  routeSummary,
  ScorePill,
  ScoreRing,
  Sheet,
  Skeleton,
  Tabs,
  TaskIndicator,
  TaskAnnouncer,
  Toast,
  trapIndex,
  WayIn,
} from '@/components/ui';

const control = (c: FieldControlProps) => h('input', c);
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('routeSummary', () => {
  it('counts the statuses and names the blocker', () => {
    const text = routeSummary(
      [
        { status: 'met', label: 'Java' },
        { status: 'met', label: 'SQL' },
        { status: 'partial', label: 'Kubernetes' },
      ],
      [{ label: 'Needs a Swiss work permit' }],
    );
    expect(text).toBe('2 of 3 met, 1 partial. 1 blocker: Needs a Swiss work permit.');
  });

  it('names missing stops and many blockers', () => {
    const text = routeSummary([{ status: 'missing', label: 'Go' }, { status: 'met', label: 'C' }], [{ label: 'A' }, { label: 'B' }]);
    expect(text).toBe('1 of 2 met, 1 missing. 2 blockers: A; B.');
  });

  it('says so when there is nothing', () => {
    expect(routeSummary([])).toBe('No requirements.');
  });

  it('says that it counts only the top stops when the route shows a part of the list', () => {
    const top = [{ status: 'missing' as const, label: 'Go' }, { status: 'met' as const, label: 'C' }];
    expect(routeSummary(top, [], 9)).toBe('Top 2 of 9 requirements: 1 met, 1 missing.');
    expect(routeSummary(top, [], 2)).toBe('1 of 2 met, 1 missing.');
  });
});

describe('Route', () => {
  const items = [
    { status: 'met' as const, label: 'Java', evidence: 'Ledger service' },
    { status: 'partial' as const, label: 'Kubernetes' },
    { status: 'missing' as const, label: 'Terraform' },
  ];
  it('gives each status its own stop class and word', () => {
    const html = render(h(Route, { items }));
    expect(html).toContain('ui-stop-met');
    expect(html).toContain('ui-stop-partial');
    expect(html).toContain('ui-stop-missing');
    expect(html).toContain('>Met<');
    expect(html).toContain('>Partial<');
    expect(html).toContain('>Missing<');
    expect(html).toContain('Ledger service');
  });
  it('has the hidden summary and the blockers before the route', () => {
    const html = render(h(Route, { items, blockers: [{ label: 'Needs a work permit' }] }));
    expect(html).toContain('class="sr-only">1 of 3 met, 1 partial, 1 missing. 1 blocker: Needs a work permit.');
    expect(html.indexOf('ui-blockers')).toBeLessThan(html.indexOf('<ol class="ui-route"'));
  });
});

describe('Field', () => {
  it('links the error to the control', () => {
    const html = render(h(Field, { label: 'Job link', error: 'Paste a link.', hint: 'From Lever.', children: control }));
    expect(html).toContain('aria-invalid="true"');
    const described = /aria-describedby="([^"]+)"/.exec(html)![1].split(' ');
    const errId = /<p id="([^"]+)" class="ui-field-err"/.exec(html)![1];
    expect(described).toContain(errId);
    expect(html).toContain('<label for=');
    expect(html).toContain('Job link');
  });
  it('has no error markup without an error', () => {
    const html = render(h(Field, { label: 'Name', children: control }));
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
  });
});

describe('Sheet', () => {
  it('is a labelled modal dialog', () => {
    const html = render(h(Sheet, { open: true, onClose: () => {}, title: 'Filters' }, h('p', null, 'Body')));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<h2 id="${labelled}">Filters</h2>`);
  });
  it('renders nothing when closed', () => {
    expect(render(h(Sheet, { open: false, onClose: () => {}, title: 'Filters' }))).toBe('');
  });
});

describe('trapIndex', () => {
  it('moves on and wraps at both ends', () => {
    expect(trapIndex(3, 0, false)).toBe(1);
    expect(trapIndex(3, 2, false)).toBe(0);
    expect(trapIndex(3, 0, true)).toBe(2);
    expect(trapIndex(3, 2, true)).toBe(1);
  });
  it('goes to the first or last item when focus is outside', () => {
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
    expect(trapIndex(0, -1, false)).toBe(-1);
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Jobs', panel: 'A panel' },
    { id: 'b', label: 'People', panel: 'B panel' },
  ];
  it('has the tab roles and one selected tab', () => {
    const html = render(h(Tabs, { label: 'Sections', tabs }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html.match(/tabindex="0"/g)!.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
  });
  it('supports the vertical orientation', () => {
    expect(render(h(Tabs, { label: 'Sections', tabs, orientation: 'vertical' }))).toContain('aria-orientation="vertical"');
  });
});

describe('nextTabIndex', () => {
  it('moves with the arrows and wraps', () => {
    expect(nextTabIndex(3, 0, 'ArrowRight')).toBe(1);
    expect(nextTabIndex(3, 2, 'ArrowRight')).toBe(0);
    expect(nextTabIndex(3, 0, 'ArrowLeft')).toBe(2);
  });
  it('handles Home and End', () => {
    expect(nextTabIndex(3, 1, 'Home')).toBe(0);
    expect(nextTabIndex(3, 1, 'End')).toBe(2);
  });
  it('uses the up and down arrows when vertical', () => {
    expect(nextTabIndex(3, 0, 'ArrowDown', 'vertical')).toBe(1);
    expect(nextTabIndex(3, 0, 'ArrowRight', 'vertical')).toBeNull();
  });
  it('ignores other keys', () => {
    expect(nextTabIndex(3, 0, 'a')).toBeNull();
  });
});

describe('ScorePill', () => {
  it('tints by score', () => {
    expect(render(h(ScorePill, { score: 75 }))).toContain('ui-pill-mint');
    expect(render(h(ScorePill, { score: 74 }))).toContain('ui-pill-lav');
    expect(render(h(ScorePill, { score: 50 }))).toContain('ui-pill-lav');
    expect(render(h(ScorePill, { score: 49 }))).toContain('ui-pill-neutral');
  });
  it('has a spoken label', () => {
    expect(render(h(ScorePill, { score: 86 }))).toContain('aria-label="Match 86 of 100"');
  });
});

describe('ScoreRing', () => {
  it('shows the number and a label', () => {
    const html = render(h(ScoreRing, { score: 86 }));
    expect(html).toContain('aria-label="Match 86 of 100"');
    expect(html).toContain('--v:86');
  });
});

describe('EmptyState', () => {
  it('shows the cause, the detail and the action', () => {
    const html = render(h(EmptyState, { cause: 'No country is on.', detail: 'Turn one on.', action: { label: 'Open countries', onClick: () => {} } }));
    expect(html).toContain('No country is on.');
    expect(html).toContain('Turn one on.');
    expect(html).toContain('Open countries');
    expect(html).toContain('<button');
  });
  it('uses a link for an href action', () => {
    expect(render(h(EmptyState, { cause: 'Nothing here.', action: { label: 'Go', href: '/x' } }))).toContain('<a class="btn go ui-btn" href="/x">Go</a>');
  });
});

describe('ErrorNote', () => {
  it('has role alert only when live', () => {
    expect(render(h(ErrorNote, { what: 'Build failed.', fix: 'Fix line 42.' }))).not.toContain('role="alert"');
    expect(render(h(ErrorNote, { what: 'Build failed.', fix: 'Fix line 42.', live: true }))).toContain('role="alert"');
  });
  it('shows a retry button on request', () => {
    expect(render(h(ErrorNote, { what: 'a', fix: 'b', onRetry: () => {}, retryLabel: 'Build again' }))).toContain('Build again');
  });
});

describe('Button', () => {
  it('sets aria-busy and a spinner when busy', () => {
    const html = render(h(Button, { busy: true }, 'Save'));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('ui-spin');
  });
  it('has no aria-busy when idle, and the variant class', () => {
    const html = render(h(Button, { variant: 'go' }, 'Save'));
    expect(html).not.toContain('aria-busy');
    expect(html).toContain('btn ui-btn go');
  });
});

describe('small parts', () => {
  it('Badge has a tone', () => {
    expect(render(h(Badge, { tone: 'coral', children: '3' }))).toContain('ui-badge-coral');
  });
  it('Panel shows its title', () => {
    expect(render(h(Panel, { title: 'Your way in' }, 'x'))).toContain('Your way in');
  });
  it('Fold is a closed button with the status', () => {
    const html = render(h(Fold, { title: 'Your CV', status: 'Ready' }, 'Body'));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Ready');
  });
  it('WayIn lists three stops', () => {
    const html = render(h(WayIn, { contact: 'Anna Weber', company: 'Orbit' }));
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
  it('Skeleton is busy with a hidden word', () => {
    const html = render(h(Skeleton, { rows: 2 }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading');
    expect(html.match(/class="ui-skel"/g)).toHaveLength(2);
  });
  it('TaskIndicator renders nothing without text', () => {
    expect(render(h(TaskIndicator, { text: null }))).toBe('');
    expect(render(h(TaskIndicator, { text: 'Checking 12 jobs' }))).toContain('role="status"');
  });
  it('TaskIndicator can drop its live region, and TaskAnnouncer stays in the page with no text', () => {
    expect(render(h(TaskIndicator, { text: 'Checking 12 jobs', silent: true }))).not.toContain('role="status"');
    const empty = render(h(TaskAnnouncer, { text: null }));
    expect(empty).toContain('role="status"');
    expect(render(h(TaskAnnouncer, { text: 'Checking 12 jobs' }))).toContain('Checking 12 jobs');
  });
  it('Toast is a polite live region', () => {
    const html = render(h(Toast, { message: 'Copied', onHide: () => {} }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Copied');
    expect(render(h(Toast, { message: null, onHide: () => {} }))).not.toContain('Copied');
  });
});

describe('isFocusableState', () => {
  const ok = { hiddenAncestor: false, inertAncestor: false, disabled: false, display: 'block', visibility: 'visible' };
  it('accepts a visible control', () => {
    expect(isFocusableState(ok)).toBe(true);
  });
  it('skips hidden, inert, disabled, display:none and visibility:hidden controls', () => {
    expect(isFocusableState({ ...ok, hiddenAncestor: true })).toBe(false);
    expect(isFocusableState({ ...ok, inertAncestor: true })).toBe(false);
    expect(isFocusableState({ ...ok, disabled: true })).toBe(false);
    expect(isFocusableState({ ...ok, display: 'none' })).toBe(false);
    expect(isFocusableState({ ...ok, visibility: 'hidden' })).toBe(false);
  });
});

describe('sheetKeyAction', () => {
  it('closes on Esc', () => {
    expect(sheetKeyAction('Escape', false, 3, 1)).toEqual({ type: 'close' });
  });
  it('wraps Tab at the last item and Shift+Tab at the first', () => {
    expect(sheetKeyAction('Tab', false, 3, 2)).toEqual({ type: 'focus', index: 0 });
    expect(sheetKeyAction('Tab', true, 3, 0)).toEqual({ type: 'focus', index: 2 });
  });
  it('lets the browser move focus inside the list', () => {
    expect(sheetKeyAction('Tab', false, 3, 0)).toEqual({ type: 'none' });
    expect(sheetKeyAction('Tab', true, 3, 2)).toEqual({ type: 'none' });
  });
  it('pulls focus in when it is outside the list, and holds it on the panel when the list is empty', () => {
    expect(sheetKeyAction('Tab', false, 3, -1)).toEqual({ type: 'focus', index: 0 });
    expect(sheetKeyAction('Tab', false, 0, -1)).toEqual({ type: 'focus', index: -1 });
  });
  it('ignores other keys', () => {
    expect(sheetKeyAction('a', false, 3, 0)).toEqual({ type: 'none' });
  });
});

describe('pickOpener', () => {
  const el = (isConnected: boolean) => ({ isConnected });
  it('prefers the opener from the screen, then the pointer target, then the active element', () => {
    const [a, b, c] = [el(true), el(true), el(true)];
    expect(pickOpener(a, b, c)).toBe(a);
    expect(pickOpener(null, b, c)).toBe(b);
    expect(pickOpener(null, null, c)).toBe(c);
  });
  it('skips an element that left the page', () => {
    const [gone, b] = [el(false), el(true)];
    expect(pickOpener(gone, b, null)).toBe(b);
    expect(pickOpener(null, null, null)).toBeNull();
  });
});

describe('scheduleHide', () => {
  it('calls the handler after 4 seconds', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    scheduleHide({ current: fn });
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('does not call after cancel, and reads the newest handler', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const ref = { current: first };
    const cancel = scheduleHide(ref);
    ref.current = second;
    vi.advanceTimersByTime(TOAST_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const cancel2 = scheduleHide(ref);
    cancel2();
    cancel();
    vi.advanceTimersByTime(TOAST_MS);
    expect(second).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('markup fixes', () => {
  it('ScorePill is an image with its label', () => {
    expect(render(h(ScorePill, { score: 86 }))).toContain('role="img"');
  });
  it('Fold aria-controls names the body id', () => {
    const html = render(h(Fold, { title: 'Your CV', status: 'Ready', children: 'Body' }));
    const id = /aria-controls="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<div id="${id}" class="ui-fold-body" hidden="">`);
  });
  it('Button confirm uses one polite region outside the button', () => {
    const html = render(h(Button, { confirm: 'Copied', children: 'Copy message' }));
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html.indexOf('</button>')).toBeLessThan(html.indexOf('aria-live'));
  });
});
