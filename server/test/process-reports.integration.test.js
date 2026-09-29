// The process-flow reports: delivery receipt numbers on completion, the daily
// sales summary, sales by channel, salesperson attribution, the cash flow
// statement (it must tie to the ledger), the exception report and the
// month-end closing checklist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, productId, wholesaleId, retailId;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const today = new Date().toISOString().slice(0, 10);
const sell = async (body = {}) => {
  const r = await as(tok.cashier, 'post', '/api/orders').send({
    items: [{ productId, name: 'Crate', price: 500, quantity: 2 }], paymentMethod: 'Cash', table: 'Takeout', ...body,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const done = await as(tok.boss, 'put', `/api/orders/${r.body.order._id}`).send({ status: 'Completed' });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return M('Order').findById(r.body.order._id).lean();
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'prBoss', role: 'superadmin' });
  await makeUser({ name: 'prCashier', role: 'cashier' });
  tok.boss = await loginStaff(app, 'prBoss');
  tok.cashier = await loginStaff(app, 'prCashier');
  const ClientAccount = M('ClientAccount');
  wholesaleId = String((await ClientAccount.create({ clientCode: 'PR-W', username: 'prw', name: 'Bulk Buyer', password: 'x', paymentMethod: 'Cash', segments: ['Wholesale'], assignedSalesperson: 'Rep Ana', isActive: true }))._id);
  retailId = String((await ClientAccount.create({ clientCode: 'PR-R', username: 'prr', name: 'Corner Store', password: 'x', paymentMethod: 'Cash', isActive: true }))._id);
  await M('Category').create({ name: 'PRCat', department: 'Logistics' });
  productId = String((await M('Product').create({ name: 'Crate', category: 'PRCat', basePrice: 500 }))._id);
  await M('Inventory').create({ itemName: 'Crate', stockQty: 500, unit: 'pcs', unitCost: 200 });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('sales documents, channel and salesperson', () => {
  let wholesale, retail;
  it('completing a delivery issues a DR number for what left', async () => {
    wholesale = await sell({ clientAccountId: wholesaleId });
    expect(wholesale.drNumber).toMatch(/DR/);
    expect(wholesale.completedAt).toBeTruthy();
    expect(wholesale.deliveryReceipts).toHaveLength(1);
    expect(wholesale.deliveryReceipts[0].lines[0]).toMatchObject({ name: 'Crate', qty: 2 });
    retail = await sell({ clientAccountId: retailId });
    expect(retail.drNumber).not.toBe(wholesale.drNumber);
  });

  it('the channel comes from the buyer, the salesperson from the client or the cashier', () => {
    expect(wholesale).toMatchObject({ channel: 'Wholesale', salesperson: 'Rep Ana' });
    expect(retail).toMatchObject({ channel: 'Retail', salesperson: 'prCashier' });
  });

  it('the daily sales summary lists each document with its DR and OR', async () => {
    const r = await as(tok.boss, 'get', `/api/reports/sales-documents?start=${today}&end=${today}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.rows.find(x => x.orderNumber === wholesale.orderNumber);
    expect(row).toMatchObject({ customerNumber: 'PR-W', customerName: 'BULK BUYER', drNumbers: wholesale.drNumber, amount: 1000 });
    expect(r.body.total).toBeGreaterThanOrEqual(2000);
    const lines = await as(tok.boss, 'get', `/api/reports/sales-line-items?start=${today}&end=${today}`);
    expect(lines.status).toBe(200);
    expect(lines.body.rows.find(x => x.drNumbers === wholesale.drNumber)).toMatchObject({ netSales: 1000 });
  });

  it('sales by channel splits wholesale from retail', async () => {
    const r = await as(tok.boss, 'get', `/api/reports/sales-by-channel?start=${today}&end=${today}`);
    expect(r.status).toBe(200);
    expect(r.body.channels.find(c => c.channel === 'Wholesale')).toMatchObject({ orders: 1, net: 1000, share: 50 });
    expect(r.body.channels.find(c => c.channel === 'Retail')).toMatchObject({ orders: 1, net: 1000 });
    expect((await as(tok.cashier, 'get', `/api/reports/sales-by-channel?start=${today}&end=${today}`)).status).toBe(403);
  });

  it('sales by customer totals each buyer, largest first', async () => {
    const r = await as(tok.boss, 'get', `/api/reports/sales-by-customer?start=${today}&end=${today}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bulk = r.body.customers.find(c => c.customerNumber === 'PR-W');
    expect(bulk).toMatchObject({ customer: 'Bulk Buyer', orders: 1, net: 1000, share: 50 });
    expect(r.body.totalNet).toBe(2000);
    const nets = r.body.customers.map(c => c.net);
    expect(nets).toEqual([...nets].sort((a, b) => b - a));
    expect((await as(tok.cashier, 'get', `/api/reports/sales-by-customer?start=${today}&end=${today}`)).status).toBe(403);
    expect((await as(tok.boss, 'get', '/api/reports/sales-by-customer')).status).toBe(400);
  });

  it('a salesperson named at the till must be on the staff list', async () => {
    const bad = await as(tok.cashier, 'post', '/api/orders').send({
      items: [{ productId, name: 'Crate', price: 500, quantity: 1 }], paymentMethod: 'Cash', table: 'Takeout', salesperson: 'Nobody Here',
    });
    expect(bad.status).toBe(400);
    const named = await sell({ clientAccountId: wholesaleId, salesperson: 'prBoss' });
    // Named at the till beats the client's assigned rep.
    expect(named.salesperson).toBe('prBoss');
  });

  it('commissions follow the salesperson', async () => {
    const r = await as(tok.boss, 'get', `/api/reports/commissions?start=${today}&end=${today}`);
    expect(r.body.sellers.map(s => s.name)).toEqual(expect.arrayContaining(['Rep Ana', 'prCashier']));
  });
});

describe('cash flow', () => {
  it('ties to the cash in the ledger', async () => {
    const r = await as(tok.boss, 'get', `/api/reports/cash-flow?start=${today}&end=${today}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ties).toBe(true);
    expect(r.body.closingCash).toBe(r.body.ledgerClosingCash);
    expect(r.body.closingCash).toBeGreaterThanOrEqual(2000);
    expect((await as(tok.boss, 'get', '/api/reports/cash-flow?start=2026-05-02&end=2026-05-01')).status).toBe(400);
  });
});

describe('exceptions and month-end close', () => {
  it('the exception report lists what needs a person', async () => {
    await M('Shift').create({ cashierName: 'prCashier', expectedCash: 1000, actualCash: 900, variance: -100, status: 'Closed' }).catch(() => null);
    const r = await as(tok.boss, 'get', '/api/reports/exceptions');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const keys = r.body.sections.map(s => s.key);
    expect(keys).toEqual(expect.arrayContaining(['overdueAr', 'overdueAp', 'overLimit', 'stockVariance', 'cashVariance', 'billsUnmatched', 'journalsWaiting']));
    expect((await as(tok.cashier, 'get', '/api/reports/exceptions')).status).toBe(403);
  });

  it('a pending manual journal blocks the close until it is approved', async () => {
    const last = new Date(); last.setDate(0); // the last day of the previous month
    const year = last.getFullYear(), month = last.getMonth() + 1;
    await M('ManualJournal').create({
      draftNumber: 'MJ-TEST-1', description: 'Accrual', date: last, status: 'Pending', preparedBy: 'prCashier',
      lines: [{ accountCode: '650000', debit: 10, credit: 0 }, { accountCode: '111000', debit: 0, credit: 10 }], totalDebit: 10, totalCredit: 10,
      createdAt: last,
    });
    const cl = await as(tok.boss, 'get', `/api/periods/checklist?year=${year}&month=${month}`);
    expect(cl.status, JSON.stringify(cl.body)).toBe(200);
    expect(cl.body.items.find(i => i.key === 'journals')).toMatchObject({ status: 'open', blocking: true });
    expect(cl.body.items.find(i => i.key === 'trial').status).toBe('done');
    const close = await as(tok.boss, 'post', '/api/periods/close').send({ year, month });
    expect(close.status).toBe(409);
    expect(close.body.blocking).toContain('Manual journal entries approved');

    // Manual steps are ticked by a person.
    const tick = await as(tok.boss, 'post', '/api/periods/checklist/tick').send({ year, month, key: 'review' });
    expect(tick.body.items.find(i => i.key === 'review')).toMatchObject({ status: 'done' });
    expect((await as(tok.boss, 'post', '/api/periods/checklist/tick').send({ year, month, key: 'trial' })).status).toBe(400);
    expect((await as(tok.cashier, 'post', '/api/periods/checklist/tick').send({ year, month, key: 'review' })).status).toBe(403);

    await M('ManualJournal').updateOne({ draftNumber: 'MJ-TEST-1' }, { $set: { status: 'Rejected' } });
    const ok = await as(tok.boss, 'post', '/api/periods/close').send({ year, month });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
