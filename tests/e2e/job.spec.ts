import { expect } from '@playwright/test';
import { adminTest as test, expectNoSideScroll, isPhone, shot } from './helpers';

test('the job detail: the route, Your way in and Your CV, and Back on a phone', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('button.jr', { hasText: 'Backend Engineer, Payments' }).click();
  await expect(page).toHaveURL(/job=/);

  // The route shows the top requirements, each with a word for its state (not colour only).
  const route = page.locator('.ui-route li');
  await expect(route.first()).toBeVisible();
  expect(await route.count()).toBeGreaterThan(2);
  await expect(page.locator('.ui-route .ui-stop-word', { hasText: 'Missing' }).or(page.locator('.ui-route .ui-stop-word', { hasText: 'Met' })).first()).toBeVisible();
  await expectNoSideScroll(page);

  const phone = isPhone(page);
  for (const [title, part] of [['Your way in', 'wayin'], ['Your CV for this role', 'cv']] as const) {
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    if (phone) {
      // A phone opens the part as its own screen, with a Back button.
      await expect(page).toHaveURL(new RegExp(`part=${part}`));
      const back = page.locator(`.jd-${part} .jd-back`).getByRole('button', { name: 'Back' });
      await expect(back).toBeVisible();
      await expectNoSideScroll(page);
      await back.click();
      await expect(page).not.toHaveURL(/part=/);
    } else {
      await expect(page.getByRole('button', { name: new RegExp(`^${title}`) })).toHaveAttribute('aria-expanded', 'true');
      await expectNoSideScroll(page);
    }
  }

  // The way in is open last on a wide screen; on a phone the job list shows again after the Jobs button.
  await shot(page, info, 'job-detail');
  if (phone) {
    await page.getByRole('button', { name: 'Jobs', exact: true }).first().click();
    await expect(page.locator('button.jr').first()).toBeVisible();
  }
});
