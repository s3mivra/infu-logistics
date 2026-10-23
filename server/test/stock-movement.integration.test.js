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
import { percentile, daysWithoutStock, classify, cleanMovementSettings, calendarDaysBetween, recommendBuy, runOut, spikeCapped, MOVEMENT_DEFAULTS } from '../features/stock-movement.js';

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
    // A negative balance is records gone wrong, not an empty shelf.
    expect(daysWithoutStock({ start: -40, cards: [], from, to })).toBe(0);
    // A day it sold on was a day it was there to sell.
    const day3 = [Date.parse('2026-10-03T00:00:00Z'), Date.parse('2026-10-04T00:00:00Z')];
    expect(daysWithoutStock({ start: 0, cards: [], from, to, soldDays: [day3] })).toBe(9);
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

  it('days since the last sale are whole calendar days in the business time zone', () => {
    expect(calendarDaysBetween('2026-09-30T04:00:00Z', new Date('2026-10-15T04:00:00Z'))).toBe(15);
    // 23:30 on Sep 30 in Manila and 00:30 on Oct 1 in Manila are different days...
    expect(calendarDaysBetween('2026-09-30T15:30:00Z', new Date('2026-09-30T16:30:00Z'))).toBe(1);
    // ...while 00:30 and 23:30 on the same Manila day are not.
    expect(calendarDaysBetween('2026-09-30T16:30:00Z', new Date('2026-10-01T15:30:00Z'))).toBe(0);
    expect(calendarDaysBetween(null)).toBeNull();
    expect(calendarDaysBetween('not a date')).toBeNull();
  });

  it('buy = per day x (cover + delivery) + safety stock, less free stock and what is on order', () => {
    const settings = { coverDays: 30, leadTimeDays: 7, safetyDays: 3 };
    // 2 a day: target 2 x 37 + 2 x 3 = 80; 10 free and 20 coming leaves 50.
    expect(recommendBuy({ adu: 2, available: 10, onOrder: 20, settings, whole: true })).toBe(50);
    // A fraction of a piece is rounded UP to the next whole one, never down.
    expect(recommendBuy({ adu: 0.1, available: 3, onOrder: 0, settings, whole: true })).toBe(1);   // 4 - 3 = 1
    expect(recommendBuy({ adu: 0.11, available: 3, onOrder: 0, settings, whole: true })).toBe(2);  // 4.4 - 3 = 1.4
    // An ingredient may be bought in part.
    expect(recommendBuy({ adu: 0.11, available: 3, onOrder: 0, settings, whole: false })).toBeCloseTo(1.4, 3);
    // Enough already, no rate, or bad numbers: nothing.
    expect(recommendBuy({ adu: 1, available: 100, onOrder: 0, settings, whole: true })).toBe(0);
    expect(recommendBuy({ adu: 0, available: 0, onOrder: 0, settings, whole: true })).toBe(0);
    expect(recommendBuy({ adu: NaN, available: 0, onOrder: 0, settings, whole: true })).toBe(0);
    // Negative stock is not counted as a debt to buy back on top.
    expect(recommendBuy({ adu: 1, available: -5, onOrder: 0, settings, whole: true })).toBe(40);
  });

  it('one huge day cannot blow up the buying rate', () => {
    // Steady 10 a day, then one bulk order of 500: counted as 30 (3 x the typical 10).
    expect(spikeCapped([10, 10, 10, 10, 500], 3)).toEqual({ qty: 70, capped: true });
    expect(spikeCapped([10, 12, 9, 11], 3)).toEqual({ qty: 42, capped: false });
    expect(spikeCapped([500, 2], 3)).toEqual({ qty: 502, capped: false });         // too few days to know what is typical
    expect(spikeCapped([], 3)).toEqual({ qty: 0, capped: false });
  });

  it('days left never divides by zero', () => {
    const settings = { leadTimeDays: 7, safetyDays: 3 };
    expect(runOut({ daysLeft: 0, available: 0, adu: 5, settings })).toBe('out');   // no stock, still selling
    expect(runOut({ daysLeft: null, available: 0, adu: 0, settings })).toBeNull();  // no stock, no sales: N/A
  });

  it('flags what runs out before a delivery could arrive', () => {
    const settings = { leadTimeDays: 7, safetyDays: 3 };
    expect(runOut({ daysLeft: 0, available: 0, adu: 1, settings })).toBe('out');
    expect(runOut({ daysLeft: 5, available: 5, adu: 1, settings })).toBe('urgent');
    expect(runOut({ daysLeft: 8, available: 8, adu: 1, settings })).toBe('low');
    expect(runOut({ daysLeft: 20, available: 20, adu: 1, settings })).toBeNull();
    expect(runOut({ daysLeft: null, available: 0, adu: 0, settings })).toBeNull();     // no sales: no forecast
  });

  it('settings stay inside sensible bounds', () => {
    expect(cleanMovementSettings({ fastPercentile: 999, deadDays: 'x', coverDays: 21 })).toMatchObject({ fastPercentile: 75, deadDays: 90, coverDays: 21, spikeFactor: 3 });
    expect(MOVEMENT_DEFAULTS.coverDays + MOVEMENT_DEFAULTS.leadTimeDays + MOVEMENT_DEFAULTS.safetyDays).toBe(24);   // 14 + 7 + 3
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
    // adu comes back rounded to 2 decimals; allow that rounding, not more.
    expect(Math.abs(syr.adu - 30 / syr.inStockDays)).toBeLessThanOrEqual(0.0051);
    const st = res.body.settings, horizon = st.coverDays + st.leadTimeDays + st.safetyDays;   // 14 + 7 + 3 by default
    expect(syr.recommend).toBe(Math.ceil((30 / syr.inStockDays) * horizon - 3));
    expect(res.body.rows.find(r => r.itemCode === 'OLD').recommend).toBe(0);           // nothing to buy for dead stock
  });

  it('an item that was out of stock is not called dead - it could not sell', async () => {
    const gone = await item({ itemCode: 'GONE', itemName: 'SOLD OUT ITEM', stockQty: 0, createdAt: ago(200) });
    await M('StockCard').create({ inventoryId: String(gone._id), itemName: 'SOLD OUT ITEM', type: 'Sale', qtyChange: -4, balanceAfter: 0, date: ago(60) });
    const rows = (await as('get', '/api/analytics/stock-movement')).body.rows;
    expect(rows.find(r => r.itemCode === 'GONE')).toMatchObject({ class: 'unavailable', soldQty: 0 });
  });

  it('the Suggested PO drafts what Stock movement says to buy, in whole units', async () => {
    const mv = (await as('get', '/api/analytics/stock-movement')).body.rows.find(r => r.itemCode === 'SYR-2L');
    expect(mv.recommend).toBeGreaterThan(0);
    const po = await as('get', '/api/reports/purchase-order?days=14');
    expect(po.status).toBe(200);
    const line = po.body.lines.find(l => l.itemCode === 'SYR-2L');
    expect(line, JSON.stringify(po.body.lines)).toBeTruthy();
    expect(Number.isInteger(line.suggestedOrder)).toBe(true);
    expect(line.suggestedOrder).toBeGreaterThanOrEqual(mv.recommend);
    expect(po.body.lines.find(l => l.itemCode === 'OLD')).toBeUndefined();   // dead stock is not bought
  });

  it('a threshold out of its range is refused and named, not quietly reset', async () => {
    const before = (await as('get', '/api/analytics/movement-settings')).body.settings;
    const bad = await as('put', '/api/analytics/movement-settings').send({ fastPercentile: 30, coverDays: 20 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/fastPercentile must be 50-95/);
    expect((await as('get', '/api/analytics/movement-settings')).body.settings).toEqual(before);   // nothing half-saved
    expect((await as('get', '/api/analytics/stock-movement')).body.limits.fastPercentile).toEqual([50, 95]);
  });

  it('sales against a negative stock balance are not read as a stock-out that inflates the rate', async () => {
    // 60 sold over 20 days while the books showed the shelf below zero.
    const neg = await item({ itemCode: 'NEG', itemName: 'OVERSOLD ITEM', stockQty: 50, createdAt: ago(200) });
    await M('StockCard').create({ inventoryId: String(neg._id), itemName: 'OVERSOLD ITEM', type: 'Sale', qtyChange: -10, balanceAfter: -10, date: ago(40) });
    for (let d = 1; d <= 20; d++) {
      await order('log', { createdAt: ago(d), items: [{ productCode: 'NEG', name: 'Oversold', quantity: 3 }] });
      await M('StockCard').create({ inventoryId: String(neg._id), itemName: 'OVERSOLD ITEM', type: 'Sale', qtyChange: -3, balanceAfter: -10 - 3 * (21 - d), date: ago(d) });
    }
    const r = (await as('get', '/api/analytics/stock-movement')).body.rows.find(x => x.itemCode === 'NEG');
    expect(r.outDays).toBe(0);
    // adu comes back rounded to 2 decimals; allow that rounding, not more.
    expect(Math.abs(r.adu - 60 / r.inStockDays)).toBeLessThanOrEqual(0.0051);
    expect(r.inStockDays).toBeGreaterThan(25);                                   // the whole window, not a sliver of it
    expect(r.adu).toBeLessThan(2.5);                                             // ~2 a day, not 60 / a few days
  });

  it('a bulk order on one day is held down to a typical day when working out what to buy', async () => {
    const bulk = await item({ itemCode: 'BULK', itemName: 'BULK BUY ITEM', stockQty: 5, createdAt: ago(200) });
    for (let d = 2; d <= 11; d++) await order('log', { createdAt: ago(d), items: [{ productCode: 'BULK', name: 'Bulk', quantity: 2 }] });
    await order('log', { createdAt: ago(1), items: [{ productCode: 'BULK', name: 'Bulk', quantity: 300 }] });
    const res = (await as('get', '/api/analytics/stock-movement')).body;
    const r = res.rows.find(x => x.itemCode === 'BULK'), s = res.settings;
    expect(r.soldQty).toBe(320);                                                   // Sold still shows everything
    expect(r.spikeCapped).toBe(true);
    const horizon = s.coverDays + s.leadTimeDays + s.safetyDays;
    // Buy from 20 + 6 (the 300 counted as 3 x 2) = 26, not 320.
    expect(r.recommend).toBe(Math.max(0, Math.ceil((26 / r.inStockDays) * horizon - 5 - 1e-9)));
    expect(r.recommend).toBeLessThan(Math.ceil((320 / r.inStockDays) * horizon - 5));
  });

  it('the thresholds can be changed and are used', async () => {
    const saved = await as('put', '/api/analytics/movement-settings').send({ coverDays: 10, leadTimeDays: 0, safetyDays: 0 });
    expect(saved.body.settings).toMatchObject({ coverDays: 10, leadTimeDays: 0, safetyDays: 0 });
    const syr = (await as('get', '/api/analytics/stock-movement')).body.rows.find(r => r.itemCode === 'SYR-2L');
    expect(syr.recommend).toBe(Math.ceil((30 / syr.inStockDays) * 10 - 3));          // 10 days' worth, less 3
  });
});

