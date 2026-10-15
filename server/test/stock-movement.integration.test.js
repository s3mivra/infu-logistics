// Fast-moving, slow-moving and dead stock (features/stock-movement.js).
//
// Logistics counts whole units sold and buys whole units; a cafe counts what
// its recipes took from stock and may buy part of a unit. Only completed
// sales count, and an item that was out of stock, or is too new to judge, is
// not called dead.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { percentile, daysWithoutStock, classify, cleanMovementSettings, MOVEMENT_DEFAULTS } from '../features/stock-movement.js';

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);

describe('the arithmetic', () => {
  it('a percentile is a value from the list, by nearest rank', () => {
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([5], 75)).toBe(5);
    expect(percentile([], 75)).toBe(0);
  });

  it('counts the days the shelf was empty from the stock card trail', () => {
    const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-10-11T00:00:00Z');
    // in stock, sold out on day 2, restocked on day 6
    const cards = [{ date: '2026-10-03T00:00:00Z', balanceAfter: 0 }, { date: '2026-10-07T00:00:00Z', balanceAfter: 10 }];
    expect(daysWithoutStock({ start: 5, cards, from, to })).toBe(4);
    expect(daysWithoutStock({ start: 0, cards: [], from, to })).toBe(10);
    expect(daysWithoutStock({ start: null, cards: [], from, to })).toBe(0);     // nothing known: treated as in stock
  });

  it('classifies by rate and consistency, and never calls an untested item dead', () => {
    const s = MOVEMENT_DEFAULTS;
    const base = { fastThreshold: 2, settings: s, historyDays: 400, ageDays: 400, outDays: 0, effectiveDays: 30 };
    expect(classify({ ...base, soldQty: 90, adu: 3, soldDays: 20 })).toBe('fast');
    expect(classify({ ...base, soldQty: 90, adu: 3, soldDays: 1 })).toBe('slow');          // one big order is not "consistently"
    expect(classify({ ...base, soldQty: 5, adu: 0.2, soldDays: 4 })).toBe('slow');
    expect(classify({ ...base, soldQty: 0, adu: 0, soldDays: 0 })).toBe('dead');
    expect(classify({ ...base, soldQty: 0, adu: 0, soldDays: 0, ageDays: 10 })).toBe('new');
    expect(classify({ ...base, soldQty: 0, adu: 0, soldDays: 0, historyDays: 10 })).toBe('new');
    expect(classify({ ...base, soldQty: 0, adu: 0, soldDays: 0, outDays: 20 })).toBe('unavailable');
    // A window shorter than the dead-stock period still finds dead stock...
    expect(classify({ ...base, soldQty: 0, adu: 0, soldDays: 0, effectiveDays: 7, daysSinceSale: 90 })).toBe('dead');
    // ...but not an item that sold a few days before the window began.
    expect(classify({ ...base, soldQty: 0, adu: 0, soldDays: 0, effectiveDays: 7, daysSinceSale: 10 })).toBe('slow');
  });

  it('settings stay inside sensible bounds', () => {
    expect(cleanMovementSettings({ fastPercentile: 999, deadDays: 'x', coverDays: 14 })).toMatchObject({ fastPercentile: 75, deadDays: 30, coverDays: 14 });
  });
});

async function boot(businessType) {
  const ctx = await bootApp({ businessType });
  await makeUser({ name: `mv${businessType}`, role: 'superadmin' });
  const tok = await loginStaff(ctx.app, `mv${businessType}`);
  const as = (m, p) => request(ctx.app)[m](p).set('Authorization', `Bearer ${tok}`);
  return { ctx, as };
}
const M = (n) => mongoose.model(n);
const item = async (over) => {
  const doc = await M('Inventory').create({ unit: 'pcs', stockQty: 10, unitCost: 10, ...over });
  if (over.createdAt) await M('Inventory').collection.updateOne({ _id: doc._id }, { $set: { createdAt: over.createdAt } });
  return doc;
};
const order = (businessType, over) => M('Order').create({
  businessType, orderNumber: `MV-${Math.random().toString(36).slice(2, 9)}`, table: 'Pickup', subtotal: 1, total: 1,
  status: 'Completed', paymentMethod: 'Cash', items: [], ...over,
});

