// Holding an order's stock holds it in the stock's own units: an order for
// 3 packs of a 1 kg item kept in grams holds 3,000 g, not 3 g.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const M = (n) => mongoose.model(n);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'HoldOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'HoldOwner');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('holding an order', () => {
  it('holds what the sale would take, in base units', async () => {
    const inv = await M('Inventory').create({ itemCode: 'CB-1', itemName: 'COMMERCIAL BLEND', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, packSize: 1, stockQty: 580000, unitCost: 0.6, businessType: 'log' });
    const prod = await M('Product').create({ name: 'COMMERCIAL BLEND', productCode: 'CB-1', category: 'COFFEE', basePrice: 900, businessType: 'log',
      baseRecipe: [{ invId: String(inv._id), name: 'COMMERCIAL BLEND', qty: 1000, packBase: 1000, unit: 'g' }] });
    const client = await M('ClientAccount').create({ clientCode: 'CUS-H1', username: 'holdc', password: 'x', name: 'HOLD CLIENT', isActive: true });
    const order = await M('Order').create({ businessType: 'log', orderNumber: 'HOLD-1', status: 'Pending', clientAccountId: String(client._id), customerName: client.name, total: 2700, subtotal: 2700,
      items: [{ productId: prod._id, name: 'COMMERCIAL BLEND', price: 900, quantity: 3 }] });
    const r = await request(app).post('/api/reservations').set('Authorization', `Bearer ${tok}`).send({ orderId: String(order._id) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await M('Inventory').findById(inv._id).lean()).reservedQty).toBe(3000);
  });
});
