import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Commission rates by category and tiers are set on the Commissions report.
test('commission rates: a category rate and a tier are saved', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);
  await page.getByRole('button', { name: 'Reports', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Sales by Channel', exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Operations', exact: true }).last().click();
  await page.getByRole('button', { name: 'Commissions', exact: true }).last().click();
  await page.getByRole('button', { name: /^Commission rates/ }).click();
  await page.getByRole('button', { name: '+ Category rate' }).click();
  await page.getByLabel('Category', { exact: true }).last().fill('E2E Drinks');
  await page.getByLabel('Rate in percent').first().fill('7.5');
  await page.getByRole('button', { name: '+ Tier' }).click();
  await page.getByLabel('Tier starts at').last().fill('0');
  await page.getByLabel('Rate in percent').nth(1).fill('2');
  await page.getByRole('button', { name: 'Save rates' }).click();
  await expect(page.getByText('Commission rates saved.')).toBeVisible({ timeout: 20000 });
  // Reopened, it reads back what was saved.
  await page.getByRole('button', { name: /^Commission rates/ }).click();
  await page.getByRole('button', { name: /^Commission rates/ }).click();
  await expect(page.getByLabel('Category', { exact: true }).last()).toHaveValue('E2E Drinks');
  await expect(page.getByRole('columnheader', { name: 'Effective' }).or(page.getByText(/No attributed sales|Click Refresh/))).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});
