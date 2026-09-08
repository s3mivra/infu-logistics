// Withholding tax: money deducted from someone else's payment.
//
// When a business withholds on rent or a professional fee, three things are
// true at once and all three have to be recorded:
//   - the expense is the FULL amount (the service was worth what it was worth)
//   - the supplier is paid LESS
//   - the difference is a liability, held until the BIR is paid
//
// Booking the expense net of tax is the common mistake: costs come out
// understated and the money owed to the BIR appears nowhere at all.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const line = (je, code) => je.lines.find(l => l.accountCode === code);
// Whatever account the payment method routes to - the point here is the net
// amount that left, not which till it left from.
const paidOut = (je) => je.lines.find(l => l.credit > 0 && !String(l.accountCode).startsWith('230'));

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'WhtSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'WhtSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const enable = (on = true) =>
  auth('patch', '/api/settings/withholdingTaxEnabled').send({ value: on });

// 10,000 of rent, withheld at 5% - the standard EWT rate on rent.
const payRent = (over = {}) => auth('post', '/api/expenses').send({
  amount: 10000, categoryCode: '630000', paymentMethod: 'Cash on Hand',
  description: 'March rent', vendor: 'Landlord',
  withholdingRate: 5, ...over,
});

beforeEach(async () => {
  for (const n of ['JournalEntry', 'Settings']) await M(n).deleteMany({});
  await enable(true);
});

describe('withholding on a payment', () => {
  it('expenses the full amount, not what the supplier received', async () => {
    const res = await payRent();
    expect(res.body.success).toBe(true);
    const je = await M('JournalEntry').findById(res.body.entry._id).lean();
    // The failure this prevents: rent booked at 9,500 because that is what
    // left the till, understating costs by the tax every single month.
    expect(line(je, '630000').debit).toBe(10000);
  }, 30000);

  it('pays the supplier the net amount', async () => {
    const res = await payRent();
    const je = await M('JournalEntry').findById(res.body.entry._id).lean();
    expect(paidOut(je).credit).toBe(9500);
  }, 30000);

  it('holds the tax as a liability until it is remitted', async () => {
    const res = await payRent();
    const je = await M('JournalEntry').findById(res.body.entry._id).lean();
    expect(line(je, '230100').credit).toBe(500);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  }, 30000);

  it('does none of it when no rate is given', async () => {
    const res = await payRent({ withholdingRate: 0 });
    const je = await M('JournalEntry').findById(res.body.entry._id).lean();
    expect(line(je, '230100')).toBeUndefined();
    expect(paidOut(je).credit).toBe(10000);
  }, 30000);

  it('refuses a rate that is plainly a typo', async () => {
    // 500 in the percent box would withhold fifty times the payment.
    const res = await payRent({ withholdingRate: 500 });
    const je = await M('JournalEntry').findById(res.body.entry._id).lean();
    // Capped at the top of the real EWT band rather than accepted.
    expect(line(je, '230100').credit).toBe(1500);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  }, 30000);
});

describe('when the business does not withhold', () => {
  it('ignores a rate rather than rejecting the expense', async () => {
    await enable(false);
    const res = await payRent();
    // The expense is still a valid expense - it just is not withheld against.
    expect(res.body.success).toBe(true);
    const je = await M('JournalEntry').findById(res.body.entry._id).lean();
    expect(line(je, '230100')).toBeUndefined();
    expect(paidOut(je).credit).toBe(10000);
  }, 30000);

  it('hides the report entirely', async () => {
    await enable(false);
    const res = await auth('get', '/api/reports/withholding-tax');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not switched on/i);
  }, 30000);
});

describe('what is owed to the BIR', () => {
  it('reports what has been withheld and not yet remitted', async () => {
    await payRent();
    await payRent({ description: 'April rent' });

    const { body } = await auth('get', '/api/reports/withholding-tax');
    expect(body.totals.withheld).toBe(1000);
    expect(body.totals.remitted).toBe(0);
    // This is the number that has to be paid over.
    expect(body.totals.outstanding).toBe(1000);
  }, 30000);

  it('nets off a remittance once the BIR is paid', async () => {
    await payRent();
    // Remitting: the liability is discharged and the cash goes.
    await M('JournalEntry').create({
      date: new Date(), reference: 'RMT-1', description: 'BIR remittance',
      lines: [
        { accountCode: '230100', accountName: 'Withholding Tax Payable - Expanded', debit: 500, credit: 0 },
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 0, credit: 500 },
      ],
      totalDebit: 500, totalCredit: 500,
    });

    const { body } = await auth('get', '/api/reports/withholding-tax');
    expect(body.totals.withheld).toBe(500);
    expect(body.totals.remitted).toBe(500);
    expect(body.totals.outstanding).toBe(0);
  }, 30000);

  it('groups by month, which is how it is remitted', async () => {
    await payRent();
    const { body } = await auth('get', '/api/reports/withholding-tax');
    expect(body.periods[0].month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.periods[0].accountName).toMatch(/withholding/i);
    // Each withholding is listed, so a 2307 can be filled in per supplier.
    expect(body.periods[0].entries.length).toBeGreaterThan(0);
  }, 30000);
});
