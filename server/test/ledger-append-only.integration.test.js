// Journal entries are append-only: corrected by a reversing entry, never
// edited or deleted. Until now that held only by convention.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { bootApp } from './helpers/harness.js';
import { withLedgerMaintenance } from '../lib/ledgerGuard.js';

let ctx, je;
const JE = () => mongoose.model('JournalEntry');
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  je = await JE().create({ reference: 'APPEND-1', description: 'posted',
    lines: [{ accountCode: '111000', debit: 100, credit: 0 }, { accountCode: '310000', debit: 0, credit: 100 }] });
}, 120000);
afterAll(async () => { await ctx?.stop?.(); });

describe('a posted journal entry cannot be rewritten', () => {
  it('refuses updateOne', async () => {
    await expect(JE().updateOne({ _id: je._id }, { $set: { description: 'edited' } })).rejects.toThrow(/append-only/);
  });
  it('refuses updateMany and findOneAndUpdate', async () => {
    await expect(JE().updateMany({}, { $set: { description: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(JE().findOneAndUpdate({ _id: je._id }, { $set: { description: 'x' } })).rejects.toThrow(/append-only/);
  });
  it('refuses deleteOne, deleteMany and findByIdAndDelete', async () => {
    await expect(JE().deleteOne({ _id: je._id })).rejects.toThrow(/append-only/);
    await expect(JE().deleteMany({})).rejects.toThrow(/append-only/);
    await expect(JE().findByIdAndDelete(je._id)).rejects.toThrow(/append-only/);
  });
  it('refuses re-saving an existing entry', async () => {
    const doc = await JE().findById(je._id);
    doc.description = 'edited';
    await expect(doc.save()).rejects.toThrow(/append-only/);
  });
  it('still has the entry, unchanged', async () => {
    const doc = await JE().findById(je._id).lean();
    expect(doc.description).toBe('posted');
  });
  it('still allows posting new entries', async () => {
    await expect(JE().create({ reference: 'APPEND-2', description: 'new',
      lines: [{ accountCode: '111000', debit: 5, credit: 0 }, { accountCode: '310000', debit: 0, credit: 5 }] })).resolves.toBeTruthy();
  });
  it('allows explicitly declared maintenance (migrations, the purge)', async () => {
    const r = await withLedgerMaintenance(() => JE().updateOne({ _id: je._id }, { $set: { description: 'migrated' } }));
    expect(r.modifiedCount).toBe(1);
  });
});
