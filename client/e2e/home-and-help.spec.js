import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Home is where a fresh device starts: what waits on you, the setup
// checklist, your screens. Plus the "?" help and the touch-screen switch.
test('home, help for the screen, and touch mode', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: /Needs your action/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Your screens/i })).toBeVisible();

  // By keyboard: in this test setup a business-type warning banner covers the sidebar's top.
  await page.getByRole('button', { name: 'Help for this screen' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Help for this screen' })).toContainText('Start here each day.');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Check stock/ }).click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  // By keyboard: in this test setup a business-type warning banner covers the sidebar's top.
  await page.getByRole('button', { name: 'Help for this screen' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Help for this screen' })).toContainText('Stock levels');
  await page.keyboard.press('Escape');

  await page.evaluate(() => { localStorage.setItem('dash.touch', '1'); });
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('touch-mode'))).toBe(true);
  await page.evaluate(() => { localStorage.setItem('dash.touch', '0'); });
  expect(errors, errors.join('\n')).toHaveLength(0);
});
