// The voucher file: every peso that leaves a cash account, documented.
//
// A check voucher is the paper somebody signs for a disbursement, and the file
// of them is what "money out" gets reconciled against. Three of the biggest
// ways money left - payroll, paid expenses, and opening a petty-cash float -
// issued none at all, so that file was never a complete record.
//
// The rule the issuer enforces: a voucher exists when, and only when, money
// actually left a cash, bank or e-wallet account.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const vouchers = () => M('CheckVoucher').find({}).sort({ createdAt: 1 }).lean();

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CvSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CvSuper');
  await M('Settings').updateOne({ key: 'payrollEnabled' }, { $set: { value: true } }, { upsert: true });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([
    M('CheckVoucher').deleteMany({}), M('JournalEntry').deleteMany({}),
    M('PayrollRun').deleteMany({}), M('RevolvingFund').deleteMany({}),
  ]);
});

describe('paying staff', () => {
  const iso = (d) => d.toISOString().slice(0, 10);

  const paidRun = async () => {
    const today = new Date();
    const draft = await auth('post', '/api/payroll-runs').send({
      periodStart: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      periodEnd: iso(today), payDate: iso(today),
      lines: [{ employeeName: 'Rosa Vega', grossPay: 20000, sss: 900, philhealth: 500, pagibig: 200, withholdingTax: 1500 }],
    });
    const id = draft.body.run._id;
    await auth('post', `/api/payroll-runs/${id}/approve`).send({});
    return auth('post', `/api/payroll-runs/${id}/pay`).send({ paidFromAccount: '112000' });
  };

  it('issues a voucher for the net pay leaving the bank', async () => {
    const res = await paidRun();
    expect(res.body.success).toBe(true);

    const [cv] = await vouchers();
    expect(cv).toBeTruthy();
    expect(cv.purpose).toBe('payroll');
    expect(cv.amount).toBeCloseTo(16900, 2);        // gross less the deductions held back
    expect(cv.sourceAccount).toBe('112000');
    expect(cv.payeeName).toMatch(/Payroll/);
    expect(cv.journalEntryRef).toBe(res.body.reference);
    expect(cv.status).toBe('Issued');
  });

  it('does not issue one when the run is only approved', async () => {
    const today = new Date();
    const draft = await auth('post', '/api/payroll-runs').send({
      periodStart: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      periodEnd: iso(today), payDate: iso(today),
      lines: [{ employeeName: 'Rosa Vega', grossPay: 20000, sss: 900 }],
    });
    await auth('post', `/api/payroll-runs/${draft.body.run._id}/approve`).send({});
    // Approving books the wages; no money has moved yet.
    expect(await vouchers()).toHaveLength(0);
  });
});

describe('paying an expense', () => {
  const expense = (paymentMethod) => auth('post', '/api/expenses').send({
    amount: 3500, categoryCode: '630000', description: 'March electricity',
    vendor: 'Meralco', refNo: 'OR-99120', paymentMethod,
  });

  it('issues a voucher when it is actually paid out', async () => {
    const res = await expense('Cash');
    expect(res.body.success).toBe(true);

    const [cv] = await vouchers();
    expect(cv.purpose).toBe('expense');
    expect(cv.payeeName).toBe('Meralco');
    expect(cv.amount).toBeCloseTo(3500, 2);
    expect(cv.referenceNumber).toBe('OR-99120');
  });

  it('issues none for an expense put on account - nobody was paid', async () => {
    const res = await expense('On Account');
    expect(res.body.success).toBe(true);
    // It raised a payable. Paying that bill later is what gets a voucher.
    expect(await vouchers()).toHaveLength(0);
  });
});

describe('opening a petty-cash float', () => {
  it('issues a voucher for the money leaving the bank', async () => {
    const res = await auth('post', '/api/revolving-funds').send({
      name: 'Front desk float', initialAmount: 5000, sourceAccount: '112000',
      description: 'Daily incidentals',
    });
    expect(res.body.success).toBe(true);

    const [cv] = await vouchers();
    expect(cv.purpose).toBe('petty-cash');
    expect(cv.amount).toBeCloseTo(5000, 2);
    expect(cv.sourceAccount).toBe('112000');
    expect(cv.payeeName).toMatch(/Front desk float/);
  });
});

describe('the voucher itself', () => {
  it('carries everything the printed document needs', async () => {
    await auth('post', '/api/expenses').send({
      amount: 1200, categoryCode: '630000', description: 'Water delivery',
      vendor: 'Aqua Co', paymentMethod: 'Cash',
    });
    const [cv] = await vouchers();

    // Who, how much, out of what, under whose authority, and against which
    // entry - a voucher missing any of these cannot be filed.
    expect(cv.voucherNumber).toMatch(/^CV-\d{4}-\d{6}$/);
    expect(cv.payeeName).toBe('Aqua Co');
    expect(cv.amount).toBeCloseTo(1200, 2);
    expect(cv.sourceAccountName).toBeTruthy();
    expect(cv.issuedBy).toBe('CvSuper');
    expect(cv.journalEntryRef).toBeTruthy();
    expect(cv.date).toBeTruthy();
  });

  it('can be voided, with the reason kept on it', async () => {
    await auth('post', '/api/expenses').send({
      amount: 800, categoryCode: '630000', description: 'Courier', paymentMethod: 'Cash',
    });
    const [cv] = await vouchers();

    const res = await auth('post', `/api/check-vouchers/${cv._id}/void`).send({ reason: 'Wrong payee' });
    expect(res.body.success).toBe(true);

    const fresh = await M('CheckVoucher').findById(cv._id).lean();
    expect(fresh.status).toBe('Voided');
    expect(fresh.voidReason).toBe('Wrong payee');
    expect(fresh.voidedBy).toBe('CvSuper');
  });
});

