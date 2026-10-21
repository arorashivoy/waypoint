import { expect } from '@playwright/test';
import { expectNoSideScroll, memberTest as test, shot } from './helpers';

test('the wizard: do 2 steps, skip the rest, land on Jobs', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome, Mia/ })).toBeVisible();
  await expectNoSideScroll(page);

  // Step 1: read and continue.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 2: the search. Save it.
  await expect(page.getByRole('heading', { name: 'Where do you want to work?' })).toBeVisible();
  await expectNoSideScroll(page);
  const save = page.getByRole('button', { name: 'Save and continue', exact: true });
  await expect(save).toBeEnabled();
  await save.click();

  // Steps 3 to 6: skip each one. The last skip leaves the wizard.
  for (const title of ['Add your Claude key', 'Add your experience', 'Review your drafts', 'Find your first jobs']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Skip this step', exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'Find your first jobs' })).toBeHidden();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expectNoSideScroll(page);

  // The wizard stays done after a reload.
  await page.reload();
  await expect(page.locator('button.jr').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Welcome, / })).toBeHidden();
  await shot(page, info, 'wizard-jobs');
});
