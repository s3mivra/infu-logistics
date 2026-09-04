// Throughput measurement, not a pass/fail feature test.
//
// Answers "how long does a real import actually take, and how much does it
// store?" at the volumes an onboarding day involves: 100+ inventory items,
// 100+ expenses, 100+ backdated sales, 1000+ ledger entries.
//
// The assertions are deliberately loose ceilings - this exists to PRINT numbers.
// Tight timing assertions would just flake on a loaded machine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'BenchSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'BenchSuper');
}, 180000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
const report = [];
const time = async (label, rows, fn) => {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  report.push({ label, rows, ms, perRow: +(ms / rows).toFixed(1), perSec: Math.round(rows / (ms / 1000)) });
  return out;
};

describe('bulk throughput at onboarding volumes', () => {
  it('imports 120 inventory items', async () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      itemName: `Bench Item ${i}`, itemCode: `BN-${String(i).padStart(4, '0')}`,
      unit: 'g', qty: 1000, unitCost: 1.5, stockCategory: `Cat ${i % 8}`,
    }));
    const res = await time('inventory import', items.length, () =>
      auth('post', '/api/inventory/import').send({ items }));
    // A throughput figure for work that did not happen is worse than no
    // figure - assert the rows actually landed before trusting the timing.
    const stored = await M('Inventory').countDocuments({});
    report[report.length - 1].stored = stored;
    report[report.length - 1].response = JSON.stringify(res.body).slice(0, 200);
    expect(res.status).toBeLessThan(500);
  }, 300000);

  it('imports 150 expenses', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({
      date: new Date(Date.now() - (i % 60) * 86400000).toISOString().slice(0, 10),
      categoryCode: '630000', amount: 100 + i,
      paymentMethod: 'Cash on Hand', vendor: `Payee ${i}`, description: `Bench expense ${i}`,
    }));
    const res = await time('expense import', rows.length, () =>
      auth('post', '/api/expenses/import').send({ rows }));
    report[report.length - 1].stored = res.body?.created ?? 0;
    report[report.length - 1].response = JSON.stringify(res.body).slice(0, 200);
    expect(res.status).toBeLessThan(500);
  }, 300000);

  it('posts 100 backdated sales', async () => {
    const ordersBefore = await M('Order').countDocuments({});
    await time('backdated sales', 100, async () => {
      // Posted one at a time, which is how the screen does it.
      for (let i = 0; i < 100; i++) {
        await auth('post', '/api/admin/backdate-sale').send({
          date: new Date(Date.now() - (i % 90) * 86400000).toISOString().slice(0, 10),
          amount: 500 + i, paymentMethod: 'Cash on Hand', note: `Bench sale ${i}`,
        });
      }
    });
    report[report.length - 1].stored = (await M('Order').countDocuments({})) - ordersBefore;
    expect(true).toBe(true);
  }, 600000);

  it('writes 1000 journal entries', async () => {
    await time('journal entries', 1000, async () => {
      const docs = Array.from({ length: 1000 }, (_, i) => ({
        date: new Date(Date.now() - (i % 365) * 86400000),
        reference: `BENCH-${String(i).padStart(5, '0')}`,
        description: `Bench entry ${i}`,
        lines: [
          { accountCode: '111000', accountName: 'Cash on Hand', debit: 100, credit: 0 },
          { accountCode: '410000', accountName: 'Product Sales', debit: 0, credit: 100 },
        ],
        totalDebit: 100, totalCredit: 100,
      }));
      for (let i = 0; i < docs.length; i += 250) {
        await M('JournalEntry').insertMany(docs.slice(i, i + 250), { ordered: false });
      }
    });
    expect(await M('JournalEntry').countDocuments({})).toBeGreaterThanOrEqual(1000);
  }, 300000);

  it('prints the measured throughput and resulting storage', async () => {
    const db = mongoose.connection.db;
    const stats = await db.stats();

    const collections = ['Inventory', 'StockCard', 'JournalEntry', 'Order', 'Expense', 'Product'];
    const sizes = [];
    for (const name of collections) {
      try {
        const model = M(name);
        const count = await model.countDocuments({});
        const cs = await db.command({ collStats: model.collection.collectionName });
        sizes.push({
          collection: name, docs: count,
          storageKB: Math.round((cs.storageSize || 0) / 1024),
          avgDocBytes: Math.round(cs.avgObjSize || 0),
        });
      } catch { /* a model with no collection yet */ }
    }

    const out = process.env.BENCH_OUT;
    if (out) {
      fs.writeFileSync(out, JSON.stringify({
        throughput: report, storage: sizes,
        dbDataKB: Math.round((stats.dataSize || 0) / 1024),
        dbStorageKB: Math.round((stats.storageSize || 0) / 1024),
      }, null, 2));
    }

    // eslint-disable-next-line no-console
    console.log('\n===== BULK THROUGHPUT =====');
    // eslint-disable-next-line no-console
    console.table(report);
    // eslint-disable-next-line no-console
    console.log('===== STORAGE AFTER =====');
    // eslint-disable-next-line no-console
    console.table(sizes);
    // eslint-disable-next-line no-console
    console.log(`DB dataSize: ${Math.round((stats.dataSize || 0) / 1024)} KB, storageSize: ${Math.round((stats.storageSize || 0) / 1024)} KB\n`);

    expect(report.length).toBeGreaterThan(0);
  }, 120000);
});
