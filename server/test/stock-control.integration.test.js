// Stock control (features/stock-control.js, lib/negativeStock.js, lib/stockCount.js).
//
// Selling below zero is a setting: warn (the sale goes through, flagged, and
// managers are told) or block (refused). Rolling counts pick a few items a day
// by movement class and go through the ordinary counting route; every count
// is kept, so the variance report can show expected vs counted, in units and
// pesos, by day and by who counted.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { withLedgerMaintenance } from '../lib/ledgerGuard.js';
import { selectCountList, varianceLine, varianceTotals, cleanCountCycle, COUNT_CYCLE_DEFAULTS } from '../lib/stockCount.js';
import { flagBelowZero, cleanNegativeStockMode } from '../lib/negativeStock.js';

const DAY = 86400000;

describe('the arithmetic', () => {
  it('a variance is counted - expected, in units and at cost in pesos', () => {
    expect(varianceLine({ expectedQty: 10, countedQty: 7, unitCost: 60 })).toEqual({ expectedQty: 10, countedQty: 7, variance: -3, unitCost: 60, varianceValue: -180 });
    expect(varianceLine({ expectedQty: -3, countedQty: 10, unitCost: 60 })).toMatchObject({ variance: 13, varianceValue: 780 });
    expect(varianceLine({ expectedQty: 0.3, countedQty: 0.1, unitCost: 0.5 })).toMatchObject({ variance: -0.2, varianceValue: -0.1 });
    expect(varianceLine({ expectedQty: 5, countedQty: 5, unitCost: 60 })).toMatchObject({ variance: 0, varianceValue: 0 });
  });

  it('totals keep shortage and overage apart', () => {
    const rows = [{ variance: -3, varianceValue: -180 }, { variance: 2, varianceValue: 120 }, { variance: 0, varianceValue: 0 }];
    expect(varianceTotals(rows)).toEqual({ counted: 3, withVariance: 2, shortValue: -180, overValue: 120, netValue: -60 });
  });

  it('picks the count list by class and how long since each was counted', () => {
    const now = new Date('2026-10-19T04:00:00Z');
    const ago = (d) => new Date(now.getTime() - d * DAY);
    const items = [
      { _id: 'fastDue', itemName: 'Fast due', stockQty: 5, class: 'fast' },          // 8 days, every 7
      { _id: 'fastFresh', itemName: 'Fast fresh', stockQty: 5, class: 'fast' },      // 3 days
      { _id: 'slowFresh', itemName: 'Slow fresh', stockQty: 5, class: 'slow' },      // 20 days, every 30
      { _id: 'slowDue', itemName: 'Slow due', stockQty: 5, class: 'slow' },          // 31 days
      { _id: 'deadFresh', itemName: 'Dead fresh', stockQty: 5, class: 'dead' },      // 60 days, every 90
      { _id: 'deadDue', itemName: 'Dead due', stockQty: 5, class: 'dead' },          // 100 days
      { _id: 'never', itemName: 'Never', stockQty: 5, class: 'new' },
      { _id: 'neg', itemName: 'Negative', stockQty: -4, class: 'fast' },             // counted yesterday, still on
    ];
    const lastCounted = new Map([['fastDue', ago(8)], ['fastFresh', ago(3)], ['slowFresh', ago(20)], ['slowDue', ago(31)],
      ['deadFresh', ago(60)], ['deadDue', ago(100)], ['neg', ago(1)]]);
    const { list, dueTotal } = selectCountList({ items, lastCounted, cycle: COUNT_CYCLE_DEFAULTS, now });
    expect(list.map(r => r._id)).toEqual(['neg', 'never', 'fastDue', 'deadDue', 'slowDue']);
    expect(dueTotal).toBe(5);
    expect(list[0]).toMatchObject({ belowZero: true, reason: 'Below zero' });
    expect(list.find(r => r._id === 'fastDue')).toMatchObject({ intervalDays: 7, daysSince: 8 });

    // The cap leaves the most overdue - and every below-zero item.
    const capped = selectCountList({ items, lastCounted, cycle: { ...COUNT_CYCLE_DEFAULTS, maxPerDay: 2 }, now });
    expect(capped.list.map(r => r._id)).toEqual(['neg', 'never']);
    // Monthly instead of weekly for fast movers: the 8-day one is no longer due.
    const monthly = selectCountList({ items, lastCounted, cycle: { ...COUNT_CYCLE_DEFAULTS, fastDays: 30 }, now });
    expect(monthly.list.map(r => r._id)).not.toContain('fastDue');
  });

  it('settings stay inside their bounds', () => {
    expect(cleanCountCycle({ fastDays: 0, slowDays: 14, maxPerDay: 'x' })).toMatchObject({ fastDays: 7, slowDays: 14, maxPerDay: 20 });
    expect(cleanNegativeStockMode('block')).toBe('block');
    expect(cleanNegativeStockMode('anything')).toBe('warn');
  });

  it('flags only a line that left the item below zero', () => {
    const list = [];
    expect(flagBelowZero({ inventoryId: 'a', itemName: 'A', balanceAfter: 0 }, list).belowZero).toBeUndefined();
    expect(flagBelowZero({ inventoryId: 'a', itemName: 'A', balanceAfter: -2 }, list).belowZero).toBe(true);
    flagBelowZero({ inventoryId: 'a', itemName: 'A', balanceAfter: -5 }, list);
    expect(list).toEqual([{ invId: 'a', itemName: 'A', balanceAfter: -5 }]);
  });
});

