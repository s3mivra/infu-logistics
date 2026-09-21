// A finished good that remembers how it is made.
//
// Spanish milk, cold brew, simple syrup: bought-in stock turned into stock the
// cafe makes. The first batch is entered by hand. Every batch after that used
// to be entered by hand as well - every material, every quantity - so the
// recipe now lives on the item it makes, and the next batch is "pick it, say
// how much". Some of what goes in is not stock at all - the water in a cold
// brew - so a batch can carry a line that is recorded and never deducted.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CafeSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CafeSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

let condensed, milk, spanish;
beforeEach(async () => {
  for (const n of ['ProductionOrder', 'Inventory', 'StockCard', 'JournalEntry']) await M(n).deleteMany({});
  condensed = await M('Inventory').create({ itemCode: 'RM-COND', itemName: 'CONDENSED MILK', unit: 'g', stockQty: 3770, unitCost: 0.175 });
  milk = await M('Inventory').create({ itemCode: 'RM-MILK', itemName: 'FRESH MILK', unit: 'ml', stockQty: 20000, unitCost: 0.095 });
  spanish = await M('Inventory').create({ itemCode: 'FG-SPAN', itemName: 'SPANISH MILK', unit: 'ml', stockQty: 0, unitCost: 0 });
});

// One litre of Spanish milk: 377 g condensed, 500 ml milk, and 200 ml of water
// that comes from the tap, not from stock.
const LITRE = [
  { invId: () => condensed._id, qty: 377 },
  { invId: () => milk._id, qty: 500 },
  { nonStock: true, name: 'Filtered Water', qty: 200, unit: 'ml' },
];
const file = (over = {}) => auth('post', '/api/production-orders').send({
  materials: LITRE.map(m => (m.nonStock ? m : { invId: String(m.invId()), qty: m.qty })),
  outputType: 'existing', outputInvId: String(spanish._id), outputQty: 1000,
  ...over,
});

// File, approve, and say what actually came out of it. The recipe is written
// down at that last step, so a batch that never happened cannot teach one.
const run = async (over = {}, actual = 1000) => {
  const filed = await file(over);
  const id = filed.body.order._id;
  await auth('post', `/api/production-orders/${id}/approve`).send({});
  await auth('post', `/api/production-orders/${id}/reconcile`).send({ actualOutputQty: actual });
  return filed;
};

describe('a batch with something that is not stock in it', () => {
  it('files, with the water written down as part of the batch', async () => {
    const res = await file();
    expect(res.body.success).toBe(true);
    const water = res.body.order.materials.find(m => m.itemName === 'Filtered Water');
    expect(water).toMatchObject({ nonStock: true, qty: 200, unit: 'ml' });
    expect(water.invId).toBeFalsy();
  });

  it('takes only stock when approved, and costs only stock', async () => {
    const { body } = await file();
    const approved = await auth('post', `/api/production-orders/${body.order._id}/approve`).send({});
    expect(approved.body.success).toBe(true);

    expect((await M('Inventory').findById(condensed._id)).stockQty).toBe(3770 - 377);
    expect((await M('Inventory').findById(milk._id)).stockQty).toBe(20000 - 500);
    // 377 x 0.175 + 500 x 0.095. The water costs nothing and comes from nowhere.
    expect(approved.body.order.totalMaterialsCost).toBeCloseTo(65.975 + 47.5, 6);
  });

  it('still refuses a line with no name', async () => {
    const res = await auth('post', '/api/production-orders').send({
      materials: [{ invId: String(milk._id), qty: 100 }, { nonStock: true, name: '  ', qty: 50, unit: 'ml' }],
      outputType: 'existing', outputInvId: String(spanish._id), outputQty: 100,
    });
    expect(res.status).toBe(400);
  });
});

describe('remembering the recipe', () => {
  it('saves the materials on the item, with what it actually made as its yield', async () => {
    // Planned a litre, got 960 ml. What these materials make is 960 ml, and
    // that is the figure the next batch has to be scaled against.
    await run({ saveRecipe: true }, 960);
    const item = await M('Inventory').findById(spanish._id).lean();
    expect(item.recipeYield).toBe(960);
    expect(item.productionRecipe.map(r => [r.itemName, r.qty, !!r.nonStock])).toEqual([
      ['CONDENSED MILK', 377, false],
      ['FRESH MILK', 500, false],
      ['Filtered Water', 200, true],
    ]);
  });

  it('leaves the item alone when not asked to', async () => {
    await run();
    const item = await M('Inventory').findById(spanish._id).lean();
    expect(item.productionRecipe || []).toHaveLength(0);
  });

  it('will not make an item out of itself', async () => {
    const res = await auth('post', '/api/production-orders').send({
      materials: [{ invId: String(spanish._id), qty: 100 }],
      outputType: 'existing', outputInvId: String(spanish._id), outputQty: 100, saveRecipe: true,
    });
    expect(res.status).toBe(400);
  });

  it('gives a brand-new item its recipe the moment it exists', async () => {
    const filed = await auth('post', '/api/production-orders').send({
      materials: [{ invId: String(milk._id), qty: 900 }, { nonStock: true, name: 'Ice', qty: 100, unit: 'g' }],
      outputType: 'new', outputName: 'Iced Milk Base', outputUnit: 'ml', outputQty: 1000, saveRecipe: true,
    });
    expect(filed.body.success).toBe(true);
    await auth('post', `/api/production-orders/${filed.body.order._id}/approve`).send({});
    await auth('post', `/api/production-orders/${filed.body.order._id}/reconcile`).send({ actualOutputQty: 980 });

    const made = await M('Inventory').findOne({ itemName: 'ICED MILK BASE' }).lean();
    expect(made.stockQty).toBe(980);
    expect(made.recipeYield).toBe(980);
    expect(made.productionRecipe.map(r => r.itemName)).toEqual(['FRESH MILK', 'Ice']);
  });

  it('is not written down by a batch that was filed and then rejected', async () => {
    const filed = await file({ saveRecipe: true });
    const rej = await auth('post', `/api/production-orders/${filed.body.order._id}/reject`)
      .send({ reason: 'Wrong quantities' });
    expect(rej.body.success).toBe(true);
    const item = await M('Inventory').findById(spanish._id).lean();
    expect(item.productionRecipe || []).toHaveLength(0);
    expect(item.recipeYield ?? null).toBe(null);
  });

  it('can be forgotten again', async () => {
    await run({ saveRecipe: true });
    const res = await auth('delete', `/api/inventory/${spanish._id}/production-recipe`);
    expect(res.body.success).toBe(true);
    const item = await M('Inventory').findById(spanish._id).lean();
    expect(item.productionRecipe).toHaveLength(0);
    expect(item.recipeYield ?? null).toBe(null);
  });
});
