// A sale paid in parts at the till: some cash, the rest by check or on account.
// Each part lands in its own account; only what was not handed over in cash
// stays on the receivable; voiding gives each account its part back.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const place = async (price) => {
  const r = await auth('post', '/api/orders').send({ table: 'Takeout', customerName: 'Split Buyer', items: [{ name: 'Open Item', price, quantity: 1 }] });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r.body.order;
};
const pay = (id, body) => auth('put', `/api/orders/${id}`).send({ status: 'Preparing', paymentMethod: 'Split', ...body });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'splitBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'splitBoss');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('split payment at the till', () => {
  it('refuses parts that do not add up, or a check with no number', async () => {
    const o = await place(1000);
    expect((await pay(o._id, { payments: [{ method: 'Cash', amount: 400 }, { method: 'Check', amount: 500, reference: 'C1' }] })).status).toBe(400);
    const noNo = await pay(o._id, { payments: [{ method: 'Cash', amount: 400 }, { method: 'Check', amount: 600 }] });
    expect(noNo.status).toBe(400);
    expect(noNo.body.error).toMatch(/check number/i);
    expect((await pay(o._id, { payments: [{ method: 'Cash', amount: 1000 }] })).status).toBe(400);
  });

  it('books each part to its own account and leaves only the unpaid part owed', async () => {
    const o = await place(1000);
    const paid = await pay(o._id, { payments: [{ method: 'Cash', amount: 400 }, { method: 'Check', amount: 600, reference: 'CHK-55', checkDate: '2026-10-01' }] });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    const done = await auth('put', `/api/orders/${o._id}`).send({ status: 'Completed' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const saved = await M('Order').findById(o._id).lean();
    expect(saved.paymentMethod).toBe('Split');
    expect(saved.arPaidAmount).toBe(400);
    expect(saved.paymentReference).toBe('CHK-55');
    expect(saved.payments.map(p => [p.method, p.amount, p.reference || ''])).toEqual([['Cash', 400, ''], ['Check', 600, 'CHK-55']]);
    const je = await M('JournalEntry').findOne({ description: { $regex: saved.orderNumber }, 'lines.accountCode': '410000' }).lean();
    const debit = (code) => je.lines.filter(l => l.accountCode === code).reduce((s, l) => s + (l.debit || 0), 0);
    expect([debit('111000'), debit('120000')]).toEqual([400, 600]);
    const ar = (await auth('get', '/api/finance/ar-outstanding')).body;
    expect(ar.orders.find(x => x.orderNumber === saved.orderNumber).balance).toBe(600);
    const tb = await trialBalance();
    expect(tb.debits).toBe(tb.credits);

    // Voiding gives each account its own part back.
    const v = await auth('post', `/api/orders/${o._id}/void`).send({ reason: 'Wrong order' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const net = async (code) => {
      const rows = await M('JournalEntry').aggregate([{ $unwind: '$lines' }, { $match: { 'lines.accountCode': code } },
        { $group: { _id: null, n: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } }]);
      return +(rows[0]?.n || 0).toFixed(2);
    };
    expect([await net('111000'), await net('120000')]).toEqual([0, 0]);
  });

  it('a refund takes down what is owed first, then comes out of cash', async () => {
    const o = await place(1000);
    expect((await pay(o._id, { payments: [{ method: 'Cash', amount: 400 }, { method: 'On Account', amount: 600 }] })).status).toBe(200);
    expect((await auth('put', `/api/orders/${o._id}`).send({ status: 'Completed' })).status).toBe(200);
    const r = await auth('post', `/api/orders/${o._id}/refund`).send({ reason: 'Returned', refundAmount: 1000, inventoryAction: 'None' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const je = await M('JournalEntry').findOne({ reference: { $regex: '^REFUND' }, description: { $regex: (await M('Order').findById(o._id).lean()).orderNumber } }).lean()
      || await M('JournalEntry').findOne({ reference: { $regex: '^REFUND' } }).sort({ createdAt: -1 }).lean();
    const credit = (code) => je.lines.filter(l => l.accountCode === code).reduce((s, l) => s + (l.credit || 0), 0);
    expect([credit('120000'), credit('111000')]).toEqual([600, 400]);
  });

  it('parts that are all cash are simply a cash sale', async () => {
    const o = await place(500);
    expect((await pay(o._id, { payments: [{ method: 'Cash', amount: 200 }, { method: 'Cash', amount: 300 }] })).status).toBe(200);
    const saved = await M('Order').findById(o._id).lean();
    expect([saved.paymentMethod, saved.payments.length]).toEqual(['Cash', 0]);
  });
});
