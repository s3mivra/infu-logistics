// Editing an inventory item's code must (a) enforce uniqueness, (b) cascade to
// the linked resale product's productCode, and (c) leave stock-card history -
// which keys off inventoryId, not the code - untouched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, item;

const putCode = (id, itemCode, extra = {}) =>
  request(app).put(`/api/inventory/${id}`).set('Authorization', `Bearer ${superTok}`)
    .send({ itemCode, itemName: 'Widget', unit: 'pcs', unitCost: 5, ...extra });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'inv_super', role: 'superadmin' });
  superTok = await loginStaff(app, 'inv_super');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  item = await Inventory.create({ itemCode: 'RML-0001', itemName: 'Widget', unit: 'pcs', stockQty: 10, unitCost: 5, businessType: 'log' });
  // The linked resale product carries productCode === itemCode.
  await Product.create({ name: 'Widget', productCode: 'RML-0001', basePrice: 20, businessType: 'log' });
  // A second item to collide against.
  await Inventory.create({ itemCode: 'RML-0002', itemName: 'Gadget', unit: 'pcs', stockQty: 5, unitCost: 3, businessType: 'log' });
});

afterAll(async () => { await ctx?.stop?.(); });

describe('PUT /api/inventory/:id - itemCode rename', () => {
  it('renames the code and cascades to the linked product', async () => {
    const res = await putCode(item._id, 'RML-9001');
    expect(res.status).toBe(200);
    expect(res.body.item.itemCode).toBe('RML-9001');

    const prod = await mongoose.model('Product').findOne({ productCode: 'RML-9001' }).lean();
    expect(prod).toBeTruthy();
    expect(prod.name).toBe('Widget');
    // Old code no longer resolves to a product.
    expect(await mongoose.model('Product').findOne({ productCode: 'RML-0001' }).lean()).toBeNull();
  });

  it('uppercases and trims the entered code', async () => {
    const res = await putCode(item._id, '  rml-9002  ');
    expect(res.status).toBe(200);
    expect(res.body.item.itemCode).toBe('RML-9002');
  });

  it('rejects a code already used by another item', async () => {
    const res = await putCode(item._id, 'RML-0002');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already uses code/i);
  });

  it('rejects a blank code', async () => {
    const res = await putCode(item._id, '   ');
    expect(res.status).toBe(400);
  });

  it('leaves stock-card history intact - it keys off inventoryId, not the code', async () => {
    const StockCard = mongoose.model('StockCard');
    await StockCard.create({ inventoryId: item._id, itemName: 'Widget', type: 'Adjustment', qtyChange: 1, balanceAfter: 11 });
    await putCode(item._id, 'RML-9003');
    const cards = await StockCard.find({ inventoryId: item._id }).lean();
    expect(cards.length).toBeGreaterThan(0);
  });
});
