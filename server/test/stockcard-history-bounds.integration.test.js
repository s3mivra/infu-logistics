// StockCard gains a row for every stock movement and never shrinks, so both
// history endpoints have to be bounded.
//
// GET /api/inventory/history used to fetch the ENTIRE collection - unfiltered,
// unsorted-by-index and hydrated - so the client could narrow it to one day in
// the browser. That transfers and holds the whole trading history of the
// business to print a single day of it, and the unindexed sort fails outright
// once the collection passes MongoDB's in-memory sort limit.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (p) => request(app).get(p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'HistSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'HistSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const StockCard = () => mongoose.model('StockCard');
beforeEach(async () => { await StockCard().deleteMany({}); });

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const isoDay = (d) => d.toISOString().slice(0, 10);

async function seedCards(rows) {
  await StockCard().insertMany(rows.map((r, i) => ({
    inventoryId: r.inventoryId || 'inv-1', itemName: r.itemName || 'Coffee Beans',
    date: r.date, type: 'Sale', reference: `REF-${i}`,
    qtyChange: -1, balanceAfter: 100 - i, unitCost: 1,
  })));
}

describe('the full history endpoint is bounded', () => {
  it('returns only the requested date range', async () => {
    await seedCards([
      { date: new Date() },
      { date: new Date() },
      { date: daysAgo(40) },   // outside the window
      { date: daysAgo(400) },  // long outside
    ]);

    const today = isoDay(new Date());
    const res = await auth(`/api/inventory/history?start=${today}&end=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(2);
  });

  it('includes the whole of the end day, not just its first instant', async () => {
    const late = new Date(); late.setHours(23, 30, 0, 0);
    await seedCards([{ date: late }]);
    const today = isoDay(new Date());
    expect((await auth(`/api/inventory/history?start=${today}&end=${today}`)).body.history).toHaveLength(1);
  });

  it('caps an unfiltered request instead of returning everything', async () => {
    await seedCards(Array.from({ length: 60 }, () => ({ date: new Date() })));
    const res = await auth('/api/inventory/history?limit=25');
    expect(res.body.history).toHaveLength(25);
    // A clipped set must say so, or a partial report reads as a complete one.
    expect(res.body.truncated).toBe(true);
    expect(res.body.limit).toBe(25);
  });

  it('does not claim truncation when everything fits', async () => {
    await seedCards([{ date: new Date() }, { date: new Date() }]);
    const res = await auth('/api/inventory/history?limit=25');
    expect(res.body.truncated).toBe(false);
  });

  it('refuses an absurd limit rather than honouring it', async () => {
    await seedCards(Array.from({ length: 5 }, () => ({ date: new Date() })));
    const res = await auth('/api/inventory/history?limit=999999');
    expect(res.body.limit).toBeLessThanOrEqual(5000);
  });

  it('returns newest first', async () => {
    await seedCards([{ date: daysAgo(2) }, { date: new Date() }, { date: daysAgo(1) }]);
    const dates = (await auth('/api/inventory/history')).body.history.map(h => new Date(h.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });
});

describe('the per-item history endpoint is bounded', () => {
  it('caps a single item history and reports truncation', async () => {
    await seedCards(Array.from({ length: 40 }, () => ({ date: new Date(), inventoryId: 'inv-hot' })));
    const res = await auth('/api/inventory/history/inv-hot?limit=10');
    expect(res.body.history).toHaveLength(10);
    expect(res.body.truncated).toBe(true);
  });

  it('returns only that item movements', async () => {
    await seedCards([
      { date: new Date(), inventoryId: 'inv-a' },
      { date: new Date(), inventoryId: 'inv-b' },
      { date: new Date(), inventoryId: 'inv-a' },
    ]);
    const res = await auth('/api/inventory/history/inv-a');
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history.every(h => h.inventoryId === 'inv-a')).toBe(true);
  });
});

describe('the sort is index-backed', () => {
  it('declares the indexes both endpoints sort on', async () => {
    // Without these, the sort is done in memory and starts failing outright
    // once the collection passes MongoDB's 32MB sort limit.
    const idx = await StockCard().collection.indexes();
    const keys = idx.map(i => JSON.stringify(i.key));
    expect(keys).toContain(JSON.stringify({ date: -1 }));
    expect(keys).toContain(JSON.stringify({ inventoryId: 1, date: -1 }));
  });
});