describe('logistics: whole units', () => {
  let ctx, as, syrup, cups, gloves, oldStock, newStock;
  beforeAll(async () => {
    ({ ctx, as } = await boot('log'));
    // A 2-litre bottle: stock is kept in litres, sold and bought by the bottle.
    syrup = await item({ itemCode: 'SYR-2L', itemName: 'VANILLA SYRUP 2L', unit: 'L', unitMultiplier: 2, stockQty: 6, createdAt: ago(200) });   // 3 bottles
    cups = await item({ itemCode: 'CUP-12', itemName: 'PAPER CUP 12OZ', stockQty: 40, createdAt: ago(200) });
    gloves = await item({ itemCode: 'GLV', itemName: 'GLOVES', stockQty: 25, createdAt: ago(200) });
    oldStock = await item({ itemCode: 'OLD', itemName: 'OLD STOCK NOBODY BUYS', stockQty: 7, createdAt: ago(200) });
    newStock = await item({ itemCode: 'NEW', itemName: 'BRAND NEW ITEM', stockQty: 5, createdAt: ago(3) });
    await order('log', { createdAt: ago(120), items: [{ productCode: 'CUP-12', name: 'Paper Cup', quantity: 1 }] });   // history is long enough
    // Syrup: a bottle or two on most days - fast.
    for (let d = 1; d <= 20; d++) await order('log', { createdAt: ago(d), items: [{ productCode: 'SYR-2L', name: 'Vanilla Syrup 2L', quantity: d % 2 ? 2 : 1 }] });
    // Cups and gloves: now and then - slow.
    await order('log', { createdAt: ago(5), items: [{ productCode: 'CUP-12', name: 'Paper Cup', quantity: 3 }] });
    await order('log', { createdAt: ago(9), items: [{ productCode: 'GLV', name: 'Gloves', quantity: 1 }] });
    // A backdated sale counts too (it never touched stock, but it was a sale).
    await order('log', { createdAt: ago(12), isBackdated: true, items: [{ productCode: 'GLV', name: 'Gloves', quantity: 2 }] });
    // Cancelled and voided orders never count.
    await order('log', { createdAt: ago(2), status: 'Voided', items: [{ productCode: 'OLD', name: 'Old', quantity: 50 }] });
    await order('log', { createdAt: ago(2), status: 'Cancelled', items: [{ productCode: 'OLD', name: 'Old', quantity: 50 }] });
  }, 120000);
  afterAll(async () => { await ctx.stop(); });

  it('counts whole units sold, the orders and the days, and when it last sold', async () => {
    const res = await as('get', '/api/analytics/stock-movement');
    expect(res.status).toBe(200);
    expect(res.body.wholeUnits).toBe(true);
    const row = (code) => res.body.rows.find(r => r.itemCode === code);
    expect(row('SYR-2L')).toMatchObject({ unit: 'pcs', stock: 3, soldQty: 30, transactions: 20, soldDays: 20 });
    expect(row('GLV')).toMatchObject({ soldQty: 3, transactions: 2 });                 // the backdated sale is in
    expect(row('OLD').soldQty).toBe(0);                                                 // voided and cancelled are not
    expect(new Date(row('SYR-2L').lastSold).getTime()).toBeGreaterThan(ago(2).getTime());
  });

  it('classes them fast, slow, dead - and a brand-new item as too new to tell', async () => {
    const rows = (await as('get', '/api/analytics/stock-movement')).body.rows;
    const cls = Object.fromEntries(rows.map(r => [r.itemCode, r.class]));
    expect(cls).toMatchObject({ 'SYR-2L': 'fast', 'CUP-12': 'slow', GLV: 'slow', OLD: 'dead', NEW: 'new' });
  });

  it('recommends whole bottles, never a part of one', async () => {
    const res = await as('get', '/api/analytics/stock-movement');
    for (const r of res.body.rows) expect(Number.isInteger(r.recommend)).toBe(true);
    const syr = res.body.rows.find(r => r.itemCode === 'SYR-2L');
    // 30 bottles over the days it was on sale; enough for 30 + 7 + 3 days, less the 3 on the shelf, rounded UP to a whole bottle.
    expect(syr.adu).toBeCloseTo(30 / syr.inStockDays, 2);
    expect(syr.recommend).toBe(Math.ceil((30 / syr.inStockDays) * 40 - 3));
    expect(res.body.rows.find(r => r.itemCode === 'OLD').recommend).toBe(0);           // nothing to buy for dead stock
  });

  it('an item that was out of stock is not called dead - it could not sell', async () => {
    const gone = await item({ itemCode: 'GONE', itemName: 'SOLD OUT ITEM', stockQty: 0, createdAt: ago(200) });
    await M('StockCard').create({ inventoryId: String(gone._id), itemName: 'SOLD OUT ITEM', type: 'Sale', qtyChange: -4, balanceAfter: 0, date: ago(60) });
    const rows = (await as('get', '/api/analytics/stock-movement')).body.rows;
    expect(rows.find(r => r.itemCode === 'GONE')).toMatchObject({ class: 'unavailable', soldQty: 0 });
  });

  it('the thresholds can be changed and are used', async () => {
    const saved = await as('put', '/api/analytics/movement-settings').send({ coverDays: 10, leadTimeDays: 0, safetyDays: 0 });
    expect(saved.body.settings).toMatchObject({ coverDays: 10, leadTimeDays: 0, safetyDays: 0 });
    const syr = (await as('get', '/api/analytics/stock-movement')).body.rows.find(r => r.itemCode === 'SYR-2L');
    expect(syr.recommend).toBe(Math.ceil((30 / syr.inStockDays) * 10 - 3));          // 10 days' worth, less 3
  });
});

