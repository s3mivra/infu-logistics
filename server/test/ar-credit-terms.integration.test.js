// Credit terms (utang / on-account payment terms):
//   - A client can carry a default payment-terms-in-days.
//   - When a NON-CASH order Completes, those terms are snapshotted onto the order
//     as arTermsDays + arDueDate (= completion time + terms days). Cash orders
//     never get a due date.
//   - The snapshot is frozen: changing the client's default terms afterwards must
//     NOT move an already-booked receivable's due date.
//   - The A/R-outstanding report flags an order overdue once its due date passes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, prod, client;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

async function completeOrder(paymentMethod, clientAccountId) {
  const body = {
    items: [{ productId: String(prod._id), name: 'Widget', price: 100, quantity: 1 }],
    table: 'Takeout', paymentMethod,
    ...(clientAccountId ? { clientAccountId } : {}),
  };
  const a = await auth('post', '/api/orders', staffTok).send(body);
  expect(a.status).toBe(200);
  await auth('put', `/api/orders/${a.body.order._id}`, staffTok).send({ status: 'Completed' });
  return a.body.order._id;
}

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'tSuper', role: 'superadmin' });
  await makeUser({ name: 'tStaff', role: 'staff' });
  superTok = await loginStaff(app, 'tSuper');
  staffTok = await loginStaff(app, 'tStaff');

  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'TCat', department: 'Kitchen' });
  prod = await Product.create({ name: 'Widget', category: 'TCat', basePrice: 100 });

  const res = await auth('post', '/api/client-accounts', superTok).send({
    username: 'termsco', password: 'secret123', name: 'Terms Co',
    paymentMethod: 'On Account', creditTermsDays: 15,
  });
  expect(res.status).toBe(200);
  expect(res.body.client.creditTermsDays).toBe(15);
  client = res.body.client;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('A/R credit terms', () => {
  const Order = () => mongoose.model('Order');

  it('snapshots the client terms onto a non-cash order at completion', async () => {
    const id = await completeOrder('On Account', client._id);
    const o = await Order().findById(id).lean();
    expect(o.arTermsDays).toBe(15);
    expect(o.arDueDate).toBeTruthy();
    const days = Math.round((new Date(o.arDueDate).getTime() - new Date().getTime()) / 86400000);
    expect(days).toBeGreaterThanOrEqual(14);
    expect(days).toBeLessThanOrEqual(15);
  });

  it('does NOT set a due date on a cash order', async () => {
    const id = await completeOrder('Cash', client._id);
    const o = await Order().findById(id).lean();
    expect(o.arDueDate == null).toBe(true);
  });

  it('freezes the due date — later changes to client terms do not move it', async () => {
    const id = await completeOrder('On Account', client._id);
    const before = (await Order().findById(id).lean()).arDueDate;
    await auth('patch', `/api/client-accounts/${client._id}`, superTok).send({ creditTermsDays: 90 });
    const after = (await Order().findById(id).lean()).arDueDate;
    expect(new Date(after).getTime()).toBe(new Date(before).getTime());
  });

  it('flags an order overdue in ar-outstanding once its due date passes', async () => {
    const id = await completeOrder('On Account', client._id);
    // Backdate the due date to yesterday.
    await Order().updateOne({ _id: id }, { $set: { arDueDate: new Date(Date.now() - 86400000) } });
    const res = await auth('get', '/api/finance/ar-outstanding', superTok);
    expect(res.status).toBe(200);
    const row = res.body.orders.find(r => String(r._id) === String(id));
    expect(row).toBeTruthy();
    expect(row.overdue).toBe(true);
    expect(res.body.overdueCount).toBeGreaterThanOrEqual(1);
  });
});
