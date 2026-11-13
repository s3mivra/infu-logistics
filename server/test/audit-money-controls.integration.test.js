// Regression tests for the 2026-11 audit's money-lever findings (M11, M12,
// M22, M37, M87, M90, M100-M105, M119-M121). Each case replays the exploit
// proven against the unpatched server and asserts it is refused, and that the
// legitimate path (a manager, or a cashier with a manager's PIN approval)
// still works.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app, superTok, mgrTok, cashierTok, financeTok, staffTok, productId, mgrId;
const M = (n) => mongoose.model(n);
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log', jwtSecret: 'audit-money-controls-secret-0123456789' });
  app = ctx.app;
  await makeUser({ name: 'McSuper', role: 'superadmin' });
  await makeUser({ name: 'McMgr', role: 'manager' });
  await makeUser({ name: 'McCashier', role: 'cashier' });
  await makeUser({ name: 'McFinance', role: 'finance' });
  await makeUser({ name: 'McStaff', role: 'staff' });
  await M('User').updateMany({}, { $set: { tenantId: null } });
  superTok = await loginStaff(app, 'McSuper');
  mgrTok = await loginStaff(app, 'McMgr');
  cashierTok = await loginStaff(app, 'McCashier');
  financeTok = await loginStaff(app, 'McFinance');
  staffTok = await loginStaff(app, 'McStaff');
  mgrId = String((await M('User').findOne({ name: 'McMgr' }).lean())._id);
  await M('User').updateOne({ _id: mgrId }, { $set: { pinHash: await (await import('bcrypt')).default.hash('4821', 12) } });
  await M('Inventory').create({ itemCode: 'MC-RIBEYE', itemName: 'MC Ribeye', stockQty: 100, unit: 'pcs', unitCost: 300, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log' });
  const p = await auth('post', '/api/products', superTok).send({ name: 'MC Ribeye', category: 'Meat', basePrice: 112 });
  productId = p.body.product._id;
}, 120000);

afterAll(async () => { await ctx.stop(); });

const line = (o = {}) => ({ productId, name: 'MC Ribeye', price: 112, quantity: 1, ...o });
const order = (tok, body, headers = {}) => auth('post', '/api/orders', tok).set(headers).send({ customerName: 'MC Test', paymentMethod: 'Cash', items: [line()], ...body });
const approvalFor = async (requesterTok, target) => {
  const r = await auth('post', '/api/users/authorize', requesterTok).send({ name: 'McMgr', pin: '4821', permission: 'orders.override', target });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.approval;
};

