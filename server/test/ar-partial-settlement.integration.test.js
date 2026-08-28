// Partial A/R collections.
//
// The bug this locks down: settling a 1,700 receivable with a 1,500 payment
// used to mark the whole invoice settled and drop it off the books, silently
// writing off the remaining 200. A collection now only pays down what it is
// worth - the invoice stays outstanding for the remainder, ages on that
// remainder, and only closes when the running total reaches the face value.
//
// Each collection also carries two distinct dates: when the money was taken
// from the client (collectionDate) and when it was banked (depositDate). They
// differ in practice - cash collected Friday is banked Monday - and the
// collection report is read on either basis.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, prod, client;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

// One completed On Account sale of `price`, i.e. one receivable of that value.
async function receivable(price) {
  const a = await auth('post', '/api/orders', staffTok).send({
    items: [{ productId: String(prod._id), name: 'Widget', price, quantity: 1 }],
    table: 'Takeout', paymentMethod: 'On Account', clientAccountId: client._id,
  });
  expect(a.status).toBe(200);
  await auth('put', `/api/orders/${a.body.order._id}`, staffTok).send({ status: 'Completed' });
  return a.body.order._id;
}

const settle = (id, body) => auth('post', `/api/orders/${id}/settle-ar`, superTok).send(body);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'arSuper', role: 'superadmin' });
  await makeUser({ name: 'arStaff', role: 'staff' });
  superTok = await loginStaff(app, 'arSuper');
  staffTok = await loginStaff(app, 'arStaff');

  await mongoose.model('Category').create({ name: 'ARCat', department: 'Kitchen' });
  prod = await mongoose.model('Product').create({ name: 'Widget', category: 'ARCat', basePrice: 100 });

  const res = await auth('post', '/api/client-accounts', superTok).send({
    username: 'partialco', password: 'secret123', name: 'Partial Co', paymentMethod: 'On Account',
  });
  expect(res.status).toBe(200);
  client = res.body.client;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('partial A/R settlement', () => {
  const Order = () => mongoose.model('Order');

  it('paying 1500 against a 1700 invoice leaves 200 outstanding, not zero', async () => {
    const id = await receivable(1700);

    const res = await settle(id, { amount: 1500, paymentMethod: 'Cash on Hand' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fullySettled).toBe(false);
    expect(res.body.balance).toBe(200);

    const o = await Order().findById(id).lean();
    expect(o.arSettled).toBe(false);          // the invoice is NOT closed
    expect(o.arPaidAmount).toBe(1500);
    expect(o.total).toBe(1700);               // face value never changes
    expect(o.arPayments).toHaveLength(1);
  });

  it('the remaining 200 still shows as outstanding A/R, at 200 and not 1700', async () => {
    const list = await auth('get', '/api/finance/ar-outstanding', superTok);
    expect(list.status).toBe(200);
    const row = list.body.orders.find(o => o.arPaidAmount === 1500);
    expect(row).toBeTruthy();
    expect(row.balance).toBe(200);
    expect(row.total).toBe(1700);             // face value kept for display
    // The headline total must count the remainder, not the original invoice.
    expect(list.body.totalOutstanding).toBe(200);
  });

  it('a second collection for the remainder closes the invoice', async () => {
    const o = await Order().findOne({ arPaidAmount: 1500 }).lean();
    const res = await settle(o._id, { amount: 200, paymentMethod: 'Bank Transfer' });
    expect(res.status).toBe(200);
    expect(res.body.fullySettled).toBe(true);
    expect(res.body.balance).toBe(0);

    const after = await Order().findById(o._id).lean();
    expect(after.arSettled).toBe(true);
    expect(after.arPaidAmount).toBe(1700);
    expect(after.arPayments).toHaveLength(2);
  });

  it('refuses a collection larger than what is left, quoting the remainder', async () => {
    const id = await receivable(1000);
    expect((await settle(id, { amount: 600, paymentMethod: 'Cash on Hand' })).status).toBe(200);

    const over = await settle(id, { amount: 500, paymentMethod: 'Cash on Hand' });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/400\.00 remaining/);

    // The rejected attempt must not have moved anything.
    const o = await Order().findById(id).lean();
    expect(o.arPaidAmount).toBe(600);
    expect(o.arPayments).toHaveLength(1);
  });

  it('records collection and deposit dates separately, and books the JE on the deposit date', async () => {
    const id = await receivable(500);
    const res = await settle(id, {
      amount: 500, paymentMethod: 'Bank Transfer',
      collectionDate: '2026-03-06', depositDate: '2026-03-09',
      collectedBy: 'Rider Joe', referenceNumber: 'BNK-77',
    });
    expect(res.status).toBe(200);

    const o = await Order().findById(id).lean();
    const p = o.arPayments[0];
    expect(new Date(p.collectionDate).toISOString().slice(0, 10)).toBe('2026-03-06');
    expect(new Date(p.depositDate).toISOString().slice(0, 10)).toBe('2026-03-09');
    expect(p.collectedBy).toBe('Rider Joe');
    expect(p.recordedBy).toBe('arSuper');

    // The ledger moves when the money is banked, not when it is collected.
    const je = await mongoose.model('JournalEntry').findOne({ reference: p.journalRef }).lean();
    expect(je).toBeTruthy();
    expect(new Date(je.date).toISOString().slice(0, 10)).toBe('2026-03-09');
    expect(je.totalDebit).toBe(500);
  });

  it('rejects a deposit date earlier than the collection date', async () => {
    const id = await receivable(300);
    const res = await settle(id, {
      amount: 300, paymentMethod: 'Cash on Hand',
      collectionDate: '2026-03-10', depositDate: '2026-03-08',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/earlier than the collection date/i);
  });

  it('each collection gets its own journal reference - no reuse across payments', async () => {
    const id = await receivable(900);
    await settle(id, { amount: 400, paymentMethod: 'Cash on Hand' });
    await settle(id, { amount: 500, paymentMethod: 'GCash' });

    const o = await Order().findById(id).lean();
    const refs = o.arPayments.map(p => p.journalRef);
    expect(new Set(refs).size).toBe(2);

    const entries = await mongoose.model('JournalEntry').find({ reference: { $in: refs } }).lean();
    expect(entries).toHaveLength(2);
    // Both legs together settle the invoice exactly once.
    expect(entries.reduce((s, e) => s + e.totalDebit, 0)).toBe(900);
  });

  it('the payment history reports a running balance per collection', async () => {
    const id = await receivable(1000);
    await settle(id, { amount: 250, paymentMethod: 'Cash on Hand', collectionDate: '2026-04-01' });
    await settle(id, { amount: 300, paymentMethod: 'GCash', collectionDate: '2026-04-05' });

    const res = await auth('get', `/api/orders/${id}/ar-payments`, superTok);
    expect(res.status).toBe(200);
    expect(res.body.totalPaid).toBe(550);
    expect(res.body.balance).toBe(450);
    expect(res.body.payments.map(p => p.balanceAfter)).toEqual([750, 450]);
  });

  it('a settled invoice cannot be collected against again', async () => {
    const id = await receivable(100);
    expect((await settle(id, { amount: 100, paymentMethod: 'Cash on Hand' })).status).toBe(200);
    const again = await settle(id, { amount: 50, paymentMethod: 'Cash on Hand' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already settled/i);
  });
});

describe('collection report', () => {
  it('reports collections on the collection-date basis and flags undeposited money', async () => {
    const res = await auth('get', '/api/reports/collections?start=2026-03-01&end=2026-03-07&basis=collection', superTok);
    expect(res.status).toBe(200);
    // The 2026-03-06 collection lands in the window; it was banked on 03-09,
    // i.e. after the window closed, so it is still "in transit" as of 03-07.
    const row = res.body.collections.find(r => r.referenceNumber === 'BNK-77');
    expect(row).toBeTruthy();
    expect(row.amount).toBe(500);
    expect(row.floatDays).toBe(3);
    expect(row.collectedBy).toBe('Rider Joe');
    expect(res.body.undepositedTotal).toBe(500);
  });

  it('the same collection moves to its deposit week on the deposit basis', async () => {
    const collected = await auth('get', '/api/reports/collections?start=2026-03-08&end=2026-03-14&basis=collection', superTok);
    expect(collected.body.collections.find(r => r.referenceNumber === 'BNK-77')).toBeFalsy();

    const deposited = await auth('get', '/api/reports/collections?start=2026-03-08&end=2026-03-14&basis=deposit', superTok);
    expect(deposited.body.collections.find(r => r.referenceNumber === 'BNK-77')).toBeTruthy();
    // Already banked within the window, so nothing is in transit on this basis.
    expect(deposited.body.undepositedTotal).toBe(0);
  });
});

describe('A/R aging report', () => {
  it('ages a partly paid invoice on its remaining balance, not its face value', async () => {
    const res = await auth('get', '/api/reports/ar-aging', superTok);
    expect(res.status).toBe(200);

    const inv = res.body.invoices.find(i => i.faceTotal === 1000 && i.paid === 600);
    expect(inv).toBeTruthy();
    expect(inv.balance).toBe(400);

    // Fully settled invoices are off the schedule entirely.
    expect(res.body.invoices.some(i => i.faceTotal === 1700)).toBe(false);
    // Every line's balance rolls into the client subtotal and the grand total.
    const sum = res.body.invoices.reduce((s, i) => s + i.balance, 0);
    expect(res.body.totals.total).toBeCloseTo(Math.round(sum * 100) / 100, 2);
  });

  it('excludes collections banked after the asOf date, so an old report still reproduces', async () => {
    // Collected and banked a week out. As of today that money has not landed,
    // so the receivable must still read at full value - re-running a past
    // report must not be restated by collections that happened afterwards.
    const id = await receivable(777);
    // Local-clock date strings: the report parses days on the server's own
    // wall clock (lib/reportRange.js), and toISOString() is UTC - east of
    // Greenwich that silently lands on the previous day.
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const future = (days) => ymd(new Date(Date.now() + days * 86400000));
    const res = await settle(id, {
      amount: 777, paymentMethod: 'Bank Transfer',
      collectionDate: future(5), depositDate: future(7),
    });
    expect(res.status).toBe(200);

    // The order itself is closed - the collection covered the full invoice.
    expect((await mongoose.model('Order').findById(id).lean()).arSettled).toBe(true);

    // The aging report is an AS-OF view, and as of today the money has not
    // reached the bank, so it correctly still shows the full balance.
    // (Contrast with /api/finance/ar-outstanding, the live worklist, which
    // goes by arSettled and drops it immediately.)
    const live = await auth('get', '/api/finance/ar-outstanding', superTok);
    expect(live.body.orders.some(o => String(o._id) === String(id))).toBe(false);
    const asOfToday = await auth('get', `/api/reports/ar-aging?asOf=${ymd(new Date())}`, superTok);
    const inv = asOfToday.body.invoices.find(i => i.faceTotal === 777);
    expect(inv).toBeTruthy();
    expect(inv.paid).toBe(0);
    expect(inv.balance).toBe(777);
  });
});
