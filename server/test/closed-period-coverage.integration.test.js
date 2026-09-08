// Closing a period should close it to EVERYTHING.
//
// Closing March means the March figures have been reported and will not move
// again. The lock exists (periodLockFor) and the sales, expense and journal
// paths honour it - but it is applied route by route, so every route added
// since is a way back into a closed month. An asset dated into March, an
// advance paid in March, a March delivery received: each posts a March entry
// into books that were signed off, and the reported figures silently change.
//
// This test walks the money-posting routes and asks each one the same
// question. It is written to FAIL for any route that lets a closed month
// through, so the gap is visible rather than assumed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

// A date inside the month we close below.
const IN_CLOSED = '2026-03-10';

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'LockSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'LockSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  for (const n of ['ClosedPeriod', 'JournalEntry', 'FixedAsset', 'Advance']) {
    await M(n).deleteMany({});
  }
  // March 2026 is closed: reported, signed off, not to be moved.
  await M('ClosedPeriod').create({ year: 2026, month: 3, isOpen: false, closedBy: 'LockSuper' });
});

const marchEntries = () => M('JournalEntry').countDocuments({
  date: { $gte: new Date('2026-03-01T00:00:00'), $lte: new Date('2026-03-31T23:59:59') },
});

describe('the routes that already honour a closed month', () => {
  it('refuses a backdated sale into it', async () => {
    const res = await auth('post', '/api/admin/backdate-sale').send({
      date: IN_CLOSED, amount: 500, paymentMethod: 'Cash', customerName: 'Walk-in',
    });
    expect(res.status).toBe(423);           // Locked, not a bad request
    expect(String(res.body.error)).toMatch(/closed/i);
  }, 30000);

  it('refuses an expense dated into it', async () => {
    const res = await auth('post', '/api/expenses').send({
      amount: 1000, categoryCode: '610000', paymentMethod: 'Cash on Hand',
      description: 'Backdated electricity', date: IN_CLOSED,
    });
    expect(res.body.success).toBe(false);
    expect(String(res.body.error)).toMatch(/closed/i);
  }, 30000);
});

describe('the routes that used to let a closed month through', () => {
  it('refuses an asset acquired inside a closed month', async () => {
    const res = await auth('post', '/api/fixed-assets').send({
      name: 'Backdated Grinder', accountCode: '140200',
      acquisitionCost: 30000, salvageValue: 0, usefulLifeMonths: 60,
      acquisitionDate: IN_CLOSED, paidFromAccount: '111000',
    });
    // The failure this catches: a 30,000 asset appearing in a month whose
    // balance sheet has already been reported.
    expect(String(res.body.error || '')).toMatch(/closed/i);
    expect(await marchEntries()).toBe(0);
  }, 30000);

  it('refuses an advance paid inside a closed month', async () => {
    const res = await auth('post', '/api/advances').send({
      type: 'employee', payeeName: 'Barista', amount: 2000,
      account: '170100', sourceAccount: '111000', date: IN_CLOSED,
      purpose: 'Backdated float',
    });
    expect(String(res.body.error || '')).toMatch(/closed/i);
    expect(await marchEntries()).toBe(0);
  }, 30000);
});

// The manual journal is where an accountant makes corrections, so the date on
// it is not cosmetic - it decides which month a correction lands in.
describe('a manual journal entry', () => {
  it('posts into the month it is dated, not the day it is typed', async () => {
    const res = await auth('post', '/api/journal').send({
      date: '2026-05-15', description: 'Adjusting entry',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 100, credit: 0 },
        { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: 100 },
      ],
    });
    expect(res.body.success).toBe(true);
    const je = await M('JournalEntry').findOne({ description: 'Adjusting entry' }).lean();
    expect(new Date(je.date).getMonth()).toBe(4);   // May, not today
  }, 30000);

  it('still refuses a date inside a closed month', async () => {
    const res = await auth('post', '/api/journal').send({
      date: IN_CLOSED, description: 'Backdated correction',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 100, credit: 0 },
        { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: 100 },
      ],
    });
    expect(res.status).toBe(423);
    expect(await marchEntries()).toBe(0);
  }, 30000);
});