// A supplier returning our overpayment is money coming IN. It was impossible to
// record at all - the credit could only ever be applied to another bill, so a
// credit against a supplier you no longer buy from sat there forever.
describe('taking a supplier credit back in cash', () => {
  let supplier;
  beforeEach(async () => {
    await M('Supplier').deleteMany({});
    supplier = await M('Supplier').create({ name: 'Acme Supply', creditBalance: 1500 });
  });

  const movement = async (code) => {
    const entries = await M('JournalEntry').find({ 'lines.accountCode': code }).lean();
    return Math.round(entries.reduce((sum, je) => sum + je.lines
      .filter(l => l.accountCode === code)
      .reduce((t, l) => t + (l.debit || 0) - (l.credit || 0), 0), 0) * 100) / 100;
  };

  it('books it as a receipt into the account it landed in', async () => {
    const res = await auth('post', `/api/suppliers/${supplier._id}/credit/refund`)
      .send({ amount: 1500, intoAccount: '112000', referenceNumber: 'BT-771' });
    expect(res.body.success).toBe(true);

    expect(await movement('112000')).toBe(1500);    // money in
    expect(await movement('160100')).toBe(-1500);   // the credit is cleared
    expect((await M('Supplier').findById(supplier._id).lean()).creditBalance).toBeCloseTo(0, 2);
  });

  it('issues no check voucher - nothing left a cash account', async () => {
    await auth('post', `/api/suppliers/${supplier._id}/credit/refund`).send({ amount: 1500 });
    expect(await vouchers()).toHaveLength(0);
  });

  it('refuses to refund more credit than the supplier holds', async () => {
    const res = await auth('post', `/api/suppliers/${supplier._id}/credit/refund`).send({ amount: 2000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/available/i);
  });

  it("records it in the supplier's credit history", async () => {
    await auth('post', `/api/suppliers/${supplier._id}/credit/refund`).send({ amount: 500, note: 'Bank transfer back' });
    const fresh = await M('Supplier').findById(supplier._id).lean();
    const entry = fresh.creditHistory.at(-1);
    expect(entry.type).toBe('refunded');
    expect(entry.amount).toBeCloseTo(500, 2);
    expect(fresh.creditBalance).toBeCloseTo(1000, 2);
  });
});

// Petty cash is a cash account like any other: money going into the float comes
// out of the bank, and money spent from the float leaves the float. Both are
// disbursements, and the rule does not bend because the amounts are small.
describe('petty cash', () => {
  const openFund = () => auth('post', '/api/revolving-funds').send({
    name: 'Kitchen float', initialAmount: 4000, sourceAccount: '112000',
  });

  it('documents money spent out of the float', async () => {
    const fund = await openFund();
    const id = fund.body.fund._id;
    await M('CheckVoucher').deleteMany({});   // the opening voucher is its own case

    const res = await auth('post', `/api/revolving-funds/${id}/disburse`).send({
      amount: 350, description: 'Taxi for a delivery', categoryCode: '630000',
    });
    expect(res.body.success).toBe(true);

    const [cv] = await vouchers();
    expect(cv.purpose).toBe('petty-cash');
    expect(cv.sourceAccount).toBe('114000');       // it left the float
    expect(cv.amount).toBeCloseTo(350, 2);
    expect(cv.payeeName).toBe('Taxi for a delivery');
  });
});

// Buying stock with money is a disbursement; buying it on credit raises a
// payable and pays nobody until that bill is settled.
describe('buying stock', () => {
  it('documents a purchase paid for in cash', async () => {
    const res = await auth('post', '/api/inventory').send({
      itemName: `Beans ${Date.now()}`, unit: 'kg', displayUnit: 'kg', unitMultiplier: 1,
      stockQty: 10, unitCost: 250, creditAccount: '111000',
    });
    expect(res.body.success).toBe(true);

    const [cv] = await vouchers();
    expect(cv).toBeTruthy();
    expect(cv.purpose).toBe('expense');
    expect(cv.amount).toBeCloseTo(2500, 2);
    expect(cv.sourceAccount).toBe('111000');
  });

  it('issues none when the stock was bought on credit', async () => {
    const supplier = await M('Supplier').create({ name: `Credit Co ${Date.now()}` });
    const res = await auth('post', '/api/inventory').send({
      itemName: `Flour ${Date.now()}`, unit: 'kg', displayUnit: 'kg', unitMultiplier: 1,
      stockQty: 10, unitCost: 100, creditAccount: '220000',
      supplierId: String(supplier._id), supplierName: supplier.name,
    });
    expect(res.body.success).toBe(true);
    expect(await vouchers()).toHaveLength(0);
  });
});
