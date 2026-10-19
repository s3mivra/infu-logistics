// Inventory audit, logistics side: goods counted in whole pieces and packs.
//
//   - pieces are whole: a fractional quantity is refused, not half-deducted
//   - receiving a PO line with no pack size uses the item's own pack
//   - a transfer moves exactly one quantity out and the same in, in the same
//     unit, and never touches stock held for a client
//   - partial fulfilment and a backdated sale take stock through the recipe,
//     like a live sale, and a void gives it back
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { withLedgerMaintenance } from '../lib/ledgerGuard.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const stock = async (doc) => (await M('Inventory').findById(doc._id).lean()).stockQty;
const cardSum = async (doc) => (await M('StockCard').find({ inventoryId: String(doc._id) }).lean())
  .reduce((s, c) => s + (Number(c.qtyChange) || 0), 0);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'logAudit', role: 'superadmin' });
  tok = await loginStaff(app, 'logAudit');
  await M('Category').create({ name: 'Syrups' });
}, 120000);
afterAll(async () => { await ctx.stop(); });

let can, bottle, bundle, supplierId;
beforeEach(async () => {
  await withLedgerMaintenance(async () => {
    for (const n of ['Product', 'Inventory', 'Order', 'StockCard', 'JournalEntry', 'PurchaseOrder', 'StockTransfer', 'Bill', 'Supplier']) await M(n).deleteMany({});
  });
  const open = async (doc) => {
    const d = await M('Inventory').create({ businessType: 'log', ...doc });
    await M('StockCard').create({ inventoryId: String(d._id), itemName: d.itemName, type: 'Initial', reference: 'OPEN', qtyChange: d.stockQty, balanceAfter: d.stockQty, unitCost: d.unitCost });
    return d;
  };
  // A 377 g can (stored in g) and a 740 ml bottle, both counted in packs.
  can = await open({ itemCode: 'P50012', itemName: 'ALASKA CONDENSED MILK', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, packSize: 0.377, stockQty: 377 * 10, unitCost: 66 / 377 });
  bottle = await open({ itemCode: 'P40034', itemName: 'LB ROASTED ALMOND', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000, packSize: 0.74, stockQty: 740 * 4, unitCost: 375 / 740 });
  await M('Product').create({ productCode: 'P50012', name: 'ALASKA CONDENSED MILK', category: 'Syrups', basePrice: 79, businessType: 'log',
    baseRecipe: [{ invId: String(can._id), name: 'ALASKA CONDENSED MILK', qty: 377, packBase: 377, unit: 'g' }] });
  // A bundle named apart from its stock: reached only through its recipe.
  bundle = await M('Product').create({ productCode: 'BND-1', name: 'BARISTA STARTER PACK', category: 'Syrups', basePrice: 450, businessType: 'log',
    baseRecipe: [
      { invId: String(can._id), name: 'ALASKA CONDENSED MILK', qty: 377, packBase: 377, unit: 'g' },
      { invId: String(bottle._id), name: 'LB ROASTED ALMOND', qty: 740, packBase: 740, unit: 'ml' },
    ] });
  supplierId = String((await M('Supplier').create({ name: 'Lauriat Beverages' }))._id);
});

const place = async (product, quantity) => {
  const p = await M('Product').findOne({ name: product }).lean();
  return as('post', '/api/orders').send({
    table: 'Walk In', customerName: 'Audit Client', paymentMethod: 'Cash',
    items: [{ productId: String(p._id), name: p.name, price: p.basePrice, quantity }],
  });
};

describe('whole pieces', () => {
  it('selling 1 can takes exactly one can', async () => {
    const r = await place('ALASKA CONDENSED MILK', 1);
    await as('put', `/api/orders/${r.body.order._id}`).send({ status: 'Completed' });
    expect(await stock(can)).toBe(377 * 9);
  });

  it('refuses 1.5 cans rather than taking a can and a half', async () => {
    const r = await place('ALASKA CONDENSED MILK', 1.5);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/whole units/i);
    expect(await stock(can)).toBe(377 * 10);
  });
});

