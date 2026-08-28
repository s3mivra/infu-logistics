// Check collections and the check register.
//
// A check is a PROMISE of money. Two things follow, and both are tested here:
//
//   1. Receiving one must not pretend the bank moved. It is booked to Checks
//      on Hand (115000), not cash, and only reaches a bank account when it
//      clears.
//   2. A bounced check must REVERSE the collection. If it does not, a bounced
//      check silently forgives the debt: the money is gone and the books say
//      the client paid. That is the same class of bug as the partial-payment
//      one - money vanishing because a status flag was set too eagerly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, prod, client;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const Order = () => mongoose.model('Order');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

// Take in one check and hand back the register row for it.
async function payByCheck(orderId, amount, extra = {}) {
  const res = await settle(orderId, { amount, paymentMethod: 'Check', ...extra });
  expect(res.status).toBe(200);
  const reg = await auth('get', '/api/collections/checks', superTok);
  const row = reg.body.checks.find(c => c.checkNumber === extra.checkNumber);
  expect(row).toBeTruthy();
  return row;
}

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'chkSuper', role: 'superadmin' });
  await makeUser({ name: 'chkStaff', role: 'staff' });
  superTok = await loginStaff(app, 'chkSuper');
  staffTok = await loginStaff(app, 'chkStaff');

  await mongoose.model('Category').create({ name: 'ChkCat', department: 'Kitchen' });
  prod = await mongoose.model('Product').create({ name: 'Widget', category: 'ChkCat', basePrice: 100 });

  const res = await auth('post', '/api/client-accounts', superTok).send({
    username: 'checkco', password: 'secret123', name: 'Check Co', paymentMethod: 'On Account',
  });
  expect(res.status).toBe(200);
  client = res.body.client;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('receiving a check', () => {
  it('requires a check number', async () => {
    const id = await receivable(1000);
    const res = await settle(id, { amount: 1000, paymentMethod: 'Check' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check number is required/i);

    // Nothing was posted for the rejected attempt.
    const o = await Order().findById(id).lean();
    expect(o.arPaidAmount).toBe(0);
  });

  it('books to Checks on Hand, not to a bank account', async () => {
    const id = await receivable(1000);
    const res = await settle(id, { amount: 1000, paymentMethod: 'Check', checkNumber: 'CHK-001', checkBank: 'BPI' });
    expect(res.status).toBe(200);

    const o = await Order().findById(id).lean();
    const je = await mongoose.model('JournalEntry').findOne({ reference: o.arPayments[0].journalRef }).lean();
    const debit = je.lines.find(l => l.debit > 0);
    // 115000 Checks on Hand - NOT 112000 Cash in Bank. The bank has not moved.
    expect(debit.accountCode).toBe('115000');
    expect(debit.debit).toBe(1000);
    expect(je.lines.find(l => l.credit > 0).accountCode).toBe('120000');
  });

  it('leaves the deposit date empty - the money has not reached an account yet', async () => {
    const o = await Order().findOne({ 'arPayments.checkNumber': 'CHK-001' }).lean();
    const p = o.arPayments[0];
    expect(p.depositDate).toBeFalsy();
    expect(p.checkStatus).toBe('On Hand');
    expect(p.checkBank).toBe('BPI');
  });

  it('refuses the same check number twice - almost always a double entry', async () => {
    const id = await receivable(500);
    const dupe = await settle(id, { amount: 500, paymentMethod: 'Check', checkNumber: 'CHK-001', checkBank: 'BPI' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toMatch(/already recorded/i);
  });

  it('a check still settles the receivable it was collected against', async () => {
    const o = await Order().findOne({ 'arPayments.checkNumber': 'CHK-001' }).lean();
    expect(o.arPaidAmount).toBe(1000);
    expect(o.arSettled).toBe(true);
  });
});

describe('the check register', () => {
  it('flags a post-dated check as not yet depositable', async () => {
    const id = await receivable(2000);
    const future = ymd(new Date(Date.now() + 20 * 86400000));
    const row = await payByCheck(id, 2000, { checkNumber: 'CHK-PD-1', checkDate: future, checkBank: 'BDO' });
    expect(row.postDated).toBe(true);
    expect(row.status).toBe('On Hand');

    // Presenting it early is exactly what bounces a post-dated check.
    const early = await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/deposit`, superTok).send({});
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/cannot be deposited before/i);
  });

  it('separates money in the drawer from money ready to bank', async () => {
    const reg = await auth('get', '/api/collections/checks', superTok);
    expect(reg.status).toBe(200);
    // CHK-001 (dateless, so depositable now) and CHK-PD-1 (post-dated).
    expect(reg.body.summary.postDatedTotal).toBe(2000);
    expect(reg.body.summary.readyToDepositTotal).toBe(1000);
    expect(reg.body.summary.onHandTotal).toBe(3000);
  });

  it('depositing is a status step only - no account has moved yet', async () => {
    const reg = await auth('get', '/api/collections/checks?status=On Hand', superTok);
    const row = reg.body.checks.find(c => c.checkNumber === 'CHK-001');

    const before = await mongoose.model('JournalEntry').countDocuments();
    const dep = await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/deposit`, superTok).send({});
    expect(dep.status).toBe(200);
    expect(await mongoose.model('JournalEntry').countDocuments()).toBe(before);

    const o = await Order().findById(row.orderId).lean();
    const p = o.arPayments.find(x => x.checkNumber === 'CHK-001');
    expect(p.checkStatus).toBe('Deposited');
    // Depositing is where the collection finally gets its deposit date.
    expect(p.depositDate).toBeTruthy();
  });

  it('clearing moves the money out of Checks on Hand into the bank', async () => {
    const reg = await auth('get', '/api/collections/checks?status=Deposited', superTok);
    const row = reg.body.checks.find(c => c.checkNumber === 'CHK-001');

    const res = await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/clear`, superTok).send({});
    expect(res.status).toBe(200);

    const je = await mongoose.model('JournalEntry').findOne({ description: /CHK-001 cleared/ }).lean();
    expect(je).toBeTruthy();
    expect(je.lines.find(l => l.credit > 0).accountCode).toBe('115000');
    expect(je.lines.find(l => l.debit > 0).debit).toBe(1000);

    const o = await Order().findById(row.orderId).lean();
    expect(o.arPayments.find(x => x.checkNumber === 'CHK-001').checkStatus).toBe('Cleared');
  });

  it('a cleared check cannot be cleared again', async () => {
    const reg = await auth('get', '/api/collections/checks?status=Cleared', superTok);
    const row = reg.body.checks.find(c => c.checkNumber === 'CHK-001');
    const again = await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/clear`, superTok).send({});
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already Cleared/i);
  });
});

