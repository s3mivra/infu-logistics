// Stock movement for a cafe (features/stock-movement.js): ingredients, in parts.
//
// Logistics counts whole units sold and buys whole units; a cafe counts what
// its recipes took from stock and may buy part of a unit. Only completed
// sales count, and an item that was out of stock, or is too new to judge, is
// not called dead.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);


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

describe('cafe: what the recipes took', () => {
  let ctx, as, beans, milk;
  beforeAll(async () => {
    ({ ctx, as } = await boot('fb'));
    beans = await item({ itemCode: 'BEAN', itemName: 'ESPRESSO BEANS', unit: 'g', stockQty: 500, createdAt: ago(200) });
    milk = await item({ itemCode: 'MILK', itemName: 'FRESH MILK', unit: 'L', stockQty: 2.5, createdAt: ago(200) });
    await order('fb', { createdAt: ago(100), stockMoves: [{ invId: String(milk._id), qty: 0.1 }] });
    for (let d = 1; d <= 10; d++) {
      await order('fb', { createdAt: ago(d), stockMoves: [{ invId: String(beans._id), qty: 18 }, { invId: String(milk._id), qty: 0.25 }] });
    }
    await order('fb', { createdAt: ago(3), status: 'Voided', stockMoves: [{ invId: String(beans._id), qty: 1000 }] });
  }, 120000);
  afterAll(async () => { await ctx.stop(); });

  it('counts the grams and litres used, in parts, and leaves voided orders out', async () => {
    const res = await as('get', '/api/analytics/stock-movement?start=' + new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10));
    expect(res.body.wholeUnits).toBe(false);
    const row = (code) => res.body.rows.find(r => r.itemCode === code);
    expect(row('BEAN')).toMatchObject({ unit: 'g', soldQty: 180, transactions: 10 });
    expect(row('MILK')).toMatchObject({ unit: 'L', soldQty: 2.5, stock: 2.5 });
  });

  it('may recommend part of a unit', async () => {
    const milkRow = (await as('get', '/api/analytics/stock-movement')).body.rows.find(r => r.itemCode === 'MILK');
    expect(milkRow.recommend).toBeGreaterThan(0);
    expect(Number.isInteger(milkRow.recommend * 1000)).toBe(true);                     // kept to 3 decimals, not rounded to a whole litre
  });
});
