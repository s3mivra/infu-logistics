// The Complimentary report: what was given away in a range.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, owner, cashier;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CompOwner', role: 'superadmin' });
  await makeUser({ name: 'CompCashier', role: 'staff', permissions: ['pos.use'] });
  owner = await loginStaff(app, 'CompOwner');
  cashier = await loginStaff(app, 'CompCashier');
  const o = (n, when, extra) => ({ businessType: 'fb', orderNumber: n, status: 'Completed', paymentMethod: 'Cash', createdAt: new Date(when), items: [{ name: 'LATTE', price: 150, quantity: 2 }], subtotal: 300, total: 0, ...extra });
  await mongoose.model('Order').create([
    o('CP-1', '2026-11-10T04:00:00Z', { isComplimentary: true, employeeName: 'ANA', complimentaryReasonType: 'EMPLOYEE_MEAL', complimentaryApprovedBy: 'CompOwner', complimentaryCost: 60 }),
    o('CP-2', '2026-11-11T04:00:00Z', { total: 300 }),                                        // a normal sale
    o('CP-3', '2026-10-01T04:00:00Z', { isComplimentary: true, complimentaryReasonType: 'CUSTOMER_RECOVERY', complimentaryCost: 50 }),   // outside the range
  ]);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('Complimentary report', () => {
  it('lists the complimentary orders in the range, with value, cost and the reasons', async () => {
    const r = await request(app).get('/api/reports/complimentary?start=2026-11-01&end=2026-11-30').set('Authorization', `Bearer ${owner}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows.map(x => x.orderNumber)).toEqual(['CP-1']);
    expect(r.body.rows[0]).toMatchObject({ forWhom: 'ANA', reason: 'EMPLOYEE_MEAL', approvedBy: 'CompOwner', value: 300, cost: 60 });
    expect(r.body.totals).toEqual({ count: 1, value: 300, cost: 60 });
    expect(r.body.byReason[0]).toMatchObject({ name: 'EMPLOYEE_MEAL', count: 1 });
  });

  it('needs the report permission', async () => {
    expect((await request(app).get('/api/reports/complimentary').set('Authorization', `Bearer ${cashier}`)).status).toBe(403);
  });
});
