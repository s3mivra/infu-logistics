import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Phones: the bottom bar and tables as cards. Tablets/desktop: type to search
// on the till, and an unsaved form kept as a draft.
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('bottom bar opens screens; tables read as labelled cards', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);
    const bar = page.getByRole('navigation', { name: 'Quick' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: /Stock/ }).click();
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
    const table = page.locator('table.phone-cards').first();
    await expect(table).toBeAttached({ timeout: 20000 });
    await expect(table.locator('thead')).toBeHidden();
    await bar.getByRole('button', { name: /Home/ }).click();
    await expect(page.getByRole('heading', { name: /Needs your action/i })).toBeVisible();
  });
});

test('type to search on the till, and the journal form keeps a draft', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);
  await page.getByRole('button', { name: 'Orders & POS', exact: true }).first().click();
  await page.getByRole('button', { name: /Manual order/i }).first().click();
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.type('lat');
  await expect(page.getByPlaceholder('Search menu items…')).toHaveValue(/lat/i);

  await page.getByRole('button', { name: 'Ledger', exact: true }).first().click();
  await page.getByPlaceholder('Description / Memo').fill('Draft check');
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.getByPlaceholder('Description / Memo')).toHaveValue('Draft check', { timeout: 20000 });
  await expect(page.getByText('Draft restored from last time')).toBeVisible();
});
