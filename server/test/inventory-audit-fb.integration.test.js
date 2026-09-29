// Inventory audit, cafe side: measured ingredients in g and ml.
//
//   - a recipe sale deducts quantity x recipe qty, in base units
//   - several ingredients succeed or fail together
//   - a void / refund gives back exactly what the sale took, even after the
//     recipe has changed, and at the cost it left at
//   - two tills racing for the last unit: exactly one sale goes through
//   - the same order sent twice is created once
//   - after a random run of sales, voids, refunds and waste, every item's
//     stock equals the sum of its stock card, and the books still tie
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';
import { withLedgerMaintenance } from '../lib/ledgerGuard.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const stock = async (doc) => (await M('Inventory').findById(doc._id).lean()).stockQty;
const cardSum = async (doc) => (await M('StockCard').find({ inventoryId: String(doc._id) }).lean())
  .reduce((s, c) => s + (Number(c.qtyChange) || 0), 0);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'auditBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'auditBoss');
  await M('Category').create({ name: 'Coffee' });
}, 120000);
afterAll(async () => { await ctx.stop(); });

let beans, milk, cup, latte;
beforeEach(async () => {
  await withLedgerMaintenance(async () => {
    for (const n of ['Product', 'Inventory', 'Order', 'StockCard', 'JournalEntry', 'AddOn']) await M(n).deleteMany({});
  });
  // Opening stock goes in through the stock card like any other movement.
  const open = async (doc) => {
    const d = await M('Inventory').create(doc);
    await M('StockCard').create({ inventoryId: String(d._id), itemName: d.itemName, type: 'Initial', reference: 'OPEN', qtyChange: d.stockQty, balanceAfter: d.stockQty, unitCost: d.unitCost });
    return d;
  };
  beans = await open({ itemCode: 'BEAN', itemName: 'BEANS', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, stockQty: 1000, unitCost: 1.2 });
  milk = await open({ itemCode: 'MILK', itemName: 'MILK', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000, stockQty: 5000, unitCost: 0.08 });
  cup = await open({ itemCode: 'CUP', itemName: 'CUP', unit: 'pcs', stockQty: 100, unitCost: 3 });
  latte = await M('Product').create({
    name: 'Latte', category: 'Coffee', basePrice: 150,
    baseRecipe: [
      { invId: String(beans._id), name: 'BEANS', qty: 18, unit: 'g', packBase: 1 },
      { invId: String(milk._id), name: 'MILK', qty: 200, unit: 'ml', packBase: 1 },
      { invId: String(cup._id), name: 'CUP', qty: 1, unit: 'pcs', packBase: 1 },
    ],
    addOns: [{ name: 'Extra Shot', price: 30, recipe: [{ invId: String(beans._id), name: 'BEANS', qty: 18, unit: 'g', packBase: 1 }] }],
  });
});

