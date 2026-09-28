// The owner's overview on the Hub: cash, A/R, A/P and net income across every
// linked business, plus the inter-branch clearing account that makes a Hub
// transfer vanish from the combined books.
//
// Three things are pinned here:
//   1. The headline figures are the real balances, not something plausible.
//   2. Inter-branch clearing (160200) is a declared account, so a branch that
//      has sent stock still has a balance sheet that balances. It used to post
//      to 540900, which the chart did not know, and statements skipped it.
//   3. The boot migration moves old 540900 lines across, once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, migrate;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const JE = () => mongoose.model('JournalEntry');

// A journal entry posted directly, so each account's balance is known exactly.
const post = (reference, lines) => JE().create({
  date: new Date(), reference, description: reference,
  lines: lines.map(([accountCode, debit, credit]) => ({ accountCode, accountName: accountCode, debit, credit })),
  totalDebit: lines.reduce((t, l) => t + l[1], 0),
  totalCredit: lines.reduce((t, l) => t + l[2], 0),
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb', jwtSecret: 'hub-position-test-secret-0123456789' });
  app = ctx.app;
  migrate = (await import('../server.js')).migrateHubClearingAccount;
  await makeUser({ name: 'Owner', role: 'superadmin' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  tok = await loginStaff(app, 'Owner');

  await post('T-CAPITAL', [['111000', 50000, 0], ['112000', 30000, 0], ['310000', 0, 80000]]);
  await post('T-CREDIT-SALE', [['120000', 4000, 0], ['410000', 0, 4000]]);
  await post('T-BILL', [['130000', 2500, 0], ['220000', 0, 2500]]);
  await post('T-RENT', [['620000', 1500, 0], ['111000', 0, 1500]]);
  // Stock sent to a sibling branch and not yet received there.
  await post('T-HUB-OUT', [['160200', 700, 0], ['130000', 0, 700]]);
}, 120000);

afterAll(async () => { await ctx?.stop?.(); });

describe('the Hub owner overview', () => {
  let fin;
  beforeAll(async () => {
    const r = await auth('get', '/api/hub/network-financials?start=2000-01-01&end=2100-12-31');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    fin = r.body;
  });

  it('reports cash as on-hand plus bank, less what was spent', () => {
    expect(fin.position.cash).toBe(50000 + 30000 - 1500);
  });

  it('reports what customers owe and what we owe suppliers', () => {
    expect(fin.position.receivables).toBe(4000);
    expect(fin.position.payables).toBe(2500);
  });

  it('reports net income for the period', () => {
    expect(fin.position.netIncome).toBe(4000 - 1500);
  });

  it('agrees with the per-branch row when there is only one branch', () => {
    const own = fin.branches.find(b => b.self);
    expect(own.cash).toBe(fin.position.cash);
    expect(own.receivables).toBe(fin.position.receivables);
    expect(own.payables).toBe(fin.position.payables);
  });

  it('flags stock sent to a sibling that has not arrived yet', () => {
    expect(fin.interBranch.unmatched).toBe(700);
  });

  it('knows the clearing account, so nothing is reported as unmapped', () => {
    expect(fin.unknownAccounts.map(a => a.code)).not.toContain('160200');
  });

  it('keeps the balance sheet balanced after stock is sent out', () => {
    const t = fin.balanceSheet.totals;
    expect(Math.abs(t.assets - (t.liabilities + t.equity))).toBeLessThanOrEqual(0.01);
  });
});

describe('moving old transfers off the undeclared 540900 code', () => {
  it('rewrites only the 540900 lines, and leaves amounts alone', async () => {
    await post('T-LEGACY', [['540900', 300, 0], ['130000', 0, 300]]);
    const moved = await migrate();
    expect(moved).toBe(1);

    const e = await JE().findOne({ reference: 'T-LEGACY' }).lean();
    const codes = e.lines.map(l => l.accountCode).sort();
    expect(codes).toEqual(['130000', '160200']);
    expect(e.lines.find(l => l.accountCode === '160200').debit).toBe(300);
  });

  it('does nothing the second time', async () => {
    expect(await migrate()).toBe(0);
  });
});
