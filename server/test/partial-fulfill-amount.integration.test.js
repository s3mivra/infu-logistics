// Partial fulfilment with an amount typed in, paid in one method or split.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const newOrder = async (qty) => (await auth('post', '/api/orders').send({
  table: 'Walk In', paymentMethod: 'Cash', customerName: 'Amount Buyer',
  items: [{ productId: String(product._id), name: 'Crate', price: 100, quantity: qty }],
})).body.order;
const lastEntry = (ref) => M('JournalEntry').findOne({ reference: ref, description: /^Partial fulfillment/ }).sort({ createdAt: -1 }).lean();
const sum = (je, code, side) => je.lines.filter((l) => l.accountCode === code).reduce((t, l) => t + l[side], 0);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PfaSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'PfaSuper');
  await M('Category').create({ name: 'Goods', department: 'Logistics' });
  product = await M('Product').create({ productCode: 'G-9', name: 'Crate', category: 'Goods', basePrice: 100 });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('partial fulfilment, amount paid now', () => {
  it('split across two methods: each is its own debit, extra held as a deposit', async () => {
    const order = await newOrder(4);
    const r = await auth('post', `/api/orders/${order._id}/partial-fulfill`).send({
      fulfill: [{ index: 0, qty: 2 }], paymentMode: 'amount',
      payments: [{ method: 'Cash', amount: 150 }, { method: 'GCash', amount: 100 }],
    });
    expect(r.body.success, JSON.stringify(r.body)).toBe(true);
    const je = await lastEntry(order.orderNumber);
    expect(je.lines.filter((l) => l.debit > 0 && ['Cash', 'GCash'].some((m) => je.description.includes(m))).length).toBeGreaterThan(0);
    expect(je.description).toMatch(/Cash ₱150\.00 \+ GCash ₱100\.00/);
    expect(sum(je, '260200', 'credit')).toBeCloseTo(50, 2);
    expect((await M('Order').findById(order._id).lean()).amountPaid).toBe(250);
  }, 30000);

  it('less than the batch: the rest is owed (A/R)', async () => {
    const order = await newOrder(3);
    const r = await auth('post', `/api/orders/${order._id}/partial-fulfill`).send({
      fulfill: [{ index: 0, qty: 2 }], paymentMode: 'amount', paymentMethod: 'Cash', amount: 120,
    });
    expect(r.body.success, JSON.stringify(r.body)).toBe(true);
    const je = await lastEntry(order.orderNumber);
    expect(sum(je, '120000', 'debit')).toBeCloseTo(80, 2);
  }, 30000);

  it('refuses more than is left to pay, and a check with no number', async () => {
    const order = await newOrder(2);
    expect((await auth('post', `/api/orders/${order._id}/partial-fulfill`).send({
      fulfill: [{ index: 0, qty: 1 }], paymentMode: 'amount', paymentMethod: 'Cash', amount: 500,
    })).status).toBe(400);
    expect((await auth('post', `/api/orders/${order._id}/partial-fulfill`).send({
      fulfill: [{ index: 0, qty: 1 }], paymentMode: 'amount', payments: [{ method: 'Check', amount: 100 }],
    })).status).toBe(400);
  }, 30000);
});
