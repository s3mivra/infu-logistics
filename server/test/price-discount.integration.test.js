// A discount typed as the price to charge, not a percent: a line's unit price
// (items[i].targetPrice) or the order's total (targetTotal). The server turns
// each into the exact percent, and it is held to the same approval rule as any
// other manual discount.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, ownerTok, cashierTok, prodA, prodB;
const M = (n) => mongoose.model(n);
const auth = (method, path, tok) => request(app)[method](path).set('Authorization', `Bearer ${tok}`);

const place = async () => {
  const res = await auth('post', '/api/orders', ownerTok).send({
    items: [
      { productId: String(prodA._id), name: prodA.name, price: 1800, quantity: 1 },
      { productId: String(prodB._id), name: prodB.name, price: 250, quantity: 2 },
    ],
    table: 'Walk In', paymentMethod: 'Cash',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.order;
};
const put = (order, body, tok = ownerTok) => auth('put', `/api/orders/${order._id}`, tok).send(body);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PdOwner', role: 'superadmin' });
  await makeUser({ name: 'PdCashier', role: 'staff', permissions: ['pos.use', 'orders.view', 'orders.manage'] });
  ownerTok = await loginStaff(app, 'PdOwner');
  cashierTok = await loginStaff(app, 'PdCashier');
  await M('Category').create({ name: 'PdCat', department: 'Logistics' });
  prodA = await M('Product').create({ name: 'Price Disc A', category: 'PdCat', basePrice: 1800 });
  prodB = await M('Product').create({ name: 'Price Disc B', category: 'PdCat', basePrice: 250 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('a line discounted to a price', () => {
  it('lands on that price to the centavo (P1,800 -> P1,400 is 22.22...%, not .02 off)', async () => {
    const order = await place();
    const items = order.items.map((it, i) => (i === 0 ? { ...it, targetPrice: 1400 } : it));
    const res = await put(order, { items });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 1,400 + 2 x 250
    expect(res.body.order.total).toBeCloseTo(1900, 2);
  });

  it('refuses a price above the item\'s normal price', async () => {
    const order = await place();
    const items = order.items.map((it, i) => (i === 0 ? { ...it, targetPrice: 2000 } : it));
    const res = await put(order, { items });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be above/);
  });

  it('needs a manager like any other manual discount', async () => {
    const order = await place();
    const items = order.items.map((it, i) => (i === 0 ? { ...it, targetPrice: 1400 } : it));
    const res = await put(order, { items }, cashierTok);
    expect(res.status).toBe(403);
    expect(res.body.needsApproval).toBe('orders.override');
  });
});

describe('an order discounted to a total', () => {
  it('charges exactly the total asked for', async () => {
    const order = await place();   // 1,800 + 500 = 2,300
    const res = await put(order, { targetTotal: 2000, discountType: 'Promo', isVatExempt: false, discountedIndices: [0, 1] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.order.total).toBeCloseTo(2000, 2);
  });

  it('only on the ticked items, and says how low it can go', async () => {
    const order = await place();
    // Only line 0 (1,800) takes it; line 1 stays at 500, so 400 is out of reach.
    const res = await put(order, { targetTotal: 400, discountType: 'Promo', isVatExempt: false, discountedIndices: [0] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowest total/);
    const ok = await put(order, { targetTotal: 1500, discountType: 'Promo', isVatExempt: false, discountedIndices: [0] });
    expect(ok.body.order.total).toBeCloseTo(1500, 2);
  });

  it('refuses a total above the normal one', async () => {
    const order = await place();
    const res = await put(order, { targetTotal: 9999, discountedIndices: [0, 1] });
    expect(res.status).toBe(400);
  });
});
