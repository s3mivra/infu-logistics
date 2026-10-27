import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Backdate Sale: payment methods are tiles with hints, in the SOA's words,
// and each asks only for what it needs.
test('payment method tiles: hints, check details, post-dated, reference', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);
  await page.getByRole('button', { name: 'Ledger', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await page.getByRole('button', { name: 'Setup', exact: true }).last().click();
  await page.getByRole('button', { name: 'Backdate Sale', exact: true }).last().click();

  const tiles = page.getByRole('radiogroup', { name: 'Payment method' }).first();
  await expect(tiles.getByRole('radio', { name: /Cash/ }).first()).toHaveAttribute('aria-checked', 'true');
  await expect(tiles.getByText('Includes dated / post-dated checks')).toBeVisible();
  await expect(tiles.getByText('Client pays later')).toBeVisible();

  await tiles.getByRole('radio', { name: /Check \/ Dated Check/ }).click();
  await expect(page.getByLabel('Check number').first()).toBeVisible();
  await expect(page.getByLabel('Bank').first()).toBeVisible();
  await page.getByLabel('Check date').first().fill('2099-12-31');
  await expect(page.getByText('Post-dated check', { exact: true })).toBeVisible();

  await tiles.getByRole('radio', { name: /GCash/ }).click();
  await expect(page.getByLabel('Check number')).toHaveCount(0);
  await expect(page.getByLabel('Reference number').first()).toBeVisible();

  await tiles.getByRole('radio', { name: /^Cash/ }).click();
  await expect(page.getByLabel('Reference number')).toHaveCount(0);
  expect(errors, errors.join('\n')).toHaveLength(0);
});
