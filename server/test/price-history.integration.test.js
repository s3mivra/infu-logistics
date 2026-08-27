// Pricing Control's "History" button reads back the PRODUCT_PRICE_CHANGED /
// PRODUCT_RECIPE_COST_CHANGED audit trail that PUT /api/products/:id already
// writes on every change - "as of [date]: price", newest first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'price-hist-test-secret-0123456789' }));
  await makeUser({ name: 'PriceBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'PriceBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('price history', () => {
  it('starts empty, then records each price change newest-first', async () => {
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'History Test Widget', basePrice: 100, category: 'Test' });
    expect(prod.body.success).toBe(true);
    const id = prod.body.product._id;

    const empty = await request(app).get(`/api/products/${id}/price-history`).set(auth(superToken));
    expect(empty.body.success).toBe(true);
    expect(empty.body.history).toEqual([]);
    expect(empty.body.product.basePrice).toBe(100);

    await request(app).put(`/api/products/${id}`).set(auth(superToken)).set('X-Change-Reason', encodeURIComponent('Cost went up'))
      .send({ basePrice: 120 });
    await request(app).put(`/api/products/${id}`).set(auth(superToken)).set('X-Change-Reason', encodeURIComponent('Promo'))
      .send({ basePrice: 90 });

    const res = await request(app).get(`/api/products/${id}/price-history`).set(auth(superToken));
    expect(res.body.history.length).toBe(2);
    // Newest first.
    expect(res.body.history[0].oldValue).toBe(120);
    expect(res.body.history[0].newValue).toBe(90);
    expect(res.body.history[0].reason).toBe('Promo');
    expect(res.body.history[1].oldValue).toBe(100);
    expect(res.body.history[1].newValue).toBe(120);
    expect(res.body.history[1].reason).toBe('Cost went up');
    expect(res.body.history[0].changedBy).toBe('PriceBoss');
    expect(res.body.history[0].type).toBe('price');
  });

  it('a no-op update (same price) does not add a history entry', async () => {
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'Noop Widget', basePrice: 50, category: 'Test' });
    const id = prod.body.product._id;
    await request(app).put(`/api/products/${id}`).set(auth(superToken)).send({ basePrice: 50, name: 'Noop Widget Renamed' });
    const res = await request(app).get(`/api/products/${id}/price-history`).set(auth(superToken));
    expect(res.body.history).toEqual([]);
  });

  it('404s for a nonexistent product', async () => {
    const res = await request(app).get(`/api/products/${new mongoose.Types.ObjectId()}/price-history`).set(auth(superToken));
    expect(res.status).toBe(404);
  });
});
