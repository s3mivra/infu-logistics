import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

const API = process.env.VITE_API_URL || 'http://localhost:5002';

// Costing: pick a product, fill its cost from stock, add a fixed cost, price
// it with a markup, and send the price to the product.
test('a product is costed and its SRP set from the Costing tab', async ({ page, request }) => {
  test.skip(process.env.VITE_BUSINESS_TYPE === 'fb', 'logistics flow: the product is the stock item it sells');
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const headers = { Authorization: `Bearer ${tok}` };
  const code = `CST-${Date.now().toString(36)}`;
  // A 2 L bottle at P350 (P175 / L), which also becomes a product to sell.
  await request.post(`${API}/api/inventory/import`, { headers, data: { items: [{ itemCode: code, itemName: `Costing Syrup ${code}`, unit: 'L', packSize: 2, qty: 4, unitCost: 175, srp: 225 }] } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page);
  await page.getByRole('button', { name: 'Costing', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Costing' })).toBeVisible({ timeout: 20000 });

  const picker = page.getByRole('combobox', { name: 'Pick a product to price' });
  await picker.fill(code);
  await page.getByRole('option', { name: new RegExp(code, 'i') }).first().click();
  await page.getByRole('button', { name: 'Fill from product' }).click();
  // One whole bottle at today's cost.
  await expect(page.getByText('₱350.00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Fixed amount' }).click();
  await page.getByLabel('Line name').fill('Label and box');
  await page.getByLabel('Amount').fill('10');
  await page.getByLabel('Markup %').fill('30');
  // (350 + 10) x 1.30 = 468.
  await expect(page.getByText('₱468.00').first()).toBeVisible();

  await page.getByRole('button', { name: /^Apply to SRP/ }).click();
  await page.getByRole('button', { name: 'Apply price' }).click();
  await expect(page.getByText(/Price set to ₱468\.00/)).toBeVisible({ timeout: 10000 });

  const products = await (await request.get(`${API}/api/products`, { headers })).json();
  const list = Array.isArray(products) ? products : (products.products || []);
  expect(list.find(p => p.productCode === code)?.basePrice).toBe(468);
  // The costing was saved with what it came to.
  await expect(page.getByRole('button', { name: new RegExp(code, 'i') }).getByText(/Applied ₱468\.00/)).toBeVisible();
  expect(errors).toEqual([]);
});
