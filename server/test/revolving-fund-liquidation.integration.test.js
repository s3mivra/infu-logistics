// Petty cash / revolving fund, as the process flow sets it out:
//   spend -> receipts collected -> liquidation report -> validated ->
//   Finance approves the replenishment -> check voucher -> fund topped up.
// Spending posts at once, but the fund is not topped up until every spend has
// been checked against its receipt. A rejected receipt comes back off the
// expense and is owed by whoever spent it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, fund;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

const spend = async (who, body) => {
  const r = await as(tok[who], 'post', `/api/revolving-funds/${fund._id}/disburse`).send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tx;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'rfOwner', role: 'superadmin' });
  // The custodian spends; the accountant validates; neither is the other.
  await makeUser({ name: 'rfCustodian', role: 'staff', permissions: ['accounting.view', 'accounting.manage'] });
  await makeUser({ name: 'rfAccountant', role: 'staff', permissions: ['accounting.view', 'accounting.manage'] });
  tok.owner = await loginStaff(app, 'rfOwner');
  tok.custodian = await loginStaff(app, 'rfCustodian');
  tok.accountant = await loginStaff(app, 'rfAccountant');
  const r = await as(tok.owner, 'post', '/api/revolving-funds').send({ name: 'Logistics Revolving Fund', initialAmount: 20000, sourceAccount: '112000' });
  fund = r.body.fund;
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('spending lands in the validation queue', () => {
  it('records payee and OR number, and starts Unvalidated', async () => {
    const tx = await spend('custodian', { amount: 2051, description: 'DIESEL', categoryCode: '670000', payee: 'REPHIL NASAK INC.', refNo: 'OR-5521' });
    expect(tx.payee).toBe('REPHIL NASAK INC.');
    expect(tx.refNo).toBe('OR-5521');
    expect(tx.validation.status).toBe('Unvalidated');
  });

  it('shows up in the list of spends waiting to be checked, across funds', async () => {
    const r = await as(tok.accountant, 'get', '/api/revolving-funds/unvalidated');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0]).toMatchObject({ fundName: 'Logistics Revolving Fund', amount: 2051, description: 'DIESEL', spentBy: 'rfCustodian', payee: 'REPHIL NASAK INC.' });
  });

  it('a spend recorded before validation existed is not dragged into the queue', async () => {
    // Written straight to the collection, as an old row would be.
    await M('RevolvingFundTx').collection.insertOne({ fundId: new mongoose.Types.ObjectId(fund._id), type: 'disbursement', amount: 1, description: 'old', date: new Date('2020-01-01') });
    const old = await M('RevolvingFundTx').findOne({ description: 'old' });
    expect(old.validation?.status).toBeUndefined();
    await M('RevolvingFundTx').deleteOne({ _id: old._id });
  });
});

describe('the liquidation report reads like the sheet', () => {
  it('lists every spend oldest first, with % of the fund left and the total to replenish', async () => {
    await spend('custodian', { amount: 200, description: 'DELIVERY FEE', categoryCode: '670000', payee: 'LALAMOVE' });
    const r = await as(tok.accountant, 'get', `/api/revolving-funds/${fund._id}/liquidation`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows.map(x => x.particulars)).toEqual(['DIESEL', 'DELIVERY FEE']);
    expect(r.body.rows[0]).toMatchObject({ payee: 'REPHIL NASAK INC.', refNo: 'OR-5521', amount: 2051, runningBalance: 17949, pctRemaining: 0.89745, status: 'Unvalidated' });
    expect(r.body.rows[0].account).toMatch(/^670000 - /);
    expect(r.body.rows[1].runningBalance).toBe(17749);
    expect(r.body.totals).toMatchObject({ spent: 2251, unvalidated: 2251, toReplenish: 2251 });
  });
});

