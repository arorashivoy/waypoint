import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCRATCH, stateFile } from './setup/accounts';

/** A test as the admin, who has jobs and has finished the wizard. */
export const adminTest = base.extend({
  storageState: async ({}, use) => { await use(stateFile('admin')); },
});

/** A test as the new member of this project. The wizard shows to this member. */
export const memberTest = base.extend({
  storageState: async ({}, use, info) => { await use(stateFile(info.project.name)); },
});

/** Under 640 px a part of the job opens as its own screen. */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

/** The screen must not scroll sideways. */
export async function expectNoSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'horizontal scroll in px').toBeLessThanOrEqual(0);
}

/** The screenshot at the end of a test: saved in the scratch folder and attached to the report. */
export async function shot(page: Page, info: TestInfo, name: string) {
  const dir = join(SCRATCH, 'shots', info.project.name);
  mkdirSync(dir, { recursive: true });
  // The lists rise in when a screen opens. The shot waits until they stop.
  await page.waitForTimeout(800);
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}
