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
  // Each stop has one of the 3 words.
  const words = (await page.locator('.ui-route .ui-stop-word').allTextContents()).map((w) => w.trim());
  expect(words).toHaveLength(await route.count());
  for (const word of words) expect(['Met', 'Partial', 'Missing']).toContain(word);
  await expectNoSideScroll(page);

  const phone = isPhone(page);
  for (const [title, part] of [['Your way in', 'wayin'], ['Your CV for this role', 'cv']] as const) {
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    if (part === 'wayin') await expect(page.locator('.jd-wayin .ui-fold-body').getByText('Anna Weber').first()).toBeVisible();
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

  // The shot shows the job as it stands: on a wide screen with both parts open, on a phone after Back. A phone then goes back to the list.
  await shot(page, info, 'job-detail');
  if (phone) {
    await page.getByRole('button', { name: 'Jobs', exact: true }).first().click();
    await expect(page.locator('button.jr').first()).toBeVisible();
  }
});
