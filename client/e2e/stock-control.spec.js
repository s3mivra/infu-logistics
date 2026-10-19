import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

const API = process.env.VITE_API_URL || 'http://localhost:5002';

// Inventory -> Stock control: today's rolling count list is counted and
// saved, and the count shows up in the variance report - expected vs counted,
// in units and pesos - which exports to Excel.
test('rolling count list and the variance report', async ({ page, request }) => {
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const headers = { Authorization: `Bearer ${tok}` };
  const stamp = Date.now().toString(36).toUpperCase();
  const code = `SC-${stamp}`;
  await request.post(`${API}/api/inventory/import`, { headers,
    data: { items: [{ itemCode: code, itemName: `Count Item ${stamp}`, unit: 'pcs', qty: 5, unitCost: 10 }] } });
  // Room on today's list for everything other tests created too.
  await request.put(`${API}/api/stock-control/settings`, { headers, data: { countCycle: { maxPerDay: 500 } } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);
  await page.getByRole('button', { name: /Inventory & Stock/ }).first().click();
  await page.getByRole('button', { name: 'Stock Control', exact: true }).click();
  await expect(page.getByRole('heading', { name: "Today's count" })).toBeVisible({ timeout: 20000 });

  const row = page.getByTestId(`count-row-${code}`);
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText('Never counted');
  await expect(row).toContainText('5 pcs');
  await row.getByLabel(/^Counted /).fill('3');
  await row.getByLabel(/^Reason /).fill('Two broken');
  await page.getByRole('button', { name: /Save 1 count/ }).click();
  // Counted: it leaves today's list.
  await expect(row).toHaveCount(0, { timeout: 15000 });

  await page.getByRole('tab', { name: 'Variance report' }).click();
  await expect(page.getByRole('heading', { name: 'Count variance' })).toBeVisible();
  await page.getByLabel('Search items').fill(code);
  const table = page.getByTestId('variance-table');
  const line = table.getByRole('row').filter({ hasText: code });
  await expect(line).toHaveCount(1, { timeout: 15000 });
  await expect(line).toContainText('5 pcs');      // expected
  await expect(line).toContainText('3 pcs');      // counted
  await expect(line).toContainText('-2');         // units
  await expect(line).toContainText('₱-20.00');    // at P10 each
  await expect(line).toContainText(ADMIN);
  await expect(line).toContainText('Rolling');
  await expect(line).toContainText('Two broken');
  await expect(page.getByTestId('variance-totals')).toContainText('₱-20.00');

  // Filtered to the other kind of count, it is not there.
  await page.getByLabel('Kind of count').selectOption('eod');
  await expect(page.getByText('No counts in this period.')).toBeVisible({ timeout: 15000 });
  await page.getByLabel('Kind of count').selectOption('');
  await expect(line).toHaveCount(1, { timeout: 15000 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^stock-variance-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(errors).toEqual([]);
});
