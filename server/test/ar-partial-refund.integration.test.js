// What a client still owes after part of a credit sale is refunded.
//
// A partial refund on an on-account sale credits Accounts Receivable in the
// ledger - the debt really is smaller. But the order keeps its face `total`,
// and every A/R view derives the balance as total less what has been collected.
// So the ledger said one thing and the ageing, the credit limit, the collections
// worklist and the client's own statement all said another: the client was
// chased for money that had already been credited back to them.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { businessDateStr } from '../lib/businessTime.js';

let ctx, app, tok, client, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const r2 = (n) => Math.round(n * 100) / 100;

const movement = async (code) => {
  const entries = await M('JournalEntry').find({ 'lines.accountCode': code }).lean();
  return r2(entries.reduce((sum, je) => sum + je.lines
    .filter(l => l.accountCode === code)
    .reduce((t, l) => t + (l.debit || 0) - (l.credit || 0), 0), 0));
};

// A completed credit sale of 10 widgets at ₱100.
const creditSale = async () => {
  const res = await auth('post', '/api/orders').send({
    table: 'Delivery', paymentMethod: 'Credit', clientAccountId: String(client._id),
    customerName: client.name,
    items: [{ productId: String(product._id), name: 'Widget', price: 100, quantity: 10 }],
  });
  const id = res.body.order._id;
  await auth('put', `/api/orders/${id}`).send({ status: 'Completed' });
  return id;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ArSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ArSuper');
  await M('Category').create({ name: 'Goods' });
  product = await M('Product').create({ name: 'Widget', category: 'Goods', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([M('Order').deleteMany({}), M('JournalEntry').deleteMany({}), M('ClientAccount').deleteMany({})]);
  client = await M('ClientAccount').create({
    username: `ar-${Date.now()}`, password: 'x', name: 'Northwind Trading', paymentMethod: 'Credit',
  });
});

describe('a credit sale with part of it refunded', () => {
  it('reduces the receivable in the ledger', async () => {
    const id = await creditSale();
    expect(await movement('120000')).toBe(1000);

    const res = await auth('post', `/api/orders/${id}/partial-refund`).send({
      items: [{ itemIndex: 0, qty: 3 }], reason: 'Three arrived damaged', inventoryAction: 'None',
    });
    expect(res.body.success).toBe(true);
    expect(await movement('120000')).toBe(700);   // ₱300 credited back
  });

  it('shows the same ₱700 on the client summary, not the full invoice', async () => {
    const id = await creditSale();
    await auth('post', `/api/orders/${id}/partial-refund`).send({
      items: [{ itemIndex: 0, qty: 3 }], reason: 'Three arrived damaged', inventoryAction: 'None',
    });

    const res = await auth('get', '/api/clients/summary');
    const row = res.body.clients.find(c => c._id === String(client._id));
    expect(row.aged.total).toBeCloseTo(700, 2);
    expect(row.exposure).toBeCloseTo(700, 2);
  });

  it('charges the statement of account only what is still owed', async () => {
    const id = await creditSale();
    await auth('post', `/api/orders/${id}/partial-refund`).send({
      items: [{ itemIndex: 0, qty: 3 }], reason: 'Three arrived damaged', inventoryAction: 'None',
    });

    // The business's own date, which is what the statement's range is cut in.
    // `toISOString()` would name yesterday until 8am Manila time.
    const day = businessDateStr();
    const soa = await auth('get', `/api/clients/${client._id}/statement?start=${day}&end=${day}`);
    expect(soa.body.closingBalance).toBeCloseTo(700, 2);
    expect(soa.body.aged.total).toBeCloseTo(700, 2);
  });

  it('counts a payment against what is left, and settles at the reduced amount', async () => {
    const id = await creditSale();
    await auth('post', `/api/orders/${id}/partial-refund`).send({
      items: [{ itemIndex: 0, qty: 3 }], reason: 'Three arrived damaged', inventoryAction: 'None',
    });
    // The client pays the ₱700 they actually owe.
    const paid = await auth('post', `/api/orders/${id}/settle-ar`)
      .send({ amount: 700, paymentMethod: 'Cash', referenceNumber: 'RCPT-9' });
    expect(paid.body.success).toBe(true);

    const fresh = await M('Order').findById(id).lean();
    expect(fresh.arSettled).toBe(true);           // nothing left outstanding
    expect(await movement('120000')).toBe(0);     // and the ledger agrees
  });
});

// Orders refunded before the field existed carry the credit only in their
// history, so the boot backfill reconstructs it - otherwise an upgrade leaves
// every already-refunded client still being chased for the full invoice.
describe('the one-time backfill for older refunds', () => {
  it('reconstructs what was credited, and skips exchanges', async () => {
    const legacy = await M('Order').create({
      orderNumber: 'ORD-LEGACY-1', status: 'Completed', paymentMethod: 'Credit',
      clientAccountId: String(client._id), customerName: client.name,
      total: 1000, subtotal: 1000, arPaidAmount: 0,
      items: [{ productId: String(product._id), name: 'Widget', price: 100, quantity: 10 }],
      refundHistory: [
        { reference: 'PARTIAL-REFUND-1', amount: 300, reason: 'Damaged' },
        // An exchange already moved the order's own total, so counting it here
        // as well would credit the same goods twice.
        { reference: 'EXCHANGE-1', amount: 150, reason: 'EXCHANGE: swapped size' },
      ],
    });
    await M('Order').collection.updateOne(
      { _id: legacy._id }, { $unset: { refundedAmount: '' } });

    await ctx.runStartupTasks();

    const healed = await M('Order').findById(legacy._id).lean();
    expect(healed.refundedAmount).toBeCloseTo(300, 2);
  });

  it('leaves an order that was never refunded alone', async () => {
    const id = await creditSale();
    await ctx.runStartupTasks();
    expect((await M('Order').findById(id).lean()).refundedAmount).toBe(0);
  });
});

// The books-health tie-out compares the A/R subledger against the ledger. It
// builds its own subledger figure, so it needed the same correction - otherwise
// it reports a divergence that does not exist and trains people to ignore it.
describe('the books-health receivables tie-out', () => {
  it('still ties after a partial refund', async () => {
    const id = await creditSale();
    await auth('post', `/api/orders/${id}/partial-refund`).send({
      items: [{ itemIndex: 0, qty: 3 }], reason: 'Three arrived damaged', inventoryAction: 'None',
    });

    const res = await auth('get', '/api/reports/books-health');
    const ar = res.body.checks.find(c => c.key === 'ar');
    expect(ar.ok).toBe(true);
    expect(ar.difference).toBeCloseTo(0, 2);
    expect(ar.documents).toBeCloseTo(700, 2);   // what the invoices say is owed
    expect(ar.ledger).toBeCloseTo(700, 2);      // and what the ledger holds
  });
});
