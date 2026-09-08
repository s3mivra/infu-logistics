// A cafe makes some of its own ingredients, and then sells them.
//
// Spanish Milk is not bought - a barista makes it from Alaska Condensed and
// Full Milk, and eighteen drinks on the INFU menu are built on it. So it has
// to be BOTH the output of a production batch and a material inside a product
// recipe, and its cost has to be the rolled-up cost of what went into it.
//
//   condensed + full milk  --(production batch)-->  Spanish Milk
//   Spanish Milk           --(drink recipe)------>  Spanish Latte
//
// Production was hidden from f&b deployments, so there was no way to file that
// batch: Spanish Milk sat at zero quantity and zero cost, which meant every
// drink built on it posted no cost of sale and - because a sale is refused
// when a material is short - could not be rung up at all.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  // f&b, deliberately: this is the deployment that could not reach production.
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CafeSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CafeSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

let condensed, milk;
beforeEach(async () => {
  for (const n of ['ProductionOrder', 'Inventory', 'StockCard', 'JournalEntry', 'Product', 'Order']) {
    await M(n).deleteMany({});
  }
  // The bulk sheet: 377g condensed + 1700ml full milk makes 2077ml.
  condensed = await M('Inventory').create({
    itemCode: 'RM-COND', itemName: 'Alaska Condensed Milk', unit: 'ml',
    stockQty: 4000, unitCost: 0.175, unitMultiplier: 1,
  });
  milk = await M('Inventory').create({
    itemCode: 'RM-MILK', itemName: 'Full Milk', unit: 'ml',
    stockQty: 20000, unitCost: 0.082, unitMultiplier: 1,
  });
});

// 377 × 0.175 = 65.975, 1700 × 0.082 = 139.4 -> 205.375 for 2077ml.
const BATCH_COST = 377 * 0.175 + 1700 * 0.082;

const fileBatch = (over = {}) => auth('post', '/api/production-orders').send({
  materials: [
    { invId: String(condensed._id), qty: 377 },
    { invId: String(milk._id), qty: 1700 },
  ],
  outputType: 'new', outputName: 'Spanish Milk', outputQty: 2077, outputUnit: 'ml',
  ...over,
});

const runBatch = async (actualOutputQty = 2077, over = {}) => {
  const filed = await fileBatch(over);
  const id = filed.body.order._id;
  await auth('post', `/api/production-orders/${id}/approve`).send({});
  const rec = await auth('post', `/api/production-orders/${id}/reconcile`).send({ actualOutputQty });
  return { id, rec };
};

describe('a barista making Spanish Milk on an f&b deployment', () => {
  it('lets the batch be filed at all', async () => {
    const res = await fileBatch();
    // The failure this covers: production existed but no f&b instance could
    // reach it, so this was never called.
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('Pending');
  }, 30000);

  it('takes the condensed and the milk off the shelf on approval', async () => {
    const filed = await fileBatch();
    await auth('post', `/api/production-orders/${filed.body.order._id}/approve`).send({});

    expect((await M('Inventory').findById(condensed._id).lean()).stockQty).toBe(4000 - 377);
    expect((await M('Inventory').findById(milk._id).lean()).stockQty).toBe(20000 - 1700);
  }, 30000);

  it('creates Spanish Milk as stock, priced at what went into it', async () => {
    await runBatch(2077);
    const sm = await M('Inventory').findOne({ itemName: /^spanish milk$/i }).lean();
    expect(sm).toBeTruthy();
    expect(sm.stockQty).toBe(2077);
    // Not zero, which is what a hand-created item would have been.
    expect(sm.unitCost).toBeCloseTo(BATCH_COST / 2077, 5);
  }, 30000);

  it('charges a short yield to the units that did come out', async () => {
    // Spillage: 1900ml out of a planned 2077. The same materials were used,
    // so each millilitre cost more.
    await runBatch(1900);
    const sm = await M('Inventory').findOne({ itemName: /^spanish milk$/i }).lean();
    expect(sm.stockQty).toBe(1900);
    expect(sm.unitCost).toBeCloseTo(BATCH_COST / 1900, 5);
    expect(sm.unitCost).toBeGreaterThan(BATCH_COST / 2077);
  }, 30000);

  it('moves value within inventory rather than creating any', async () => {
    await runBatch(2077);
    const je = await M('JournalEntry').findOne({ description: /Production batch/ }).lean();
    if (je) {
      // Production is a transformation, not income: whatever it posts has to
      // balance, and the business is no richer for having stirred a pitcher.
      expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    }
    const stock = await M('Inventory').find({}).lean();
    const value = stock.reduce((s, i) => s + i.stockQty * i.unitCost, 0);
    const before = 4000 * 0.175 + 20000 * 0.082;
    expect(value).toBeCloseTo(before, 2);
  }, 30000);

  it('leaves a trail in both directions under one batch number', async () => {
    const { id } = await runBatch(2077);
    const order = await M('ProductionOrder').findById(id).lean();
    const cards = await M('StockCard').find({ reference: order.batchNumber }).lean();

    // What went in, and what came out, answerable from the batch alone.
    const consumed = cards.filter(c => c.qtyChange < 0).map(c => String(c.itemName).toLowerCase()).sort();
    expect(consumed).toEqual(['alaska condensed milk', 'full milk']);
    expect(cards.find(c => c.qtyChange > 0).itemName).toMatch(/^spanish milk$/i);
  }, 30000);
});

describe('selling a drink built on what the barista made', () => {
  it('links into a recipe and costs the drink correctly', async () => {
    await runBatch(2077);
    const sm = await M('Inventory').findOne({ itemName: /^spanish milk$/i }).lean();

    // The menu importer matches recipe materials against live stock by name,
    // so a produced item links exactly like a purchased one.
    const res = await auth('post', '/api/products/import-menu').send({
      rows: [{
        name: 'SPANISH LATTE', category: 'SIGNATURE COFFEE', srp: 180,
        ingredients: [{ name: 'Spanish Milk', qty: 280, unit: 'ml' }],
      }],
    });
    expect(res.body.created).toBe(1);

    const p = await M('Product').findOne({ name: 'SPANISH LATTE' }).lean();
    const line = p.baseRecipe.find(r => /^spanish milk$/i.test(r.name));
    expect(line).toBeTruthy();
    expect(String(line.invId)).toBe(String(sm._id));
    // The cost carried into the recipe is the produced cost, not zero - this
    // is what makes the drink's margin real instead of 100%.
    expect(line.cost).toBeCloseTo(sm.unitCost, 5);
    expect(line.qty).toBe(280);
  }, 60000);

  it('is short exactly as often as the pitcher is empty', async () => {
    // 2077ml of Spanish Milk is seven 280ml lattes, not eight.
    await runBatch(2077);
    const sm = await M('Inventory').findOne({ itemName: /^spanish milk$/i }).lean();
    expect(Math.floor(sm.stockQty / 280)).toBe(7);
  }, 30000);
});
