// Product Mix / Menu Engineering for a range of months, with each item's category.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'MixOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'MixOwner');
  const p = await mongoose.model('Product').create({ name: 'MATCHA POWDER 1KG', category: 'POWDERS', basePrice: 800, businessType: 'log' });
  const sale = (n, when, qty) => ({ businessType: 'log', orderNumber: n, status: 'Completed', paymentMethod: 'Cash', table: 'Walk In', subtotal: 800 * qty, total: 800 * qty,
    createdAt: new Date(when), items: [{ productId: p._id, name: 'MATCHA POWDER 1KG', price: 800, quantity: qty }] });
  await mongoose.model('Order').create([sale('MX-OCT', '2026-10-10T04:00:00Z', 2), sale('MX-NOV', '2026-11-10T04:00:00Z', 5)]);
}, 120000);
afterAll(async () => { await ctx.stop(); });

const mix = (q = '') => request(app).get(`/api/reports/menu-engineering${q}`).set('Authorization', `Bearer ${tok}`);

describe('Product Mix over a range', () => {
  it('counts only the months asked for', async () => {
    const oct = (await mix('?start=2026-10-01&end=2026-10-31')).body;
    expect(oct.items.find((r) => r.name === 'MATCHA POWDER 1KG')).toMatchObject({ qty: 2, revenue: 1600, category: 'POWDERS' });
    expect(oct).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    const both = (await mix('?start=2026-10-01&end=2026-11-30')).body;
    expect(both.items.find((r) => r.name === 'MATCHA POWDER 1KG').qty).toBe(7);
  });

  it('without a range, counts everything', async () => {
    const all = (await mix()).body;
    expect(all.items.find((r) => r.name === 'MATCHA POWDER 1KG').qty).toBe(7);
  });
});
