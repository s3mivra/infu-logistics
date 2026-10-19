// One-time conversion of names saved before parties were kept in capitals.
// Every copy of a name is converted together, or one client would show up
// twice in A/R ageing ("Kasa Lokal" and "KASA LOKAL").
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { bootApp } from './helpers/harness.js';
import { uppercasePartyNames } from '../lib/partyNames.js';

let ctx;
const M = (n) => mongoose.model(n);
beforeAll(async () => { ctx = await bootApp({ businessType: 'log' }); }, 120000);
afterAll(async () => { await ctx.stop(); });

describe('converting existing names to capitals', () => {
  it('converts clients, suppliers and the names that point at them', async () => {
    const c = await M('ClientAccount').collection.insertOne({ name: 'Kasa Lokal', clientCode: 'PN-1', username: 'kasa', password: 'x' });
    await M('Supplier').collection.insertOne({ name: 'Best Beans Co', contactPerson: 'Ana Cruz', supplierCode: 'SUP-PN' });
    await M('Order').collection.insertOne({ orderNumber: 'PN-O1', customerName: 'Kasa Lokal', items: [], total: 0 });
    await M('Order').collection.insertOne({ orderNumber: 'PN-O2', customerName: 'Walk-In', items: [], total: 0 });
    await M('CollectionReminder').collection.insertOne({ clientKey: 'Kasa Lokal', clientAccountId: c.insertedId, method: 'Call' });
    await M('JournalEntry').collection.insertOne({ reference: 'PN-JE', description: 'x', supplierName: 'Best Beans Co', lines: [] });

    const changed = await uppercasePartyNames(mongoose);
    expect(changed['ClientAccount.name']).toBe(1);

    expect((await M('ClientAccount').findById(c.insertedId).lean()).name).toBe('KASA LOKAL');
    expect(await M('Supplier').findOne({ supplierCode: 'SUP-PN' }).lean()).toMatchObject({ name: 'BEST BEANS CO', contactPerson: 'ANA CRUZ' });
    expect((await M('Order').findOne({ orderNumber: 'PN-O1' }).lean()).customerName).toBe('KASA LOKAL');
    expect((await M('Order').findOne({ orderNumber: 'PN-O2' }).lean()).customerName).toBe('WALK-IN');
    expect((await M('CollectionReminder').findOne({ clientAccountId: c.insertedId }).lean()).clientKey).toBe('KASA LOKAL');
    // The books are history - left as written.
    expect((await M('JournalEntry').findOne({ reference: 'PN-JE' }).lean()).supplierName).toBe('Best Beans Co');
  });

  it('running it again changes nothing', async () => {
    expect(await uppercasePartyNames(mongoose)).toEqual({});
  });
});