describe('a bounced check reverses the collection', () => {
  it('reopens the receivable for the full amount', async () => {
    const id = await receivable(1700);
    const row = await payByCheck(id, 1700, { checkNumber: 'CHK-BAD-1', checkBank: 'BPI' });

    // Settled on the strength of the check...
    expect((await Order().findById(id).lean()).arSettled).toBe(true);

    const res = await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/bounce`, superTok)
      .send({ reason: 'DAIF - drawn against insufficient funds' });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.balance).toBe(1700);

    // ...and un-settled when it bounced. The client owes it again.
    const o = await Order().findById(id).lean();
    expect(o.arSettled).toBe(false);
    expect(o.arPaidAmount).toBe(0);
    const p = o.arPayments.find(x => x.checkNumber === 'CHK-BAD-1');
    expect(p.checkStatus).toBe('Bounced');
    expect(p.checkBounceReason).toMatch(/DAIF/);
  });

  it('posts a reversing entry that puts the debt back into A/R', async () => {
    const je = await mongoose.model('JournalEntry').findOne({ description: /CHK-BAD-1 BOUNCED/ }).lean();
    expect(je).toBeTruthy();
    // DR A/R (they owe it again) / CR Checks on Hand (the asset was never real).
    expect(je.lines.find(l => l.debit > 0).accountCode).toBe('120000');
    expect(je.lines.find(l => l.credit > 0).accountCode).toBe('115000');
    expect(je.totalDebit).toBe(1700);
  });

  it('the reopened invoice is back in the outstanding A/R list at full value', async () => {
    const list = await auth('get', '/api/finance/ar-outstanding', superTok);
    const row = list.body.orders.find(o => o.total === 1700);
    expect(row).toBeTruthy();
    expect(row.balance).toBe(1700);
    expect(row.paid).toBe(0);
  });

  it('a check that bounces AFTER clearing takes the money back out of the bank', async () => {
    const id = await receivable(800);
    const row = await payByCheck(id, 800, { checkNumber: 'CHK-LATE-1', checkBank: 'BDO' });
    await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/clear`, superTok).send({});

    const res = await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/bounce`, superTok)
      .send({ reason: 'Bank reversed it' });
    expect(res.status).toBe(200);

    const je = await mongoose.model('JournalEntry').findOne({ description: /CHK-LATE-1 BOUNCED/ }).lean();
    // The money already left Checks on Hand when it cleared, so the reversal
    // has to come out of the account it landed in, not out of 115000.
    expect(je.lines.find(l => l.credit > 0).accountCode).not.toBe('115000');
    expect((await Order().findById(id).lean()).arSettled).toBe(false);
  });

  it('a bounced check frees its number so a replacement can be recorded', async () => {
    const bounced = await Order().findOne({ 'arPayments.checkNumber': 'CHK-BAD-1' }).lean();
    const replace = await settle(bounced._id, {
      amount: 1700, paymentMethod: 'Check', checkNumber: 'CHK-BAD-1', checkBank: 'BPI',
    });
    expect(replace.status).toBe(200);

    const o = await Order().findById(bounced._id).lean();
    expect(o.arSettled).toBe(true);
    expect(o.arPayments).toHaveLength(2);
  });

  it('partial payment and a bounce compose correctly', async () => {
    const id = await receivable(1000);
    await settle(id, { amount: 400, paymentMethod: 'Cash on Hand' });
    const row = await payByCheck(id, 600, { checkNumber: 'CHK-MIX-1' });

    // 400 cash + 600 check = settled.
    expect((await Order().findById(id).lean()).arSettled).toBe(true);

    await auth('post', `/api/collections/checks/${row.orderId}/${row.paymentId}/bounce`, superTok).send({ reason: 'DAIF' });

    // Only the check comes back off - the 400 cash stands.
    const o = await Order().findById(id).lean();
    expect(o.arPaidAmount).toBe(400);
    expect(o.arSettled).toBe(false);
  });
});
