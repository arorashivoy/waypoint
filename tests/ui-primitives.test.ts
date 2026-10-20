import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  EmptyState,
  type FieldControlProps,
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
  it('Toast is a polite live region', () => {
    const html = render(h(Toast, { message: 'Copied', onHide: () => {} }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Copied');
    expect(render(h(Toast, { message: null, onHide: () => {} }))).not.toContain('Copied');
  });
});
