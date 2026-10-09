import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// The café-only screens. The rest of the suite runs against a logistics
// server, where these never appear - so this file runs only when asked
// (E2E_CAFE=1) against a server started with BUSINESS_TYPE=fb.
const API = process.env.VITE_API_URL || 'http://localhost:5002';
test.skip(process.env.E2E_CAFE !== '1', 'café screens: run with E2E_CAFE=1 against a BUSINESS_TYPE=fb server');

test('Dine-in / Take-out, the take-out-only tick, and an item not on the menu', async ({ page, request }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const headers = { Authorization: `Bearer ${tok}` };
  const stamp = Date.now();
  await request.post(`${API}/api/categories`, { headers, data: { name: `Coffee ${stamp}`, department: 'Bar' } });
  const cup = (await (await request.post(`${API}/api/inventory`, { headers, data: { itemName: `CUP ${stamp}`, unit: 'pcs', stockQty: 50, unitCost: 3 } })).json());
  const cupId = cup.item?._id || cup.inventory?._id || cup._id;
  const prodName = `E2E Latte ${stamp}`;
  const made = await (await request.post(`${API}/api/products`, { headers, data: {
    name: prodName, category: `Coffee ${stamp}`, basePrice: 120,
    baseRecipe: cupId ? [{ invId: String(cupId), name: `CUP ${stamp}`, qty: 1, cost: 3, unit: 'pcs', packBase: 1 }] : [],
  } })).json();
  expect(made.success, JSON.stringify(made)).toBe(true);

  await login(page);

  // ── Menu Setup: the switch ──
  await page.getByRole('button', { name: 'Menu Setup', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  const sw = page.getByRole('button', { name: 'Dine-in / Take-out' });
  await expect(sw).toBeVisible({ timeout: 20000 });
  if ((await sw.getAttribute('aria-pressed')) !== 'true') await sw.click();
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/^On\. Every order says which it is/)).toBeVisible();

  // ── a product's recipe: the take-out-only tick ──
  await page.locator('div').filter({ hasText: prodName }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last().getByRole('button', { name: 'Edit' }).click();
  const tick = page.getByRole('checkbox', { name: `CUP ${stamp} is used for take-out only` });
  await expect(tick).toBeVisible({ timeout: 20000 });
  await tick.check();
  await expect(tick).toBeChecked();
  await page.keyboard.press('Escape');

  // ── the till ──
  await page.getByRole('button', { name: 'Orders & POS', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
  await page.getByRole('button', { name: /Manual Order/i }).first().click();
  // A Dine-In order says so on its own.
  await expect(page.getByText('Dine in - own cups, no take-out packaging used.')).toBeVisible({ timeout: 20000 });
  // A walk-in is asked.
  await page.getByRole('button', { name: /^Dine-In$/ }).first().click();
  await page.getByRole('button', { name: 'Walk In', exact: true }).first().click();
  await expect(page.getByRole('radiogroup', { name: 'Dine in or take out' })).toBeVisible();
  await page.getByRole('radio', { name: /Take out/ }).click();
  await expect(page.getByRole('radio', { name: /Take out/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '+ Item not on the menu' }).click();
  await page.getByLabel('Item name').fill('Affogato special');
  await page.getByLabel('Price').fill('165');
  await page.getByRole('button', { name: 'Add to order' }).click();
  await expect(page.getByText('Affogato special').first()).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test("a customer on the QR menu is asked dine in or take out", async ({ page, request }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const headers = { Authorization: `Bearer ${tok}` };
  await request.patch(`${API}/api/settings/serviceModeEnabled`, { headers, data: { value: true } });
  await request.patch(`${API}/api/settings/isAcceptingQROrders`, { headers, data: { value: true } });
  const stamp = Date.now();
  await request.post(`${API}/api/categories`, { headers, data: { name: `Tea ${stamp}`, department: 'Bar' } });
  const prodName = `QR Tea ${stamp}`;
  const leaf = await (await request.post(`${API}/api/inventory`, { headers, data: { itemName: `LEAF ${stamp}`, unit: 'g', stockQty: 1000, unitCost: 1 } })).json();
  const leafId = leaf.item?._id || leaf.inventory?._id || leaf._id;
  await request.post(`${API}/api/products`, { headers, data: { name: prodName, category: `Tea ${stamp}`, basePrice: 90, showOnQr: true,
    baseRecipe: [{ invId: String(leafId), name: `LEAF ${stamp}`, qty: 5, cost: 1, unit: 'g', packBase: 1 }] } });
  const s = await (await request.post(`${API}/api/sessions/generate`, { headers, data: { table: '5' } })).json();
  expect(s.success, JSON.stringify(s)).toBe(true);

  await page.goto(`/menu/5?session=${s.sessionId}`);
  await page.getByRole('button', { name: /start order/i }).click({ timeout: 20000 });
  // Some menus ask for a name first.
  const nameBox = page.getByPlaceholder(/name/i).first();
  if (await nameBox.isVisible({ timeout: 8000 }).catch(() => false)) {
    await nameBox.fill('Guest Tester');
    const go = page.getByRole('button', { name: /browse menu|continue|view menu|next/i }).first();
    if (await go.isVisible().catch(() => false)) await go.click();
  }
  await page.getByText(prodName).first().click({ timeout: 20000 });
  const add = page.getByRole('button', { name: /add to (cart|order)|^add$/i }).first();
  if (await add.isVisible({ timeout: 5000 }).catch(() => false)) await add.click();
  await page.getByRole('button', { name: /1 item/i }).first().click({ timeout: 20000 });

  await expect(page.getByRole('radiogroup', { name: 'Dine in or take out' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Choose dine in or take out' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Take out' }).click();
  await expect(page.getByRole('button', { name: /Send to/ })).toBeEnabled();
  expect(errors, errors.join('\n')).toHaveLength(0);
});
