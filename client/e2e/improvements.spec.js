import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// The work-saving additions, each opened and used once in a real browser:
// one payment spread over a client's unpaid sales, repeating bills, the daily
// closing check, finding stock with no cost, and the forecast's way straight
// to purchase orders.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('collect once from a client, repeating bills, the closing check, no-cost stock, forecast to orders', async ({ page, request }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const headers = { Authorization: `Bearer ${tok}` };
  const stamp = Date.now();
  const buyer = `BULK PAYER ${stamp}`;
  // Two unpaid sales for one client, and a stock item with no cost.
  const ids = [];
  for (const price of [300, 500]) {
    const o = await (await request.post(`${API}/api/orders`, { headers, data: { table: 'Takeout', customerName: buyer, items: [{ name: 'Open Item', price, quantity: 1 }] } })).json();
    expect(o.success, JSON.stringify(o)).toBe(true);
    await request.put(`${API}/api/orders/${o.order._id}`, { headers, data: { status: 'Preparing', paymentMethod: 'On Account' } });
    await request.put(`${API}/api/orders/${o.order._id}`, { headers, data: { status: 'Completed' } });
    ids.push(o.order._id);
  }
  await request.post(`${API}/api/inventory`, { headers, data: { itemName: `NOCOST ${stamp}`, unit: 'pcs', stockQty: 3, unitCost: 0 } });

  await login(page);

  // ── one payment across both sales: ₱600 settles the first in full, the second in part ──
  await page.getByRole('button', { name: 'Ledger', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await page.getByRole('button', { name: /AR & AP/ }).first().click();
  await page.getByRole('button', { name: /Collect one payment from a client/ }).click();
  await page.getByPlaceholder('Which client?').fill(buyer);
  await page.getByRole('option', { name: new RegExp(buyer) }).first().click();
  await page.getByLabel('Amount received').fill('600');
  await expect(page.getByText('It will settle:')).toBeVisible();
  // The form's own button: other clients' rows on the page have one too.
  await expect(page.locator('form').getByRole('button', { name: 'Collect', exact: true })).toBeDisabled();   // no reference yet
  await page.getByLabel('Reference number').fill('OR-7001');
  await page.locator('form').getByRole('button', { name: 'Collect', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Collect', exact: true }).click();   // the confirmation
  await expect.poll(async () => {
    const ar = await (await request.get(`${API}/api/finance/ar-outstanding`, { headers })).json();
    return (ar.orders || []).filter(o => o.customerName === buyer || String(o.customerName).toUpperCase() === buyer).reduce((s, o) => s + (o.balance ?? o.total), 0);
  }, { timeout: 30000 }).toBe(200);

  // ── repeating bills ──
  await page.getByRole('button', { name: 'Bills (AP)' }).first().click();
  await page.getByRole('button', { name: /Repeating bills/ }).click();
  await expect(page.getByRole('button', { name: 'Add repeating bill' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add repeating bill' })).toBeDisabled();

  // ── the daily closing check ──
  await page.getByRole('button', { name: 'Shifts & Cash', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await page.getByRole('button', { name: 'Daily Closing Check' }).click();
  await expect(page.getByRole('heading', { name: 'Sold' })).toBeVisible({ timeout: 20000 });
  // At least this test's two sales; specs before it share the server and may add more.
  const sold = page.getByText(/^\d+ completed sale\(s\)$/);
  await expect(sold).toBeVisible();
  expect(Number((await sold.textContent()).match(/\d+/)[0])).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('heading', { name: 'To the bank' })).toBeVisible();

  // ── stock with no cost ──
  await page.getByRole('button', { name: 'Inventory & Stock', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  const noCost = page.getByRole('button', { name: /^No cost \(\d+\)$/ });
  await expect(noCost).toBeVisible({ timeout: 20000 });
  await noCost.click();
  await expect(noCost).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(`NOCOST ${stamp}`).first()).toBeVisible();

  // ── one forecast on Analytics ──
  await page.getByRole('button', { name: 'Analytics', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: /Reorder Forecast/i })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('High Velocity & Forecast')).toHaveCount(0);

  expect(errors, errors.join('\n')).toHaveLength(0);
});
