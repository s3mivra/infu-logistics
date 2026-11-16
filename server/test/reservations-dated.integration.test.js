// An order reserved for a later day: booked with its date and time, a deposit
// taken now (held as a customer deposit, not a sale), the deposit used first
// when it is rung up on the day, and given back if it is called off.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const M = (n) => mongoose.model(n);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'RsvOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'RsvOwner');
  for (let i = 0; i < 120; i++) {
    if ((await request(app).get('/health')).body.startup === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const reserve = (name) => as('post', '/api/orders').send({
  items: [{ name: 'Chocolate Cake', price: 1200, quantity: 1, productDiscountPercent: 0 }],
  table: 'Pickup', customerName: name, reserveOnly: true, reservedFor: '2026-11-22T07:00:00.000Z',
});
const lineOf = (je, code) => je.lines.filter((l) => l.accountCode === code).reduce((t, l) => t + l.debit - l.credit, 0);

describe('an order reserved for a later day', () => {
  let order;

  it('is kept as Reserved with the day and time it is for', async () => {
    const r = await reserve('Ana Reyes');
    expect(r.body.success, JSON.stringify(r.body)).toBe(true);
    order = r.body.order;
    expect(order.status).toBe('Reserved');
    expect(new Date(order.reservedFor).toISOString()).toBe('2026-11-22T07:00:00.000Z');
  });

  it('takes a deposit into Customer Advances / Deposits, not sales', async () => {
    const r = await as('post', `/api/orders/${order._id}/reservation-deposit`).send({ amount: 500, paymentMethod: 'Cash' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const je = await M('JournalEntry').findOne({ reference: r.body.journalReference }).lean();
    expect(lineOf(je, '260200')).toBe(-500);   // credit: held for the customer
    expect(je.lines.some((l) => /^4/.test(l.accountCode))).toBe(false);   // no revenue yet
    const o = await M('Order').findById(order._id).lean();
    expect(o).toMatchObject({ depositRemaining: 500, amountPaid: 500 });
    expect(o.reservationDeposits).toHaveLength(1);
  });

  it('refuses a deposit larger than what is left', async () => {
    const r = await as('post', `/api/orders/${order._id}/reservation-deposit`).send({ amount: 800, paymentMethod: 'Cash' });
    expect(r.status).toBe(400);
  });

  it('on the day, uses the deposit first and takes only the balance', async () => {
    expect((await as('put', `/api/orders/${order._id}`).send({ status: 'Pending' })).status).toBe(200);
    const done = await as('put', `/api/orders/${order._id}`).send({ status: 'Completed', paymentMethod: 'Cash' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const o = await M('Order').findById(order._id).lean();
    expect(o.depositRemaining).toBe(0);
    const je = await M('JournalEntry').findOne({ reference: o.orderNumber }).lean();
    expect(lineOf(je, '260200')).toBe(500);    // the deposit, released
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    const cashIn = je.lines.filter((l) => l.accountCode.startsWith('11') && l.debit > 0).reduce((t, l) => t + l.debit, 0);
    expect(cashIn).toBe(700);                  // only the balance now
  });

  it('called off, gives the deposit back', async () => {
    const r = await reserve('Ben Cruz');
    const id = r.body.order._id;
    await as('post', `/api/orders/${id}/reservation-deposit`).send({ amount: 300, paymentMethod: 'GCash', reference: 'GC-1' });
    const cancel = await as('put', `/api/orders/${id}`).send({ status: 'Cancelled' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const o = await M('Order').findById(id).lean();
    expect(o).toMatchObject({ status: 'Cancelled', depositRemaining: 0, depositRefunded: 300 });
    const je = await M('JournalEntry').findOne({ description: new RegExp(`Reservation deposit refunded: ${o.orderNumber.replace(/-X$/, '')}`) }).lean();
    expect(je).toBeTruthy();
    expect(lineOf(je, '260200')).toBe(300);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });
});
