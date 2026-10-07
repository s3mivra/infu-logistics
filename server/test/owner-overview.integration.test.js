// The Owner role and its overview page, and spending from a revolving fund
// being something a person is given rather than something every staff has.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, fund;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ovBoss', role: 'superadmin' });
  await makeUser({ name: 'ovOwner', role: 'Owner' });
  await makeUser({ name: 'ovCashier', role: 'cashier' });
  await makeUser({ name: 'ovManager', role: 'manager' });
  for (const n of ['ovBoss', 'ovOwner', 'ovCashier', 'ovManager']) tok[n] = await loginStaff(app, n);
  const placed = await as(tok.ovBoss, 'post', '/api/orders').send({ table: 'Takeout', paymentMethod: 'Cash', customerName: 'Walk In', items: [{ name: 'Open Item', price: 500, quantity: 1 }] });
  await as(tok.ovBoss, 'put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
  fund = (await as(tok.ovBoss, 'post', '/api/revolving-funds').send({ name: 'Ov Fund', initialAmount: 5000, sourceAccount: '112000' })).body.fund;
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('the Owner role', () => {
  it('is there to be given, and sees the overview', async () => {
    const role = await mongoose.model('Role').findOne({ name: 'Owner' }).lean();
    expect(role.permissions).toEqual(expect.arrayContaining(['owner.view', 'accounting.view', 'requisitions.approve']));
    const r = await as(tok.ovOwner, 'get', '/api/owner/overview');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.sales).toMatchObject({ today: 500, todayCount: 1, monthToDate: 500 });
    expect(r.body.month.income).toBe(500);
    expect(r.body.cash.onHand).toBe(500);
    expect(r.body.cash.petty).toBe(5000);
    expect(r.body.waiting).toMatchObject({ requisitions: 0, fundSpends: 0 });
  });

  it('looks but does not key in work', async () => {
    expect((await as(tok.ovOwner, 'get', '/api/reports/sales-summary')).status).toBe(200);
    expect((await as(tok.ovOwner, 'post', '/api/check-vouchers').send({ payeeName: 'X', amount: 1, sourceAccount: '111000', chargeAccount: '760000', notes: 'x' })).status).toBe(403);
    expect((await as(tok.ovOwner, 'post', '/api/inventory').send({ itemName: 'X' })).status).toBe(403);
    expect((await as(tok.ovOwner, 'post', `/api/revolving-funds/${fund._id}/disburse`).send({ amount: 10, description: 'x' })).status).toBe(403);
  });

  it('the overview is not for everyone', async () => {
    expect((await as(tok.ovCashier, 'get', '/api/owner/overview')).status).toBe(403);
    expect((await as(tok.ovManager, 'get', '/api/owner/overview')).status).toBe(403);
  });
});

describe('spending from a revolving fund', () => {
  it('needs the permission; without it a slip is filed instead', async () => {
    expect((await as(tok.ovCashier, 'post', `/api/revolving-funds/${fund._id}/disburse`).send({ amount: 100, description: 'Tape', categoryCode: '760000' })).status).toBe(403);
    const slip = await as(tok.ovCashier, 'post', '/api/requisition-slips').send({ type: 'petty-cash', fundId: fund._id, amount: 100, description: 'Tape', categoryCode: '760000' });
    expect(slip.status, JSON.stringify(slip.body)).toBe(200);
    expect(slip.body.slip.status).toBe('Pending');
    const ok = await as(tok.ovManager, 'post', `/api/revolving-funds/${fund._id}/disburse`).send({ amount: 100, description: 'Tape', categoryCode: '760000' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const seen = await as(tok.ovOwner, 'get', '/api/owner/overview');
    expect(seen.body.waiting).toMatchObject({ requisitions: 1, fundSpends: 1 });
  });
});
