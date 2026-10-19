// Budgets: set per account per month, compared with the ledger in Budget vs
// Actual, and checked when a requisition is filed - an over-budget slip is
// approved only with a reason.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, fundId;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const now = new Date();
const YEAR = now.getFullYear(), MONTH = now.getMonth() + 1;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'bgBoss', role: 'superadmin' });
  await makeUser({ name: 'bgCashier', role: 'cashier' });
  tok.boss = await loginStaff(app, 'bgBoss');
  tok.cashier = await loginStaff(app, 'bgCashier');
  const f = await as(tok.boss, 'post', '/api/revolving-funds').send({ name: 'Office Fund', initialAmount: 5000 });
  fundId = f.body.fund._id;
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('budgets', () => {
  it('sets a budget and refuses nonsense', async () => {
    const bad = await as(tok.boss, 'put', '/api/budgets').send({ year: YEAR, rows: [{ accountCode: '999999', month: MONTH, amount: 10 }, { accountCode: '650000', month: 13, amount: 10 }, { accountCode: '650000', month: 1, amount: -5 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.problems).toHaveLength(3);
    expect((await as(tok.cashier, 'put', '/api/budgets').send({ year: YEAR, rows: [{ accountCode: '650000', month: MONTH, amount: 1000 }] })).status).toBe(403);
    const ok = await as(tok.boss, 'put', '/api/budgets').send({ year: YEAR, rows: [
      { accountCode: '650000', month: MONTH, amount: 1000 },
      { accountCode: '410000', month: MONTH, amount: 50000 },
    ] });
    expect(ok.body).toMatchObject({ success: true, saved: 2 });
  });

  it('Budget vs Actual reads the actual side from the ledger', async () => {
    const exp = await as(tok.boss, 'post', '/api/expenses').send({ amount: 700, categoryCode: '650000', paymentMethod: 'Cash', description: 'Printer paper' });
    expect(exp.body.success, JSON.stringify(exp.body)).toBe(true);
    const r = await as(tok.boss, 'get', `/api/reports/budget-vs-actual?year=${YEAR}&fromMonth=${MONTH}`);
    expect(r.status).toBe(200);
    const supplies = r.body.rows.find(x => x.accountCode === '650000');
    expect(supplies).toMatchObject({ budget: 1000, actual: 700, variance: -300, favourable: true, over: false });
    expect(r.body.rows.find(x => x.accountCode === '410000')).toMatchObject({ budget: 50000, type: 'revenue' });
  });

  it('a requisition over what is left is held until an approver accepts it with a reason', async () => {
    const slip = await as(tok.boss, 'post', '/api/requisition-slips').send({ type: 'petty-cash', fundId, amount: 500, description: 'Toner', categoryCode: '650000' });
    expect(slip.body.slip.budgetCheck[0]).toMatchObject({ accountCode: '650000', budget: 1000, spent: 700, available: 300, over: true });
    const plain = await as(tok.boss, 'post', `/api/requisition-slips/${slip.body.slip._id}/approve`).send({});
    expect(plain.status).toBe(409);
    expect(plain.body.overBudget).toBe(true);
    const ok = await as(tok.boss, 'post', `/api/requisition-slips/${slip.body.slip._id}/approve`).send({ acceptOverBudget: true, overBudgetReason: 'Printer broke - urgent' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const saved = await mongoose.model('RequisitionSlip').findById(slip.body.slip._id).lean();
    expect(saved).toMatchObject({ status: 'Approved', overBudgetAcceptedBy: 'bgBoss', overBudgetReason: 'Printer broke - urgent' });
  });

  it('a slip within budget, or with no budget, is not held up', async () => {
    const slip = await as(tok.boss, 'post', '/api/requisition-slips').send({ type: 'petty-cash', fundId, amount: 100, description: 'Stamps', categoryCode: '760000' });
    expect(slip.body.slip.budgetCheck[0]).toMatchObject({ hasBudget: false, over: false });
    expect((await as(tok.boss, 'post', `/api/requisition-slips/${slip.body.slip._id}/approve`).send({})).status).toBe(200);
  });
});
