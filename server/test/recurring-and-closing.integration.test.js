// Repeating bills (entered once, proposed each month for approval) and the
// daily closing check (sales, the drawer count and the deposits side by side).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, cashier, supplierId;
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'rcBoss', role: 'superadmin' });
  await makeUser({ name: 'rcCashier', role: 'cashier' });
  tok = await loginStaff(app, 'rcBoss');
  cashier = await loginStaff(app, 'rcCashier');
  supplierId = String((await mongoose.model('Supplier').create({ name: 'LANDLORD CO', supplierCode: 'SUP-RC-1' }))._id);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('repeating bills', () => {
  it('are entered once and raised as Pending bills once a month', async () => {
    const made = await as(tok, 'post', '/api/recurring-bills').send({ supplierId, description: 'Office rent', amount: 25000, expenseAccountCode: '520000', dayOfMonth: 5 });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const first = await as(tok, 'post', '/api/recurring-bills/raise').send({});
    expect(first.body.raised).toHaveLength(1);
    const bill = await mongoose.model('Bill').findOne({ billNumber: first.body.raised[0].billNumber }).lean();
    expect([bill.status, bill.amount, bill.supplierName]).toEqual(['Pending', 25000, 'LANDLORD CO']);
    expect(bill.description).toMatch(/^Office rent - \d{4}-\d{2}$/);
    expect(new Date(bill.dueDate).getDate()).toBe(5);
    // the same month is not raised twice
    expect((await as(tok, 'post', '/api/recurring-bills/raise').send({})).body.raised).toHaveLength(0);
  });

  it('a paused one is skipped, and only the books role may set them up', async () => {
    const row = (await as(tok, 'post', '/api/recurring-bills').send({ supplierId, description: 'Internet', amount: 1800, expenseAccountCode: '520000' })).body.row;
    await as(tok, 'patch', `/api/recurring-bills/${row._id}`).send({ isActive: false });
    expect((await as(tok, 'post', '/api/recurring-bills/raise').send({})).body.raised).toHaveLength(0);
    expect((await as(cashier, 'post', '/api/recurring-bills').send({ supplierId, description: 'x', amount: 1, expenseAccountCode: '520000' })).status).toBe(403);
    expect((await as(tok, 'delete', `/api/recurring-bills/${row._id}`)).status).toBe(200);
  });
});

describe('daily closing check', () => {
  it('puts the day\'s sales by payment beside the drawer and the deposits', async () => {
    for (const [method, price] of [['Cash', 500], ['GCash', 300]]) {
      const o = await as(tok, 'post', '/api/orders').send({ table: 'Takeout', paymentMethod: method, customerName: 'Walk In', items: [{ name: 'Open Item', price, quantity: 1 }] });
      await as(tok, 'put', `/api/orders/${o.body.order._id}`).send({ status: 'Preparing', paymentMethod: method, ...(method === 'GCash' ? {} : {}) });
      await as(tok, 'put', `/api/orders/${o.body.order._id}`).send({ status: 'Completed' });
    }
    const r = await as(tok, 'get', '/api/reports/daily-closing');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.sales).toMatchObject({ total: 800, count: 2, cash: 500 });
    expect(r.body.sales.byMethod).toMatchObject({ Cash: 500, GCash: 300 });
    expect(r.body.issues.join(' ')).toMatch(/no drawer session/i);
    expect((await as(cashier, 'get', '/api/reports/daily-closing')).status).toBe(403);
  });
});
