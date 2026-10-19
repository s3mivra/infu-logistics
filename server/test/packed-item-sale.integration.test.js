// A packed good imported from the stock sheet ("Pack 377 / Unit g": a 377 g
// can) becomes a product that sells ONE CAN per unit. The product created with
// it used to deduct one display unit instead - 1 kg = 1000 g - so selling one
// can took 1000 / 377 = 2.6525 cans off the shelf.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { normaliseInventoryRow, inventoryImportPayload } from '../../client/src/shared/importSheets.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const importRow = async (row) => {
  const r = await as('post', '/api/inventory/import').send(inventoryImportPayload([normaliseInventoryRow(row)]));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};
const sell = async (productName, quantity) => {
  const p = await M('Product').findOne({ name: productName }).lean();
  const r = await as('post', '/api/orders').send({
    table: 'Walk In', customerName: 'Pack Test', paymentMethod: 'Cash', amountTendered: 100000,
    items: [{ productId: String(p._id), name: p.name, price: p.basePrice, quantity }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const done = await as('put', `/api/orders/${r.body.order._id}`).send({ status: 'Completed' });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'packBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'packBoss');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('selling a packed good takes one pack per unit sold', () => {
  it('a 377 g can: selling 1 takes exactly 377 g (one can)', async () => {
    await importRow({ Code: 'ACM-1', Product: 'ALASKA CONDENSED MILK', Pack: '377', Unit: 'g', Qty: '648', 'Cost / pack': '66', 'SRP / pack': '79' });
    const before = await M('Inventory').findOne({ itemCode: 'ACM-1' }).lean();
    expect(before.stockQty).toBeCloseTo(648 * 377, 6);
    await sell('ALASKA CONDENSED MILK', 1);
    const after = await M('Inventory').findOne({ itemCode: 'ACM-1' }).lean();
    expect(before.stockQty - after.stockQty).toBeCloseTo(377, 6);
    const card = await M('StockCard').findOne({ inventoryId: after._id, type: 'Sale' }).lean();
    expect(card.qtyChange).toBeCloseTo(-377, 6);
  });

  it('selling 3 takes three packs', async () => {
    const before = await M('Inventory').findOne({ itemCode: 'ACM-1' }).lean();
    await sell('ALASKA CONDENSED MILK', 3);
    const after = await M('Inventory').findOne({ itemCode: 'ACM-1' }).lean();
    expect(before.stockQty - after.stockQty).toBeCloseTo(3 * 377, 6);
  });

  it('an item counted in plain pieces still takes 1 piece per sale', async () => {
    await importRow({ Code: 'CUP-1', Product: 'PAPER CUP', Pack: '', Unit: 'pcs', Qty: '500', 'Cost / pack': '2', 'SRP / pack': '5' });
    await sell('PAPER CUP', 2);
    const after = await M('Inventory').findOne({ itemCode: 'CUP-1' }).lean();
    expect(after.stockQty).toBe(498);
  });

  it('repairs a product made before the fix, and leaves a hand-written recipe alone', async () => {
    const { repairPackRecipes } = await import('../server.js');
    const can = await M('Inventory').create({ itemCode: 'OLD-1', itemName: 'EVAP MILK', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, packSize: 0.37, stockQty: 3700, unitCost: 0.1, businessType: 'log' });
    // The shape the old import wrote: one line, qty = unitMultiplier, no packBase.
    const broken = await M('Product').create({ productCode: 'OLD-1', name: 'EVAP MILK', category: 'Dairy', basePrice: 50, businessType: 'log',
      baseRecipe: [{ invId: String(can._id), name: 'EVAP MILK', qty: 1000, unit: 'g' }] });
    // Someone's own recipe that happens to use a whole kilo: not the import's shape.
    const handMade = await M('Product').create({ productCode: 'BUNDLE-1', name: 'EVAP BULK', category: 'Dairy', basePrice: 130, businessType: 'log',
      baseRecipe: [{ invId: String(can._id), name: 'EVAP MILK', qty: 1000, unit: 'g' }] });

    expect(await repairPackRecipes()).toBeGreaterThanOrEqual(1);
    const fixed = await M('Product').findById(broken._id).lean();
    expect(fixed.baseRecipe[0]).toMatchObject({ qty: 370, packBase: 370 });
    expect((await M('Product').findById(handMade._id).lean()).baseRecipe[0].qty).toBe(1000);
    // Running it again changes nothing.
    await repairPackRecipes();
    expect((await M('Product').findById(broken._id).lean()).baseRecipe[0].qty).toBe(370);
  });

  it('a 1 kg bag still takes 1 kg per sale', async () => {
    await importRow({ Code: 'SUG-1', Product: 'WHITE SUGAR', Pack: '1', Unit: 'kg', Qty: '40', 'Cost / pack': '80', 'SRP / pack': '95' });
    const before = await M('Inventory').findOne({ itemCode: 'SUG-1' }).lean();
    await sell('WHITE SUGAR', 1);
    const after = await M('Inventory').findOne({ itemCode: 'SUG-1' }).lean();
    expect(before.stockQty - after.stockQty).toBeCloseTo(1000, 6);
  });
});
