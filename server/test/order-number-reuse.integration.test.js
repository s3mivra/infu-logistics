// A cancelled order holding the latest number gives it back; void and refund
// keep theirs, and an older cancelled number stays a gap.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const place = async () => {
  const r = await as('post', '/api/orders').send({ items: [{ name: 'Open Item', price: 100, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash', customerName: 'Walk-in' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.order;
};
const cancel = (o) => as('put', `/api/orders/${o._id}`).send({ status: 'Cancelled' });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'onOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'onOwner');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('order number after a cancel', () => {
  it('the latest cancelled number goes to the next order; the cancelled one is kept as -X', async () => {
    const a = await place();
    const r = await cancel(a);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const kept = await mongoose.model('Order').findById(a._id).lean();
    expect(kept.orderNumber).toBe(`${a.orderNumber}-X`);
    expect(kept.status).toBe('Cancelled');
    const b = await place();
    expect(b.orderNumber).toBe(a.orderNumber);
  });

  it('an older cancelled number stays a gap', async () => {
    const a = await place();
    const b = await place();
    await cancel(a);
    expect((await mongoose.model('Order').findById(a._id).lean()).orderNumber).toBe(a.orderNumber);
    const c = await place();
    expect(c.orderNumber).not.toBe(a.orderNumber);
    expect(c.orderNumber > b.orderNumber).toBe(true);
  });

  it('a number with something posted under it is not reused', async () => {
    const a = await place();
    await mongoose.model('StockCard').collection.insertOne({ reference: a.orderNumber, type: 'Sale', qtyChange: -1 });
    await cancel(a);
    expect((await mongoose.model('Order').findById(a._id).lean()).orderNumber).toBe(a.orderNumber);
    const b = await place();
    expect(b.orderNumber).not.toBe(a.orderNumber);
  });
});

describe('closing the day', () => {
  it('open tickets at the end of the day give their numbers back, newest first', async () => {
    const kept = await place();
    await as('put', `/api/orders/${kept._id}`).send({ status: 'Completed' });
    const a = await place();
    const b = await place();
    const r = await as('post', '/api/orders/archive');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const Order = mongoose.model('Order');
    expect((await Order.findById(a._id).lean()).orderNumber).toBe(`${a.orderNumber}-X`);
    expect((await Order.findById(b._id).lean()).orderNumber).toBe(`${b.orderNumber}-X`);
    const next = await place();
    expect(next.orderNumber).toBe(a.orderNumber);
  });
});

describe('print name on a line', () => {
  it('the till can give a line a print name; the product name is untouched', async () => {
    const r = await as('post', '/api/orders').send({
      items: [{ name: 'Open Item', printName: '  House   Blend 1kg ', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', customerName: 'Walk-in',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const o = await mongoose.model('Order').findById(r.body.order._id).lean();
    expect(o.items[0].printName).toBe('House Blend 1kg');
    expect(o.items[0].name).toBe('Open Item');
  });
});
