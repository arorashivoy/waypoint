import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD } from './setup/accounts';
import { expectNoSideScroll, shot } from './helpers';

// This test signs in by hand, so it starts with no cookies.
test.use({ storageState: { cookies: [], origins: [] } });

test('sign in with the form and land on Jobs', async ({ page }, info) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSideScroll(page);

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('button.jr').first()).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, info, 'signin');
});