const place = async (quantity = 1, { shot = false, headers = {} } = {}) => {
  let r = as('post', '/api/orders');
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  const placed = await r.send({
    table: 'Takeout', paymentMethod: 'Cash', customerName: 'Walk-in',
    items: [{ productId: String(latte._id), name: 'Latte', price: 150, quantity, selectedAddOns: shot ? [{ name: 'Extra Shot', price: 30 }] : [] }],
  });
  expect(placed.status, JSON.stringify(placed.body)).toBe(200);
  return placed.body.order;
};
const complete = (order) => as('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
const sell = async (quantity = 1, opts) => {
  const o = await place(quantity, opts);
  const done = await complete(o);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return o;
};

describe('a recipe sale', () => {
  it('3 lattes of 18 g beans and 200 ml milk take 54 g and 600 ml, and 3 cups', async () => {
    await sell(3);
    expect(await stock(beans)).toBe(1000 - 54);
    expect(await stock(milk)).toBe(5000 - 600);
    expect(await stock(cup)).toBe(97);
  });

  it('an extra shot takes its own 18 g on top', async () => {
    await sell(2, { shot: true });
    expect(await stock(beans)).toBe(1000 - 2 * 18 - 2 * 18);
  });

  it('records on the order exactly what it took, at the cost it took it', async () => {
    const o = await sell(3);
    const saved = await M('Order').findById(o._id).lean();
    const beansMove = saved.stockMoves.find(m => m.invId === String(beans._id));
    expect(beansMove).toMatchObject({ qty: 54, unitCost: 1.2, lineIndex: 0 });
    const card = await M('StockCard').findOne({ inventoryId: String(beans._id), type: 'Sale' }).lean();
    expect(card.unitCost).toBe(1.2);          // used to be blank on every sale row
  });

  it('when one ingredient is short, nothing is taken from the others', async () => {
    await M('Inventory').updateOne({ _id: milk._id }, { $set: { stockQty: 100 } });   // not enough for one latte
    const o = await place(1);
    const done = await complete(o);
    expect(done.status).toBe(400);
    expect(await stock(beans)).toBe(1000);
    expect(await stock(cup)).toBe(100);
    expect((await M('Order').findById(o._id).lean()).status).not.toBe('Completed');
  });
});

describe('giving it back', () => {
  it('a void restores exactly what the sale took, after the recipe has changed', async () => {
    const o = await sell(3);
    // The recipe changes after the sale: 25 g now, and no cup.
    await M('Product').updateOne({ _id: latte._id }, { $set: { baseRecipe: [
      { invId: String(beans._id), name: 'BEANS', qty: 25, unit: 'g', packBase: 1 },
      { invId: String(milk._id), name: 'MILK', qty: 200, unit: 'ml', packBase: 1 },
    ] } });
    const r = await as('post', `/api/orders/${o._id}/void`).send({ reason: 'Restock' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stock(beans)).toBe(1000);   // 54 back, not 75
    expect(await stock(milk)).toBe(5000);
    expect(await stock(cup)).toBe(100);      // the cup comes back although the recipe no longer has one
  });

  it('reverses the cost of goods at what it was booked at, not today\'s cost', async () => {
    const o = await sell(3);
    await M('Inventory').updateOne({ _id: beans._id }, { $set: { unitCost: 9.99 } });   // cost moves after the sale
    await as('post', `/api/orders/${o._id}/void`).send({ reason: 'Restock' });
    const voidJe = await M('JournalEntry').findOne({ reference: new RegExp(`VOID.*${o.orderNumber}`) }).lean();
    const cogsBack = voidJe.lines.find(l => l.accountCode === '510000').credit;
    expect(cogsBack).toBeCloseTo(54 * 1.2 + 600 * 0.08 + 3 * 3, 2);
  });

  it('a full refund gives back the same quantities', async () => {
    const o = await sell(2);
    const r = await as('post', `/api/orders/${o._id}/refund`).send({ reason: 'Wrong order', inventoryAction: 'Restock' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stock(beans)).toBe(1000);
    expect(await stock(milk)).toBe(5000);
  });

  it('a partial refund of 1 of 3 gives back one latte\'s worth', async () => {
    const o = await sell(3);
    const r = await as('post', `/api/orders/${o._id}/partial-refund`).send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'Spilled', inventoryAction: 'Restock' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stock(beans)).toBe(1000 - 36);
    expect(await stock(milk)).toBe(5000 - 400);
  });
});

describe('races and replays', () => {
  it('two tills selling the last cup: exactly one goes through', async () => {
    await M('Inventory').updateOne({ _id: cup._id }, { $set: { stockQty: 1 } });
    const orders = [];
    for (let i = 0; i < 5; i++) orders.push(await place(1));
    const results = await Promise.all(orders.map(o => complete(o)));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(await stock(cup)).toBe(0);
  });

  it('the same order sent twice with one key is created once', async () => {
    const headers = { 'Idempotency-Key': 'till-2-sale-00017' };
    const first = await place(1, { headers });
    const again = await place(1, { headers });
    expect(String(again._id)).toBe(String(first._id));
    expect(await M('Order').countDocuments({})).toBe(1);
  });

  it('completing an order twice deducts once', async () => {
    const o = await place(1);
    expect((await complete(o)).status).toBe(200);
    expect((await complete(o)).status).toBe(400);
    expect(await stock(beans)).toBe(1000 - 18);
  });
});

describe('the stock card is the ledger', () => {
  it('stock on hand equals the sum of the stock card after a random run of movements', async () => {
    // A fixed-seed generator, so a failure can be replayed exactly.
    let seed = 20260929;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const done = [];
    for (let step = 0; step < 40; step++) {
      const pick = rnd();
      if (pick < 0.45 || done.length === 0) {
        const o = await place(1 + Math.floor(rnd() * 3), { shot: rnd() < 0.3 });
        const r = await complete(o);
        if (r.status === 200) done.push(o);
      } else if (pick < 0.6) {
        const o = done.splice(Math.floor(rnd() * done.length), 1)[0];
        await as('post', `/api/orders/${o._id}/void`).send({ reason: rnd() < 0.7 ? 'Restock' : 'Spoilage' });
      } else if (pick < 0.75) {
        const o = done.splice(Math.floor(rnd() * done.length), 1)[0];
        await as('post', `/api/orders/${o._id}/partial-refund`).send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'x', inventoryAction: 'Restock' });
      } else {
        const item = [beans, milk, cup][Math.floor(rnd() * 3)];
        await as('post', `/api/inventory/spoilage/${item._id}`).send({ qty: item === cup ? 1 : 7, reason: 'Spoiled' });
      }
    }
    for (const item of [beans, milk, cup]) {
      expect(await stock(item)).toBeCloseTo(await cardSum(item), 6);
    }
    const health = await as('get', '/api/reports/books-health');
    expect(health.status).toBe(200);
    const stockCheck = health.body.checks.find(c => c.key === 'stockCard');
    expect(stockCheck.ok, JSON.stringify(stockCheck.detail)).toBe(true);
    const tb = await trialBalance();
    expect(tb.debits).toBeCloseTo(tb.credits, 2);
  }, 120000);

  it('refuses to edit or delete a stock card row', async () => {
    await sell(1);
    await expect(M('StockCard').updateMany({}, { $set: { qtyChange: 0 } })).rejects.toThrow(/append-only/);
    await expect(M('StockCard').deleteMany({})).rejects.toThrow(/append-only/);
  });
});
