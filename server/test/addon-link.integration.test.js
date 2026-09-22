// Linking add-ons to many products at once (POST /api/addons/link).
//
// It must write what ticking the add-on inside a product writes, never
// duplicate one a product already has, and never overwrite a price or recipe
// that one product was given for it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, mgr, staff, shot, oat, latte, mocha, tea;
const M = (n) => mongoose.model(n);
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const link = (body, tok = mgr) => as(tok)('post', '/api/addons/link').send(body);
const addOnsOf = async (p) => (await M('Product').findById(p._id).lean()).addOns;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'LinkMgr', role: 'manager' });
  await makeUser({ name: 'LinkStaff', role: 'staff' });
  mgr = await loginStaff(app, 'LinkMgr');
  staff = await loginStaff(app, 'LinkStaff');
}, 120000);
afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  for (const n of ['Product', 'AddOn']) await M(n).deleteMany({});
  shot = await M('AddOn').create({ name: 'Extra Shot', price: 30 });
  oat = await M('AddOn').create({ name: 'Oat Milk', price: 25 });
  latte = await M('Product').create({ name: 'Latte', category: 'Coffee', basePrice: 130,
    // This latte already carries its own, bigger extra shot.
    addOns: [{ name: 'Extra Shot', price: 40, recipe: [{ name: 'BEANS', qty: 25, unit: 'g' }] }] });
  mocha = await M('Product').create({ name: 'Mocha', category: 'Coffee', basePrice: 150 });
  tea = await M('Product').create({ name: 'Green Tea', category: 'Tea', basePrice: 110 });
});

describe('attaching', () => {
  it('puts the add-ons on every product, the way ticking them in a product does', async () => {
    const res = await link({ addOnIds: [String(shot._id), String(oat._id)], target: { all: true }, action: 'attach' });
    expect(res.body.success).toBe(true);
    const tAddOns = await addOnsOf(tea);
    expect(tAddOns.map((a) => a.name).sort()).toEqual(['Extra Shot', 'Oat Milk']);
    expect(tAddOns.find((a) => a.name === 'Oat Milk')).toMatchObject({ price: 25, recipe: [] });
  });

  it('never duplicates one a product has, nor touches its own price and recipe', async () => {
    await link({ addOnIds: [String(shot._id)], target: { all: true }, action: 'attach' });
    await link({ addOnIds: [String(shot._id)], target: { all: true }, action: 'attach' });
    const lAddOns = await addOnsOf(latte);
    expect(lAddOns.filter((a) => a.name === 'Extra Shot')).toHaveLength(1);
    expect(lAddOns[0].price).toBe(40);
    expect(lAddOns[0].recipe[0].qty).toBe(25);
    expect((await addOnsOf(mocha)).filter((a) => a.name === 'Extra Shot')).toHaveLength(1);
  });

  it('can be limited to a category', async () => {
    await link({ addOnIds: [String(oat._id)], target: { categories: ['Coffee'] }, action: 'attach' });
    expect((await addOnsOf(mocha)).map((a) => a.name)).toContain('Oat Milk');
    expect((await addOnsOf(tea)).map((a) => a.name)).not.toContain('Oat Milk');
  });

  it('can be limited to chosen products, with all add-ons at once', async () => {
    const res = await link({ addOnIds: 'all', target: { productIds: [String(tea._id)] }, action: 'attach' });
    expect(res.body.products).toBe(1);
    expect((await addOnsOf(tea)).map((a) => a.name).sort()).toEqual(['Extra Shot', 'Oat Milk']);
    expect((await addOnsOf(mocha)).length).toBe(0);
  });
});

describe('removing', () => {
  it('takes the add-on off only the products chosen', async () => {
    await link({ addOnIds: [String(shot._id)], target: { all: true }, action: 'attach' });
    await link({ addOnIds: [String(shot._id)], target: { categories: ['Coffee'] }, action: 'detach' });
    expect((await addOnsOf(latte)).map((a) => a.name)).not.toContain('Extra Shot');
    expect((await addOnsOf(tea)).map((a) => a.name)).toContain('Extra Shot');
  });
});

describe('who may', () => {
  it('needs products.manage', async () => {
    const res = await link({ addOnIds: 'all', target: { all: true }, action: 'attach' }, staff);
    expect(res.status).toBe(403);
  });

  it('refuses a request that names no products', async () => {
    const res = await link({ addOnIds: 'all', target: {}, action: 'attach' });
    expect(res.status).toBe(400);
  });
});
