// Expense listing — the read side that backs the Expenses page.
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
    // A sale posts to revenue/cash — it must never appear as an expense.
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
