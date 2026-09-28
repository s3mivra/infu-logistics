// PUT /api/orders/:id used to take any status string. An audit set an order
// to "Voided" with a plain staff token - no reason captured, none of the
// stock or ledger reversal the real void route does, which is superadmin-only.
// Order status has no schema enum, so this route is the only thing standing
// between a staff login and an arbitrary status.
//
// Cancelling an order whose cash is already in the drawer has the same effect
// on the shift's expected cash, so that needs the void permission as well.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, cashierTok, managerTok, prod;
const as = (tok, m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const order = async () => (await as(cashierTok, 'post', '/api/orders').send({
  table: 'Takeout', paymentMethod: 'Cash',
  items: [{ productId: String(prod._id), name: prod.name, price: 100, quantity: 1 }],
})).body.order._id;
const statusOf = async (id) => (await mongoose.model('Order').findById(id).lean()).status;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Till', role: 'cashier' });
  await makeUser({ name: 'Lead', role: 'manager' });
  cashierTok = await loginStaff(app, 'Till');
  managerTok = await loginStaff(app, 'Lead');
  prod = await mongoose.model('Product').create({ name: 'Brew', category: 'X', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx?.stop?.(); });

describe('statuses the generic update refuses', () => {
  for (const bad of ['Voided', 'Refunded', 'Parked', 'Partially Delivered', 'whatever']) {
    it(`refuses "${bad}" and leaves the order as it was`, async () => {
      const id = await order();
      const r = await as(cashierTok, 'put', `/api/orders/${id}`).send({ status: bad });
      expect(r.status).toBe(400);
      expect(await statusOf(id)).toBe('Pending');
    });
  }
});

describe('the normal life of an order still works', () => {
  it('moves Pending -> Preparing -> Ready -> Completed', async () => {
    const id = await order();
    for (const s of ['Preparing', 'Ready', 'Completed']) {
      const r = await as(cashierTok, 'put', `/api/orders/${id}`).send({ status: s, ...(s === 'Preparing' ? { amountTendered: 100 } : {}) });
      expect(r.status, `${s}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    expect(await statusOf(id)).toBe('Completed');
  });

  it('lets a cashier cancel an order nobody has paid for', async () => {
    const id = await order();
    const r = await as(cashierTok, 'put', `/api/orders/${id}`).send({ status: 'Cancelled' });
    expect(r.status).toBe(200);
    expect(await statusOf(id)).toBe('Cancelled');
  });
});

describe('cancelling an order whose cash is already taken', () => {
  it('is refused for a cashier', async () => {
    const id = await order();
    await as(cashierTok, 'put', `/api/orders/${id}`).send({ status: 'Preparing', amountTendered: 100 });
    const r = await as(cashierTok, 'put', `/api/orders/${id}`).send({ status: 'Cancelled' });
    expect(r.status).toBe(403);
    expect(await statusOf(id)).toBe('Preparing');
  });

  it('is allowed for someone holding the void permission', async () => {
    const id = await order();
    await as(cashierTok, 'put', `/api/orders/${id}`).send({ status: 'Preparing', amountTendered: 100 });
    const r = await as(managerTok, 'put', `/api/orders/${id}`).send({ status: 'Cancelled' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