describe('prices, discounts and comps at the till (M11, M12)', () => {
  it('a cashier cannot sell below the catalogue price, at P0, or at 1e308 without approval', async () => {
    for (const price of [0, 50, 1e308]) {
      const r = await order(cashierTok, { items: [line({ price })] });
      expect(r.status, `price ${price}`).toBeGreaterThanOrEqual(400);
    }
  });

  it('a negative add-on price is refused for everyone', async () => {
    const r = await order(mgrTok, { items: [line({ selectedAddOns: [{ name: 'Rebate', price: -100 }] })] });
    expect(r.status).toBe(400);
  });

  it('a cashier cannot give a manual 100% discount or comp an order without approval', async () => {
    expect((await order(cashierTok, { discountPercent: 100 })).status).toBe(403);
    expect((await order(cashierTok, { discountFlat: 50 })).status).toBe(403);
    expect((await order(cashierTok, { isComplimentary: true })).status).toBe(403);
  });

  it('the statutory SC/PWD discount needs no approval', async () => {
    const r = await order(cashierTok, { discountPercent: 20, isVatExempt: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("a manager's PIN approval lets the cashier override, and the approver is recorded", async () => {
    const approval = await approvalFor(cashierTok, 'new');
    const r = await order(cashierTok, { isComplimentary: true, approval });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.complimentaryApprovedBy).toBe('McMgr');
  });

  it('a manager (orders.override) can still change a price, and it is audited', async () => {
    const r = await order(mgrTok, { items: [line({ price: 100 })] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.total).toBeLessThan(112);
    expect(await M('AuditLog').countDocuments({ action: /priceOverride/i })).toBeGreaterThan(0);
  });

  it('PUT complimentary ignores a typed approver and needs a real one', async () => {
    const o = await order(cashierTok, {});
    const typed = await auth('put', `/api/orders/${o.body.order._id}/complimentary`, cashierTok).send({ reasonType: 'Staff Meal', approvedBy: 'Super Admin' });
    expect(typed.status).toBe(403);
  });

  it('a negative add-on cannot be added on edit either', async () => {
    const o = await order(cashierTok, {});
    const r = await auth('put', `/api/orders/${o.body.order._id}`, cashierTok).send({ items: [{ selectedAddOns: [{ name: 'Rebate', price: -100 }] }] });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe('backdating (M22)', () => {
  it("a cashier's placedAt older than 12 hours is ignored", async () => {
    const claimed = new Date(Date.now() - 48 * 3600 * 1000);
    const r = await order(cashierTok, { placedAt: claimed.toISOString() }, { 'Idempotency-Key': 'mc-backdate-1' });
    expect(r.status).toBe(200);
    expect(new Date(r.body.order.createdAt).getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
  });
});

describe('combo contents come from the catalogue (M87)', () => {
  it('a typed component list is replaced by the combo record', async () => {
    const combo = await auth('post', '/api/combos', superTok).send({ name: 'MC Combo', price: 25, items: [{ productId, name: 'MC Ribeye', quantity: 1 }] });
    expect(combo.status, JSON.stringify(combo.body)).toBe(200);
    const id = combo.body.combo?._id || combo.body._id;
    const r = await order(mgrTok, { items: [{ productId: id, name: 'MC Combo', price: 25, quantity: 1, isCombo: true, comboItems: [{ productId, name: 'MC Ribeye', quantity: 10 }] }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.items[0].comboItems.map(c => c.quantity)).toEqual([1]);
  });
});

describe('exchanges on complimentary orders (M90)', () => {
  it('are refused', async () => {
    const approval = await approvalFor(cashierTok, 'new');
    const o = await order(cashierTok, { isComplimentary: true, approval });
    await auth('put', `/api/orders/${o.body.order._id}`, mgrTok).send({ status: 'Completed' });
    const r = await auth('post', `/api/orders/${o.body.order._id}/exchange`, superTok).send({
      reason: 'swap', returnItems: [{ itemIndex: 0, qty: 1 }], newItems: [{ productId, qty: 1 }],
    });
    expect(r.status).toBe(400);
  });
});

describe('cash drawer (M119, M120)', () => {
  it('a plain staff account cannot post an expense from the drawer, and pay-outs are capped', async () => {
    const start = await auth('post', '/api/shifts/start', staffTok).send({ startingCash: 0 });
    expect(start.status, JSON.stringify(start.body)).toBeLessThan(300);
    const asExpense = await auth('post', '/api/shifts/movement', staffTok).send({ type: 'out', amount: 1, reason: 'x', expenseAccount: '610000', vendor: 'Cousin Co' });
    expect(asExpense.status).toBe(403);
    const huge = await auth('post', '/api/shifts/movement', staffTok).send({ type: 'out', amount: 250000, reason: 'x' });
    expect(huge.status).toBe(400);
    expect(await M('JournalEntry').countDocuments({ reference: /^EXP-/ })).toBe(0);
  });

  it('a count far from expected needs a manager to close the drawer', async () => {
    const r = await auth('post', '/api/shifts/end', staffTok).send({ actualCash: 900000000 });
    expect(r.status).toBe(403);
    expect(await M('JournalEntry').countDocuments({ reference: /^SHIFT-VAR/ })).toBe(0);
  });
});

describe('quotes (M101)', () => {
  it('cannot be ordered beyond the quoted quantity, nor priced below catalogue without approval', async () => {
    await makeClient({ username: 'mcclient' });
    const clientTok = await loginClient(app, 'mcclient');
    const q = await auth('post', '/api/client/quotations', clientTok).send({ items: [{ productId, name: 'MC Ribeye', quantity: 1 }] });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const qid = q.body.quotation._id;
    const cheap = await auth('post', `/api/quotations/${qid}/quote`, cashierTok).send({ lines: [{ index: 0, quotedPrice: 1 }] });
    expect(cheap.status).toBe(403);
    const ok = await auth('post', `/api/quotations/${qid}/quote`, mgrTok).send({ lines: [{ index: 0, quotedPrice: 100 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await auth('post', `/api/client/quotations/${qid}/accept`, clientTok).send({});
    const fifty = await auth('post', '/api/orders', clientTok).send({ items: [{ productId, name: 'MC Ribeye', quantity: 50 }] });
    expect(fifty.status).toBe(400);
  });
});

describe('price-approval gate covers discounts (M100)', () => {
  it("a manager's product discount waits for approval", async () => {
    const r = await auth('put', `/api/products/${productId}`, mgrTok).send({ discountPercent: 90 });
    expect(r.status).toBeLessThan(500);
    const p = await M('Product').findById(productId).lean();
    expect(p.discountPercent || 0).toBe(0);
  });

  it('a manager cannot change prices through the hub catalogue', async () => {
    const r = await auth('post', '/api/hub/catalog/sync', mgrTok).send({});
    expect(r.status).toBe(403);
  });
});

describe('setup importers after go-live (M102)', () => {
  it('finance cannot import opening client credit once the business has completed a sale', async () => {
    const o = await order(mgrTok, {});
    await auth('put', `/api/orders/${o.body.order._id}`, mgrTok).send({ status: 'Completed' });
    const r = await auth('post', '/api/setup/open-deposits/import', financeTok).send({ rows: [{ client: 'MC CLIENT', amount: 250000 }] });
    expect(r.status).toBe(423);
  });
});

describe('purchase order receipts (M37)', () => {
  it('cannot receive more than was ordered', async () => {
    const po = await auth('post', '/api/purchase-orders', superTok).send({
      supplier: 'MC Supplier', lines: [{ itemName: 'MC Ribeye', invId: null, orderedQty: 10, unitCost: 300, unit: 'pcs' }],
    });
    expect(po.status, JSON.stringify(po.body)).toBeLessThan(300);
    const id = po.body.po?._id || po.body.purchaseOrder?._id || po.body._id;
    const r = await auth('post', `/api/purchase-orders/${id}/receive`, superTok).send({ received: [{ index: 0, receivedQty: 500 }] });
    expect(r.status).toBe(400);
  });
});