let ctx, app, tok, product, inv;
const M = (n) => mongoose.model(n);
const auth = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const sell = async (quantity) => {
  const placed = await auth('post', '/api/orders').send({
    table: 'Counter', paymentMethod: 'Cash', customerName: 'Walk In',
    items: [{ productId: String(product._id), name: 'Sack', price: 100, quantity }],
  });
  expect(placed.body.success).toBe(true);
  return auth('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
};
const stock = async () => (await M('Inventory').findById(inv._id).lean()).stockQty;
const setMode = (negativeStockMode) => auth('put', '/api/stock-control/settings').send({ negativeStockMode });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'CtlSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CtlSuper');
  await M('Category').create({ name: 'Bulk', department: 'Logistics' });
  product = await M('Product').create({ name: 'Sack', category: 'Bulk', basePrice: 100, productCode: 'SACK' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  for (const n of ['Order', 'Inventory', 'StockCard', 'JournalEntry', 'StockCount', 'EODRecord', 'Settings']) {
    await withLedgerMaintenance(() => M(n).deleteMany({}));
  }
  inv = await M('Inventory').create({ itemCode: 'SACK', itemName: 'SACK', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1, stockQty: 5, unitCost: 60, srp: 100 });
});

describe('selling below zero', () => {
  it('warns by default: the sale goes through, flagged, and managers are told', async () => {
    const settings = await auth('get', '/api/stock-control/settings');
    expect(settings.body.negativeStockMode).toBe('warn');

    const done = await sell(8);
    expect(done.status).toBe(200);
    expect(await stock()).toBe(-3);
    expect(done.body.order.belowZeroItems).toEqual([{ invId: String(inv._id), itemName: 'SACK', balanceAfter: -3 }]);

    const card = await M('StockCard').findOne({ inventoryId: String(inv._id), type: 'Sale' }).lean();
    expect(card).toMatchObject({ qtyChange: -8, balanceAfter: -3, belowZero: true });

    // The same deduction and the same cost of sale as any other sale of 8.
    const cogs = await M('JournalEntry').aggregate([{ $unwind: '$lines' }, { $match: { 'lines.accountCode': '510000' } }, { $group: { _id: null, d: { $sum: '$lines.debit' } } }]);
    expect(cogs[0].d).toBe(480);

    const feed = await auth('get', '/api/notifications');
    const neg = feed.body.items.filter(i => i.kind === 'below_zero');
    expect(neg).toHaveLength(1);
    expect(neg[0]).toMatchObject({ severity: 'critical', tab: 'inventory', sub: 'control', focusId: String(inv._id) });
    expect(feed.body.items.some(i => i.kind === 'low_stock' && i.focusId === String(inv._id))).toBe(false);

    // Written after the response, so give it a moment.
    let audit = null;
    for (let i = 0; i < 20 && !audit; i++) {
      audit = await M('AuditLog').findOne({ action: 'Order_SOLD_BELOW_ZERO' }).lean();
      if (!audit) await new Promise(r => setTimeout(r, 50));
    }
    expect(audit?.details?.after?.items).toEqual([{ invId: String(inv._id), itemName: 'SACK', balanceAfter: -3 }]);
  });

  it('a sale that had the stock is not flagged', async () => {
    const done = await sell(5);
    expect(done.status).toBe(200);
    expect(await stock()).toBe(0);
    expect(done.body.order.belowZeroItems).toEqual([]);
    expect((await M('StockCard').findOne({ type: 'Sale' }).lean()).belowZero).toBeUndefined();
  });

  it('blocks when set to block, naming the item and the setting', async () => {
    expect((await setMode('block')).body.negativeStockMode).toBe('block');
    const refused = await sell(8);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/INSUFFICIENT STOCK.*SACK.*Selling below zero is turned off in Settings/);
    expect(await stock()).toBe(5);
    expect(await M('StockCard').countDocuments({ type: 'Sale' })).toBe(0);
    // What is there can still be sold.
    expect((await sell(5)).status).toBe(200);
    expect(await stock()).toBe(0);
  });

  it('refuses a mode it does not know', async () => {
    const bad = await setMode('sometimes');
    expect(bad.status).toBe(400);
  });

  it('never sells stock held for another client, even in warn mode', async () => {
    await M('Inventory').findByIdAndUpdate(inv._id, { reservedQty: 4 });
    const refused = await sell(3);   // 1 free, 4 held
    expect(refused.status).toBe(400);
    expect(await stock()).toBe(5);
  });

  it('lists what is below zero with its last stock card lines', async () => {
    await sell(8);
    const r = await auth('get', '/api/stock-control/below-zero');
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ _id: String(inv._id), stockQty: -3, value: -180 });
    expect(r.body.items[0].lastLines[0]).toMatchObject({ type: 'Sale', qtyChange: -8, balanceAfter: -3, belowZero: true });
  });
});

