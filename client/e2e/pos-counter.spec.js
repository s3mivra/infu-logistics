import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// POS counter upgrades: barcode scan rings an item up, and the
// customer-facing display (/display) mirrors the live cart.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('the customer display mirrors a cart sent on the same device', async ({ context }) => {
  const display = await context.newPage();
  await display.goto('/display');
  await expect(display.getByText(/Your items will appear here/i)).toBeVisible();
  const till = await context.newPage();
  await till.goto('/display'); // any same-origin page can publish on the channel
  await till.evaluate(() => {
    new BroadcastChannel('semivra-customer-display').postMessage({
      business: 'E2E Shop', items: [{ name: 'Latte', quantity: 2, addOns: [], lineTotal: 300 }],
      subtotal: 300, discount: 0, total: 300, at: Date.now(),
    });
  });
  await expect(display.getByText('Latte')).toBeVisible();
  await expect(display.getByTestId('display-total')).toContainText('300.00');
});

test('scanning a barcode adds the product to the cart; an unknown code says so', async ({ page, request }) => {
  test.setTimeout(120000);
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const auth = { Authorization: `Bearer ${tok}` };
  const name = `Scan Test ${Date.now()}`;
  const barcode = `E2E${Date.now()}`;
  await request.post(`${API}/api/categories`, { headers: auth, data: { name: 'E2E' } });
  const created = await request.post(`${API}/api/products`, { headers: auth, data: { name, category: 'E2E', basePrice: 55, barcode } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await request.post(`${API}/api/inventory`, { headers: auth, data: { itemName: name, unit: 'pcs', stockQty: 50, unitCost: 10 } });

  await login(page);
  await page.getByRole('button', { name: /^Orders & POS/ }).first().click();
  await page.getByRole('button', { name: /Manual Order/i }).first().click();
  const scan = page.getByPlaceholder('Scan barcode');
  await scan.fill(barcode);
  await scan.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: `Added ${name}` })).toBeVisible();
  await scan.fill('NOPE-000000');
  await scan.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /No product with barcode/ })).toBeVisible();
});
