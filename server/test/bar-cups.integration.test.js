// Dine-in in the bar's own cups (cafe).
//
// A drink's recipe carries its take-out cup. Served in the shop's own glass,
// that cup never leaves the shelf - so a dine-in order marked "bar cups" skips
// stock items flagged as take-out packaging when it is completed. If the
// customer does not finish and leaves with it, the cup is taken then.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { withLedgerMaintenance } from '../lib/ledgerGuard.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CupSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CupSuper');
  await M('Category').create({ name: 'Coffee' });
}, 120000);
afterAll(async () => { await ctx.stop(); });

let beans, cup, latte;
beforeEach(async () => {
  for (const n of ['Product', 'Inventory', 'Order', 'StockCard']) await withLedgerMaintenance(() => M(n).deleteMany({}));
  beans = await M('Inventory').create({ itemCode: 'BEAN', itemName: 'ESPRESSO BEANS', unit: 'g', stockQty: 1000, unitCost: 1.2 });
  cup = await M('Inventory').create({ itemCode: 'CUP', itemName: '12OZ TAKE-OUT CUP', unit: 'pcs', stockQty: 100, unitCost: 3, takeoutPackaging: true });
  latte = await M('Product').create({
    name: 'Latte', category: 'Coffee', basePrice: 130,
    baseRecipe: [
      { invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 20, cost: 1.2, unit: 'g', packBase: 1 },
      { invId: String(cup._id), name: '12OZ TAKE-OUT CUP', qty: 1, cost: 3, unit: 'pcs', packBase: 1 },
    ],
  });
});

const place = async (quantity, extra = {}) => {
  const r = await auth('post', '/api/orders').send({
    table: 'Dine-In', paymentMethod: 'Cash', customerName: 'Walk-in',
    items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity, selectedAddOns: [] }], ...extra,
  });
  expect(r.body.success, JSON.stringify(r.body)).toBe(true);
  return r.body.order;
};
const complete = (o, extra = {}) => auth('put', `/api/orders/${o._id}`).send({ status: 'Completed', ...extra });
const stock = async (doc) => (await M('Inventory').findById(doc._id).lean()).stockQty;

describe('a dine-in order in the bar\'s cups', () => {
  it('takes the drink\'s ingredients but leaves the take-out cup on the shelf', async () => {
    const o = await place(2, { useBarCups: true });
    expect((await complete(o)).status).toBe(200);
    expect(await stock(beans)).toBe(1000 - 40);
    expect(await stock(cup)).toBe(100);
    const saved = await M('Order').findById(o._id).lean();
    expect(saved.items[0].barCupQty).toBe(2);
    expect(saved.items[0].barCupPack).toEqual([{ invId: String(cup._id), name: '12OZ TAKE-OUT CUP', qty: 1 }]);
  });

  it('without it, the cup comes off as it always did', async () => {
    const o = await place(2);
    await complete(o);
    expect(await stock(cup)).toBe(98);
  });

  it('can be switched back to take-out cups when the order is completed', async () => {
    const o = await place(1, { useBarCups: true });
    await complete(o, { useBarCups: false });
    expect(await stock(cup)).toBe(99);
    expect((await M('Order').findById(o._id).lean()).items[0].barCupQty || 0).toBe(0);
  });

  it('can be switched on for an order that was placed without it (a QR table order)', async () => {
    const o = await place(1);
    await complete(o, { useBarCups: true });
    expect(await stock(cup)).toBe(100);
  });
});

describe('not finished - made take-out after', () => {
  it('takes the cup then, for the drinks named, and books its cost', async () => {
    const o = await place(3, { useBarCups: true });
    await complete(o);
    const r = await auth('post', `/api/orders/${o._id}/take-out`).send({ lines: [{ index: 0, qty: 1 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.cost).toBe(3);
    expect(await stock(cup)).toBe(99);
    const saved = await M('Order').findById(o._id).lean();
    expect(saved.items[0].barCupQty).toBe(2);
    expect(saved.stockMoves.some(m => m.invId === String(cup._id) && m.qty === 1)).toBe(true);
    const je = await M('JournalEntry').findOne({ description: new RegExp(`^Take-out packaging for ${saved.orderNumber}`) }).lean();
    expect(je.lines.map(l => `${l.accountCode}:${l.debit}/${l.credit}`).sort()).toEqual(['130000:0/3', '510000:3/0']);
  });

  it('with no lines named, takes it for every drink still in bar cups - and only once', async () => {
    const o = await place(2, { useBarCups: true });
    await complete(o);
    expect((await auth('post', `/api/orders/${o._id}/take-out`).send({})).status).toBe(200);
    expect(await stock(cup)).toBe(98);
    const again = await auth('post', `/api/orders/${o._id}/take-out`).send({});
    expect(again.status).toBe(400);
    expect(await stock(cup)).toBe(98);
  });

  it('refuses when there are not enough cups, and changes nothing', async () => {
    const o = await place(2, { useBarCups: true });
    await complete(o);
    await M('Inventory').updateOne({ _id: cup._id }, { $set: { stockQty: 1 } });
    const r = await auth('post', `/api/orders/${o._id}/take-out`).send({});
    expect(r.status).toBe(400);
    expect(await stock(cup)).toBe(1);
    expect((await M('Order').findById(o._id).lean()).items[0].barCupQty).toBe(2);
  });

  it('is not for an order that is still open', async () => {
    const o = await place(1, { useBarCups: true });
    expect((await auth('post', `/api/orders/${o._id}/take-out`).send({})).status).toBe(400);
  });
});

describe('voiding afterwards', () => {
  it('gives back the cup that was taken for take-out, with the ingredients', async () => {
    const o = await place(1, { useBarCups: true });
    await complete(o);
    await auth('post', `/api/orders/${o._id}/take-out`).send({});
    expect(await stock(cup)).toBe(99);
    const v = await auth('post', `/api/orders/${o._id}/void`).send({ reason: 'Restock' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(await stock(cup)).toBe(100);
    expect(await stock(beans)).toBe(1000);
  });
});

describe('the switch on an open order', () => {
  it('can be set without changing anything else, and is used when the order is completed', async () => {
    const o = await place(1);
    const r = await auth('put', `/api/orders/${o._id}`).send({ useBarCups: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const saved = await M('Order').findById(o._id).lean();
    expect(saved.useBarCups).toBe(true);
    expect(saved.status).toBe(o.status);
    await complete(o);
    expect(await stock(cup)).toBe(100);
  });

  it('marking a stock item as take-out packaging is saved from the item editor', async () => {
    const lid = await M('Inventory').create({ itemCode: 'LID', itemName: 'LID', unit: 'pcs', stockQty: 50, unitCost: 1 });
    const r = await auth('put', `/api/inventory/${lid._id}`).send({ takeoutPackaging: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await M('Inventory').findById(lid._id).lean()).takeoutPackaging).toBe(true);
  });
});