describe('rolling counts and the variance report', () => {
  it('puts the below-zero item on top of today\'s list and caps the rest', async () => {
    await M('Inventory').create([
      { itemCode: 'B1', itemName: 'BOX ONE', unit: 'pcs', stockQty: 10, unitCost: 5 },
      { itemCode: 'B2', itemName: 'BOX TWO', unit: 'pcs', stockQty: 10, unitCost: 5 },
      { itemCode: 'B3', itemName: 'BOX THREE', unit: 'pcs', stockQty: 10, unitCost: 5 },
    ]);
    await sell(8);
    const set = await auth('put', '/api/stock-control/settings').send({ countCycle: { maxPerDay: 2 } });
    expect(set.body.countCycle.maxPerDay).toBe(2);
    const r = await auth('get', '/api/stock-control/count-list');
    expect(r.status).toBe(200);
    expect(r.body.list).toHaveLength(2);
    expect(r.body.list[0]).toMatchObject({ _id: String(inv._id), belowZero: true });
    expect(r.body.dueTotal).toBe(4);

    expect((await auth('put', '/api/stock-control/settings').send({ countCycle: { maxPerDay: 0 } })).status).toBe(400);
  });

  it('counts through the ordinary route without closing the day, and drops off the list', async () => {
    await sell(8);   // -3 on the books
    const counted = await auth('post', '/api/inventory/count').send({ rolling: true, counts: { [inv._id]: 4 }, reasons: { [inv._id]: 'Delivery not received' } });
    expect(counted.body).toMatchObject({ success: true, counted: 1 });
    expect(await stock()).toBe(4);

    // The day is still open: the till keeps selling and EOD can still be done.
    const eod = await auth('get', '/api/inventory/eod-data');
    expect(eod.body.status).toBe('OPEN');

    // Stock moved and the books moved, as for any count.
    const adj = await M('StockCard').findOne({ type: 'Adjustment' }).lean();
    expect(adj).toMatchObject({ qtyChange: 7, balanceAfter: 4 });
    expect(adj.remarks).toMatch(/^Rolling count: Delivery not received/);
    expect(await M('JournalEntry').countDocuments({ reference: adj.reference })).toBe(1);

    const row = await M('StockCount').findOne().lean();
    expect(row).toMatchObject({ kind: 'rolling', expectedQty: -3, countedQty: 4, variance: 7, unitCost: 60, varianceValue: 420, countedBy: 'CtlSuper' });

    const list = await auth('get', '/api/stock-control/count-list');
    expect(list.body.list.map(r => r._id)).not.toContain(String(inv._id));

    // No counts at all is refused, rather than recording nothing.
    expect((await auth('post', '/api/inventory/count').send({ rolling: true, counts: {} })).status).toBe(400);
  });

  it('reports expected vs counted by day and by counter, filterable', async () => {
    await makeUser({ name: 'CtlCounter', role: 'admin' });
    const tok2 = await loginStaff(app, 'CtlCounter');
    const other = await M('Inventory').create({ itemCode: 'B9', itemName: 'BOX NINE', unit: 'pcs', stockQty: 10, unitCost: 5 });
    await auth('post', '/api/inventory/count').send({ rolling: true, counts: { [inv._id]: 2 } });             // 5 -> 2: -3 x 60
    await auth('post', '/api/inventory/count', tok2).send({ rolling: true, counts: { [other._id]: 10 } });    // right
    await auth('post', '/api/inventory/count', tok2).send({ counts: { [other._id]: 12 } });                    // EOD: +2 x 5

    const all = await auth('get', '/api/stock-control/variance');
    expect(all.status).toBe(200);
    expect(all.body.rows).toHaveLength(3);
    expect(all.body.totals).toEqual({ counted: 3, withVariance: 2, shortValue: -180, overValue: 10, netValue: -170 });
    expect(all.body.byDay).toHaveLength(1);
    expect(all.body.byCounter.find(c => c.countedBy === 'CtlSuper')).toMatchObject({ counted: 1, shortValue: -180 });
    expect(all.body.byCounter.find(c => c.countedBy === 'CtlCounter')).toMatchObject({ counted: 2, overValue: 10 });
    expect(all.body.counters).toEqual(['CtlCounter', 'CtlSuper']);

    const byCounter = await auth('get', '/api/stock-control/variance?countedBy=CtlCounter');
    expect(byCounter.body.rows).toHaveLength(2);
    const onlyVariance = await auth('get', '/api/stock-control/variance?varianceOnly=1');
    expect(onlyVariance.body.rows.map(r => r.itemName).sort()).toEqual(['BOX NINE', 'SACK']);
    const eodOnly = await auth('get', '/api/stock-control/variance?kind=eod');
    expect(eodOnly.body.rows).toEqual([expect.objectContaining({ itemName: 'BOX NINE', expectedQty: 10, countedQty: 12, variance: 2, varianceValue: 10 })]);
    const search = await auth('get', '/api/stock-control/variance?q=sack');
    expect(search.body.rows).toHaveLength(1);
    const yesterday = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    const old = await auth('get', `/api/stock-control/variance?start=${yesterday}&end=${yesterday}`);
    expect(old.body.rows).toHaveLength(0);
  });
});
