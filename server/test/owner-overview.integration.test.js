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

  it('takes a period for sales and profit, and compares it with the one before', async () => {
    const day = (d) => d.toISOString().slice(0, 10);
    const longAgo = await as(tok.ovOwner, 'get', '/api/owner/overview?start=2020-01-01&end=2020-01-31');
    expect(longAgo.status, JSON.stringify(longAgo.body)).toBe(200);
    expect([longAgo.body.sales.monthToDate, longAgo.body.month.income]).toEqual([0, 0]);
    expect(longAgo.body.period).toMatchObject({ start: '2020-01-01', end: '2020-01-31', previousEnd: '2019-12-31' });
    expect(longAgo.body.cash.onHand).toBe(500);                       // a balance is always as of now
    const wide = await as(tok.ovOwner, 'get', `/api/owner/overview?start=2020-01-01&end=${day(new Date(Date.now() + 86400000))}`);
    expect(wide.body.sales.monthToDate).toBe(500);
    expect((await as(tok.ovOwner, 'get', '/api/owner/overview?start=2026-02-01&end=2026-01-01')).status).toBe(400);
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

describe('the permissions that used to be owner-only', () => {
  it('can be given to a person, and are refused without them', async () => {
    await makeUser({ name: 'ovClerk', role: 'staff', permissions: ['orders.view', 'accounting.view', 'sales.backdate', 'ar.collect', 'clients.edit', 'orders.refund'] });
    const clerk = await loginStaff(app, 'ovClerk');
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sale = await as(clerk, 'post', '/api/admin/backdate-sale').send({ date: day, amount: 300, paymentMethod: 'On Account', customerName: 'Late Co' });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200);
    expect((await as(tok.ovCashier, 'post', '/api/admin/backdate-sale').send({ date: day, amount: 300, paymentMethod: 'Cash' })).status).toBe(403);

    const paid = await as(clerk, 'post', `/api/orders/${sale.body.order._id}/settle-ar`).send({ amount: 300, settleAccount: 'Cash on Hand' });
    expect(paid.status, JSON.stringify(paid.body)).not.toBe(403);
    expect((await as(tok.ovManager, 'post', `/api/orders/${sale.body.order._id}/settle-ar`).send({ amount: 1 })).status).toBe(403);

    const client = await mongoose.model('ClientAccount').create({ name: 'EDIT ME', clientCode: 'CUS-EDIT', username: 'editme', password: 'x' });
    expect((await as(clerk, 'patch', `/api/client-accounts/${client._id}`).send({ phone: '0917' })).status).toBe(200);
    expect((await as(tok.ovCashier, 'patch', `/api/client-accounts/${client._id}`).send({ phone: '0917' })).status).toBe(403);
  });
});

describe('the rest of the owner-only actions', () => {
  it('follow their permissions', async () => {
    await makeUser({ name: 'ovStock', role: 'staff', permissions: ['inventory.view', 'inventory.setup', 'inventory.delete'] });
    const stockTok = await loginStaff(app, 'ovStock');
    const item = await mongoose.model('Inventory').create({ itemName: 'PERM ITEM', unit: 'pcs', stockQty: 5, unitCost: 2 });
    expect((await as(stockTok, 'put', `/api/inventory/${item._id}`).send({ itemName: 'PERM ITEM 2' })).status).not.toBe(403);
    expect((await as(tok.ovCashier, 'put', `/api/inventory/${item._id}`).send({ itemName: 'X' })).status).toBe(403);
    expect((await as(stockTok, 'post', '/api/stock-locations').send({ name: 'Back room' })).status).not.toBe(403);
    expect((await as(tok.ovCashier, 'post', '/api/stock-locations').send({ name: 'Nope' })).status).toBe(403);
    expect((await as(stockTok, 'delete', `/api/inventory/${item._id}`)).status).not.toBe(403);
    // a menu manager builds combos and add-ons, as the screen already offered
    expect((await as(tok.ovManager, 'post', '/api/addons').send({ name: 'Extra Shot', price: 30 })).status).not.toBe(403);
    expect((await as(tok.ovCashier, 'post', '/api/addons').send({ name: 'Nope', price: 1 })).status).toBe(403);
  });
});

describe('price tiers', () => {
  it('are created and removed by whoever is given the permission', async () => {
    await makeUser({ name: 'ovTiers', role: 'staff', permissions: ['products.view', 'pricing.tiers'] });
    const t = await loginStaff(app, 'ovTiers');
    const made = await as(t, 'post', '/api/price-tiers').send({ name: 'Satellite', pricingMode: 'per_product', percent: 0 });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect((await as(tok.ovManager, 'post', '/api/price-tiers').send({ name: 'Nope' })).status).toBe(403);
    expect((await as(t, 'delete', `/api/price-tiers/${made.body.tier._id}`)).status).toBe(200);
  });
});
