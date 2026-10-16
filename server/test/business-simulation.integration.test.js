// The business, end to end (logistics).
//
// Runs a distributor through a month the way the app is really used - stock
// imported from the setup sheet, bought on purchase orders and received, sold
// on the till and completed, an order voided, another still on its way - and
// then reads the result where the owner would: the stock, Analytics -> Stock
// movement, and the Suggested PO. Every step is a real HTTP call against the
// routes the screens use; nothing is computed here that the app should have.
//
// The one shortcut is the calendar: a month of sales cannot happen in a test,
// so once the sales are made through the till their dates (and the stock card
// lines they wrote) are moved back across the month. Each order keeps exactly
// what it sold and what it took from stock.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

const DAY = 86400000;
const ago = (d, h = 10) => new Date(Date.now() - d * DAY + (h - 12) * 3600000);
const M = (n) => mongoose.model(n);
let ctx, auth;
const ok = (res, what) => {
  if (res.status < 200 || res.status > 299 || res.body?.success === false) throw new Error(`${what} (${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`);
  return res.body;
};
const item = (code) => M('Inventory').findOne({ itemCode: code }).lean();
const product = (code) => M('Product').findOne({ productCode: code }).lean();

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  await makeUser({ name: 'SimOwner', role: 'superadmin' });
  const tok = await loginStaff(ctx.app, 'SimOwner');
  auth = (m, p) => request(ctx.app)[m](p).set('Authorization', `Bearer ${tok}`);
}, 120000);
afterAll(async () => { await ctx.stop(); });

// What was sold, day by day: [days ago, bottles of syrup, sleeves of cups].
const SALES = [
  [28, 2, 0], [26, 1, 1], [25, 2, 0], [23, 1, 0], [21, 2, 1], [19, 1, 0], [17, 2, 0],
  [15, 1, 1], [13, 2, 0], [11, 1, 0], [9, 2, 0], [7, 1, 1], [5, 2, 0], [3, 1, 0], [1, 2, 0],
];
const SYRUP_SOLD = SALES.reduce((n, s) => n + s[1], 0);   // 23 bottles
const CUPS_SOLD = SALES.reduce((n, s) => n + s[2], 0);    // 4 sleeves
const saleIds = [];

