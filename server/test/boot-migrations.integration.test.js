// Boot-time startup tasks on LEGACY data. We seed pre-migration documents with the raw
// driver (bypassing Mongoose defaults so fields are genuinely absent), then invoke the
// extracted runStartupTasks() and assert each one-time migration ran.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { bootApp } from './helpers/harness.js';

let ctx;

beforeAll(async () => { ctx = await bootApp({ businessType: 'log' }); }, 120000);
afterAll(async () => { await ctx.stop(); });

describe('runStartupTasks — idempotent migrations on legacy data', () => {
  it('backfills businessType, rewrites 4→6-digit codes, syncs counters, backfills the superadmin role', async () => {
    const Order = mongoose.model('Order');
    const Product = mongoose.model('Product');
    const JournalEntry = mongoose.model('JournalEntry');
    const Settings = mongoose.model('Settings');
    const Counter = mongoose.model('Counter');
    const User = mongoose.model('User');

    // Legacy docs (raw inserts bypass schema defaults → fields truly absent):
    await Order.collection.insertOne({ orderNumber: 'ORD-2099-A0042', status: 'Completed', total: 10 });
    await Product.collection.insertOne({ name: 'LegacyProd', basePrice: 1, productCode: 'BEV-A0099' });
    await JournalEntry.collection.insertOne({
      reference: 'LEG-1',
      lines: [{ accountCode: '1000', debit: 5, credit: 0 }, { accountCode: '4000', debit: 0, credit: 5 }],
      totalDebit: 5, totalCredit: 5,
    });
    await Settings.deleteOne({ key: 'coaV2Migrated' });            // let the one-time COA migration re-run
    await User.collection.insertOne({ userCode: 'ADN-A0500', name: 'Super Admin' }); // legacy admin, no role

    await ctx.runStartupTasks();

    // businessType stamped on legacy docs
    expect((await Order.findOne({ orderNumber: 'ORD-2099-A0042' }).lean()).businessType).toBe('log');
    expect((await Product.findOne({ productCode: 'BEV-A0099' }).lean()).businessType).toBe('log');

    // 4-digit account codes rewritten via CODE_MAP (1000→111000, 4000→410000)
    const je = await JournalEntry.findOne({ reference: 'LEG-1' }).lean();
    expect(je.lines.map((l) => l.accountCode).sort()).toEqual(['111000', '410000']);

    // atomic counter synced up to the seeded order's sequence
    expect((await Counter.findById('ORD-2099').lean()).seq).toBeGreaterThanOrEqual(42);

    // legacy "Super Admin" with no role gets role=superadmin
    expect((await User.findOne({ userCode: 'ADN-A0500' }).lean()).role).toBe('superadmin');
  });

  it('is idempotent — a second run makes no further changes and does not throw', async () => {
    await expect(ctx.runStartupTasks()).resolves.not.toThrow();
    const je = await mongoose.model('JournalEntry').findOne({ reference: 'LEG-1' }).lean();
    expect(je.lines.map((l) => l.accountCode).sort()).toEqual(['111000', '410000']); // unchanged
  });
});
