// Customer deposits tied to a client account.
//
// A client pays ahead of any order (e.g. to reserve stock for next month).
// The deposit sits in 260200 until it is applied to one of THEIR orders, and
// both the Clients screen and the client's own portal show what is left.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app, superTok, acme, other, acmeTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const Order = () => mongoose.model('Order');

const completedOrder = (client, total, extra = {}) => Order().create({
  orderNumber: `DEP-${Math.random().toString(36).slice(2, 8)}`,
  status: 'Completed', total, subtotal: total, paymentMethod: 'On Account',
  clientId: String(client._id), ...extra,
});
const deposit = (body) => auth('post', '/api/advances', superTok).send({ type: 'customer', ...body });
const apply = (advance, body) => auth('post', `/api/advances/${advance._id}/liquidate`, superTok).send({ method: 'order', ...body });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'DepSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'DepSuper');
  await makeClient({ username: 'acme' });
  await makeClient({ username: 'other' });
  acme = await mongoose.model('ClientAccount').findOne({ username: 'acme' }).lean();
  other = await mongoose.model('ClientAccount').findOne({ username: 'other' }).lean();
  acmeTok = await loginClient(app, 'acme');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('recording a deposit against a client', () => {
  it('links the deposit and takes the payee name from the account', async () => {
    const res = await deposit({ clientId: String(acme._id), payeeName: 'typo name', amount: 50000, purpose: 'Reserve 200 sacks' });
    expect(res.status).toBe(200);
    expect(res.body.advance.clientId).toBe(String(acme._id));
    expect(res.body.advance.payeeName).toBe(acme.name);
  });

  it('refuses a client link on a non-customer advance, or an unknown client', async () => {
    expect((await auth('post', '/api/advances', superTok).send({ type: 'employee', clientId: String(acme._id), payeeName: 'X', amount: 10 })).status).toBe(400);
    expect((await deposit({ clientId: String(new mongoose.Types.ObjectId()), amount: 10 })).status).toBe(400);
  });

  it('filters the list by client', async () => {
    const res = await auth('get', `/api/advances?clientId=${acme._id}`, superTok);
    expect(res.body.advances.length).toBeGreaterThan(0);
    expect(res.body.advances.every(a => a.clientId === String(acme._id))).toBe(true);
  });
});

describe('applying a deposit to an order', () => {
  it('pays part of a larger order and leaves the rest on A/R', async () => {
    const { body: { advance } } = await deposit({ clientId: String(acme._id), amount: 3000 });
    const order = await completedOrder(acme, 10000);

    const res = await apply(advance, { orderId: String(order._id) }); // amount omitted
    expect(res.status).toBe(200);
    expect(res.body.advance.status).toBe('Liquidated');

    const after = await Order().findById(order._id).lean();
    expect(after.arPaidAmount).toBe(3000);
    expect(after.arSettled).toBe(false);
  });

  it('uses only what the order can take when the deposit is larger', async () => {
    const { body: { advance } } = await deposit({ clientId: String(acme._id), amount: 5000 });
    const order = await completedOrder(acme, 1200);

    const res = await apply(advance, { orderId: String(order._id) });
    expect(res.status).toBe(200);
    expect(res.body.advance.status).toBe('Partially Liquidated');
    expect(res.body.advance.outstanding).toBe(3800);
    expect((await Order().findById(order._id).lean()).arSettled).toBe(true);

    // An explicit amount above the order's balance is refused.
    const second = await completedOrder(acme, 100);
    expect((await apply(advance, { orderId: String(second._id), amount: 500 })).status).toBe(400);
  });

  it("refuses another client's order", async () => {
    const { body: { advance } } = await deposit({ clientId: String(acme._id), amount: 1000 });
    const order = await completedOrder(other, 1000);
    const res = await apply(advance, { orderId: String(order._id) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/belongs to/i);
  });

  it('refuses orders with no receivable: unfinished, cash, or already paid', async () => {
    const { body: { advance } } = await deposit({ clientId: String(acme._id), amount: 1000 });
    const pending = await completedOrder(acme, 500, { status: 'Pending' });
    const cash = await completedOrder(acme, 500, { paymentMethod: 'Cash' });
    const paid = await completedOrder(acme, 500, { arPaidAmount: 500, arSettled: true });
    expect((await apply(advance, { orderId: String(pending._id) })).status).toBe(400);
    expect((await apply(advance, { orderId: String(cash._id) })).status).toBe(400);
    expect((await apply(advance, { orderId: String(paid._id) })).status).toBe(409);
  });
});

describe('where the client and staff see it', () => {
  it('shows open deposits on the Clients summary', async () => {
    const res = await auth('get', '/api/clients/summary', superTok);
    const row = res.body.clients.find(c => c._id === String(acme._id));
    const open = await mongoose.model('Advance').find({ clientId: String(acme._id), status: { $in: ['Open', 'Partially Liquidated'] } }).lean();
    const expected = open.reduce((s, a) => s + a.amount - (a.liquidatedAmount || 0), 0);
    expect(row.deposits).toBeCloseTo(expected, 2);
    expect(row.deposits).toBeGreaterThan(0);
    expect(res.body.clients.find(c => c._id === String(other._id)).deposits).toBe(0);
  });

  it("shows the client their own deposits in the portal, and nobody else's", async () => {
    const res = await auth('get', '/api/client/profile', acmeTok);
    expect(res.status).toBe(200);
    expect(res.body.profile.deposits.balance).toBeGreaterThan(0);
    expect(res.body.profile.deposits.items[0]).toHaveProperty('remaining');

    const otherTok = await loginClient(app, 'other');
    const mine = await auth('get', '/api/client/profile', otherTok);
    expect(mine.body.profile.deposits.balance).toBe(0);
  });
});
