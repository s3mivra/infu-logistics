// Advances: money that moves BEFORE the transaction it belongs to exists.
//   employee  cash to staff        DR 170100 / CR cash    (asset)
//   supplier  prepayment on order  DR 170200 / CR cash    (asset)
//   customer  deposit received     DR cash   / CR 260200  (liability)
// Each is cleared ("liquidated") in parts against whatever it was actually
// for, and the derived status walks Open -> Partially Liquidated -> Liquidated.
// Cash-out advances issue a Check Voucher; a customer deposit does not,
// because nothing was disbursed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'AdvSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'AdvSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const issue = (body) => auth('post', '/api/advances', superTok).send(body);

// Pull the journal entry a route just wrote, so the accounting can be asserted
// rather than assumed from the HTTP response.
async function jeFor(reference) {
  return mongoose.model('JournalEntry').findOne({ reference }).lean();
}
const lineFor = (je, code) => je.lines.find(l => l.accountCode === code);
const balances = (je) => expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);

describe('issuing an advance', () => {
  it('pays cash out for an employee advance and issues a Check Voucher', async () => {
    const res = await issue({ type: 'employee', payeeName: 'Rider Joel', amount: 5000, purpose: 'Fuel float', sourceAccount: '111000', referenceNumber: 'OR-9001' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.advance.status).toBe('Open');
    expect(res.body.advance.outstanding).toBe(5000);
    expect(res.body.voucher).toBeTruthy();

    const je = await jeFor(res.body.advance.journalEntryRef);
    expect(lineFor(je, '170100').debit).toBe(5000);
    expect(lineFor(je, '111000').credit).toBe(5000);
    balances(je);
    // The real-world reference must survive onto the ledger narrative.
    expect(je.description).toMatch(/OR-9001/);
  });

  it('books a customer deposit as a liability and issues NO voucher', async () => {
    const res = await issue({ type: 'customer', payeeName: 'Acme Corp', amount: 2000, purpose: 'Downpayment' });
    expect(res.status).toBe(200);
    expect(res.body.voucher).toBeNull();

    const je = await jeFor(res.body.advance.journalEntryRef);
    expect(lineFor(je, '111000').debit).toBe(2000);   // cash came IN
    expect(lineFor(je, '260200').credit).toBe(2000);  // we now owe them
    balances(je);
  });

  it('books a supplier prepayment against 170200, separate from overpayment credit', async () => {
    const res = await issue({ type: 'supplier', payeeName: 'Metro Fuel', amount: 3000 });
    const je = await jeFor(res.body.advance.journalEntryRef);
    expect(lineFor(je, '170200').debit).toBe(3000);
    expect(lineFor(je, '160100')).toBeUndefined(); // NOT the overpayment account
  });

  it('rejects a bad type, a missing payee, and a non-positive amount', async () => {
    expect((await issue({ type: 'vendor', payeeName: 'X', amount: 10 })).status).toBe(400);
    expect((await issue({ type: 'employee', payeeName: '  ', amount: 10 })).status).toBe(400);
    expect((await issue({ type: 'employee', payeeName: 'X', amount: 0 })).status).toBe(400);
  });

  it('falls back to Cash on Hand when the source account is not a cash account', async () => {
    const res = await issue({ type: 'employee', payeeName: 'Rider Ana', amount: 100, sourceAccount: '610000' });
    expect(res.body.advance.sourceAccount).toBe('111000');
  });
});

describe('liquidating an advance', () => {
  it('clears part against an expense, then the rest by cash return', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Ben', amount: 5000, sourceAccount: '111000' });

    const part = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'expense', amount: 3200, expenseAccount: '610000', note: 'Fuel receipts', referenceNumber: 'RCPT-77' });
    expect(part.status).toBe(200);
    expect(part.body.advance.status).toBe('Partially Liquidated');
    expect(part.body.advance.outstanding).toBe(1800);

    const je = await jeFor(part.body.advance.liquidations[0].journalRef);
    expect(lineFor(je, '610000').debit).toBe(3200);  // expense recognised
    expect(lineFor(je, '170100').credit).toBe(3200); // advance shrinks
    balances(je);
    expect(je.description).toMatch(/RCPT-77/);
    expect(je.description).toMatch(/Fuel receipts/);

    const rest = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'cash-return', returnToAccount: '111000' }); // amount omitted = remainder
    expect(rest.body.advance.status).toBe('Liquidated');
    expect(rest.body.advance.outstanding).toBe(0);

    const je2 = await jeFor(rest.body.advance.liquidations[1].journalRef);
    expect(lineFor(je2, '111000').debit).toBe(1800); // cash back in
    expect(lineFor(je2, '170100').credit).toBe(1800);
  });

  it('applies a customer deposit against a receivable', async () => {
    const Order = mongoose.model('Order');
    const order = await Order.create({
      orderNumber: `ADV-${Math.random().toString(36).slice(2, 8)}`,
      status: 'Completed', total: 2000, subtotal: 2000, paymentMethod: 'Bank Transfer',
    });
    const { body: { advance } } = await issue({ type: 'customer', payeeName: 'Acme Corp', amount: 2000 });

    const res = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'order', orderId: String(order._id) });
    expect(res.status).toBe(200);
    expect(res.body.advance.status).toBe('Liquidated');

    const je = await jeFor(res.body.advance.liquidations[0].journalRef);
    // Liability discharged, receivable relieved.
    expect(lineFor(je, '260200').debit).toBe(2000);
    expect(lineFor(je, '120000').credit).toBe(2000);
    balances(je);
  });

  it('refuses to liquidate more than is left', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Cy', amount: 500 });
    const res = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'expense', amount: 900, expenseAccount: '610000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
  });

  it('refuses a method that does not apply to the advance type', async () => {
    const { body: { advance } } = await issue({ type: 'customer', payeeName: 'Acme', amount: 100 });
    // 'expense' is meaningless for a deposit we received.
    const res = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'expense', amount: 50, expenseAccount: '610000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be one of/i);
  });

  it('rejects an expense liquidation pointed at a non-expense account', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Di', amount: 100 });
    const res = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'expense', amount: 50, expenseAccount: '111000' });
    expect(res.status).toBe(400);
  });

  it('cannot liquidate an already fully liquidated advance', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Ed', amount: 100 });
    await auth('post', `/api/advances/${advance._id}/liquidate`, superTok).send({ method: 'cash-return' });
    const again = await auth('post', `/api/advances/${advance._id}/liquidate`, superTok).send({ method: 'cash-return', amount: 10 });
    expect(again.status).toBe(409);
  });
});

