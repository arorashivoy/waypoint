import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * One click on Continue must not also submit the next step. The main button of a step and the main button
 * of the next step sit in the same place. Without a key, React reuses the DOM node, and the node of
 * step 1 becomes the submit button of step 2 during the same click. The browser then submits that form.
 * A browser test (tests/e2e/wizard.spec.ts) covers the behaviour. This test keeps the key in place.
 */
describe('the footer of the wizard', () => {
  const source = readFileSync('src/components/onboarding/Onboarding.tsx', 'utf8');

  it('gives the main button its own key for each step', () => {
    expect(source).toMatch(/<Fragment key=\{current\}>\{primary\}<\/Fragment>/);
  });

  it('puts the keyed main button inside the footer', () => {
    const footer = source.slice(source.indexOf('<footer className="ob-foot">'), source.indexOf('</footer>'));
    expect(footer).toContain('<Fragment key={current}>{primary}</Fragment>');
  });
});
