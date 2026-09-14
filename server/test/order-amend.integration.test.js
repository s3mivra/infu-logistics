// Amending an order before it is completed.
//
// A client orders too much. Until the order is Completed nothing has posted,
// so staff correct it in place: a reason is required, the change is kept as a
// numbered revision, changed lines are re-priced by the same rules as order
// creation, and a completed order can only be changed through a refund.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, sack, bag, client;
const auth = (m, p, t = superTok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const Order = () => mongoose.model('Order');

const place = (items, extra = {}) => auth('post', '/api/orders').send({ table: 'Pickup', paymentMethod: 'On Account', clientAccountId: client._id, items, ...extra });
const amend = (id, body, t) => auth('post', `/api/orders/${id}/amend`, t).send(body);
const line = (p, quantity) => ({ productId: String(p._id), name: p.name, price: p.basePrice, quantity });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'AmendSuper', role: 'superadmin' });
  await makeUser({ name: 'AmendViewer', role: 'staff', permissions: ['orders.view'] });
  superTok = await loginStaff(app, 'AmendSuper');
  staffTok = await loginStaff(app, 'AmendViewer');

  await mongoose.model('Category').create({ name: 'Bulk', department: 'Logistics' });
  // 10+ sacks earn 20% off.
  sack = await mongoose.model('Product').create({ name: 'Rice Sack', category: 'Bulk', basePrice: 1000, bulkBreaks: [{ minQty: 10, percent: 20 }] });
  bag = await mongoose.model('Product').create({ name: 'Sugar Bag', category: 'Bulk', basePrice: 100 });

  const res = await auth('post', '/api/client-accounts').send({ username: 'amendco', password: 'secret123', name: 'Amend Co', paymentMethod: 'On Account' });
  client = res.body.client;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('amending an open order', () => {
  it('cuts a quantity, re-prices it, and keeps the history', async () => {
    const { body: { order } } = await place([line(sack, 12), line(bag, 5)]);
    expect(order.total).toBe(12 * 1000 * 0.8 + 500);

    const res = await amend(order._id, { reason: 'Client called - only needs 8 sacks', changes: [{ index: 0, quantity: 8 }] });
    expect(res.status).toBe(200);
    // 8 sacks is below the 10-sack break, so the 20% is gone.
    expect(res.body.order.total).toBe(8 * 1000 + 500);
    expect(res.body.order.revision).toBe(1);
    const a = res.body.order.amendments[0];
    expect(a.reason).toMatch(/8 sacks/);
    expect(a.totalBefore).toBe(10100);
    expect(a.totalAfter).toBe(8500);
    expect(a.changes[0]).toMatchObject({ name: 'Rice Sack', from: 12, to: 8 });
  });

  it('removes a line with quantity 0 but refuses to empty the order', async () => {
    const { body: { order } } = await place([line(sack, 1), line(bag, 2)]);
    const res = await amend(order._id, { reason: 'No sugar', changes: [{ index: 1, quantity: 0 }] });
    expect(res.status).toBe(200);
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.total).toBe(1000);

    const empty = await amend(order._id, { reason: 'all gone', changes: [{ index: 0, quantity: 0 }] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/cancel/i);
  });

  it('requires a reason, a real change, a real line, and whole units in logistics', async () => {
    const { body: { order } } = await place([line(bag, 3)]);
    expect((await amend(order._id, { changes: [{ index: 0, quantity: 2 }] })).status).toBe(400);
    expect((await amend(order._id, { reason: 'x', changes: [{ index: 0, quantity: 3 }] })).status).toBe(400);
    expect((await amend(order._id, { reason: 'x', changes: [{ index: 0, quantity: 1.5 }] })).status).toBe(400);
    expect((await amend(order._id, { reason: 'x', changes: [{ index: 9, quantity: 1 }] })).status).toBe(400);
  });

  it('needs the orders.manage permission', async () => {
    const { body: { order } } = await place([line(bag, 3)]);
    expect((await amend(order._id, { reason: 'x', changes: [{ index: 0, quantity: 2 }] }, staffTok)).status).toBe(403);
  });

  it('re-checks the credit limit when an order grows', async () => {
    await Order().updateMany({ clientAccountId: String(client._id) }, { $set: { status: 'Cancelled' } });
    await mongoose.model('ClientAccount').updateOne({ _id: client._id }, { $set: { creditLimit: 5000 } });
    await mongoose.model('Settings').updateOne({ key: 'creditLimitMode' }, { $set: { value: 'per_client' } }, { upsert: true });

    const { body: { order } } = await place([line(bag, 10)]);
    const grow = await amend(order._id, { reason: 'Client wants more', changes: [{ index: 0, quantity: 100 }] });
    expect(grow.status).toBe(409);
    expect(grow.body.error).toMatch(/credit limit/i);

    const ok = await amend(order._id, { reason: 'A bit more', changes: [{ index: 0, quantity: 20 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.order.total).toBe(2000);

    await mongoose.model('ClientAccount').updateOne({ _id: client._id }, { $set: { creditLimit: null } });
  });
});

describe('adding products while amending', () => {
  it('adds a new line priced from the product, never from the request', async () => {
    const { body: { order } } = await place([line(bag, 2)]);
    const res = await amend(order._id, { reason: 'Client added rice', adds: [{ productId: String(sack._id), quantity: 3, price: 1 }] });
    expect(res.status).toBe(200);
    const added = res.body.order.items.find(i => i.name === 'Rice Sack');
    expect(added.price).toBe(1000);
    expect(added.department).toBe('Logistics');
    expect(res.body.order.total).toBe(200 + 3000);
    expect(res.body.order.amendments[0].changes).toContainEqual(expect.objectContaining({ name: 'Rice Sack', from: 0, to: 3 }));
  });

  it('raises the quantity of a product already on the order, and applies its bulk break', async () => {
    const { body: { order } } = await place([line(sack, 8)]);
    const res = await amend(order._id, { reason: 'Two more', adds: [{ productId: String(sack._id), quantity: 2 }] });
    expect(res.status).toBe(200);
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.items[0].quantity).toBe(10);
    expect(res.body.order.total).toBe(10 * 1000 * 0.8);
  });

  it('refuses unknown, unavailable, or option-requiring products', async () => {
    const { body: { order } } = await place([line(bag, 2)]);
    const off = await mongoose.model('Product').create({ name: 'Off Item', category: 'Bulk', basePrice: 50, isAvailable: false });
    const opt = await mongoose.model('Product').create({ name: 'Needs Options', category: 'Bulk', basePrice: 50, modifierGroups: [new mongoose.Types.ObjectId()] });
    expect((await amend(order._id, { reason: 'x', adds: [{ productId: String(new mongoose.Types.ObjectId()), quantity: 1 }] })).status).toBe(400);
    expect((await amend(order._id, { reason: 'x', adds: [{ productId: String(off._id), quantity: 1 }] })).status).toBe(400);
    const res = await amend(order._id, { reason: 'x', adds: [{ productId: String(opt._id), quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/new order/i);
  });
});

describe('what cannot be amended', () => {
  it('refuses a completed order and points to refunds', async () => {
    const { body: { order } } = await place([line(bag, 2)]);
    await auth('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
    const res = await amend(order._id, { reason: 'too many', changes: [{ index: 0, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/refund/i);
  });

  it('refuses a cancelled or partly fulfilled order', async () => {
    const { body: { order: c } } = await place([line(bag, 2)]);
    await auth('put', `/api/orders/${c._id}`).send({ status: 'Cancelled' });
    expect((await amend(c._id, { reason: 'x', changes: [{ index: 0, quantity: 1 }] })).status).toBe(409);

    const { body: { order: p } } = await place([line(bag, 4)]);
    await Order().updateOne({ _id: p._id }, { $set: { 'items.0.fulfilledQty': 2 } });
    const res = await amend(p._id, { reason: 'x', changes: [{ index: 0, quantity: 3 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Drop Remaining/);
  });

  it('an amended order still completes at the amended total', async () => {
    const { body: { order } } = await place([line(sack, 12)]);
    await amend(order._id, { reason: 'Only 5', changes: [{ index: 0, quantity: 5 }] });
    const done = await auth('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
    expect(done.body.success).toBe(true);
    expect((await Order().findById(order._id).lean()).total).toBe(5000);
  });
});
