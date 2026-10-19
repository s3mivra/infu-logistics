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
  // A narrow window, like a small laptop: the tables must still fit.
  await page.setViewportSize({ width: 1040, height: 900 });
  await page.getByRole('button', { name: /AR & AP/ }).first().click();
  const row = page.locator('tr').filter({ hasText: placed.order.orderNumber }).first();
  await expect(row).toBeVisible({ timeout: 20000 });
  // Order | Customer | Owed | Action - four columns, all on screen with no sideways scroll.
  const cells = row.locator('td');
  await expect(cells).toHaveCount(4);
  await expect(cells.nth(2)).toContainText('₱600.00');
  await expect(cells.nth(2)).toContainText('of ₱1000.00 invoiced');
  await expect(cells.nth(2)).toContainText('₱400.00 collected');
  const covers = (a, b) => a && b && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  for (let i = 0; i < 3; i++) {
    expect(covers(await cells.nth(i).boundingBox(), await cells.nth(i + 1).boundingBox()), `parts ${i} and ${i + 1} of the row overlap`).toBeFalsy();
  }
  // Every part of the row sits inside the card - nothing hangs off the right edge.
  const inside = await row.evaluate((tr) => {
    const card = tr.closest('table').getBoundingClientRect();
    return [...tr.querySelectorAll('td')].every((td) => { const r = td.getBoundingClientRect(); return r.left >= card.left - 1 && r.right <= card.right + 1; });
  });
  expect(inside, 'part of a receivable row hangs outside its card').toBe(true);
  const fits = await row.evaluate((tr) => { const box = tr.closest('table').parentElement; return box.scrollWidth <= box.clientWidth + 1; });
  expect(fits, 'the receivables table scrolls sideways').toBe(true);

  if (process.env.E2E_SHOT) await page.screenshot({ path: process.env.E2E_SHOT, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 720 });
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