describe('a month of business, through the app', () => {
  beforeAll(async () => {
    // ── 1. The stock list, from the setup sheet: counted at zero, costed ──
    // A 2-litre bottle of syrup is ONE item sold as one pc; Qty goes in litres
    // the way the import reads the sheet (packs x pack size).
    ok(await auth('post', '/api/inventory/import').send({ items: [
      { itemCode: 'SYR-VAN', itemName: 'Vanilla Syrup', category: 'Syrups', unit: 'L', packSize: 2, qty: 0, unitCost: 175, srp: 225 },
      { itemCode: 'CUP-12', itemName: 'Paper Cup 12oz', category: 'Packaging', unit: 'pcs', qty: 0, unitCost: 120, srp: 180 },
      { itemCode: 'OLD-1', itemName: 'Discontinued Mug', category: 'Merch', unit: 'pcs', qty: 12, unitCost: 90, srp: 150 },
      { itemCode: 'NEW-1', itemName: 'New Caramel Syrup', category: 'Syrups', unit: 'L', packSize: 1, qty: 6, unitCost: 160, srp: 210 },
    ] }), 'inventory import');

    // ── 2. A supplier, and the stock bought from them ──
    ok(await auth('post', '/api/suppliers').send({ name: 'Metro Syrups', paymentTerms: '30 days' }), 'supplier');
    const syrup = await item('SYR-VAN'), cups = await item('CUP-12');
    const po = ok(await auth('post', '/api/purchase-orders').send({
      supplier: 'Metro Syrups',
      lines: [{ invId: String(syrup._id), itemName: syrup.itemName, unit: 'L', packSize: 2, orderedQty: 30, unitCost: 350 }],   // 30 bottles at 350
    }), 'purchase order');
    ok(await auth('post', `/api/purchase-orders/${po.purchaseOrder._id}/receive`).send({ received: [{ index: 0, receivedQty: 30 }] }), 'receive');
    // Cups come from someone else, named on the order only (not a saved supplier).
    const cupPo = ok(await auth('post', '/api/purchase-orders').send({
      supplier: 'Paper Goods Trading',
      lines: [{ invId: String(cups._id), itemName: cups.itemName, unit: 'pcs', orderedQty: 5, unitCost: 120 }],
    }), 'cups purchase order');
    ok(await auth('post', `/api/purchase-orders/${cupPo.purchaseOrder._id}/receive`).send({ received: [{ index: 0, receivedQty: 5 }] }), 'receive cups');

    // ── 3. A month of sales on the till, each one completed ──
    const sell = async (code, qty) => {
      const p = await product(code);
      const o = ok(await auth('post', '/api/orders').send({
        table: 'Pickup', paymentMethod: 'Cash',
        items: [{ productId: String(p._id), name: p.name, productCode: p.productCode, price: p.basePrice, quantity: qty }],
      }), `sale of ${qty} ${code}`).order;
      ok(await auth('put', `/api/orders/${o._id}`).send({ status: 'Completed' }), 'complete');
      return o._id;
    };
    for (const [d, syr, cup] of SALES) {
      if (syr) saleIds.push([await sell('SYR-VAN', syr), d]);
      if (cup) saleIds.push([await sell('CUP-12', cup), d]);
    }
    // A sale rung up and voided, and one cancelled before it was made: neither counts.
    const voided = await sell('SYR-VAN', 5);
    ok(await auth('post', `/api/orders/${voided}/void`).send({ reason: 'Restock' }), 'void');
    const p = await product('OLD-1');
    const cancelled = ok(await auth('post', '/api/orders').send({ table: 'Pickup', paymentMethod: 'Cash', items: [{ productId: String(p._id), name: p.name, productCode: 'OLD-1', price: 150, quantity: 4 }] }), 'order to cancel').order;
    ok(await auth('put', `/api/orders/${cancelled._id}`).send({ status: 'Cancelled' }), 'cancel');

    // ── 4. More syrup ordered, not yet delivered ──
    ok(await auth('post', '/api/purchase-orders').send({
      supplier: 'Metro Syrups',
      lines: [{ invId: String(syrup._id), itemName: syrup.itemName, unit: 'L', packSize: 2, orderedQty: 4, unitCost: 350 }],
    }), 'open purchase order');

    // ── 5. The calendar (see the note at the top) ──
    // A sale's stock card names its order by number (StockCard.reference).
    for (const [id, d] of saleIds) {
      const _id = new mongoose.Types.ObjectId(String(id));
      const { orderNumber } = await M('Order').findById(_id, { orderNumber: 1 }).lean();
      await M('Order').collection.updateOne({ _id }, { $set: { createdAt: ago(d), updatedAt: ago(d) } });
      await M('StockCard').collection.updateMany({ reference: orderNumber }, { $set: { date: ago(d) } });
    }
    // Counted at zero on the import, then the delivery, before the first sale.
    await M('StockCard').collection.updateMany({ type: 'Stock Take Import', date: { $gte: ago(1, 0) } }, { $set: { date: ago(31) } });
    await M('StockCard').collection.updateMany({ type: 'Restock', date: { $gte: ago(1, 0) } }, { $set: { date: ago(30) } });
    for (const code of ['SYR-VAN', 'CUP-12', 'OLD-1']) await M('Inventory').collection.updateOne({ itemCode: code }, { $set: { createdAt: ago(200) } });
    const old = await product('OLD-1');
    await M('Order').create({ businessType: 'log', orderNumber: 'SIM-OLD-1', table: 'Pickup', subtotal: 150, total: 150, status: 'Completed', paymentMethod: 'Cash',
      createdAt: ago(150), items: [{ productId: String(old._id), name: old.name, productCode: 'OLD-1', price: 150, quantity: 1 }] });
  }, 240000);

  it('the stock is right after buying and selling: whole bottles, held in millilitres', async () => {
    const syrup = await item('SYR-VAN');
    // 30 bottles in, 23 sold; the voided 5 went back. A bottle is 2,000 ml.
    expect(syrup.packSize).toBe(2);
    expect(syrup.stockQty).toBe((30 - SYRUP_SOLD) * 2000);
    expect((await item('CUP-12')).stockQty).toBe(5 - CUPS_SOLD);
    expect((await item('OLD-1')).stockQty).toBe(12);                 // the cancelled order took nothing
  });

  it('the books still balance', async () => {
    const tb = await trialBalance();
    expect(tb.debits).toBeCloseTo(tb.credits, 2);
  });

  it('the Analytics sales panel shows today by default, and any period asked for', async () => {
    const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(ago(d));
    const todayOnly = ok(await auth('get', '/api/analytics/dashboard'), 'dashboard');
    expect(todayOnly.period).toMatchObject({ isToday: true });
    expect(todayOnly.today.count).toBe(0);                                  // every sale was moved into the past
    const month = ok(await auth('get', `/api/analytics/dashboard?start=${day(30)}&end=${day(0)}`), 'dashboard month');
    expect(month.period).toMatchObject({ start: day(30), end: day(0), isToday: false });
    expect(month.today.count).toBe(saleIds.length);                         // the voided and cancelled ones are not sales
    const week = ok(await auth('get', `/api/analytics/dashboard?start=${day(7)}&end=${day(0)}`), 'dashboard week');
    expect(week.today.count).toBe(saleIds.filter(([, d]) => d <= 7).length);
  });

  let mv, row;
  it('Stock movement counts what sold, in whole units, over the period', async () => {
    mv = ok(await auth('get', '/api/analytics/stock-movement'), 'stock movement');
    row = (code) => mv.rows.find(r => r.itemCode === code);
    expect(mv.wholeUnits).toBe(true);
    expect(row('SYR-VAN')).toMatchObject({ unit: 'pcs', stock: 30 - SYRUP_SOLD, available: 30 - SYRUP_SOLD, onOrder: 4, soldQty: SYRUP_SOLD, transactions: 15, soldDays: 15 });
    expect(row('CUP-12')).toMatchObject({ unit: 'pcs', stock: 5 - CUPS_SOLD, soldQty: CUPS_SOLD, transactions: 4 });
    expect(row('OLD-1')).toMatchObject({ soldQty: 0, transactions: 0 });            // voided and cancelled are left out
    for (const r of mv.rows) {
      expect(Number.isInteger(r.stock), `${r.itemCode} stock ${r.stock}`).toBe(true);
      expect(Number.isInteger(r.recommend), `${r.itemCode} buy ${r.recommend}`).toBe(true);
    }
  });

  it('per day, days left and days since the last sale agree with each other', () => {
    const syr = row('SYR-VAN');
    expect(syr.adu).toBeCloseTo(SYRUP_SOLD / syr.inStockDays, 2);
    expect(syr.daysOfStock).toBeCloseTo((30 - SYRUP_SOLD) / syr.adu, 0);   // per day is shown rounded
    expect(syr.daysSinceSale).toBe(1);                                               // last sold yesterday
    expect(row('CUP-12').daysSinceSale).toBe(7);
    expect(row('OLD-1').daysSinceSale).toBeGreaterThanOrEqual(149);
    expect(row('NEW-1').daysOfStock).toBeNull();                                     // no sales: N/A, not a number
  });

  it('classes each item: fast, slow, dead, and too new to tell', () => {
    expect(row('SYR-VAN').class).toBe('fast');
    expect(row('CUP-12').class).toBe('slow');
    expect(row('OLD-1').class).toBe('dead');
    expect(row('NEW-1').class).toBe('new');
  });

  it('says to buy whole bottles: enough for cover + delivery + safety, less stock and what is coming', () => {
    const syr = row('SYR-VAN'), s = mv.settings;
    const target = (SYRUP_SOLD / syr.inStockDays) * (s.coverDays + s.leadTimeDays + s.safetyDays);
    expect(syr.recommend).toBe(Math.ceil(target - (30 - SYRUP_SOLD) - 4));
    // 7 bottles at ~0.8 a day is ~9 days: past the 7-day delivery, inside the 3 spare days.
    expect(syr.daysOfStock).toBeGreaterThanOrEqual(s.leadTimeDays);
    expect(syr.daysOfStock).toBeLessThan(s.leadTimeDays + s.safetyDays);
    expect(syr.runOut).toBe('low');
    expect(row('OLD-1').recommend).toBe(0);
    expect(row('NEW-1').recommend).toBe(0);
  });

  it('the Suggested PO drafts the same bottles, from the supplier that sold them', async () => {
    const po = ok(await auth('get', '/api/reports/purchase-order?days=14'), 'suggested PO');
    const line = po.lines.find(l => l.itemCode === 'SYR-VAN');
    expect(line, JSON.stringify(po.lines)).toBeTruthy();
    expect(line.displayUnit).toBe('pcs');
    expect(line.suggestedOrder).toBe(row('SYR-VAN').recommend);
    expect(po.lines.find(l => l.itemCode === 'OLD-1')).toBeUndefined();
    // Each item goes to the supplier it was last bought from, so the drafts split.
    expect(line.supplierName).toMatch(/metro syrups/i);
    const cups = po.lines.find(l => l.itemCode === 'CUP-12');
    expect(cups, JSON.stringify(po.lines)).toBeTruthy();
    expect(cups.supplierName).toMatch(/paper goods trading/i);
  });

  it("each supplier's own lead time decides how much to buy of what it supplies", async () => {
    const metro = await M('Supplier').findOne({ name: /metro syrups/i }).lean();
    // Refused: not a whole number of days, or out of range.
    for (const bad of [-1, 91, 2.5, 'soon']) {
      expect((await auth('patch', `/api/suppliers/${metro._id}`).send({ leadTimeDays: bad })).status, String(bad)).toBe(400);
    }
    ok(await auth('patch', `/api/suppliers/${metro._id}`).send({ leadTimeDays: 2, paymentTerms: '15 days' }), 'set lead time');
    const saved = await M('Supplier').findById(metro._id).lean();
    expect(saved).toMatchObject({ leadTimeDays: 2, paymentTerms: '15 days' });   // contact details save at once, no approval

    const res = ok(await auth('get', '/api/analytics/stock-movement'), 'stock movement');
    const syr = res.rows.find(r => r.itemCode === 'SYR-VAN'), cups = res.rows.find(r => r.itemCode === 'CUP-12'), st = res.settings;
    expect(syr).toMatchObject({ leadTimeDays: 2, leadFromSupplier: true });
    expect(syr.supplierName).toMatch(/metro syrups/i);
    // Paper Goods was typed on the order, never saved with a lead time: the default.
    expect(cups).toMatchObject({ leadTimeDays: st.leadTimeDays, leadFromSupplier: false });
    expect(syr.recommend).toBe(Math.max(0, Math.ceil((SYRUP_SOLD / syr.inStockDays) * (st.coverDays + 2 + st.safetyDays) - (30 - SYRUP_SOLD) - 4 - 1e-9)));
    // A 2-day supplier needs less than the 7-day default would have asked for.
    expect(syr.recommend).toBeLessThan(row('SYR-VAN').recommend);
    // The Suggested PO drafts the same amount, and carries the lead time.
    const po = ok(await auth('get', '/api/reports/purchase-order?days=14'), 'suggested PO');
    expect(po.lines.find(l => l.itemCode === 'SYR-VAN')).toMatchObject({ suggestedOrder: syr.recommend, leadTimeDays: 2 });
    row = (code) => res.rows.find(r => r.itemCode === code);                   // later steps read the new figures
  });

  it('the setup workbook reads a lead time for each supplier', async () => {
    const r = ok(await auth('post', '/api/suppliers/import').send({ rows: [
      { name: 'Quick Cups Co', leadTimeDays: '3' }, { name: 'Slow Freight Co', leadTimeDays: '120' }, { name: 'No Lead Co', leadTimeDays: '' },
    ] }), 'supplier import');
    expect(r.skipped.map(x => x.row)).toEqual([2]);                              // 120 days is out of range
    expect((await M('Supplier').findOne({ name: /quick cups/i }).lean()).leadTimeDays).toBe(3);
    expect((await M('Supplier').findOne({ name: /no lead/i }).lean()).leadTimeDays).toBeNull();
    const tpl = ok(await auth('get', '/api/export/suppliers?template=1'), 'template');
    expect(tpl.columns).toContain('leadTimeDays');
  });

  it('a draft made from it can be saved and received, and the stock comes in as whole bottles', async () => {
    const want = row('SYR-VAN').recommend;
    const syrup = await item('SYR-VAN');
    const po = ok(await auth('post', '/api/purchase-orders').send({
      supplier: 'Metro Syrups',
      lines: [{ invId: String(syrup._id), itemName: syrup.itemName, unit: 'pcs', packSize: 2, orderedQty: want, unitCost: 350 }],
    }), 'suggested purchase order');
    ok(await auth('post', `/api/purchase-orders/${po.purchaseOrder._id}/receive`).send({ received: [{ index: 0, receivedQty: want }] }), 'receive suggested');
    expect((await item('SYR-VAN')).stockQty).toBe((30 - SYRUP_SOLD + want) * 2000);
    const after = ok(await auth('get', '/api/analytics/stock-movement'), 'stock movement after').rows.find(r => r.itemCode === 'SYR-VAN');
    expect(after.stock).toBe(30 - SYRUP_SOLD + want);
    expect(after.recommend).toBe(0);                                                 // nothing more to buy now
    expect(after.runOut).toBeNull();
  });
});
