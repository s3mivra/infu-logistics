import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// The three screens that had only ever been checked by reading the code:
// taking a split payment on an open order, the receivables tables (which used
// to run their columns together and hide the last ones), and the revenue
// chart whose bars can be clicked. One order is carried through all three.
const API = process.env.VITE_API_URL || 'http://localhost:5002';
const boxesOverlap = (a, b) => a && b && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1;

test('split payment at the till, then the receivables tables and the revenue chart', async ({ page, request }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const headers = { Authorization: `Bearer ${tok}` };
  const buyer = `SPLIT E2E ${Date.now()}`;
  const placed = await (await request.post(`${API}/api/orders`, {
    headers, data: { table: 'Takeout', customerName: buyer, items: [{ name: 'Open Item', price: 1000, quantity: 1 }] },
  })).json();
  expect(placed.success, JSON.stringify(placed)).toBe(true);
  const orderId = placed.order._id;

  // ── 1. the till ──
  await login(page);
  await page.getByRole('button', { name: 'Orders & POS', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  const number = page.getByText(placed.order.orderNumber, { exact: false }).first();
  await expect(number).toBeVisible({ timeout: 20000 });
  // The order's own card: the nearest ancestor that holds a payment dropdown.
  const card = page.locator('div').filter({ hasText: placed.order.orderNumber }).filter({ has: page.locator('option[value="Split"]') }).last();
  await card.locator('select').filter({ has: page.locator('option[value="Split"]') }).first().selectOption('Split');

  const payBtn = card.getByRole('button', { name: /Finish the split payment|Pay & send/ });
  await card.getByLabel('Payment 1 amount').fill('400');
  await card.getByLabel('Payment 2 method').selectOption('Check');
  await card.getByLabel('Payment 2 amount').fill('600');
  // A check with no number is not a finished payment.
  await expect(payBtn).toBeDisabled();
  await expect(payBtn).toHaveText(/Finish the split payment/);
  await card.getByLabel('Payment 2 check number').fill('CHK-E2E-1');
  await expect(card.getByText(/Adds up to/)).toBeVisible();
  await expect(payBtn).toBeEnabled();
  await payBtn.click();

  await expect.poll(async () => {
    const all = await (await request.get(`${API}/api/orders`, { headers })).json();
    return (all.orders || []).find(o => o._id === orderId)?.paymentMethod;
  }, { timeout: 20000 }).toBe('Split');
  const done = await (await request.put(`${API}/api/orders/${orderId}`, { headers, data: { status: 'Completed' } })).json();
  expect(done.success, JSON.stringify(done)).toBe(true);

  // ── 2. receivables: every column reachable, none run together ──
  await page.getByRole('button', { name: 'Ledger', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await page.getByRole('button', { name: /AR & AP/ }).first().click();
  const row = page.locator('tr').filter({ hasText: placed.order.orderNumber }).first();
  await expect(row).toBeVisible({ timeout: 20000 });
  const cells = row.locator('td');
  // Order | Customer | Channel | Date | Age | Due | Invoiced | Collected | Balance | Action
  await expect(cells.nth(6)).toHaveText('₱1000.00');
  await expect(cells.nth(7)).toContainText('₱400.00');
  await expect(cells.nth(8)).toHaveText('₱600.00');
  for (let i = 0; i < 9; i++) {
    expect(boxesOverlap(await cells.nth(i).boundingBox(), await cells.nth(i + 1).boundingBox()), `columns ${i} and ${i + 1} overlap`).toBeFalsy();
  }
  // The last column can be brought into view (the table scrolls sideways).
  await cells.nth(9).scrollIntoViewIfNeeded();
  await expect(cells.nth(9)).toBeInViewport();

  // ── 3. the revenue chart ──
  await page.getByRole('button', { name: 'Analytics', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Daily Revenue Trend' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Click a day to see its total.')).toBeVisible();
  const bar = page.locator('button[aria-pressed]').filter({ has: page.locator('div') }).last();
  await bar.click();
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/· \d+ order\(s\)/)).toBeVisible();
  await bar.click();
  await expect(page.getByText('Click a day to see its total.')).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});
