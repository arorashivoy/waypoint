import { expect } from '@playwright/test';
import { adminTest as test, expectNoSideScroll, shot } from './helpers';
import { stateFile } from './setup/accounts';

// Each project builds the CV of its own job, so the projects do not meet in one build.
const ROLE: Record<string, string> = {
  'iphone-15': 'Platform Engineer',
  'pixel-7': 'Data Engineer',
  'ipad-portrait': 'Staff Backend Engineer',
  'ipad-landscape': 'Site Reliability Engineer',
  'ipad-pro': 'Quant Developer',
  'desktop': 'Junior Data Analyst',
};

test('the CV: build it, see the result, and use Open, Download and the preview', async ({ page }, info) => {
  const role = ROLE[info.project.name];
  const list = await (await page.request.get('/api/jobs/list')).json();
  const job = (list.jobs ?? list).find((j: { role: string }) => j.role === role);
  expect(job, `seeded job ${role}`).toBeTruthy();

  await page.goto(`/?job=${job.id}`);
  await page.getByRole('button', { name: /^Your CV for this role/ }).click();

  // Nothing is built yet.
  const build = page.getByRole('button', { name: 'Build CV' });
  await expect(build).toBeVisible();
  await build.click();

  // The worker builds. The base CV has no claims, so the result is the base CV with the reason, not a fault.
  const rebuild = page.getByRole('button', { name: 'Rebuild CV' });
  await expect(rebuild).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/This is the base CV, not tailored: no claims.yml/)).toBeVisible();

  const open = page.getByRole('link', { name: 'Open', exact: true });
  const download = page.getByRole('link', { name: 'Download', exact: true });
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(download).toHaveAttribute('download', '');

  // The link serves a PDF.
  const href = await open.getAttribute('href');
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  // The preview draws the pages.
  const preview = page.locator('.jd-preview');
  await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(preview.locator('canvas').first()).toBeVisible();
  await expectNoSideScroll(page);
  await preview.scrollIntoViewIfNeeded();
  await shot(page, info, 'cv-built');
});

// A member with no CV source: the build fails, and the page must say so in words, next to the button.
test.describe('the CV error path', () => {
  test.use({ storageState: stateFile('no-cv') });

  test('a build with no CV source shows the reason and no PDF', async ({ page }, info) => {
    const role = ROLE[info.project.name];
    const list = await (await page.request.get('/api/jobs/list')).json();
    const job = (list.jobs ?? list).find((j: { role: string }) => j.role === role);
    expect(job, `seeded job ${role}`).toBeTruthy();

    await page.goto(`/?job=${job.id}`);
    await page.getByRole('button', { name: /^Your CV for this role/ }).click();
    await page.getByRole('button', { name: 'Build CV' }).click();

    await expect(page.getByRole('button', { name: 'Build CV' })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Open', exact: true })).toHaveCount(0);
    await expect(page.locator('.jd-preview canvas')).toHaveCount(0);
    await expect(page.locator('.jd-cv [role=alert]')).toContainText('No résumé is set up');
    await expectNoSideScroll(page);
    await shot(page, info, 'cv-error');
  });
});
