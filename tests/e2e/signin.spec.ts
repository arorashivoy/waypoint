import { expect, test } from '@playwright/test';
import { ADMIN, PROJECTS, password } from './setup/accounts';
import { expectNoSideScroll, shot } from './helpers';

// This test signs in by hand, so it starts with no cookies.
test.use({ storageState: { cookies: [], origins: [] } });

test('sign in with the form: a wrong password fails, the right one lands on Jobs', async ({ page }, info) => {
  // Each project signs in from its own made-up address, so the limit for one address does not fill.
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `10.30.0.${PROJECTS.indexOf(info.project.name as (typeof PROJECTS)[number]) + 1}` });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSideScroll(page);

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('not correct');
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Password').fill(password());
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('button.jr').first()).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, info, 'signin');
});
