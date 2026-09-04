// Expense categories come from the live chart, not a hand-written list.
//
// EXPENSE_CATEGORIES names twelve accounts. Treating it as THE set of expense
// accounts had two effects, both silent:
//
//   1. Real accounts in the chart could not be booked to at all - Employee
//      Benefits, Transportation & Delivery, Depreciation, Interest Expense.
//      They appear in the P&L but nothing could ever post to them.
//   2. A custom sub-account ("Electricity" under Utilities) was unselectable
//      AND invisible in the expense list, so money spent through it vanished
//      from "what have we spent" while still sitting in the ledger.
//
// The picker, the reader and the validator must therefore all agree.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ExpSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ExpSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
const categories = async () => (await auth('get', '/api/expenses/categories')).body.categories;

beforeEach(async () => {
  await M('JournalEntry').deleteMany({});
  await M('Account').deleteMany({ custom: true });
});

describe('which accounts can be expensed', () => {
  it('still offers the familiar twelve, with their friendlier labels', async () => {
    const cats = await categories();
    const byCode = Object.fromEntries(cats.map(c => [c.code, c.label]));
    expect(byCode['630000']).toBe('Rent');
    // The chart calls this "Utilities Expense"; the friendlier label wins.
    expect(byCode['640000']).toBe('Utilities (Electricity / Water / Internet)');
    expect(byCode['760000']).toBe('Miscellaneous Expense');
  });

  it('now also offers real accounts the hand-written list left out', async () => {
    const codes = (await categories()).map(c => c.code);
    // Each of these is an expense account in the chart that nothing could post to.
    for (const code of ['620000', '670000', '690000', '910000', '920000', '930000']) {
      expect(codes).toContain(code);
    }
  });

  it('excludes COGS - that is driven by sales, not by filing a receipt', async () => {
    const codes = (await categories()).map(c => c.code);
    for (const code of ['510000', '520000', '530000', '535000', '540000']) {
      expect(codes).not.toContain(code);
    }
  });

  it('excludes parent rollups, which would double-count their children', async () => {
    const codes = (await categories()).map(c => c.code);
    for (const code of ['500000', '600000', '700000', '900000']) {
      expect(codes).not.toContain(code);
    }
  });
});

describe('a custom sub-account is a first-class expense category', () => {
  // The case that motivated this: breaking Utilities down by bill.
  const makeSub = () => auth('post', '/api/accounts')
    .send({ parentCode: '640000', name: 'Electricity' });

  it('appears in the picker once created', async () => {
    const made = await makeSub();
    expect(made.status).toBeLessThan(400);
    const code = made.body?.account?.code;
    expect(code).toBeTruthy();

    const cats = await categories();
    const found = cats.find(c => c.code === code);
    expect(found).toBeTruthy();
    expect(found.custom).toBe(true);
    expect(found.label).toMatch(/Electricity/i);
  }, 30000);

  it('can be posted to, and the expense reads back', async () => {
    const made = await makeSub();
    const code = made.body?.account?.code;

    const posted = await auth('post', '/api/expenses').send({
      amount: 1250, categoryCode: code, paymentMethod: 'Cash on Hand',
      description: 'July electricity', vendor: 'Meralco',
    });
    expect(posted.status).toBe(200);
    expect(posted.body.success).toBe(true);

    // The half that used to fail silently: it is in the ledger, so it must be
    // in the expense list too.
    const list = await auth('get', '/api/expenses');
    const hit = (list.body.expenses || []).find(e => String(e.description || '').includes('July electricity'));
    expect(hit).toBeTruthy();
  }, 30000);
});

describe('posting to an account that is not expensable', () => {
  it('refuses COGS', async () => {
    const res = await auth('post', '/api/expenses').send({
      amount: 100, categoryCode: '510000', paymentMethod: 'Cash on Hand', description: 'nope',
    });
    expect(res.body.success).not.toBe(true);
    expect(String(res.body.error)).toMatch(/invalid expense category/i);
  });

  it('refuses a parent rollup', async () => {
    const res = await auth('post', '/api/expenses').send({
      amount: 100, categoryCode: '600000', paymentMethod: 'Cash on Hand', description: 'nope',
    });
    expect(res.body.success).not.toBe(true);
  });

  it('refuses an account that does not exist', async () => {
    const res = await auth('post', '/api/expenses').send({
      amount: 100, categoryCode: '999999', paymentMethod: 'Cash on Hand', description: 'nope',
    });
    expect(res.body.success).not.toBe(true);
  });
});

describe('the newly-opened accounts actually work end to end', () => {
  it('books and reads back an expense against Transportation & Delivery', async () => {
    const posted = await auth('post', '/api/expenses').send({
      amount: 640, categoryCode: '670000', paymentMethod: 'Cash on Hand',
      description: 'Rider fuel reimbursement',
    });
    expect(posted.body.success).toBe(true);

    const list = await auth('get', '/api/expenses');
    const hit = (list.body.expenses || []).find(e => String(e.description || '').includes('Rider fuel'));
    expect(hit).toBeTruthy();
  }, 30000);
});
