// "Not paid yet" - delivering a logistics order now and collecting later.
//
// The POS sends it on the Credit tender: booked to Accounts Receivable, nothing
// expected in the drawer, settled later in AR & AP. An order is usually rung up
// as cash and only switched at the moment of sending, and that switch is where
// it starts to count against the client's credit - so the limit is checked
// there, not only when the order is created.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, bossTok, staffTok, clientId, productId, seq = 0;
const M = (n) => mongoose.model(n);
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

// A cashier's order for the client, rung up as cash (the POS default).
const ring = async (qty = 2) => (await as(staffTok)('post', '/api/orders').send({
  table: 'Pickup', customerName: 'Owing Client', clientAccountId: clientId, paymentMethod: 'Cash',
  items: [{ productId, name: 'Crate', price: 100, quantity: qty }],
})).body.order;
const sendUnpaid = (order) => as(staffTok)('put', `/api/orders/${order._id}`).send({ status: 'Preparing', paymentMethod: 'Credit' });
const owe = (amount) => M('Order').create({
  orderNumber: `UNP-${String(++seq).padStart(5, '0')}`, customerName: 'Owing Client', clientAccountId: clientId,
  status: 'Completed', paymentMethod: 'Credit', total: amount, arSettled: false, businessType: 'log',
});
const limit = async (value) => {
  await as(bossTok)('patch', '/api/settings/creditLimitMode').send({ value: value == null ? 'off' : 'per_client' });
  await as(bossTok)('patch', `/api/client-accounts/${clientId}`).send({ creditLimit: value == null ? '' : value });
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'UnpaidBoss', role: 'superadmin' });
  await makeUser({ name: 'UnpaidTill', role: 'staff' });
  bossTok = await loginStaff(app, 'UnpaidBoss');
  staffTok = await loginStaff(app, 'UnpaidTill');
  const c = await M('ClientAccount').create({ clientCode: 'CUS-1000-A0900', username: 'owingclient', password: 'x', name: 'Owing Client' });
  clientId = String(c._id);
  const p = await as(bossTok)('post', '/api/products').send({ name: 'Crate', category: 'Dry Goods', basePrice: 100 });
  productId = p.body.product._id;
}, 120000);
afterAll(async () => { await ctx.stop(); });
beforeEach(async () => {
  await M('Order').deleteMany({});
  await limit(null);
});

describe('sending an order without payment', () => {
  it('goes out on the Credit tender with nothing tendered', async () => {
    const order = await ring();
    const res = await sendUnpaid(order);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    const stored = await M('Order').findById(order._id).lean();
    expect(stored).toMatchObject({ status: 'Preparing', paymentMethod: 'Credit' });
    expect(Number(stored.amountTendered) || 0).toBe(0);
  });

  it('books the sale to Accounts Receivable when completed', async () => {
    const order = await ring();
    await sendUnpaid(order);
    const done = await as(staffTok)('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
    expect(done.body.success, JSON.stringify(done.body)).toBe(true);
    const entries = await M('JournalEntry').find({ description: { $regex: order.orderNumber } }).lean();
    const lines = entries.flatMap(e => e.lines || []);
    expect(lines.some(l => l.accountCode === '120000' && l.debit > 0)).toBe(true);
    expect(lines.some(l => l.accountCode === '111000' && l.debit > 0)).toBe(false);
  });
});

describe('the client\'s credit limit', () => {
  it('refuses the switch when it would take them over', async () => {
    await limit(500);
    await owe(400);
    const order = await ring(2);                         // ₱200: 400 + 200 > 500
    const res = await sendUnpaid(order);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Credit limit/);
    const stored = await M('Order').findById(order._id).lean();
    expect(stored).toMatchObject({ status: 'Pending', paymentMethod: 'Cash' });
  });

  it('allows it within the limit', async () => {
    await limit(500);
    await owe(200);
    const order = await ring(2);                         // 200 + 200 <= 500
    expect((await sendUnpaid(order)).body.success).toBe(true);
  });

  it('does not stand in the way of a cash payment', async () => {
    await limit(100);
    await owe(400);
    const order = await ring(2);
    const res = await as(staffTok)('put', `/api/orders/${order._id}`).send({ status: 'Preparing', paymentMethod: 'Cash', amountTendered: 200 });
    expect(res.body.success).toBe(true);
  });
});