describe('cancelling an advance', () => {
  it('reverses the original entry and requires a reason', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Fay', amount: 700, sourceAccount: '111000' });

    const noReason = await auth('post', `/api/advances/${advance._id}/cancel`, superTok).send({});
    expect(noReason.status).toBe(400);

    const res = await auth('post', `/api/advances/${advance._id}/cancel`, superTok).send({ reason: 'Issued twice by mistake' });
    expect(res.status).toBe(200);
    expect(res.body.advance.status).toBe('Cancelled');

    // The reversal is the exact mirror of the issue entry.
    const je = await mongoose.model('JournalEntry').findOne({ description: new RegExp(`Cancellation of advance ${advance.advanceNumber}`) }).lean();
    expect(lineFor(je, '111000').debit).toBe(700);
    expect(lineFor(je, '170100').credit).toBe(700);
    balances(je);
  });

  it('refuses to cancel once part of it has been liquidated', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Gil', amount: 1000 });
    await auth('post', `/api/advances/${advance._id}/liquidate`, superTok)
      .send({ method: 'expense', amount: 400, expenseAccount: '610000' });

    const res = await auth('post', `/api/advances/${advance._id}/cancel`, superTok).send({ reason: 'changed mind' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cash return/i);
  });

  it('cannot cancel twice', async () => {
    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Hal', amount: 100 });
    await auth('post', `/api/advances/${advance._id}/cancel`, superTok).send({ reason: 'first' });
    const again = await auth('post', `/api/advances/${advance._id}/cancel`, superTok).send({ reason: 'second' });
    expect(again.status).toBe(409);
  });
});

describe('listing advances', () => {
  it('totals only live advances and excludes cancelled ones from outstanding', async () => {
    const before = await auth('get', '/api/advances', superTok);
    const baseOutstanding = before.body.totalOutstanding;

    const { body: { advance } } = await issue({ type: 'employee', payeeName: 'Rider Ivy', amount: 250 });
    const mid = await auth('get', '/api/advances', superTok);
    expect(mid.body.totalOutstanding).toBeCloseTo(baseOutstanding + 250, 2);

    await auth('post', `/api/advances/${advance._id}/cancel`, superTok).send({ reason: 'void' });
    const after = await auth('get', '/api/advances', superTok);
    expect(after.body.totalOutstanding).toBeCloseTo(baseOutstanding, 2);
  });

  it('filters by type', async () => {
    const res = await auth('get', '/api/advances?type=customer', superTok);
    expect(res.status).toBe(200);
    expect(res.body.advances.every(a => a.type === 'customer')).toBe(true);
  });
});