describe('receiving', () => {
  it('a PO line with no pack size receives in the item\'s own packs', async () => {
    const po = await as('post', '/api/purchase-orders').send({
      supplier: 'Lauriat Beverages', supplierId,
      lines: [{ invId: String(can._id), itemName: 'ALASKA CONDENSED MILK', itemCode: 'P50012', unit: 'pcs', orderedQty: 24, unitCost: 66 }],
    });
    expect(po.status, JSON.stringify(po.body)).toBe(201);
    const rcv = await as('post', `/api/purchase-orders/${po.body.purchaseOrder._id}/receive`).send({ received: [{ index: 0, receivedQty: 24 }] });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(200);
    expect(await stock(can)).toBe(377 * 34);             // 24 cans, not 24 kg
    expect(await stock(can)).toBeCloseTo(await cardSum(can), 6);
  });
});

describe('transfers', () => {
  it('moves the same quantity out of one item and into the other, in one step', async () => {
    const other = await M('Inventory').create({ businessType: 'log', itemCode: 'P50012-B', itemName: 'ALASKA CONDENSED MILK (WAREHOUSE B)', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, packSize: 0.377, stockQty: 0, unitCost: 66 / 377 });
    const t = await as('post', '/api/stock-transfers').send({ fromItemId: String(can._id), toItemId: String(other._id), qtyBase: 377 * 3 });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    await as('post', `/api/stock-transfers/${t.body.transfer._id}/approve`).send({});
    const rel = await as('post', `/api/stock-transfers/${t.body.transfer._id}/release`).send({});
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    expect(await stock(can)).toBe(377 * 7);
    expect(await stock(other)).toBe(377 * 3);
    expect((await stock(can)) + (await stock(other))).toBe(377 * 10);     // net zero
  });

  it('refuses to move grams into an item counted in millilitres', async () => {
    const t = await as('post', '/api/stock-transfers').send({ fromItemId: String(can._id), toItemId: String(bottle._id), qtyBase: 377 });
    expect(t.status).toBe(400);
    expect(t.body.error).toMatch(/same unit/);
  });

  it('refuses to move stock held for a client', async () => {
    await M('Inventory').updateOne({ _id: can._id }, { $set: { reservedQty: 377 * 9 } });
    const other = await M('Inventory').create({ businessType: 'log', itemCode: 'X', itemName: 'X', unit: 'g', stockQty: 0, unitCost: 0 });
    const t = await as('post', '/api/stock-transfers').send({ fromItemId: String(can._id), toItemId: String(other._id), qtyBase: 377 * 2 });
    expect(t.status).toBe(400);
    expect(t.body.error).toMatch(/free to move/);
  });
});

describe('partial fulfilment and backdated sales use the recipe', () => {
  it('a bundle fulfilled in two rounds takes its cans and bottles, and a void gives them back', async () => {
    const r = await place('BARISTA STARTER PACK', 2);
    const id = r.body.order._id;
    const first = await as('post', `/api/orders/${id}/partial-fulfill`).send({ fulfill: [{ index: 0, qty: 1 }], paymentMode: 'full', paymentMethod: 'Cash' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await stock(can)).toBe(377 * 9);              // used to take nothing: the bundle has no stock item of its own
    expect(await stock(bottle)).toBe(740 * 3);
    const rest = await as('post', `/api/orders/${id}/partial-fulfill`).send({ fulfill: [{ index: 0, qty: 1 }], paymentMode: 'full', paymentMethod: 'Cash' });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(await stock(can)).toBe(377 * 8);
    const v = await as('post', `/api/orders/${id}/void`).send({ reason: 'Restock' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await stock(can)).toBe(377 * 10);
    expect(await stock(bottle)).toBe(740 * 4);
  });

  it('refuses half a unit in a fulfilment round', async () => {
    const r = await place('BARISTA STARTER PACK', 2);
    const res = await as('post', `/api/orders/${r.body.order._id}/partial-fulfill`).send({ fulfill: [{ index: 0, qty: 0.5 }], paymentMode: 'full', paymentMethod: 'Cash' });
    expect(res.status).toBe(400);
  });

  it('a backdated bundle sale takes stock through the recipe', async () => {
    const date = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const res = await as('post', '/api/admin/backdate-sale').send({
      date, affectInventory: true,
      items: [{ productId: String(bundle._id), name: 'BARISTA STARTER PACK', price: 450, quantity: 1 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await stock(can)).toBe(377 * 9);
    expect(await stock(bottle)).toBe(740 * 3);
    expect((await M('Order').findById(res.body.order._id).lean()).stockMoves).toHaveLength(2);
  });
});
