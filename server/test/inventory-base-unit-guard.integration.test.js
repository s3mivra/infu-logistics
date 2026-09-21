// Changing what an item is counted in, while recipes are written in the old one.
//
// The edit dialog's unit picker sets the BASE unit along with the display unit:
// choosing "L" for an item kept in grams made it millilitres, and choosing
// "pcs" made 1000 g of beans into 1000 pieces. Nothing was converted, so every
// recipe taking "18 g" from it quietly started taking 18 of something else.
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
  await makeUser({ name: 'UnitSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'UnitSuper');
}, 120000);
afterAll(async () => { await ctx.stop(); });

let beans, syrup;
beforeEach(async () => {
  for (const n of ['Product', 'Inventory', 'AddOn']) await M(n).deleteMany({});
  beans = await M('Inventory').create({ itemCode: 'BEAN', itemName: 'ESPRESSO BEANS', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, stockQty: 1000, unitCost: 1.2 });
  syrup = await M('Inventory').create({ itemCode: 'SYR', itemName: 'VANILLA SYRUP', unit: 'g', displayUnit: 'g', unitMultiplier: 1, stockQty: 500, unitCost: 0.5 });
  await M('Product').create({
    name: 'Latte', category: 'Coffee', basePrice: 130,
    baseRecipe: [{ invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 18, unit: 'g', packBase: 1 }],
  });
});

describe('an item a recipe takes from', () => {
  it('cannot change what it is counted in', async () => {
    const res = await auth('put', `/api/inventory/${beans._id}`).send({ displayUnit: 'L', unit: 'ml', unitMultiplier: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.usedIn).toContain('Latte');
    expect((await M('Inventory').findById(beans._id).lean()).unit).toBe('g');
  });

  it('can still change how it is shown, within the same kind', async () => {
    const res = await auth('put', `/api/inventory/${beans._id}`).send({ displayUnit: 'g', unit: 'g', unitMultiplier: 1 });
    expect(res.status).toBe(200);
    expect((await M('Inventory').findById(beans._id).lean()).displayUnit).toBe('g');
  });

  it('is caught through an add-on\'s recipe too', async () => {
    await M('AddOn').create({ name: 'Vanilla', price: 20, recipe: [{ invId: String(syrup._id), name: 'VANILLA SYRUP', qty: 15, unit: 'g' }] });
    const res = await auth('put', `/api/inventory/${syrup._id}`).send({ displayUnit: 'ml', unit: 'ml' });
    expect(res.status).toBe(409);
    expect(res.body.usedIn).toContain('add-on Vanilla');
  });
});

describe('an item nothing takes from', () => {
  it('can be corrected - entered in grams when it is sold by the millilitre', async () => {
    const res = await auth('put', `/api/inventory/${syrup._id}`).send({ displayUnit: 'ml', unit: 'ml' });
    expect(res.status).toBe(200);
    expect((await M('Inventory').findById(syrup._id).lean()).unit).toBe('ml');
  });
});
