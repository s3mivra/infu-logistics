// Expense listing - the read side that backs the Expenses page.
// Expenses are journal entries whose debit is an expense account, so the risks
// are (a) catching non-expense entries and (b) totals that disagree with the
// rows once the list is truncated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const list = async (qs = '') => (await request(app).get(`/api/expenses${qs}`).set(auth(superToken))).body;

const addExpense = (amount, categoryCode, description, date) =>
  request(app).post('/api/expenses').set(auth(superToken))
    .send({ amount, categoryCode, paymentMethod: 'Cash on Hand', description, date });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'exp-test-secret-0123456789' }));
  await makeUser({ name: 'ExpBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ExpBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('expense listing', () => {
  it('returns expenses that were posted, newest first', async () => {
    await addExpense(500, '640000', 'electricity');
    await addExpense(300, '650000', 'bond paper');
    const b = await list();
    expect(b.success).toBe(true);
    expect(b.expenses.length).toBeGreaterThanOrEqual(2);
    const descs = b.expenses.map(e => e.description).join(' | ');
    expect(descs).toMatch(/electricity/i);
    expect(descs).toMatch(/bond paper/i);
  });

  it('reports each row against its expense category', async () => {
    const b = await list();
    const row = b.expenses.find(e => /electricity/i.test(e.description));
    expect(row.categoryCode).toBe('640000');
    expect(row.amount).toBe(500);
  });

  it('summarises by category and totals the range', async () => {
    const b = await list();
    const util = b.byCategory.find(c => c.code === '640000');
    const supp = b.byCategory.find(c => c.code === '650000');
    expect(util.total).toBe(500);
    expect(supp.total).toBe(300);
    expect(b.total).toBe(800);
  });

  it('does NOT pick up non-expense journal entries', async () => {
    // A sale posts to revenue/cash - it must never appear as an expense.
    await mongoose.model('JournalEntry').create({
      date: new Date(), reference: 'NOT-AN-EXPENSE', description: 'a sale',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 999, credit: 0 },
        { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: 999 },
      ],
      totalDebit: 999, totalCredit: 999,
    });
    const b = await list();
    expect(b.expenses.some(e => /a sale/.test(e.description))).toBe(false);
    expect(b.total).toBe(800);   // unchanged
  });

  it('keeps category totals honest when the row list is truncated', async () => {
    // The trap: computing totals from the returned page would understate them.
    for (let i = 0; i < 5; i++) await addExpense(10, '630000', `rent chunk ${i}`);
    const b = await list('?limit=2');
    expect(b.expenses).toHaveLength(2);
    const rent = b.byCategory.find(c => c.code === '630000');
    expect(rent.total).toBe(50);        // all five, not just the two returned
    expect(rent.count).toBe(5);
  });

  it('honours an explicit date range', async () => {
    const old = new Date(); old.setFullYear(old.getFullYear() - 1);
    await addExpense(777, '630000', 'last year rent', old.toISOString().slice(0, 10));
    const thisMonth = await list();
    expect(thisMonth.expenses.some(e => /last year rent/.test(e.description))).toBe(false);

    const from = new Date(old); from.setDate(from.getDate() - 2);
    const to = new Date(old); to.setDate(to.getDate() + 2);
    const ranged = await list(`?start=${from.toISOString().slice(0, 10)}&end=${to.toISOString().slice(0, 10)}`);
    expect(ranged.expenses.some(e => /last year rent/.test(e.description))).toBe(true);
    expect(ranged.total).toBe(777);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/expenses')).status).toBe(401);
  });
});

describe('POST /api/expenses/import - bulk Excel import', () => {
  const importRows = (rows) => request(app).post('/api/expenses/import').set(auth(superToken)).send({ rows });

  it('creates one entry per valid row and reports the total', async () => {
    const res = await importRows([
      { amount: 100, categoryCode: '650000', paymentMethod: 'Cash on Hand', description: 'bulk row 1' },
      { amount: 200, categoryCode: '640000', paymentMethod: 'Cash on Hand', description: 'bulk row 2' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.totalAmount).toBe(300);
    expect(res.body.skipped).toHaveLength(0);

    const b = await list();
    expect(b.expenses.some(e => /bulk row 1/.test(e.description))).toBe(true);
    expect(b.expenses.some(e => /bulk row 2/.test(e.description))).toBe(true);
  });

  it('skips a bad row without losing the good ones in the same batch', async () => {
    const res = await importRows([
      { amount: 100, categoryCode: '650000', paymentMethod: 'Cash on Hand', description: 'good row' },
      { amount: -5, categoryCode: '650000', paymentMethod: 'Cash on Hand', description: 'bad amount' },
      { amount: 100, categoryCode: 'nope', paymentMethod: 'Cash on Hand', description: 'bad category' },
      { amount: 100, categoryCode: '650000', paymentMethod: 'Cash on Hand', description: '' }, // missing description
    ]);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toHaveLength(3);
    expect(res.body.skipped.map(s => s.row)).toEqual([2, 3, 4]);
  });

  it('folds vendor ("Paid To") and refNo into the description', async () => {
    await importRows([{ amount: 50, categoryCode: '650000', paymentMethod: 'Cash on Hand', description: 'stapler', vendor: 'National Bookstore', refNo: 'OR-99182' }]);
    const b = await list();
    const row = b.expenses.find(e => /stapler/.test(e.description));
    expect(row.description).toMatch(/National Bookstore/);
    expect(row.description).toMatch(/OR-99182/);
  });

  it('rejects an empty batch', async () => {
    expect((await importRows([])).status).toBe(400);
  });

  it('rejects a batch over the row cap', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ amount: 1, categoryCode: '650000', paymentMethod: 'Cash on Hand', description: `row ${i}` }));
    const res = await importRows(rows);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500/);
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/expenses/import').send({ rows: [] })).status).toBe(401);
  });
});
