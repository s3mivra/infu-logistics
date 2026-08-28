// Delivery fee was sent by the client on every order but never read server-side
// (POST /api/orders never destructured req.body.deliveryFee) - silently
// dropped, never saved, never folded into `total`. Every delivery order's
// recorded total undercounted by exactly the fee, so it never reconciled
// against what was actually collected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'delivery-fee-test-secret-0123456789' }));
  await makeUser({ name: 'DeliveryBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'DeliveryBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('delivery fee is persisted and folded into total', () => {
  it('an order with a delivery fee saves it and adds it to total', async () => {
    const res = await request(app).post('/api/orders').set(auth(superToken)).send({
      items: [{ name: 'Widget', price: 100, quantity: 2, productDiscountPercent: 0 }],
      table: 'Manual Delivery',
      deliveryFee: 75,
      deliveryAddress: '123 Test St',
      customerPhone: '09171234567',
    });
    expect(res.body.success).toBe(true);
    const order = res.body.order;
    expect(order.deliveryFee).toBe(75);
    expect(order.deliveryAddress).toBe('123 Test St');
    expect(order.customerPhone).toBe('09171234567');
    // subtotal 200, no discount/vat by default in this business config - total
    // must be subtotal + deliveryFee, not just subtotal.
    expect(order.total).toBe(order.subtotal - order.discount + 75);

    // Persisted, not just echoed in the response.
    const fresh = await mongoose.model('Order').findById(order._id).lean();
    expect(fresh.deliveryFee).toBe(75);
    expect(fresh.total).toBe(order.total);
  });

  it('an order with no delivery fee still defaults cleanly to 0, total unaffected', async () => {
    const res = await request(app).post('/api/orders').set(auth(superToken)).send({
      items: [{ name: 'Widget', price: 50, quantity: 1, productDiscountPercent: 0 }],
      table: 'Takeout',
    });
    expect(res.body.success).toBe(true);
    expect(res.body.order.deliveryFee).toBe(0);
    expect(res.body.order.total).toBe(res.body.order.subtotal - res.body.order.discount);
  });

  it('rejects a negative delivery fee by clamping to 0, not subtracting from total', async () => {
    const res = await request(app).post('/api/orders').set(auth(superToken)).send({
      items: [{ name: 'Widget', price: 100, quantity: 1, productDiscountPercent: 0 }],
      table: 'Manual Delivery',
      deliveryFee: -50,
    });
    expect(res.body.success).toBe(true);
    expect(res.body.order.deliveryFee).toBe(0);
    expect(res.body.order.total).toBe(res.body.order.subtotal - res.body.order.discount);
  });
});
