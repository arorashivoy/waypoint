import { describe, expect, it } from 'vitest';
import { focusedSection, keepFocus, type FocusDoc } from '@/components/pending/focus';

function fake(active: FocusDoc['activeElement'], body: unknown = {}) {
  const focused: string[] = [];
  const doc: FocusDoc = {
    activeElement: active,
    body,
    getElementById: (id) => ({ focus: () => void focused.push(id) }),
  };
  return { doc, focused };
}
const inSection = (key: string, isConnected = true) => ({ closest: () => ({ getAttribute: () => key }), isConnected });

describe('focusedSection', () => {
  it('names the section of the focused element', () => {
    expect(focusedSection(fake(inSection('needs')).doc)).toBe('needs');
  });

  it('gives null when the focus is on the page body', () => {
    const body = {};
    expect(focusedSection(fake(body, body).doc)).toBeNull();
  });
});

describe('keepFocus', () => {
  it('moves the focus to the section heading when the focused element left the page', () => {
    const { doc, focused } = fake(inSection('needs', false));
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
    const { doc, focused } = fake(inSection('needs'));
    keepFocus(doc, 'needs');
    expect(focused).toEqual([]);
  });

  it('does nothing when the focus was outside every section', () => {
    const { doc, focused } = fake({}, {});
    keepFocus(doc, null);
    expect(focused).toEqual([]);
  });
});
