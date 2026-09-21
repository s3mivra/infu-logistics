// Writes that used to ask only "is staff".
//
// The permission catalogue has always said who may change the menu
// (products.manage) and receive or restock stock (inventory.manage), and the
// built-in staff role has never held either - but the routes only checked for
// a staff login, so any staff account could do both through the API. They now
// check the permission they were always meant to.
//
// Waste, the end-of-day count and comps are floor work staff really do, so
// they get permissions of their own that every built-in role that did them
// still holds, and that a narrower role can leave out.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { withFloorActions, resolvePermissions } from '../lib/authz.js';

let ctx, app, staff, manager, narrow, item;
const M = (n) => mongoose.model(n);
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ApStaff', role: 'staff' });
  await makeUser({ name: 'ApManager', role: 'manager' });
  // Can see stock and ring sales, and nothing else on the floor.
  await makeUser({ name: 'ApNarrow', role: 'staff', permissions: ['pos.use', 'orders.view', 'inventory.view', 'products.view'] });
  staff = as(await loginStaff(app, 'ApStaff'));
  manager = as(await loginStaff(app, 'ApManager'));
  narrow = as(await loginStaff(app, 'ApNarrow'));
  await M('Category').create({ name: 'Coffee' });
  item = await M('Inventory').create({ itemCode: 'MLK', itemName: 'MILK', unit: 'ml', stockQty: 5000, unitCost: 0.1 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('manager work', () => {
  it('staff cannot change the menu', async () => {
    expect((await staff('post', '/api/products').send({ name: 'X', category: 'Coffee', basePrice: 1 })).status).toBe(403);
    expect((await staff('post', '/api/categories').send({ name: 'Y' })).status).toBe(403);
    expect((await staff('post', '/api/discounts').send({ name: 'Z', percentage: 5 })).status).toBe(403);
  });

  it('staff cannot receive or restock stock', async () => {
    expect((await staff('post', '/api/inventory').send({ itemName: 'SUGAR', unit: 'g', stockQty: 1, unitCost: 1 })).status).toBe(403);
    expect((await staff('post', `/api/inventory/restock/${item._id}`).send({ addedStock: 1, totalCost: 1 })).status).toBe(403);
  });

  it('a manager can do both', async () => {
    expect((await manager('post', '/api/products').send({ name: 'Latte', category: 'Coffee', basePrice: 130 })).status).toBe(200);
    expect((await manager('post', '/api/categories').send({ name: 'Tea' })).status).toBe(200);
  });
});

describe('floor work', () => {
  it('staff still log waste, as before', async () => {
    const res = await staff('post', `/api/inventory/spoilage/${item._id}`).send({ qty: 100, reason: 'Spoilage' });
    expect(res.status).toBe(200);
  });

  it('a role narrowed without it cannot', async () => {
    const res = await narrow('post', `/api/inventory/spoilage/${item._id}`).send({ qty: 100, reason: 'Spoilage' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/inventory\.waste/);
  });

  it('upgrading keeps every stored list able to do what it did', () => {
    // What the one-time startup migration applies to each stored role and list.
    expect(withFloorActions(['pos.use', 'inventory.view'])).toEqual(
      expect.arrayContaining(['inventory.waste', 'inventory.count', 'orders.comp']));
    expect(withFloorActions(['accounting.view'])).toEqual(['accounting.view']);
  });

  it('every built-in role that rings sales can comp and count', () => {
    for (const role of ['admin', 'manager', 'cashier', 'staff']) {
      expect(resolvePermissions({ role }), role).toEqual(expect.arrayContaining(['orders.comp', 'inventory.waste', 'inventory.count']));
    }
    expect(resolvePermissions({ role: 'finance' })).not.toContain('inventory.waste');
  });
});