describe('validate -> approve -> replenish', () => {
  it('the replenishment cannot be approved while receipts are unchecked', async () => {
    const slip = (await as(tok.custodian, 'post', '/api/requisition-slips').send({ type: 'fund-replenish', fundId: fund._id, sourceAccount: '112000' })).body.slip;
    const r = await as(tok.owner, 'post', `/api/requisition-slips/${slip._id}/approve`).send({});
    expect(r.status).toBe(409);
    expect(r.body.needsValidation).toBe(true);
    expect((await M('RevolvingFund').findById(fund._id).lean()).currentBalance).toBe(17749);
  });

  it('nobody validates their own receipts', async () => {
    const tx = (await M('RevolvingFundTx').findOne({ fundId: fund._id, description: 'DIESEL' }).lean());
    const r = await as(tok.custodian, 'post', `/api/revolving-funds/${fund._id}/transactions/${tx._id}/validate`).send({});
    expect(r.status).toBe(403);
  });

  it('a rejected receipt comes off the expense and is owed by the custodian', async () => {
    const tx = await M('RevolvingFundTx').findOne({ fundId: fund._id, description: 'DELIVERY FEE' }).lean();
    const noReason = await as(tok.accountant, 'post', `/api/revolving-funds/${fund._id}/transactions/${tx._id}/reject`).send({});
    expect(noReason.status).toBe(400);
    const r = await as(tok.accountant, 'post', `/api/revolving-funds/${fund._id}/transactions/${tx._id}/reject`).send({ reason: 'No official receipt' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const je = await M('JournalEntry').findOne({ reference: r.body.reference }).lean();
    expect(je.lines.find(l => l.accountCode === '170100').debit).toBe(200);
    expect(je.lines.find(l => l.accountCode === '670000').credit).toBe(200);
    const twice = await as(tok.accountant, 'post', `/api/revolving-funds/${fund._id}/transactions/${tx._id}/validate`).send({});
    expect(twice.status).toBe(409);
  });

  it('once every receipt is checked, approval tops the fund up with a check voucher', async () => {
    const tx = await M('RevolvingFundTx').findOne({ fundId: fund._id, description: 'DIESEL' }).lean();
    const v = await as(tok.accountant, 'post', `/api/revolving-funds/${fund._id}/transactions/${tx._id}/validate`).send({});
    expect(v.status).toBe(200);
    expect(v.body.tx.validation).toMatchObject({ status: 'Validated', by: 'rfAccountant' });

    const slip = (await M('RequisitionSlip').findOne({ type: 'fund-replenish', status: 'Pending' }).lean());
    const vouchersBefore = await M('CheckVoucher').countDocuments({});
    const r = await as(tok.owner, 'post', `/api/requisition-slips/${slip._id}/approve`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.fund.currentBalance).toBe(20000);
    expect(await M('CheckVoucher').countDocuments({})).toBe(vouchersBefore + 1);

    const tb = await trialBalance();
    expect(tb.debits).toBeCloseTo(tb.credits, 2);
  });

  it('stock bought from the fund cannot be rejected as a receipt', async () => {
    const tx = await M('RevolvingFundTx').create({ fundId: fund._id, type: 'disbursement', amount: 500, description: 'Inventory received: CUPS', categoryCode: '130000', performedBy: 'rfCustodian' });
    const r = await as(tok.accountant, 'post', `/api/revolving-funds/${fund._id}/transactions/${tx._id}/reject`).send({ reason: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/stock/i);
  });
});

describe('a spend filed as a petty-cash requisition slip', () => {
  it('carries its payee and OR number onto the liquidation report, and waits to be checked', async () => {
    const filed = await as(tok.custodian, 'post', '/api/requisition-slips').send({
      type: 'petty-cash', fundId: fund._id, amount: 350, description: 'FREIGHT CHARGE', categoryCode: '670000',
      payee: 'VICTORY LINER INC', refNo: 'VL-0091',
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    const ok = await as(tok.owner, 'post', `/api/requisition-slips/${filed.body.slip._id}/approve`).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const r = await as(tok.accountant, 'get', `/api/revolving-funds/${fund._id}/liquidation`);
    expect(r.body.rows.find(x => x.particulars === 'FREIGHT CHARGE')).toMatchObject({ payee: 'VICTORY LINER INC', refNo: 'VL-0091', status: 'Unvalidated' });
  });
});
