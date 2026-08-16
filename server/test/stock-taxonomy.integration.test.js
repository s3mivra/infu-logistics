// #7 storage places + stock categories CRUD, and #9 auto item-code per category.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'stSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'stSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('#7 storage locations CRUD', () => {
  it('creates, lists, renames (cascades), and blocks delete while in use', async () => {
    const c = await auth('post', '/api/stock-locations', superTok).send({ name: 'main warehouse' });
    expect(c.status).toBe(200);
    expect(c.body.location.name).toBe('Main Warehouse'); // title-cased
    const locId = c.body.location._id;

    const dup = await auth('post', '/api/stock-locations', superTok).send({ name: 'MAIN WAREHOUSE' });
    expect(dup.status).toBe(400);

    // Assign an item to the location, then a rename must cascade to it.
    const item = await auth('post', '/api/inventory', superTok).send({ itemName: 'Rice Sack', unit: 'pcs', unitCost: 50, stockQty: 10, stockLocation: 'Main Warehouse' });
    expect(item.status).toBe(200);

    const ren = await auth('put', `/api/stock-locations/${locId}`, superTok).send({ name: 'Central Depot' });
    expect(ren.status).toBe(200);
    const Inventory = mongoose.model('Inventory');
    const moved = await Inventory.findById(item.body.item._id).lean();
    expect(moved.stockLocation).toBe('Central Depot');

    const del = await auth('delete', `/api/stock-locations/${locId}`, superTok);
    expect(del.status).toBe(400); // still in use
  });
});

describe('#9 auto item code per stock category', () => {
  it('numbers items under the category prefix, sequentially', async () => {
    const cat = await auth('post', '/api/stock-categories', superTok).send({ name: 'Beans', prefix: 'p1' });
    expect(cat.status).toBe(200);
    expect(cat.body.category.prefix).toBe('P1'); // uppercased

    const a = await auth('post', '/api/inventory', superTok).send({ itemName: 'Arabica', unit: 'g', unitCost: 1, stockQty: 100, stockCategory: 'Beans' });
    const b = await auth('post', '/api/inventory', superTok).send({ itemName: 'Robusta', unit: 'g', unitCost: 1, stockQty: 100, stockCategory: 'Beans' });
    expect(a.body.item.itemCode).toBe('P10001');
    expect(b.body.item.itemCode).toBe('P10002');
  });

  it('rejects a duplicate prefix', async () => {
    await auth('post', '/api/stock-categories', superTok).send({ name: 'Grains', prefix: 'GR' });
    const dup = await auth('post', '/api/stock-categories', superTok).send({ name: 'Cereals', prefix: 'GR' });
    expect(dup.status).toBe(400);
  });

  it('falls back to RML codes when the category has no prefix', async () => {
    await auth('post', '/api/stock-categories', superTok).send({ name: 'Misc' });
    const it = await auth('post', '/api/inventory', superTok).send({ itemName: 'Tape', unit: 'pcs', unitCost: 5, stockQty: 3, stockCategory: 'Misc' });
    expect(it.body.item.itemCode).toMatch(/^RML/);
  });
});
