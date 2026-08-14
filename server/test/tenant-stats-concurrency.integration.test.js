// Targeted check for the Part-1 dashboard-counter fix (TenantStats/ProductStats,
// applyStatsDelta in orders.js): concurrent order completions all hit the SAME
// singleton TenantStats document via atomic $inc. This test fires a batch of
// completions in parallel and asserts every one succeeds and the counters land
// exactly on the sum — no lost updates, no silent under/over count.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, prod;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'tsStaff', role: 'staff' });
  staffTok = await loginStaff(app, 'tsStaff');

  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'TSCat', department: 'Kitchen' });
  // No baseRecipe / no linked inventory — completion has nothing to deduct,
  // isolating this test to journal + stats-counter concurrency.
  prod = await Product.create({ name: 'Stat Widget', category: 'TSCat', basePrice: 50, baseRecipe: [] });
}, 120000);

afterAll(async () => { await ctx.stop(); });

it('concurrent completions all land in TenantStats/ProductStats with no lost updates', async () => {
  const N = 20;
  const orderIds = [];
  for (let i = 0; i < N; i++) {
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'Stat Widget', price: 50, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash',
    });
    expect(res.status).toBe(200);
    orderIds.push(res.body.order._id);
  }

  const results = await Promise.all(
    orderIds.map((id) => auth('put', `/api/orders/${id}`, staffTok).send({ status: 'Completed' }))
  );
  for (const r of results) expect(r.status).toBe(200);

  // Both counters are sharded (server.js: STATS_SHARDS) — sum across shards,
  // same as reports.js and backfill-stats.mjs do.
  const TenantStats = mongoose.model('TenantStats');
  const ProductStats = mongoose.model('ProductStats');
  const tsShards = await TenantStats.find({ businessType: 'fb' }).lean();
  const psShards = await ProductStats.find({ businessType: 'fb', productName: 'Stat Widget' }).lean();
  const sum = (docs, field) => docs.reduce((s, d) => s + (d[field] || 0), 0);

  expect(sum(tsShards, 'cumulativeOrderCount')).toBe(N);
  expect(sum(tsShards, 'cumulativeNonCompCount')).toBe(N);
  expect(sum(tsShards, 'cumulativeRevenue')).toBe(N * 50);
  expect(sum(psShards, 'cumulativeQty')).toBe(N);
  expect(sum(psShards, 'cumulativeRevenue')).toBe(N * 50);
});
