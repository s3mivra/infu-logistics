// Collections taken as "Cash on Hand" before it had a route sat in 118000
// Unassigned Receipts. On boot each is moved to 111000 by a correcting entry,
// once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { bootApp } from './helpers/harness.js';

let ctx;
beforeAll(async () => { ctx = await bootApp({ businessType: 'log' }); }, 120000);
afterAll(async () => { await ctx.stop(); });

describe('Cash on Hand out of Unassigned Receipts', () => {
  it('moves an old collection to Cash on Hand, and only once', async () => {
    const JE = mongoose.model('JournalEntry');
    await JE.create({ reference: 'COLL-OLD1', date: new Date(), description: 'old collection', totalDebit: 500, totalCredit: 500,
      lines: [{ accountCode: '118000', accountName: 'Unassigned Receipts', debit: 500, credit: 0 }, { accountCode: '120000', accountName: 'Accounts Receivable', debit: 0, credit: 500 }] });
    await mongoose.model('Order').create({ businessType: 'log', orderNumber: 'COH-1', status: 'Completed', paymentMethod: 'On Account', total: 500,
      items: [{ name: 'X', price: 500, quantity: 1 }], arPayments: [{ amount: 500, paymentMethod: 'Cash on Hand', journalRef: 'COLL-OLD1' }] });

    await ctx.runStartupTasks();
    await ctx.runStartupTasks();

    const fixes = await JE.find({ reference: 'COLL-OLD1-RCL' }).lean();
    expect(fixes).toHaveLength(1);
    expect(fixes[0].lines.find(l => l.accountCode === '111000').debit).toBe(500);
    expect(fixes[0].lines.find(l => l.accountCode === '118000').credit).toBe(500);
  });

  it('moves an old Cash on Hand expense, matched by its warning, and only once', async () => {
    const JE = mongoose.model('JournalEntry');
    const at = new Date();
    await mongoose.model('AuditLog').create({ userId: 'x', action: 'unmappedTender', targetReference: 'Cash on Hand', details: { after: { account: '118000', context: 'expense' } }, timestamp: at });
    await JE.create({ reference: 'EXP-OLD1', date: at, description: 'old expense', totalDebit: 300, totalCredit: 300,
      lines: [{ accountCode: '600000', accountName: 'Expense', debit: 300, credit: 0 }, { accountCode: '118000', accountName: 'Unassigned Receipts', debit: 0, credit: 300 }] });
    await JE.create({ reference: 'EXP-OTHER', date: at, description: 'unrelated, a day later', totalDebit: 50, totalCredit: 50, createdAt: new Date(at.getTime() + 86400000),
      lines: [{ accountCode: '600000', accountName: 'Expense', debit: 50, credit: 0 }, { accountCode: '118000', accountName: 'Unassigned Receipts', debit: 0, credit: 50 }] });

    await ctx.runStartupTasks();
    await ctx.runStartupTasks();

    const fixes = await JE.find({ reference: 'EXP-OLD1-RCL' }).lean();
    expect(fixes).toHaveLength(1);
    expect(fixes[0].lines.find(l => l.accountCode === '118000').debit).toBe(300);
    expect(fixes[0].lines.find(l => l.accountCode === '111000').credit).toBe(300);
    expect(await JE.exists({ reference: 'EXP-OTHER-RCL' })).toBeNull();
  });
});
