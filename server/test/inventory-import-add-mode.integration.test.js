// An inventory import (or a pulled sheet) can add to stock instead of setting
// it: 'follow' makes each item the sheet's count, 'add' adds the sheet's
// quantities to what is there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'AddOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'AddOwner');
  for (let i = 0; i < 120; i++) {
    if ((await request(app).get('/health')).body.startup === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const stockOf = async (code) => (await mongoose.model('Inventory').findOne({ itemCode: code }).lean()).stockQty;
const row = (qty) => ({ itemCode: 'UBE-1', itemName: 'UBE PASTE', unit: 'pcs', qty, unitCost: 250 });

describe('import that adds to stock', () => {
  it('follows the sheet by default: the item becomes the count', async () => {
    expect((await as('post', '/api/inventory/import').send({ items: [row(10)] })).status).toBe(200);
    expect(await stockOf('UBE-1')).toBe(10);
    expect((await as('post', '/api/inventory/import').send({ items: [row(4)] })).status).toBe(200);
    expect(await stockOf('UBE-1')).toBe(4);
  });

  it("with mode 'add', adds the sheet's quantity to what is there", async () => {
    const r = await as('post', '/api/inventory/import').send({ mode: 'add', items: [row(6)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stockOf('UBE-1')).toBe(10);
    // A new item is simply created with its quantity.
    await as('post', '/api/inventory/import').send({ mode: 'add', items: [{ itemCode: 'NEW-1', itemName: 'NEW SYRUP', unit: 'pcs', qty: 3, unitCost: 100 }] });
    expect(await stockOf('NEW-1')).toBe(3);
  });

  it('the stock sheet link remembers which way a pull applies', async () => {
    const st = await mongoose.model('Settings').findOneAndUpdate({ key: 'inventorySheet' }, { $set: { value: { url: 'https://docs.google.com/spreadsheets/d/abc/edit', tabs: 'all', checkTime: '' } } }, { upsert: true, new: true });
    expect(st).toBeTruthy();
    const g = await as('get', '/api/inventory-sheet');
    expect(g.body.sheet.stockMode).toBe('follow');
  });
});
