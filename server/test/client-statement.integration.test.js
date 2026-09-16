// A client's statement of account.
//
// At month end a credit client does not want a list of orders, they want the
// account: what they owed when the month opened, every charge and payment since
// in date order, and what is left. The opening balance is computed from the
// movements rather than stored, so the statement reconciles whichever period is
// asked for - and a client disputing their total has something to check.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, client, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

// A completed on-account sale, backdated to `at`.
const charge = async (amount, at) => {
  const res = await auth('post', '/api/orders').send({
    table: 'Delivery', paymentMethod: 'Credit', clientAccountId: String(client._id),
    customerName: client.name,
    items: [{ productId: String(product._id), name: 'Widget', price: amount, quantity: 1 }],
  });
  const id = res.body.order._id;
  await auth('put', `/api/orders/${id}`).send({ status: 'Completed' });
  // Mongoose strips createdAt out of an update when timestamps are on, so the
  // backdating goes through the raw collection.
  if (at) await M('Order').collection.updateOne({ _id: new mongoose.Types.ObjectId(String(id)) }, { $set: { createdAt: at, completedAt: at } });
  return id;
};

const collect = async (orderId, amount, at) => {
  const res = await auth('post', `/api/orders/${orderId}/settle-ar`)
    .send({ amount, paymentMethod: 'Cash', referenceNumber: 'RCPT-1' });
  if (at) {
    await M('Order').collection.updateOne({ _id: new mongoose.Types.ObjectId(String(orderId)) },
      { $set: { 'arPayments.$[].collectionDate': at, 'arPayments.$[].createdAt': at } });
  }
  return res;
};

const statement = async (start, end) =>
  auth('get', `/api/clients/${client._id}/statement?start=${start}&end=${end}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'SoaSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'SoaSuper');
  await M('Category').create({ name: 'Goods' });
  product = await M('Product').create({ name: 'Widget', category: 'Goods', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([M('Order').deleteMany({}), M('ClientAccount').deleteMany({}), M('Advance').deleteMany({})]);
  client = await M('ClientAccount').create({
    username: `acct-${Date.now()}`, password: 'x', name: 'Northwind Trading',
    paymentMethod: 'Credit', tin: '123-456-789-000', registeredName: 'Northwind Trading Corp.',
  });
});

describe('a statement of account', () => {
  it('carries the earlier balance in as an opening figure', async () => {
    await charge(1000, daysAgo(40));          // before the window
    await charge(250, daysAgo(5));            // inside it

    const res = await statement(iso(daysAgo(10)), iso(new Date()));
    expect(res.status).toBe(200);
    expect(res.body.openingBalance).toBeCloseTo(1000, 2);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.closingBalance).toBeCloseTo(1250, 2);
  });

  it('runs charges and payments down one timeline with a balance per line', async () => {
    const first = await charge(1000, daysAgo(6));
    await collect(first, 400, daysAgo(3));
    await charge(500, daysAgo(2));

    const res = await statement(iso(daysAgo(10)), iso(new Date()));
    const rows = res.body.rows;
    expect(rows.map(r => r.kind)).toEqual(['charge', 'payment', 'charge']);
    expect(rows.map(r => r.balance)).toEqual([1000, 600, 1100]);
    expect(res.body.totals.charges).toBeCloseTo(1500, 2);
    expect(res.body.totals.payments).toBeCloseTo(400, 2);
    expect(res.body.closingBalance).toBeCloseTo(1100, 2);
  });

  it('ties the closing balance to opening plus charges less payments', async () => {
    await charge(800, daysAgo(45));
    const inWindow = await charge(600, daysAgo(4));
    await collect(inWindow, 150, daysAgo(1));

    const res = await statement(iso(daysAgo(10)), iso(new Date()));
    const { openingBalance, totals, closingBalance } = res.body;
    expect(closingBalance).toBeCloseTo(openingBalance + totals.charges - totals.payments, 2);
  });

  it('ages what is still open and nets off money already held', async () => {
    await charge(1000, daysAgo(75));          // well overdue
    await charge(300, daysAgo(2));            // current
    await M('Advance').create({
      advanceNumber: 'ADV-T1', type: 'customer', payeeName: client.name,
      clientId: String(client._id), amount: 500, liquidatedAmount: 0, status: 'Open',
    });

    const res = await statement(iso(daysAgo(90)), iso(new Date()));
    expect(res.body.aged.d61_90).toBeCloseTo(1000, 2);
    expect(res.body.aged.current).toBeCloseTo(300, 2);
    expect(res.body.deposits).toBeCloseTo(500, 2);
    expect(res.body.netDue).toBeCloseTo(res.body.closingBalance - 500, 2);
  });

  it('leaves cash sales off the account entirely', async () => {
    const res = await auth('post', '/api/orders').send({
      table: 'Delivery', paymentMethod: 'Cash', clientAccountId: String(client._id),
      customerName: client.name,
      items: [{ productId: String(product._id), name: 'Widget', price: 999, quantity: 1 }],
    });
    await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });

    const soa = await statement(iso(daysAgo(10)), iso(new Date()));
    expect(soa.body.rows).toHaveLength(0);
    expect(soa.body.closingBalance).toBeCloseTo(0, 2);
  });

  it('carries the client details a printed statement has to show', async () => {
    const res = await statement(iso(daysAgo(10)), iso(new Date()));
    expect(res.body.client.name).toBe('Northwind Trading');
    expect(res.body.client.tin).toBe('123-456-789-000');
    expect(res.body.client.registeredName).toBe('Northwind Trading Corp.');
  });
});
