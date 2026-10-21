import { expect } from '@playwright/test';
import { adminTest as test } from './helpers';
import { stateFile } from './setup/accounts';

// Two pages of the same user, as two browser tabs. Only one project runs this: it changes the admin profile.
test('a save from an old tab gets the 409 and keeps the headline of the other tab', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one project is enough');
  const state = stateFile('admin');
  const open = async () => {
    const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('/?view=profile&tab=experience');
    await expect(page.getByRole('textbox', { name: 'Headline' })).toBeVisible();
    return { context, page };
  };
  const a = await open();
  const b = await open();
  try {
    await a.page.getByRole('textbox', { name: 'Headline' }).fill('Headline from the old tab');
    await b.page.getByRole('textbox', { name: 'Headline' }).fill('Headline from the other tab');
    await b.page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(b.page.getByText('Saved.')).toBeVisible();

    // SWR loads again on focus only 5 s after the last load, so the test waits longer than that.
    await a.page.waitForTimeout(6000);
    // The old tab gets the focus back and loads the new version under its form. Its edit started earlier.
    await a.page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await a.page.waitForTimeout(1500);
    await a.page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(a.page.getByText(/changed in another tab/)).toBeVisible();
    await expect(a.page.getByRole('button', { name: 'Load the new version' })).toBeVisible();

    // The server keeps the headline of the other tab.
    const server = await a.page.evaluate(async () => (await (await fetch('/api/profile')).json()).doc.profile.headline);
    expect(server).toBe('Headline from the other tab');
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
