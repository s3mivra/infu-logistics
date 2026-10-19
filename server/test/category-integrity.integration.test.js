// Orders are routed to Kitchen / Bar / Logistics by CATEGORY NAME, and every
// product points at its category by name. So names must be unique, and a
// rename must carry its products along - it used to strand them.
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

describe('categories', () => {
  it('refuses a second category with the same name, in any case', async () => {
    expect((await as('post', '/api/categories').send({ name: 'Pastry' })).status).toBe(200);
    const dup = await as('post', '/api/categories').send({ name: 'pastry ' });
    expect(dup.status).toBe(409);
    expect(await mongoose.model('Category').countDocuments({ name: /^pastry$/i })).toBe(1);
  });

  it('refuses an empty name', async () => {
    expect((await as('post', '/api/categories').send({ name: '   ' })).status).toBe(400);
  });

  it('moves the products along when a category is renamed', async () => {
    const cat = (await as('post', '/api/categories').send({ name: 'Cold Drinks' })).body.category;
    await mongoose.model('Product').create([
      { name: 'Iced Tea', category: 'Cold Drinks', basePrice: 60 },
      { name: 'Iced Coffee', category: 'Cold Drinks', basePrice: 90 },
    ]);
    const r = await as('put', `/api/categories/${cat._id}`).send({ name: 'Iced Drinks' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.productsMoved).toBe(2);
    expect(await mongoose.model('Product').countDocuments({ category: 'Cold Drinks' })).toBe(0);
    expect(await mongoose.model('Product').countDocuments({ category: 'Iced Drinks' })).toBe(2);
  });

  it('refuses renaming onto a name another category already has', async () => {
    const cat = (await as('post', '/api/categories').send({ name: 'Snacks' })).body.category;
    const r = await as('put', `/api/categories/${cat._id}`).send({ name: 'PASTRY' });
    expect(r.status).toBe(409);
  });
});
