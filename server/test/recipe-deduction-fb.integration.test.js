// A café drink takes its ingredients out of stock, in the right unit.
//
// Stock is held in base units (g / ml / pcs) and shown in kg / L, while a
// recipe is written in the unit the barista weighs in. A 1 kg bag with a 20 g
// drink poured out of it must read 0.98 kg - not 980 of something, and not a
// bag short.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, beans, milk, latte;
const M = (n) => mongoose.model(n);
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const stockOf = async (id) => {
  const i = await M('Inventory').findById(id).lean();
  return { base: i.stockQty, shown: i.stockQty / (i.unitMultiplier || 1), unit: i.displayUnit || i.unit };
};
const sellOne = async (qty = 1) => {
  const placed = await as('post', '/api/orders').send({
    table: 'Counter', paymentMethod: 'Cash', customerName: 'Test',
    items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity: qty }],
  });
  expect(placed.body.success).toBe(true);
  const done = await as('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
  expect(done.body.success, JSON.stringify(done.body).slice(0, 200)).toBe(true);
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'RecipeBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'RecipeBoss');
}, 120000);
afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Inventory').deleteMany({});
  await M('Product').deleteMany({});
  // One 1 kg bag of beans and 2 L of milk, stored the way the app stores them.
  beans = await M('Inventory').create({
    itemName: 'BEANS PROFILE(2)', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
    packSize: 1, stockQty: 1000, unitCost: 386 / 1000, businessType: 'fb',
  });
  milk = await M('Inventory').create({
    itemName: 'FRESH MILK', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000,
    stockQty: 2000, unitCost: 95 / 1000, businessType: 'fb',
  });
  latte = await M('Product').create({
    name: 'Latte', category: 'Coffee', basePrice: 130, businessType: 'fb',
    baseRecipe: [
      { invId: String(beans._id), name: 'BEANS PROFILE(2)', qty: 20, unit: 'g' },
      { invId: String(milk._id), name: 'FRESH MILK', qty: 150, unit: 'ml' },
    ],
  });
});

describe('selling a drink', () => {
  it('takes 20 g out of a 1 kg bag, leaving 0.98 kg', async () => {
    await sellOne();
    expect(await stockOf(beans._id)).toEqual({ base: 980, shown: 0.98, unit: 'kg' });
    expect(await stockOf(milk._id)).toEqual({ base: 1850, shown: 1.85, unit: 'L' });
  });

  it('keeps counting down drink by drink, without drift', async () => {
    for (let i = 0; i < 6; i++) await sellOne();
    expect(await stockOf(beans._id)).toEqual({ base: 880, shown: 0.88, unit: 'kg' });
  });

  it('takes the whole order at once when two are rung up together', async () => {
    await sellOne(2);
    expect(await stockOf(beans._id)).toEqual({ base: 960, shown: 0.96, unit: 'kg' });
  });

  it('values what is left at the same cost per kilo', async () => {
    await sellOne();
    const left = await M('Inventory').findById(beans._id).lean();
    // 0.98 kg of a P386/kg bag is P378.28 on the books.
    expect(Math.round(left.stockQty * left.unitCost * 100) / 100).toBe(378.28);
  });

  it('refuses the sale that would take more than is there, rather than going negative', async () => {
    await M('Inventory').findByIdAndUpdate(beans._id, { stockQty: 10 });   // 10 g left, a drink needs 20
    const placed = await as('post', '/api/orders').send({
      table: 'Counter', paymentMethod: 'Cash', customerName: 'Test',
      items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity: 1 }],
    });
    const done = await as('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
    expect(done.status).toBe(400);
    expect(done.body.error).toMatch(/INSUFFICIENT STOCK/i);
    expect((await stockOf(beans._id)).base).toBe(10);
  });
});
