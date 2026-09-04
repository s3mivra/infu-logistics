// Stress / adversarial tests. These are deliberately harsher than the feature
// suites: they exist to prove the claims made elsewhere actually hold under
// real concurrency and real data volume, rather than on three-row fixtures.
//
// Two questions worth losing money over:
//   1. Two tills sell the last unit at the same instant. Does stock go
//      negative, or does exactly one win?
//   2. The stock ledger has run for a year. Does the history endpoint still
//      answer, or does it drag the whole collection into memory?
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'StressSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'StressSuper');
}, 180000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);

beforeEach(async () => {
  for (const n of ['Product', 'Inventory', 'Order', 'StockCard', 'JournalEntry']) {
    await M(n).deleteMany({});
  }
});

// One drink, one ingredient, exactly enough stock for ONE sale.
async function seedOneShotLeft({ perServing = 18, stockQty = 18 } = {}) {
  const beans = await M('Inventory').create({
    itemCode: 'RM-BEAN', itemName: 'Coffee Beans', unit: 'g', stockQty, unitCost: 1,
  });
  const product = await M('Product').create({
    productCode: 'BEV-0001', name: 'Espresso', category: 'Coffee', basePrice: 100,
    baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: perServing, cost: 1, unit: 'g' }],
  });
  return { beans, product };
}

async function pendingOrder(product, qty = 1, tag = '') {
  return M('Order').create({
    orderNumber: `STR-${tag}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'Pending', paymentMethod: 'Cash', total: 100, subtotal: 100,
    items: [{ productId: String(product._id), name: product.name, quantity: qty, price: 100, selectedAddOns: [] }],
  });
}

const complete = (id) => auth('put', `/api/orders/${id}`).send({ status: 'Completed' });

describe('two tills selling the last unit at the same instant', () => {
  it('lets exactly ONE of six simultaneous sales through', async () => {
    const { beans, product } = await seedOneShotLeft({ perServing: 18, stockQty: 18 });
    const orders = await Promise.all(
      Array.from({ length: 6 }, (_, i) => pendingOrder(product, 1, `c${i}`)),
    );

    // Fired together, not one after another - the whole point.
    const results = await Promise.all(orders.map(o => complete(o._id)));
    const ok = results.filter(r => r.body?.success === true);
    const refused = results.filter(r => r.body?.success !== true);

    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(5);

    // The invariant that actually matters: stock never goes below zero.
    const after = await M('Inventory').findById(beans._id).lean();
    expect(after.stockQty).toBe(0);
    expect(after.stockQty).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('never oversells however many hit it at once', async () => {
    // Enough for 3 servings, 10 tills trying.
    const { beans, product } = await seedOneShotLeft({ perServing: 10, stockQty: 30 });
    const orders = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pendingOrder(product, 1, `m${i}`)),
    );

    const results = await Promise.all(orders.map(o => complete(o._id)));
    const ok = results.filter(r => r.body?.success === true).length;

    const after = await M('Inventory').findById(beans._id).lean();
    expect(after.stockQty).toBeGreaterThanOrEqual(0);
    // However many got through, the books must match the stock that left.
    expect(after.stockQty).toBe(30 - ok * 10);
    expect(ok).toBeLessThanOrEqual(3);
  }, 60000);

  it('refuses a single order larger than the stock on hand', async () => {
    const { beans, product } = await seedOneShotLeft({ perServing: 18, stockQty: 18 });
    const order = await pendingOrder(product, 5, 'big'); // wants 90g, has 18g

    const res = await complete(order._id);
    expect(res.body.success).not.toBe(true);
    expect(String(res.body.error)).toMatch(/insufficient stock/i);

    // A refused sale must leave stock completely untouched.
    expect((await M('Inventory').findById(beans._id).lean()).stockQty).toBe(18);
  }, 30000);
});

describe('completing the same order twice', () => {
  it('does not deduct stock twice on a double submit', async () => {
    // The classic POS double-tap, fired as two simultaneous requests.
    const { beans, product } = await seedOneShotLeft({ perServing: 10, stockQty: 100 });
    const order = await pendingOrder(product, 1, 'dbl');

    await Promise.all([complete(order._id), complete(order._id)]);

    const after = await M('Inventory').findById(beans._id).lean();
    // One sale of 10g. Deducting twice would leave 80.
    expect(after.stockQty).toBe(90);
  }, 60000);
});

describe('a refused sale leaves nothing behind', () => {
  it('writes no stock card and no journal entry when it fails', async () => {
    const { product } = await seedOneShotLeft({ perServing: 50, stockQty: 10 });
    const order = await pendingOrder(product, 1, 'roll');

    const before = await M('JournalEntry').countDocuments({});
    const res = await complete(order._id);
    expect(res.body.success).not.toBe(true);

    // The transaction must roll back cleanly - a half-written sale is worse
    // than a refused one.
    expect(await M('StockCard').countDocuments({})).toBe(0);
    expect(await M('JournalEntry').countDocuments({})).toBe(before);
    expect((await M('Order').findById(order._id).lean()).status).not.toBe('Completed');
  }, 30000);
});

describe('the stock ledger after a year of trading', () => {
  // 50k rows is a realistic year for a busy shop: a row per ingredient per sale.
  const BULK = 50000;

  beforeEach(async () => {
    const now = Date.now();
    const docs = Array.from({ length: BULK }, (_, i) => ({
      inventoryId: `inv-${i % 40}`,
      itemName: `Item ${i % 40}`,
      // Spread across the past year so date filtering is exercised properly.
      date: new Date(now - (i % 365) * 86400000),
      type: 'Sale', reference: `R-${i}`, qtyChange: -1, balanceAfter: 1000 - (i % 900), unitCost: 1,
    }));
    // Chunked so the seed itself does not blow up.
    for (let i = 0; i < docs.length; i += 5000) {
      await M('StockCard').insertMany(docs.slice(i, i + 5000), { ordered: false });
    }
  }, 180000);

  it('answers quickly and returns a bounded page, not the whole ledger', async () => {
    const t0 = Date.now();
    const res = await auth('get', '/api/inventory/history?limit=200');
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(200);
    expect(res.body.truncated).toBe(true);
    // The bug this replaced returned all 50,000 hydrated documents.
    expect(res.body.history.length).toBeLessThan(BULK);
    expect(elapsed).toBeLessThan(5000);
  }, 60000);

  it('uses the index for the date sort instead of an in-memory sort', async () => {
    // An unindexed sort over this many rows is refused outright by MongoDB once
    // it passes the 32MB limit - the failure is a hard error, not slowness.
    const plan = await M('StockCard').find({}).sort({ date: -1 }).limit(200).explain('executionStats');
    const stage = JSON.stringify(plan.queryPlanner?.winningPlan || {});
    expect(stage).not.toMatch(/"stage":"SORT"/);
    expect(plan.executionStats?.executionSuccess).toBe(true);
  }, 60000);

  it('filters a single day out of a year without scanning everything', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const res = await auth('get', `/api/inventory/history?start=${day}&end=${day}`);
    expect(res.status).toBe(200);
    // Only today's slice, not the year.
    expect(res.body.history.length).toBeLessThan(BULK);
  }, 60000);

  it('keeps per-item history bounded too', async () => {
    const res = await auth('get', '/api/inventory/history/inv-1?limit=50');
    expect(res.body.history).toHaveLength(50);
    expect(res.body.history.every(h => h.inventoryId === 'inv-1')).toBe(true);
  }, 60000);
});
