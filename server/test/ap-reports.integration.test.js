// A/P reporting - the mirror of the A/R and collection reports.
//
// The design point worth locking down: A/P ages on the DUE date, not the bill
// date. Nobody cares how long ago a bill was raised; what matters is how far
// past its payment date it is, because that is what damages a supplier
// relationship. Ageing payables the way receivables are aged would call a
// brand-new bill on 60-day terms "current" and a 40-day-old bill on 7-day
// terms "current" too, when only one of them is late.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, supplier;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const Bill = () => mongoose.model('Bill');
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysAhead = (n) => new Date(Date.now() + n * 86400000);

// A bill straight into the collection - the approval workflow is covered by
// bills.integration.test.js; this is about how they AGE.
const bill = (over = {}) => Bill().create({
  businessType: 'log',
  billNumber: `BILL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  supplierId: supplier._id,
  supplierName: supplier.name,
  source: 'Manual',
  description: 'Test bill',
  amount: 1000,
  status: 'Approved',
  ...over,
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'apSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'apSuper');
  supplier = await mongoose.model('Supplier').create({ businessType: 'log', name: 'Best Beans' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('A/P aging report', () => {
  it('ages on the due date, not the bill date', async () => {
    // Raised long ago but not due for another month: NOT overdue.
    await bill({ amount: 500, createdAt: daysAgo(90), dueDate: daysAhead(30) });
    // Raised yesterday but already past due: overdue by 40 days.
    await bill({ amount: 700, createdAt: daysAgo(1), dueDate: daysAgo(40) });

    const res = await auth('get', '/api/reports/ap-aging', superTok);
    expect(res.status).toBe(200);

    const early = res.body.bills.find(b => b.amount === 500);
    const late = res.body.bills.find(b => b.amount === 700);
    expect(early.overdue).toBe(false);
    expect(early.bucket).toBe('current');
    expect(late.overdue).toBe(true);
    expect(late.bucket).toBe('d31_60');       // 40 days past due
    expect(res.body.overdueTotal).toBe(700);
  });

  it('reports an undated bill as undated, not as current or ancient', async () => {
    // A bill with no due date has nothing to be late against. Calling it
    // "current" would understate what is overdue; calling it 90+ would invent
    // a crisis that doesn't exist.
    await bill({ amount: 250, dueDate: null, createdAt: daysAgo(200) });

    const res = await auth('get', '/api/reports/ap-aging', superTok);
    const row = res.body.bills.find(b => b.amount === 250);
    expect(row.bucket).toBe('undated');
    expect(row.overdue).toBe(false);
    expect(row.daysPastDue).toBeNull();
    expect(res.body.totals.undated).toBe(250);
  });

  it('sorts the most overdue to the top and sinks undated bills', async () => {
    const res = await auth('get', '/api/reports/ap-aging', superTok);
    const dated = res.body.bills.filter(b => b.daysPastDue !== null);
    // Descending days-past-due.
    for (let i = 1; i < dated.length; i++) {
      expect(dated[i - 1].daysPastDue).toBeGreaterThanOrEqual(dated[i].daysPastDue);
    }
    // Undated bills come last, never interleaved.
    const firstUndated = res.body.bills.findIndex(b => b.daysPastDue === null);
    if (firstUndated !== -1) {
      expect(res.body.bills.slice(firstUndated).every(b => b.daysPastDue === null)).toBe(true);
    }
  });

  it('counts an unapproved bill as a real debt, flagged as awaiting approval', async () => {
    // The supplier is owed the money whether or not we have authorised paying
    // it. A Pending bill that is already overdue is an approval problem.
    await bill({ amount: 333, status: 'Pending', dueDate: daysAgo(5) });

    const res = await auth('get', '/api/reports/ap-aging', superTok);
    const row = res.body.bills.find(b => b.amount === 333);
    expect(row.awaitingApproval).toBe(true);
    expect(row.overdue).toBe(true);
    expect(res.body.awaitingApprovalTotal).toBe(333);
  });

  it('excludes a rejected bill - it is not a debt', async () => {
    await bill({ amount: 999, status: 'Rejected', dueDate: daysAgo(10) });
    const res = await auth('get', '/api/reports/ap-aging', superTok);
    expect(res.body.bills.some(b => b.amount === 999)).toBe(false);
  });

  it('surfaces what falls due in the next week', async () => {
    await bill({ amount: 444, dueDate: daysAhead(3) });
    const res = await auth('get', '/api/reports/ap-aging', superTok);
    // An aged bucket alone never answers "do we have the cash this week".
    expect(res.body.dueSoonTotal).toBeGreaterThanOrEqual(444);
    expect(res.body.bills.find(b => b.amount === 444).overdue).toBe(false);
  });

  it('rolls every bill into its supplier subtotal and the grand total', async () => {
    const res = await auth('get', '/api/reports/ap-aging', superTok);
    const sum = res.body.bills.reduce((s, b) => s + b.amount, 0);
    expect(res.body.totals.total).toBeCloseTo(Math.round(sum * 100) / 100, 2);
    const bySupplier = res.body.bySupplier.reduce((s, g) => s + g.total, 0);
    expect(bySupplier).toBeCloseTo(res.body.totals.total, 2);
  });

  it('an asOf date treats a later payment as still outstanding', async () => {
    const b = await bill({ amount: 600, dueDate: daysAgo(20), createdAt: daysAgo(30) });
    await Bill().updateOne({ _id: b._id }, { $set: { status: 'Paid', paidAt: new Date() } });

    // Live: settled and gone.
    const now = await auth('get', '/api/reports/ap-aging', superTok);
    expect(now.body.bills.some(x => x.amount === 600)).toBe(false);

    // As of last week, that payment hadn't happened yet - so the debt stood.
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const past = await auth('get', `/api/reports/ap-aging?asOf=${ymd(daysAgo(7))}`, superTok);
    expect(past.body.bills.some(x => x.amount === 600)).toBe(true);
  });

  it('excludes bills raised after the asOf date', async () => {
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await auth('get', `/api/reports/ap-aging?asOf=${ymd(daysAgo(60))}`, superTok);
    // The bill raised yesterday cannot appear in a position dated two months back.
    expect(res.body.bills.some(b => b.amount === 700)).toBe(false);
  });
});

describe('supplier payments report', () => {
  it('reports what actually left the bank, and from which account', async () => {
    // Created already Approved - the approval workflow itself is covered by
    // bills.integration.test.js; this is about what the payment REPORTS.
    const b = await bill({ amount: 800, status: 'Approved', dueDate: daysAgo(2) });

    const paid = await auth('post', `/api/bills/${b._id}/pay`, superTok)
      .send({ payFromAccount: '111000', referenceNumber: 'PAY-1' });
    expect(paid.status).toBe(200);

    const res = await auth('get', '/api/reports/supplier-payments', superTok);
    expect(res.status).toBe(200);

    const row = res.body.payments.find(p => p.amount === 800);
    expect(row).toBeTruthy();
    expect(row.supplier).toBe('Best Beans');
    // Which pot the money came out of - the A/P debit's opposite leg.
    expect(row.paidFromCode).toBe('111000');
    expect(res.body.totalPaid).toBeGreaterThanOrEqual(800);
    expect(res.body.bySupplier.find(g => g.supplier === 'Best Beans').amount).toBeGreaterThanOrEqual(800);
  });

  it('excludes payments outside the range', async () => {
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await auth('get', `/api/reports/supplier-payments?start=${ymd(daysAgo(90))}&end=${ymd(daysAgo(60))}`, superTok);
    expect(res.body.payments.some(p => p.amount === 800)).toBe(false);
  });
});
