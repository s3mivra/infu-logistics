// Importing the real inventory sheet must not leave the catalog pointing at
// an empty twin. A stock item added by hand gets an automatic code (RML...);
// the real sheet carries the business's own code for it. The import matched
// by code only, found nothing, and made a second item with the same name -
// while the product stayed linked to the first, empty one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const M = (n) => mongoose.model(n);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'LinkOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'LinkOwner');
  for (let i = 0; i < 120; i++) {
    if ((await request(app).get('/health')).body.startup === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const importRows = (items) => as('post', '/api/inventory/import').send({ items });

describe('importing the real inventory over items added by hand', () => {
  it('takes over the hand-made item instead of making a twin, and the product stays linked', async () => {
    const made = await as('post', '/api/inventory').send({ itemName: 'Alaska Condensed Milk', unit: 'pcs', displayUnit: 'pcs', stockQty: 0, unitCost: 60 });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const inv = await M('Inventory').findOne({ itemName: /^alaska condensed milk$/i }).lean();
    expect(inv.itemCode).toMatch(/^RML/);
    const prod = await M('Product').create({ name: 'Alaska Condensed Milk', category: 'MILK/JUICE', basePrice: 81, productCode: inv.itemCode,
      baseRecipe: [{ invId: String(inv._id), name: inv.itemName, qty: 1, packBase: 1, unit: 'pcs' }] });

    const r = await importRows([{ itemCode: 'MJ-1', itemName: 'ALASKA CONDENSED MILK', unit: 'pcs', qty: 24, unitCost: 62, srp: 81, category: 'MILK/JUICE' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const items = await M('Inventory').find({ itemName: /^alaska condensed milk$/i }).lean();
    expect(items).toHaveLength(1);                 // no twin
    expect(items[0]).toMatchObject({ itemCode: 'MJ-1', stockQty: 24 });
    const p = await M('Product').findById(prod._id).lean();
    expect(String(p.baseRecipe[0].invId)).toBe(String(items[0]._id));
    expect(p.productCode).toBe('MJ-1');
    expect(await M('Product').countDocuments({ name: /^alaska condensed milk$/i })).toBe(1);   // no second listing
  });

  it('still keeps two real SKUs that share a name apart', async () => {
    await importRows([{ itemCode: 'DKB-3', itemName: 'DK BLUEBERRY', unit: 'kg', qty: 2, unitCost: 300 }]);
    await importRows([{ itemCode: 'DKB-25', itemName: 'DK BLUEBERRY', unit: 'kg', qty: 1, unitCost: 280 }]);
    const codes = (await M('Inventory').find({ itemName: 'DK BLUEBERRY' }).lean()).map((i) => i.itemCode).sort();
    expect(codes).toEqual(['DKB-25', 'DKB-3']);
  });

  it('re-importing repairs a product already left on an empty twin', async () => {
    // The state an earlier import left behind: the product on the hand-made
    // item, the real stock on a second item with the sheet's code.
    const twin = await M('Inventory').create({ itemCode: 'RML9001', itemName: 'NESTLE CREAM', unit: 'pcs', displayUnit: 'pcs', stockQty: 0, businessType: 'log' });
    const real = await M('Inventory').create({ itemCode: 'MJ-7', itemName: 'NESTLE CREAM', unit: 'pcs', displayUnit: 'pcs', stockQty: 30, unitCost: 40, businessType: 'log' });
    const prod = await M('Product').create({ name: 'Nestle Cream', category: 'MILK/JUICE', basePrice: 55, productCode: 'RML9001',
      baseRecipe: [{ invId: String(twin._id), name: 'NESTLE CREAM', qty: 1, packBase: 1, unit: 'pcs' }] });

    const r = await importRows([{ itemCode: 'MJ-7', itemName: 'NESTLE CREAM', unit: 'pcs', qty: 30, unitCost: 40, srp: 55 }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = await M('Product').findById(prod._id).lean();
    expect(String(p.baseRecipe[0].invId)).toBe(String(real._id));
    expect(p.productCode).toBe('MJ-7');
    expect(r.body.summary?.relinked || r.body.relinked).toBeGreaterThanOrEqual(1);
  });
});
