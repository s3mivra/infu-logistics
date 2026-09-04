// The recipe-sheet parse endpoint: reads the barista workbooks and reports what
// it found WITHOUT writing anything, matching every material against live stock
// so a reviewer can see what exists and what would have to be created.
//
// The sheets are written for humans standing at a bar, so the parse is
// deliberately conservative - it flags ambiguity instead of guessing. Nothing
// here should ever create or modify a record.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const post = (body) => request(app).post('/api/products/recipe-sheet/parse')
  .set('Authorization', `Bearer ${tok}`).send(body);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ParseSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ParseSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
beforeEach(async () => { await M('Inventory').deleteMany({}); await M('Product').deleteMany({}); });

// Shapes taken from the real workbooks.
const drinkSheet = [
  [' INFU COFFEE ', '', '', '', '', '', ''],
  ['SIGNATURE COFFEE', 'CUP MARK', 'Size', 'Cups', 'Espresso', 'Syrup', 'Procedure'],
  ['SEASALT', 'SS', '12oz / 16oz', 'DW / PET', 'Hot 30-35ml', '10 ml Sea Salt', 'Mix well'],
  ['TRUFFLE MOCHA', 'RM', '12oz', 'PET', 'Hot 30-35ml', '0.7ml Truffle Oil / 20ml full cream / 20ml everwhip Truffle Foam', 'Mix well'],
];
const bulkSheet = [
  ['', '', '', '', 'Spanish Milk Bulk (2077ml)', '', '', '', ''],
  ['', '', '', '', 'INGREDIENTS', 'SIZE', 'UNIT', 'UNIT COST', 'USED UNITS'],
  ['', '', '', '', 'Alaska Condensed Milk', 377, 'ml', 66, 377],
  ['', '', '', '', 'Alaska Barista Milk', 1000, 'ml', 82, 1700],
  ['', '', '', '', 'Total Cost', '', '', '', ''],
];

describe('parsing the workbook', () => {
  it('reads drinks and bulk recipes from the right sheets', async () => {
    const res = await post({ sheets: { 'SIGNATURE': drinkSheet, 'BULK RECIPE': bulkSheet } });
    expect(res.status).toBe(200);
    expect(res.body.counts.drinks).toBe(2);
    expect(res.body.counts.bulkRecipes).toBe(1);

    const bulk = res.body.bulkRecipes[0];
    expect(bulk.name).toBe('Spanish Milk Bulk');
    expect(bulk.yieldQty).toBe(2077);
    // Cost per base unit comes from the purchase pack, not the amount consumed.
    expect(bulk.ingredients.find(i => i.name === 'Alaska Barista Milk').costPerUnit).toBeCloseTo(0.082, 4);
  });

  it('flags the ambiguous drink and leaves the clean one alone', async () => {
    const res = await post({ sheets: { 'SIGNATURE': drinkSheet } });
    const seasalt = res.body.drinks.find(d => d.name === 'SEASALT');
    const truffle = res.body.drinks.find(d => d.name === 'TRUFFLE MOCHA');

    expect(seasalt.needsReview).toBe(false);
    // Three components in one cell is genuinely ambiguous - a human decides.
    expect(truffle.needsReview).toBe(true);
    expect(res.body.counts.drinksNeedingReview).toBe(1);
  });

  it('reads a quantity-only cell as its column material', async () => {
    const res = await post({ sheets: { 'SIGNATURE': drinkSheet } });
    const seasalt = res.body.drinks.find(d => d.name === 'SEASALT');
    const esp = seasalt.ingredients.find(i => i.column === 'Espresso');
    // "Hot 30-35ml" is 32.5ml OF ESPRESSO - the column names the material.
    expect(esp.components[0]).toMatchObject({ qty: 32.5, unit: 'ml', name: 'Espresso' });
  });

  it('never treats Procedure, Size or Cups as an ingredient', async () => {
    const res = await post({ sheets: { 'SIGNATURE': drinkSheet } });
    for (const d of res.body.drinks) {
      expect(d.ingredients.some(i => /procedure|size|cups/i.test(i.column))).toBe(false);
    }
  });
});

describe('matching materials against live stock', () => {
  it('reports which materials already exist and which are missing', async () => {
    await M('Inventory').create({ itemCode: 'RM-COND', itemName: 'Alaska Condensed Milk', unit: 'ml', stockQty: 5000, unitCost: 0.18 });

    const res = await post({ sheets: { 'BULK RECIPE': bulkSheet } });
    const cond = res.body.materials.find(m => m.name === 'Alaska Condensed Milk');
    const barista = res.body.materials.find(m => m.name === 'Alaska Barista Milk');

    expect(cond.matchedInvId).toBeTruthy();
    expect(cond.matchedCode).toBe('RM-COND');
    expect(barista.matchedInvId).toBeNull();       // would have to be created

    expect(res.body.counts.materialsMatched).toBe(1);
    expect(res.body.counts.materialsMissing).toBe(1);
  });

  it('matches case-insensitively and ignores punctuation differences', async () => {
    await M('Inventory').create({ itemCode: 'RM-1', itemName: 'alaska  barista milk', unit: 'ml', stockQty: 100, unitCost: 0.08 });
    const res = await post({ sheets: { 'BULK RECIPE': bulkSheet } });
    expect(res.body.materials.find(m => m.name === 'Alaska Barista Milk').matchedInvId).toBeTruthy();
  });

  it('flags a unit mismatch rather than quietly accepting it', async () => {
    // Same name, but counted in pieces - linking it would corrupt the cost.
    await M('Inventory').create({ itemCode: 'RM-2', itemName: 'Alaska Condensed Milk', unit: 'pcs', stockQty: 10, unitCost: 66 });
    const res = await post({ sheets: { 'BULK RECIPE': bulkSheet } });
    const cond = res.body.materials.find(m => m.name === 'Alaska Condensed Milk');
    expect(cond.matchedInvId).toBeTruthy();
    expect(cond.unitMismatch).toBe(true);
  });

  it('counts how often each material is used, most-used first', async () => {
    const res = await post({ sheets: { 'SIGNATURE': drinkSheet, 'BULK RECIPE': bulkSheet } });
    const uses = res.body.materials.map(m => m.uses);
    expect(uses).toEqual([...uses].sort((a, b) => b - a));
  });
});

describe('it only ever reads', () => {
  it('writes no products and no inventory', async () => {
    await post({ sheets: { 'SIGNATURE': drinkSheet, 'BULK RECIPE': bulkSheet } });
    expect(await M('Product').countDocuments({})).toBe(0);
    expect(await M('Inventory').countDocuments({})).toBe(0);
  });

  it('rejects a body that is not a sheet map', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ sheets: 'nope' })).status).toBe(400);
  });

  it('ignores empty sheets instead of failing', async () => {
    const res = await post({ sheets: { 'Sheet1': [], 'SIGNATURE': drinkSheet } });
    expect(res.status).toBe(200);
    expect(res.body.counts.drinks).toBe(2);
  });
});
