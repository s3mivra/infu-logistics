import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// The worst moment to lose the connection: the sale has REACHED the server,
// but the reply never makes it back. The tablet sees a failure, queues the
// order and replays it. Without a stable idempotency key that is two sales
// for one customer - double revenue, double stock out. This proves the whole
// path in a real browser: POS -> dropped reply -> offline queue -> replay ->
// exactly one order.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('a sale whose reply is lost is recorded exactly once', async ({ page, request }) => {
  test.setTimeout(120000);
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const auth = { Authorization: `Bearer ${tok}` };
  const name = `Drop Test ${Date.now()}`;
  await request.post(`${API}/api/categories`, { headers: auth, data: { name: 'E2E' } });
  const created = await request.post(`${API}/api/products`, { headers: auth, data: { name, category: 'E2E', basePrice: 77 } });
  expect(created.ok(), await created.text()).toBeTruthy();
  // On a logistics deployment a product is sellable only with stock behind it
  // (matched by name), so give it some.
  const stock = await request.post(`${API}/api/inventory`, { headers: auth, data: { itemName: name, unit: 'pcs', stockQty: 50, unitCost: 10 } });
  expect(stock.ok(), await stock.text()).toBeTruthy();

  const countOrders = async () => {
    const r = await request.get(`${API}/api/orders?limit=200`, { headers: auth });
    const d = await r.json();
    return (d.orders || []).filter(o => (o.items || []).some(i => i.name === name)).length;
  };
  expect(await countOrders()).toBe(0);

  // Let the FIRST order POST through to the server, then cut the connection
  // before the browser sees the answer.
  let dropped = false;
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();                       // the server processes it...
      return route.abort('connectionreset');     // ...and the reply is lost
    }
    return route.continue();
  });

  await login(page);
  await page.getByRole('button', { name: /^Orders & POS/ }).first().click();
  await page.getByRole('button', { name: /Manual Order/i }).first().click();
  await page.getByText(name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  const who = page.getByPlaceholder(/Customer.*Name/i);
  if (await who.count()) await who.first().fill('Drop Test Buyer');
  // A logistics POS opens on Pickup, which will not place without a phone.
  const phone = page.getByPlaceholder(/Phone Number/i);
  if (await phone.count()) await phone.first().fill('09171234567');
  await page.getByRole('button', { name: /Place Order/i }).click();

  // The POS reports the dropped connection and keeps the sale queued.
  await expect(page.getByText(/Connection lost/i)).toBeVisible({ timeout: 15000 });
  const ok = page.getByRole('button', { name: /^(OK|Close|Got it)$/i });
  if (await ok.count()) await ok.first().click();

  // The server DID record it the first time.
  await expect.poll(countOrders, { timeout: 10000 }).toBe(1);

  // Let the queue replay (it retries on a timer and when the queue changes),
  // then check it drained - and that the replay did not create a second sale.
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('semivra_offline_orders') || '[]').length),
    { timeout: 60000, intervals: [1000, 2000, 5000] }).toBe(0);
  expect(await countOrders()).toBe(1);
});
