// The ledger and the audit log only ever grow.
//
// Nearly every report reads journal entries by DATE (P&L, balance sheet, VAT
// return, percentage tax) or by ACCOUNT (books health, trial balance). With no
// index, each of those scans every entry ever written: fast on day one, minutes
// long after a year of trading - and nothing fails, it just gets slower until
// somebody says the app is broken.
//
// A missing index is invisible, so it is asserted here rather than trusted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { bootApp } from './helpers/harness.js';

let ctx;

beforeAll(async () => { ctx = await bootApp({ businessType: 'log' }); }, 120000);
afterAll(async () => { await ctx.stop(); });

// Index keys as Mongo reports them, e.g. { date: -1 } -> "date". createIndexes
// first so the assertion is about what the schema declares rather than about
// whether Mongoose happened to have built them yet - boot does the same.
const indexedFields = async (model) => {
  const M = mongoose.model(model);
  await M.createIndexes();
  const idx = await M.collection.indexes();
  return idx.map(i => Object.keys(i.key).join(','));
};

describe('indexes that keep reports fast as the data grows', () => {
  it('journal entries are indexed by date, by account and by reference', async () => {
    const keys = await indexedFields('JournalEntry');
    expect(keys).toContain('date');
    expect(keys).toContain('businessType,date');
    expect(keys).toContain('lines.accountCode,date');   // books health, trial balance
    expect(keys).toContain('reference');                // voids and reversals find their entry
  }, 60000);

  it('the audit log is indexed the way the Audit Report reads it', async () => {
    const keys = await indexedFields('AuditLog');
    expect(keys).toContain('createdAt');
    expect(keys).toContain('userId,createdAt');
    expect(keys).toContain('action,createdAt');
  }, 60000);

  it('orders and stock cards keep theirs', async () => {
    expect(await indexedFields('Order')).toContain('createdAt');
    expect(await indexedFields('StockCard')).toContain('inventoryId,date');
  }, 60000);
});
