// The double-entry safety net, proven two ways:
//   1. DATA-LAYER GUARANTEE — the JournalEntry model itself refuses to persist
//      an unbalanced entry (schema pre('validate') hook). This is the floor
//      beneath every app-level assertBalanced(): even a buggy or future code
//      path cannot write books that don't balance.
//   2. PER-STEP INVARIANT — driving the real order/sales money paths over HTTP,
//      the whole ledger's debits equal its credits after EVERY operation, not
//      just at the end (a net-zero end check can hide two errors that cancel).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, superTok, staffTok, prod, inv;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

// The core assertion, reused after each money operation below.
async function expectBooksBalance(label) {
  const { debits, credits } = await trialBalance();
  // Exact to the centavo — double-entry books balance, they don't "roughly" balance.
  expect(Math.abs(debits - credits), `books out of balance after ${label}: DR ${debits} vs CR ${credits}`).toBeLessThanOrEqual(0.01);
}

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'deSuper', role: 'superadmin' });
  await makeUser({ name: 'deStaff', role: 'staff' });
  superTok = await loginStaff(app, 'deSuper');
  staffTok = await loginStaff(app, 'deStaff');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'DECat', department: 'Kitchen' });
  inv = await Inventory.create({ itemName: 'Beans', stockQty: 5000, unit: 'g', unitCost: 0.5, lowStockThreshold: 50 });
  prod = await Product.create({
    name: 'Latte', category: 'DECat', basePrice: 120,
    baseRecipe: [{ invId: String(inv._id), name: 'Beans', qty: 12, cost: 6, unit: 'g' }],
  });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('data-layer guarantee: the model refuses unbalanced entries', () => {
  it('rejects a create() where debits != credits', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    await expect(JournalEntry.create({
      reference: 'DE-BAD-1', description: 'deliberately unbalanced',
      lines: [{ accountCode: '111000', debit: 100, credit: 0 }, { accountCode: '410000', debit: 0, credit: 90 }],
    })).rejects.toThrow(/UNBALANCED/i);
  });

  it('accepts a balanced create() and derives the totals from the lines', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.create({
      reference: 'DE-OK-1', description: 'balanced',
      // Totals intentionally left unset — the hook must fill them from the lines.
      lines: [{ accountCode: '111000', debit: 100, credit: 0 }, { accountCode: '410000', debit: 0, credit: 100 }],
    });
    expect(je.totalDebit).toBe(100);
    expect(je.totalCredit).toBe(100);
  });

  it('rejects an unbalanced insertMany too (not just create)', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    await expect(JournalEntry.insertMany([{
      reference: 'DE-BAD-2', description: 'unbalanced batch',
      lines: [{ accountCode: '111000', debit: 50, credit: 0 }, { accountCode: '410000', debit: 0, credit: 5 }],
    }])).rejects.toThrow(/UNBALANCED/i);
  });

  it('overwrites lying totals with the true line sums', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.create({
      reference: 'DE-OK-2', description: 'totals lie, lines are truth',
      totalDebit: 9999, totalCredit: 1, // nonsense — must be corrected to the line sums
      lines: [{ accountCode: '111000', debit: 75, credit: 0 }, { accountCode: '410000', debit: 0, credit: 75 }],
    });
    expect(je.totalDebit).toBe(75);
    expect(je.totalCredit).toBe(75);
  });
});

describe('per-step invariant: the ledger balances after every sales operation', () => {
  const order = (qty, paymentMethod = 'Cash') => ({
    items: [{ productId: String(prod._id), name: 'Latte', price: 120, quantity: qty }],
    table: 'Takeout', paymentMethod,
  });

  it('stays balanced through: cash sale, bank sale (A/R), void, and a second cash sale', async () => {
    await expectBooksBalance('setup');

    // 1) Cash sale → DR Cash / CR Revenue (+VAT if on), DR COGS / CR Inventory.
    const a = await auth('post', '/api/orders', staffTok).send(order(2));
    expect(a.status).toBe(200);
    await auth('put', `/api/orders/${a.body.order._id}`, staffTok).send({ status: 'Completed' });
    await expectBooksBalance('cash sale');

    // 2) Non-cash sale → books Accounts Receivable instead of Cash, still balanced.
    const b = await auth('post', '/api/orders', staffTok).send(order(1, 'Bank Transfer'));
    expect(b.status).toBe(200);
    await auth('put', `/api/orders/${b.body.order._id}`, staffTok).send({ status: 'Completed' });
    await expectBooksBalance('bank (A/R) sale');

    // 3) Void the cash sale → reversing entry, books return to balance.
    const v = await auth('post', `/api/orders/${a.body.order._id}/void`, superTok).send({ reason: 'Customer changed mind' });
    expect(v.status).toBe(200);
    await expectBooksBalance('void');

    // 4) Another cash sale after the void → still balanced.
    const c = await auth('post', '/api/orders', staffTok).send(order(3));
    await auth('put', `/api/orders/${c.body.order._id}`, staffTok).send({ status: 'Completed' });
    await expectBooksBalance('second cash sale');

    // Final: the whole ledger has real activity AND balances exactly.
    const { debits, credits } = await trialBalance();
    expect(debits).toBeGreaterThan(0);
    expect(Math.abs(debits - credits)).toBeLessThanOrEqual(0.01);
  });
});
