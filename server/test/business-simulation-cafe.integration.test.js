// The business, end to end (cafe): stock bought, drinks sold, and what the
// recipes used read back in Analytics -> Stock movement and the Suggested PO.
//
// The cafe counts INGREDIENTS, not drinks: a latte is 18 g of beans, 0.2 L of
// milk and one cup, exactly what the sale took off the shelf. Beans and milk
// may be bought in part; cups are counted in pcs and are bought whole.
// As in the logistics simulation, the sales go through the till and are then
// spread back across the month, with the stock card lines they wrote.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const M = (n) => mongoose.model(n);
let ctx, auth;
const ok = (res, what) => {
  if (res.status < 200 || res.status > 299 || res.body?.success === false) throw new Error(`${what} (${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`);
  return res.body;
};
const item = (code) => M('Inventory').findOne({ itemCode: code }).lean();

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  await makeUser({ name: 'CafeOwner', role: 'superadmin' });
  const tok = await loginStaff(ctx.app, 'CafeOwner');
  auth = (m, p) => request(ctx.app)[m](p).set('Authorization', `Bearer ${tok}`);
}, 120000);
afterAll(async () => { await ctx.stop(); });

// Lattes sold: [days ago, how many].
const SALES = [[27, 3], [24, 2], [21, 4], [18, 3], [15, 2], [12, 3], [9, 4], [6, 2], [3, 3], [1, 2]];
const LATTES = SALES.reduce((n, s) => n + s[1], 0);   // 28

describe('a month in the cafe, through the app', () => {
  beforeAll(async () => {
    ok(await auth('post', '/api/inventory/import').send({ items: [
      { itemCode: 'RM-BEAN', itemName: 'Espresso Beans', unit: 'kg', packSize: 1, qty: 0, unitCost: 900 },
      { itemCode: 'RM-MILK', itemName: 'Fresh Milk', unit: 'L', packSize: 1, qty: 0, unitCost: 95 },
      { itemCode: 'PK-CUP', itemName: 'Hot Cup 12oz', unit: 'pcs', qty: 0, unitCost: 4 },
    ] }), 'inventory import');
    ok(await auth('post', '/api/products/import-menu').send({ rows: [{ name: 'LATTE', category: 'COFFEE', srp: 150, ingredients: [
      { name: 'Espresso Beans', qty: 18, unit: 'g' }, { name: 'Fresh Milk', qty: 200, unit: 'ml' }, { name: 'Hot Cup 12oz', qty: 1, unit: 'pcs' },
    ] }] }), 'menu');

    const [beans, milk, cups] = await Promise.all(['RM-BEAN', 'RM-MILK', 'PK-CUP'].map(item));
    const po = ok(await auth('post', '/api/purchase-orders').send({ supplier: 'Metro Beans', lines: [
      { invId: String(beans._id), itemName: beans.itemName, unit: 'kg', packSize: 1, orderedQty: 1, unitCost: 900 },
      { invId: String(milk._id), itemName: milk.itemName, unit: 'L', packSize: 1, orderedQty: 8, unitCost: 95 },
      { invId: String(cups._id), itemName: cups.itemName, unit: 'pcs', orderedQty: 40, unitCost: 4 },
    ] }), 'purchase order');
    ok(await auth('post', `/api/purchase-orders/${po.purchaseOrder._id}/receive`).send({ received: [{ index: 0, receivedQty: 1 }, { index: 1, receivedQty: 8 }, { index: 2, receivedQty: 40 }] }), 'receive');

    const latte = await M('Product').findOne({ name: 'LATTE' }).lean();
    for (const [d, n] of SALES) {
      const o = ok(await auth('post', '/api/orders').send({ table: 'Takeout', paymentMethod: 'Cash',
        items: [{ productId: String(latte._id), name: latte.name, price: 150, quantity: n }] }), 'sale').order;
      ok(await auth('put', `/api/orders/${o._id}`).send({ status: 'Completed' }), 'complete');
      await M('Order').collection.updateOne({ _id: new mongoose.Types.ObjectId(String(o._id)) }, { $set: { createdAt: ago(d) } });
      await M('StockCard').collection.updateMany({ reference: o.orderNumber }, { $set: { date: ago(d) } });
    }
    await M('StockCard').collection.updateMany({ type: 'Stock Take Import' }, { $set: { date: ago(31) } });
    await M('StockCard').collection.updateMany({ type: 'Restock' }, { $set: { date: ago(30) } });
    await M('Inventory').collection.updateMany({}, { $set: { createdAt: ago(200) } });
  }, 240000);

  it('the recipes took exactly what was made from stock', async () => {
    expect((await item('RM-BEAN')).stockQty).toBe(1000 - 18 * LATTES);
    expect((await item('RM-MILK')).stockQty).toBe(8000 - 200 * LATTES);
    expect((await item('PK-CUP')).stockQty).toBe(40 - LATTES);
    const tb = await trialBalance();
    expect(tb.debits).toBeCloseTo(tb.credits, 2);
  });

  let mv;
  const row = (code) => mv.rows.find(r => r.itemCode === code);
  it('Stock movement counts the ingredients used, not drinks', async () => {
    mv = ok(await auth('get', '/api/analytics/stock-movement'), 'stock movement');
    expect(mv.wholeUnits).toBe(false);
    expect(row('RM-BEAN')).toMatchObject({ unit: 'g', soldQty: 18 * LATTES, transactions: SALES.length, soldDays: SALES.length });
    expect(row('RM-MILK')).toMatchObject({ unit: 'ml', soldQty: 200 * LATTES });
    expect(row('PK-CUP')).toMatchObject({ unit: 'pcs', soldQty: LATTES, stock: 40 - LATTES });
    expect(row('RM-BEAN').daysSinceSale).toBe(1);
  });

  it('buys ingredients in part, and cups in whole pieces, by the same formula', () => {
    const s = mv.settings, horizon = s.coverDays + s.leadTimeDays + s.safetyDays;
    for (const code of ['RM-BEAN', 'RM-MILK', 'PK-CUP']) {
      const r = row(code);
      expect(r.recommend, code).toBeGreaterThan(0);
      const need = (r.soldQty / r.inStockDays) * horizon - r.available - r.onOrder;
      if (code === 'PK-CUP') expect(r.recommend).toBe(Math.ceil(need));
      else expect(r.recommend).toBeCloseTo(need, 0);
    }
    expect(Number.isInteger(row('PK-CUP').recommend)).toBe(true);
  });

  it('the Suggested PO carries the same amounts, in the units a person buys in', async () => {
    const po = ok(await auth('get', '/api/reports/purchase-order?days=14'), 'suggested PO');
    const line = (code) => po.lines.find(l => l.itemCode === code);
    // Beans: grams used, bought by the kg, rounded up to a whole kg.
    expect(line('RM-BEAN')).toMatchObject({ displayUnit: 'kg', suggestedOrder: Math.ceil(row('RM-BEAN').recommend / 1000 - 1e-9) });
    expect(line('RM-MILK')).toMatchObject({ displayUnit: 'L', suggestedOrder: Math.ceil(row('RM-MILK').recommend / 1000 - 1e-9) });
    expect(line('PK-CUP')).toMatchObject({ displayUnit: 'pcs', suggestedOrder: row('PK-CUP').recommend });
  });
});
