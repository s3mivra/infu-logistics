// Holding stock for a client who has committed to it.
//
// Nothing used to hold stock at all: an order only touches inventory when it
// COMPLETES, so goods promised to one client - often against a deposit - could
// be sold to somebody else in the meantime.
//
// A reservation raises Inventory.reservedQty; everyone else sells against
// stockQty - reservedQty. The reserving client's own order releases its hold
// immediately before deducting, so the hold never blocks the sale it exists for.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, acme, other, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

let inv;
const stock = async () => M('Inventory').findById(inv._id).lean();
const orderFor = async (client, quantity = 10) => {
  const res = await auth('post', '/api/orders').send({
    table: 'Pickup', paymentMethod: 'On Account', clientAccountId: client._id,
    items: [{ productId: String(product._id), name: 'Sack', price: 100, quantity }],
  });
  expect(res.body.success).toBe(true);
  return res.body.order;
};
const complete = (order) => auth('put', `/api/orders/${order._id}`).send({ status: 'Completed' });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'RsvSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'RsvSuper');
  await M('Category').create({ name: 'Bulk', department: 'Logistics' });
  product = await M('Product').create({ name: 'Sack', category: 'Bulk', basePrice: 100, productCode: 'SACK' });
  for (const [username, name] of [['acmersv', 'Acme Rsv'], ['otherrsv', 'Other Rsv']]) {
    await auth('post', '/api/client-accounts').send({ username, password: 'secret123', name, paymentMethod: 'On Account' });
  }
  acme = await M('ClientAccount').findOne({ username: 'acmersv' }).lean();
  other = await M('ClientAccount').findOne({ username: 'otherrsv' }).lean();
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Reservation').deleteMany({});
  await M('Order').deleteMany({});
  await M('Inventory').deleteMany({});
  inv = await M('Inventory').create({
    itemCode: 'SACK', itemName: 'SACK', unit: 'pcs', displayUnit: 'pcs',
    unitMultiplier: 1, stockQty: 100, unitCost: 60, srp: 100,
  });
});

describe('holding stock', () => {
  it('holds the quantity and refuses to hold more than is available', async () => {
    const res = await auth('post', '/api/reservations').send({
      clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 40 }], note: 'Paid a deposit',
    });
    expect(res.status).toBe(200);
    expect(res.body.reservation.reservationNumber).toMatch(/RSV/);
    expect((await stock()).reservedQty).toBe(40);

    const tooMuch = await auth('post', '/api/reservations').send({
      clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 70 }],
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toMatch(/only 60/i);
    expect((await stock()).reservedQty).toBe(40);      // nothing half-applied
  }, 30000);

  it('needs a named client and a future end date', async () => {
    expect((await auth('post', '/api/reservations').send({ items: [{ invId: String(inv._id), qty: 1 }] })).status).toBe(400);
    const past = await auth('post', '/api/reservations').send({
      clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 1 }], expiresAt: '2020-01-01',
    });
    expect(past.status).toBe(400);
  }, 30000);

  it('holds an open order\'s own lines', async () => {
    const order = await orderFor(acme, 25);
    const res = await auth('post', '/api/reservations').send({ orderId: String(order._id) });
    expect(res.status).toBe(200);
    expect(res.body.reservation.items[0].qty).toBe(25);
    expect((await stock()).reservedQty).toBe(25);

    // Twice would hold the same goods again.
    expect((await auth('post', '/api/reservations').send({ orderId: String(order._id) })).status).toBe(409);
  }, 30000);
});

describe('what the hold protects', () => {
  it('keeps held stock away from another client\'s order', async () => {
    await auth('post', '/api/reservations').send({ clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 95 }] });

    const theirs = await orderFor(other, 10);       // only 5 left to sell
    const res = await complete(theirs);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/INSUFFICIENT STOCK/i);
    expect((await stock()).stockQty).toBe(100);     // nothing moved
  }, 30000);

  it('lets the reserving client\'s own order through, and frees the hold', async () => {
    const order = await orderFor(acme, 60);
    await auth('post', '/api/reservations').send({ orderId: String(order._id) });
    expect((await stock()).reservedQty).toBe(60);

    const res = await complete(order);
    expect(res.body.success).toBe(true);
    const after = await stock();
    expect(after.stockQty).toBe(40);                // sold
    expect(after.reservedQty).toBe(0);              // hold gone with it
    expect((await M('Reservation').findOne({ orderId: order._id }).lean()).status).toBe('Released');
  }, 30000);

  it('still refuses a sale the shop genuinely cannot cover', async () => {
    const order = await orderFor(acme, 150);
    await auth('post', '/api/reservations').send({ clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 10 }] });
    const res = await complete(order);
    expect(res.body.success).toBe(false);
  }, 30000);
});

describe('letting go', () => {
  it('releases and cancels, and cancelling says why', async () => {
    const a = await auth('post', '/api/reservations').send({ clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 10 }] });
    expect((await auth('post', `/api/reservations/${a.body.reservation._id}/release`).send({})).status).toBe(200);
    expect((await stock()).reservedQty).toBe(0);
    expect((await auth('post', `/api/reservations/${a.body.reservation._id}/release`).send({})).status).toBe(409);

    const b = await auth('post', '/api/reservations').send({ clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 10 }] });
    expect((await auth('post', `/api/reservations/${b.body.reservation._id}/cancel`).send({})).status).toBe(400);
    const cancelled = await auth('post', `/api/reservations/${b.body.reservation._id}/cancel`).send({ reason: 'Client backed out' });
    expect(cancelled.status).toBe(200);
    expect((await stock()).reservedQty).toBe(0);
  }, 30000);

  it('expires a hold nobody collected and puts the stock back on sale', async () => {
    const res = await auth('post', '/api/reservations').send({ clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 30 }] });
    await M('Reservation').updateOne({ _id: res.body.reservation._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const list = await auth('get', '/api/reservations');           // the sweep runs here
    expect(list.status).toBe(200);
    expect((await stock()).reservedQty).toBe(0);
    expect((await M('Reservation').findById(res.body.reservation._id).lean()).status).toBe('Expired');

    // And the stock really is sellable again.
    const theirs = await orderFor(other, 100);
    expect((await complete(theirs)).body.success).toBe(true);
  }, 30000);

  it('defaults the hold to 30 days when no date is given', async () => {
    const res = await auth('post', '/api/reservations').send({ clientId: String(acme._id), items: [{ invId: String(inv._id), qty: 5 }] });
    const days = Math.round((new Date(res.body.reservation.expiresAt) - Date.now()) / 86400000);
    expect(days).toBe(30);
  }, 30000);
});
