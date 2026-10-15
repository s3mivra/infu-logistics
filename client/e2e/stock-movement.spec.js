import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

const API = process.env.VITE_API_URL || 'http://localhost:5002';

// Analytics -> Stock movement: the thresholds can be typed into and saved, and
// the table pages through its rows.
test('stock movement thresholds can be edited and saved', async ({ page, request }) => {
  // Enough stock items to need a second page.
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  await request.post(`${API}/api/inventory/import`, { headers: { Authorization: `Bearer ${tok}` },
    data: { items: Array.from({ length: 30 }, (_, i) => ({ itemCode: `PG-${i}`, itemName: `Paging Item ${i}`, unit: 'pcs', qty: 5, unitCost: 10 })) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);
  await page.getByRole('button', { name: 'Analytics', exact: true }).first().click();
  const section = page;
  await expect(section.getByRole('heading', { name: 'Stock movement' })).toBeVisible({ timeout: 20000 });
  await section.getByRole('button', { name: 'Thresholds' }).click();

  const cover = section.getByLabel(/Buy enough for/);
  await cover.fill('45');
  await expect(cover).toHaveValue('45');
  // Cleared and retyped, the way a person corrects a number.
  await cover.press('Control+a');
  await cover.press('Backspace');
  await cover.pressSequentially('21');
  await expect(cover).toHaveValue('21');

  // Out of range: the box says so, and Save explains instead of resetting it.
  const pct = section.getByLabel(/Fast-moving = at or above/);
  await pct.fill('30');
  await expect(pct).toHaveAttribute('aria-invalid', 'true');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/50-95/).last()).toBeVisible();
  await pct.fill('80');
  await expect(pct).toHaveAttribute('aria-invalid', 'false');

  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByText(/21 cover/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Page 1 of [2-9]/)).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  expect(errors).toEqual([]);
});
