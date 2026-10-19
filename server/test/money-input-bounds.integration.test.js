// Money that enters through a form is stored to the centavo and bounded.
// An audit found a price of 12.345 stored as typed, and an expense of ₱1e308
// reaching the ledger and failing there as an "unbalanced" 500.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Boss', role: 'superadmin' });
  tok = await loginStaff(app, 'Boss');
}, 120000);
afterAll(async () => { await ctx?.stop?.(); });

describe('money inputs', () => {
  it('stores a selling price to the centavo', async () => {
    const r = await as('post', '/api/products').send({ name: 'Frac', category: 'X', basePrice: 12.345 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await mongoose.model('Product').findOne({ name: 'Frac' }).lean()).basePrice).toBe(12.35);
  });

  it('refuses an absurd price with a validation error, not a crash', async () => {
    const r = await as('post', '/api/products').send({ name: 'Huge', category: 'X', basePrice: 1e308 });
    expect(r.status).toBe(422);
  });

  it('refuses an absurd expense with a clear 400', async () => {
    const r = await as('post', '/api/expenses').send({ amount: 1e308, categoryCode: '640000', paymentMethod: 'Cash on Hand', description: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/too large/);
  });

  it('still takes an ordinary expense with centavos', async () => {
    const r = await as('post', '/api/expenses').send({ amount: 1234.56, categoryCode: '640000', paymentMethod: 'Cash on Hand', description: 'power' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
