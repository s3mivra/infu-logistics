// Storage overview: what this deployment is holding and what is growing.
//
// Size alone is not actionable - a 40MB collection is unremarkable until you
// know it was 4MB last month. The growth figures are the point, and they are
// derived from the last 30 days of documents rather than from the lifetime
// average, because a deployment that has been running a week has no lifetime
// trend worth extrapolating.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const get = () => request(app).get('/api/admin/storage-overview').set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'StorageSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'StorageSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

beforeEach(async () => {
  for (const n of ['StockCard', 'JournalEntry']) await M(n).deleteMany({});
});

describe('reporting what is stored', () => {
  it('returns database totals and a per-collection breakdown', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.database.storageBytes).toBeGreaterThan(0);
    expect(Array.isArray(res.body.collections)).toBe(true);
    expect(res.body.collections.length).toBeGreaterThan(0);
  });

  it('counts the documents actually present', async () => {
    await M('StockCard').insertMany(Array.from({ length: 40 }, (_, i) => ({
      inventoryId: 'i1', itemName: 'Beans', date: daysAgo(i % 10),
      type: 'Sale', qtyChange: -1, balanceAfter: 100 - i,
    })));

    const card = (await get()).body.collections.find(c => c.key === 'StockCard');
    expect(card.docs).toBe(40);
    expect(card.avgDocBytes).toBeGreaterThan(0);
  });

  it('orders collections largest-first, so the biggest is on top', async () => {
    const sizes = (await get()).body.collections.map(c => c.bytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});

describe('growth, which is the actionable part', () => {
  it('measures growth from the last 30 days only', async () => {
    await M('StockCard').insertMany([
      // 60 inside the window...
      ...Array.from({ length: 60 }, (_, i) => ({
        inventoryId: 'i1', itemName: 'Beans', date: daysAgo(i % 30),
        type: 'Sale', qtyChange: -1, balanceAfter: 10,
      })),
      // ...and 500 far outside it, which must not inflate the trend.
      ...Array.from({ length: 500 }, () => ({
        inventoryId: 'i1', itemName: 'Beans', date: daysAgo(200),
        type: 'Sale', qtyChange: -1, balanceAfter: 10,
      })),
    ]);

    const card = (await get()).body.collections.find(c => c.key === 'StockCard');
    expect(card.docs).toBe(560);          // everything is counted as stored...
    expect(card.docsLast30d).toBe(60);    // ...but only recent rows drive growth
    expect(card.docsPerDay).toBeCloseTo(2, 1);
  });

  it('projects a year from the observed daily rate', async () => {
    await M('StockCard').insertMany(Array.from({ length: 30 }, (_, i) => ({
      inventoryId: 'i1', itemName: 'Beans', date: daysAgo(i),
      type: 'Sale', qtyChange: -1, balanceAfter: 10,
    })));

    const card = (await get()).body.collections.find(c => c.key === 'StockCard');
    expect(card.docsPerDay).toBeCloseTo(1, 1);
    // 1 doc/day x avg size x 365, so it should be in the right ballpark.
    expect(card.projectedBytesPerYear).toBeCloseTo(card.avgDocBytes * 365, -3);
  });

  it('names the fastest-growing collection', async () => {
    await M('StockCard').insertMany(Array.from({ length: 200 }, (_, i) => ({
      inventoryId: 'i1', itemName: 'Beans', date: daysAgo(i % 30),
      type: 'Sale', qtyChange: -1, balanceAfter: 10,
    })));

    const res = await get();
    expect(res.body.growth.fastestGrowing).toBe('Stock Movements');
    expect(res.body.growth.windowDays).toBe(30);
    expect(res.body.growth.projectedBytesPerYear).toBeGreaterThan(0);
  });

  it('reports zero growth on a quiet deployment instead of NaN', async () => {
    // Everything old, nothing recent.
    await M('StockCard').insertMany(Array.from({ length: 10 }, () => ({
      inventoryId: 'i1', itemName: 'Beans', date: daysAgo(120),
      type: 'Sale', qtyChange: -1, balanceAfter: 10,
    })));

    const card = (await get()).body.collections.find(c => c.key === 'StockCard');
    expect(card.docsLast30d).toBe(0);
    expect(card.docsPerDay).toBe(0);
    expect(card.projectedBytesPerYear).toBe(0);
    expect(Number.isFinite(card.projectedBytesPerYear)).toBe(true);
  });
});

describe('who may see it', () => {
  it('refuses a cashier', async () => {
    await makeUser({ name: 'StorageTill', role: 'cashier' });
    const cashierTok = await loginStaff(app, 'StorageTill');
    const res = await request(app).get('/api/admin/storage-overview')
      .set('Authorization', `Bearer ${cashierTok}`);
    expect(res.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/admin/storage-overview')).status).toBe(401);
  });
});
