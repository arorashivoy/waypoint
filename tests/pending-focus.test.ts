import { describe, expect, it } from 'vitest';
import { keepFocus, sectionOfItem, type FocusDoc } from '@/components/pending/focus';

function fake(active: FocusDoc['activeElement'], body: unknown = {}, section: string | null = null) {
  const focused: string[] = [];
  const doc: FocusDoc = {
    activeElement: active,
    body,
    getElementById: (id) => ({ focus: () => void focused.push(id) }),
    querySelector: () => (section ? { closest: () => ({ getAttribute: () => section }) } : null),
  };
  return { doc, focused };
}
const inSection = (isConnected = true) => ({ isConnected });

describe('sectionOfItem', () => {
  it('names the section that holds the item, with no focus needed', () => {
    const body = {};
    expect(sectionOfItem(fake(body, body, 'needs').doc, 'n1')).toBe('needs');
  });

  it('gives null for an item that is not on the page', () => {
    expect(sectionOfItem(fake(null).doc, 'gone')).toBeNull();
  });
});

describe('keepFocus', () => {
  it('moves the focus to the section heading when the focused element left the page', () => {
    const { doc, focused } = fake(inSection(false));
    keepFocus(doc, 'needs');
    expect(focused).toEqual(['pn-needs']);
  });

  it('moves the focus when it fell to the page body', () => {
    const body = {};
    const { doc, focused } = fake(body, body);
    keepFocus(doc, 'safe');
    expect(focused).toEqual(['pn-safe']);
  });

  it('leaves the focus alone when the element is still on the page', () => {
    const { doc, focused } = fake(inSection());
    keepFocus(doc, 'needs');
    expect(focused).toEqual([]);
  });

  it('does nothing when the focus was outside every section', () => {
    const { doc, focused } = fake({}, {});
    keepFocus(doc, null);
    expect(focused).toEqual([]);
  });
});
