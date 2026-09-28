// On a logistics deployment a product with no recipe IS a stocked good, linked
// to its inventory item by code or by name. The inventory route stores item
// names UPPERCASE; product names keep their case. The name match was exact,
// so it never matched: the menu showed the product OUT with stock on hand,
// and a sale "skipped cleanly" - recorded with no stock movement at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, productId;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'Boss', role: 'superadmin' });
  tok = await loginStaff(app, 'Boss');
  const inv = await as('post', '/api/inventory').send({ itemName: 'Olive Oil Bottle', unit: 'pcs', stockQty: 20, unitCost: 100 });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  productId = String((await mongoose.model('Product').create({ name: 'Olive Oil Bottle', category: 'Pantry', basePrice: 180, businessType: 'log' }))._id);
}, 120000);
afterAll(async () => { await ctx?.stop?.(); });

describe('a logistics product finds its stock by name, whatever the case', () => {
  it('shows the product as in stock', async () => {
    const r = await as('get', '/api/products');
    const p = r.body.products.find(x => String(x._id) === productId);
    expect(p.stockAvailable).toBe(true);
  });

  it('deducts the stock when it is sold', async () => {
    const before = (await mongoose.model('Inventory').findOne({ itemName: /olive oil bottle/i }).lean()).stockQty;
    const r = await as('post', '/api/orders').send({ table: 'Takeout', paymentMethod: 'Cash', customerName: 'Buyer',
      items: [{ productId, name: 'Olive Oil Bottle', price: 180, quantity: 2 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Stock moves when the sale completes.
    const done = await as('put', `/api/orders/${r.body.order._id}`).send({ status: 'Completed' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const after = (await mongoose.model('Inventory').findOne({ itemName: /olive oil bottle/i }).lean()).stockQty;
    expect(after).toBeLessThan(before);
  });
});
