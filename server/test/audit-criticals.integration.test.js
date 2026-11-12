// Regression tests for the CRITICAL findings of the 2026-11 pre-production audit
// (AUDIT/REPORT.md M01, M02, M03, M13). Each case reproduces the exploit that
// was proven against the unpatched server and asserts it is now refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let app, stop, superToken, cashierToken, productId, invId;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'audit-criticals-secret-0123456789' }));
  await makeUser({ name: 'AcBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'AcCashier', role: 'cashier', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'AcBoss', 'pw');
  cashierToken = await loginStaff(app, 'AcCashier', 'pw');
  const inv = await mongoose.model('Inventory').create({
    itemCode: 'AC-WIDGET', itemName: 'Audit Widget', stockQty: 1000, unit: 'pcs',
    unitCost: 40, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log',
  });
  invId = String(inv._id);
  const prod = await request(app).post('/api/products').set(auth(superToken))
    .send({ name: 'Audit Widget', category: 'Dry Goods', basePrice: 112 });
  productId = prod.body.product._id;
}, 120000);

afterAll(async () => { await stop(); });

const stockOf = async () => (await mongoose.model('Inventory').findById(invId).lean()).stockQty;
const saleEntries = (orderNumber) => mongoose.model('JournalEntry').countDocuments({ reference: orderNumber });

const completedSale = async (quantity = 4) => {
  const created = await request(app).post('/api/orders').set(auth(cashierToken)).send({
    customerName: 'Audit Tester', paymentMethod: 'Cash',
    items: [{ productId, name: 'Audit Widget', price: 112, quantity }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = created.body.order._id;
  const done = await request(app).put(`/api/orders/${id}`).set(auth(cashierToken)).send({ status: 'Completed' });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return mongoose.model('Order').findById(id).lean();
};

describe('M01: refresh responses are never shared between callers', () => {
  it('a caller with no cookie never receives the token of a concurrent refresh', async () => {
    const login = await request(app).post('/api/users/login').send({ name: 'AcBoss', password: 'pw' });
    const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    for (let i = 0; i < 20; i++) {
      const [victim, attacker] = await Promise.all([
        request(app).post('/api/auth/refresh').set('Cookie', cookie).send({}),
        request(app).post('/api/auth/refresh').send({}),
      ]);
      expect(victim.status).toBe(200);
      expect(attacker.status).toBe(401);
      expect(attacker.body.token).toBeUndefined();
      expect(attacker.headers['x-idempotent-replay']).toBeUndefined();
    }
  });
});

describe('M02: closed orders cannot be completed again', () => {
  it('a voided order cannot be PUT back to Completed (no second sale, no second stock take)', async () => {
    const order = await completedSale(1);
    const voided = await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'audit test' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const stockAfterVoid = await stockOf();
    const sales = await saleEntries(order.orderNumber);

    const reopen = await request(app).put(`/api/orders/${order._id}`).set(auth(cashierToken)).send({ status: 'Completed' });
    expect(reopen.status).toBe(409);
    expect((await mongoose.model('Order').findById(order._id).lean()).status).toBe('Voided');
    expect(await stockOf()).toBe(stockAfterVoid);
    expect(await saleEntries(order.orderNumber)).toBe(sales);
  });

  it('a refunded order cannot be PUT back to Completed', async () => {
    const order = await completedSale(1);
    const refunded = await request(app).post(`/api/orders/${order._id}/refund`).set(auth(superToken)).send({ reason: 'audit test' });
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(200);
    const reopen = await request(app).put(`/api/orders/${order._id}`).set(auth(cashierToken)).send({ status: 'Completed' });
    expect(reopen.status).toBe(409);
    expect((await mongoose.model('Order').findById(order._id).lean()).status).toBe('Refunded');
  });
});

describe('M03: a full refund after a partial refund pays back only what is left', () => {
  it('partial 3 of 4 then full refund totals the order value, not more', async () => {
    const order = await completedSale(4);   // 4 x 112 = 448
    const partial = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 3 }], reason: 'three back', inventoryAction: 'Restock' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    const stockAfterPartial = await stockOf();

    // Default amount = what is left, never the face total again.
    const full = await request(app).post(`/api/orders/${order._id}/refund`).set(auth(superToken)).send({ reason: 'rest' });
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    const after = await mongoose.model('Order').findById(order._id).lean();
    expect(after.refundedAmount).toBeCloseTo(448, 2);
    expect(after.refundedAmount).toBeLessThanOrEqual(after.total + 0.001);
    expect(await stockOf()).toBe(stockAfterPartial);
  });

  it('refuses a full-refund amount above what is left, and a whole-order restock after a partial', async () => {
    const order = await completedSale(4);
    await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'one back', inventoryAction: 'Restock' });
    const tooMuch = await request(app).post(`/api/orders/${order._id}/refund`).set(auth(superToken))
      .send({ reason: 'x', refundAmount: 448 });
    expect(tooMuch.status).toBe(400);
    const restock = await request(app).post(`/api/orders/${order._id}/refund`).set(auth(superToken))
      .send({ reason: 'x', inventoryAction: 'Restock' });
    expect(restock.status).toBe(400);
  });

  it('refuses a refund below one centavo', async () => {
    const order = await completedSale(1);
    const tiny = await request(app).post(`/api/orders/${order._id}/refund`).set(auth(superToken))
      .send({ reason: 'x', refundAmount: 0.004 });
    expect(tiny.status).toBe(400);
    expect((await mongoose.model('Order').findById(order._id).lean()).status).toBe('Completed');
  });
});

describe('M13: an Idempotency-Key only replays to the caller who sent it', () => {
  it("a client portal user reusing a cashier's key gets 409 and none of the order", async () => {
    await makeClient({ username: 'acclient', password: 'pw' });
    const clientToken = await loginClient(app, 'acclient', 'pw');
    const key = 'audit-key-0001';
    const first = await request(app).post('/api/orders').set({ ...auth(cashierToken), 'Idempotency-Key': key }).send({
      customerName: 'Private Customer', deliveryAddress: '123 Private St', paymentMethod: 'Cash',
      items: [{ productId, name: 'Audit Widget', price: 112, quantity: 1 }],
    });
    expect(first.status).toBe(200);

    const same = await request(app).post('/api/orders').set({ ...auth(cashierToken), 'Idempotency-Key': key }).send({});
    expect(same.status).toBe(200);
    expect(same.body.order.orderNumber).toBe(first.body.order.orderNumber);

    const other = await request(app).post('/api/orders').set({ ...auth(clientToken), 'Idempotency-Key': key }).send({
      items: [{ productId, name: 'Audit Widget', quantity: 1 }],
    });
    expect(other.status).toBe(409);
    expect(JSON.stringify(other.body)).not.toContain('Private St');
  });
});
