// Deleting an order rung up by mistake.
//
// Until an order is completed nothing from it is on the books and no stock
// has left the shelf, so "delete" cancels it - traceably. A completed order is
// an issued receipt and a posted sale; it can only be voided, never deleted.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, beans, latte;
const M = (n) => mongoose.model(n);
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
// A sale posts "Sales & COGS for Order <number>"; nothing of the sort may exist.
const postingsFor = (order) => M('JournalEntry').countDocuments({ description: { $regex: order.orderNumber } });
const ring = async () => (await as('post', '/api/orders').send({
  table: 'Dine-In', customerName: 'Mistake',
  items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity: 1 }],
})).body.order;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'DelBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'DelBoss');
}, 120000);
afterAll(async () => { await ctx.stop(); });
beforeEach(async () => {
  for (const n of ['Order', 'Product', 'Inventory', 'JournalEntry', 'AuditLog']) await M(n).deleteMany({});
  beans = await M('Inventory').create({
    itemName: 'BEANS', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, stockQty: 1000, unitCost: 0.386, businessType: 'fb',
  });
  latte = await M('Product').create({
    name: 'Latte', category: 'Coffee', basePrice: 130, businessType: 'fb',
    baseRecipe: [{ invId: String(beans._id), name: 'BEANS', qty: 20, unit: 'g' }],
  });
});

describe('deleting an order entered by mistake', () => {
  it('cancels an unpaid order, traceably, and books nothing', async () => {
    const order = await ring();
    const res = await as('put', `/api/orders/${order._id}`).send({ status: 'Cancelled' });
    expect(res.body.success).toBe(true);

    const stored = await M('Order').findById(order._id).lean();
    expect(stored.status).toBe('Cancelled');
    expect(stored.cancelledBy).toBe('DelBoss');
    expect(await M('AuditLog').countDocuments({ action: 'Order_CANCEL', userId: 'DelBoss' })).toBe(1);
    expect(await postingsFor(order)).toBe(0);
    expect((await M('Inventory').findById(beans._id).lean()).stockQty).toBe(1000);
  });

  it('cancels one already paid and sent to the kitchen, still booking nothing', async () => {
    const order = await ring();
    await as('put', `/api/orders/${order._id}`).send({ status: 'Preparing', paymentMethod: 'Cash', amountTendered: 200 });
    const res = await as('put', `/api/orders/${order._id}`).send({ status: 'Cancelled' });
    expect(res.body.success).toBe(true);
    expect(await postingsFor(order)).toBe(0);
    expect((await M('Inventory').findById(beans._id).lean()).stockQty).toBe(1000);
    // The drawer's expected cash counts paid Preparing/Ready orders; a
    // cancelled one is out of that count, which is why the till tells the
    // cashier to hand the money back.
    const inDrawer = await M('Order').countDocuments({ _id: order._id, status: { $in: ['Completed', 'Preparing', 'Ready'] } });
    expect(inDrawer).toBe(0);
  });

  it('refuses to delete a completed order - that is what a void is for', async () => {
    const order = await ring();
    await as('put', `/api/orders/${order._id}`).send({ status: 'Completed', paymentMethod: 'Cash' });
    // It is on the books now - which also proves the check above is looking in
    // the right place, and would have seen a posting had there been one.
    expect(await postingsFor(order)).toBeGreaterThan(0);
    const res = await as('put', `/api/orders/${order._id}`).send({ status: 'Cancelled' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/void/i);
    expect((await M('Order').findById(order._id).lean()).status).toBe('Completed');
  });
});
