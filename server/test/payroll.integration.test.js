// Payroll: what the work cost, and what each person took home.
//
// Those are different numbers. Gross pay is the expense - what the business
// owed for the work. The statutory deductions come out of the employee's
// money and are held until each agency is paid. Booking only the net would
// understate wages and make three separate liabilities vanish.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const jeFor = (ref) => M('JournalEntry').findOne({ reference: ref }).lean();
const line = (je, code) => je.lines.find(l => l.accountCode === code);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'PaySuper', role: 'superadmin' });
  tok = await loginStaff(app, 'PaySuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const enable = (on = true) =>
  auth('patch', '/api/settings/payrollEnabled').send({ value: on });

// Two baristas. 20,000 gross each; deductions leave 17,750 and 18,050.
const draft = (over = {}) => auth('post', '/api/payroll-runs').send({
  periodStart: '2026-03-01', periodEnd: '2026-03-31', payDate: '2026-04-05',
  lines: [
    { employeeName: 'Ana Cruz', grossPay: 20000, sss: 900, philhealth: 500, pagibig: 100, withholdingTax: 750 },
    { employeeName: 'Ben Reyes', grossPay: 20000, sss: 900, philhealth: 500, pagibig: 100, withholdingTax: 450 },
  ],
  ...over,
});

const approved = async (over = {}) => {
  const { body } = await draft(over);
  await auth('post', `/api/payroll-runs/${body.run._id}/approve`).send({});
  return body.run;
};

beforeEach(async () => {
  for (const n of ['PayrollRun', 'JournalEntry', 'Settings', 'ClosedPeriod']) await M(n).deleteMany({});
  await enable(true);
});

describe('the switch', () => {
  it('hides payroll entirely when it is off', async () => {
    await enable(false);
    const res = await auth('get', '/api/payroll-runs');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not switched on/i);
  }, 30000);
});

describe('drafting a run', () => {
  it('works out each person’s take-home', async () => {
    const { body } = await draft();
    const ana = body.run.lines.find(l => l.employeeName === 'Ana Cruz');
    expect(ana.netPay).toBe(17750);   // 20,000 - 900 - 500 - 100 - 750
  }, 30000);

  it('totals the run', async () => {
    const { body } = await draft();
    expect(body.run.totals.gross).toBe(40000);
    expect(body.run.totals.sss).toBe(1800);
    expect(body.run.totals.net).toBe(35800);
  }, 30000);

  it('posts nothing until it is approved', async () => {
    await draft();
    // A draft is a working document, checked against timesheets first.
    expect(await M('JournalEntry').countDocuments({})).toBe(0);
  }, 30000);

  it('refuses a line where the deductions swallow the pay', async () => {
    const res = await draft({
      lines: [{ employeeName: 'Ana Cruz', grossPay: 1000, sss: 900, philhealth: 500 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceed/i);
  }, 30000);

  it('refuses a run with nobody on it', async () => {
    const res = await draft({ lines: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one employee/i);
  }, 30000);
});

describe('approving it', () => {
  it('expenses the gross, not the take-home', async () => {
    const run = await approved();
    const je = await jeFor((await M('PayrollRun').findById(run._id).lean()).journalEntryRef);
    // The failure this prevents: wages booked at 35,800 because that is what
    // the staff received, understating the cost of the work by 4,200.
    expect(line(je, '610000').debit).toBe(40000);
  }, 30000);

  it('holds each statutory deduction in its own account', async () => {
    const run = await approved();
    const je = await jeFor((await M('PayrollRun').findById(run._id).lean()).journalEntryRef);
    // Three agencies, three schedules - one pooled balance could not tell you
    // which of them is short.
    expect(line(je, '240100').credit).toBe(1800);   // SSS
    expect(line(je, '240200').credit).toBe(1000);   // PhilHealth
    expect(line(je, '240300').credit).toBe(200);    // Pag-IBIG
    expect(line(je, '230200').credit).toBe(1200);   // tax on compensation
  }, 30000);

  it('leaves the take-home owed to staff, not yet paid', async () => {
    const run = await approved();
    const je = await jeFor((await M('PayrollRun').findById(run._id).lean()).journalEntryRef);
    expect(line(je, '240400').credit).toBe(35800);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    // No cash has moved yet: approving is not paying.
    expect(line(je, '111000')).toBeUndefined();
  }, 30000);

  it('dates the wages to the period worked', async () => {
    const run = await approved();
    const je = await jeFor((await M('PayrollRun').findById(run._id).lean()).journalEntryRef);
    expect(new Date(je.date).getMonth()).toBe(2);   // March
  }, 30000);

  it('will not approve into a closed month', async () => {
    await M('ClosedPeriod').create({ year: 2026, month: 3, isOpen: false });
    const { body } = await draft();
    const res = await auth('post', `/api/payroll-runs/${body.run._id}/approve`).send({});
    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/closed/i);
  }, 30000);

  it('cannot be approved twice', async () => {
    const run = await approved();
    const res = await auth('post', `/api/payroll-runs/${run._id}/approve`).send({});
    expect(res.status).toBe(409);
  }, 30000);

  it('locks the payslips once it has posted', async () => {
    const run = await approved();
    const res = await auth('put', `/api/payroll-runs/${run._id}`)
      .send({ lines: [{ employeeName: 'Ana Cruz', grossPay: 99999 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/draft/i);
  }, 30000);
});

describe('paying it out', () => {
  it('discharges what was owed and moves the cash', async () => {
    const run = await approved();
    const res = await auth('post', `/api/payroll-runs/${run._id}/pay`)
      .send({ paidFromAccount: '112000', payDate: '2026-04-05' });
    expect(res.status).toBe(200);

    const je = await jeFor(res.body.reference);
    expect(line(je, '240400').debit).toBe(35800);
    expect(line(je, '112000').credit).toBe(35800);
    // The deductions stay held - they are owed to the agencies, not to staff.
    expect(line(je, '240100')).toBeUndefined();
  }, 30000);

  it('books the cash on the day it actually left', async () => {
    const run = await approved();
    const res = await auth('post', `/api/payroll-runs/${run._id}/pay`).send({ payDate: '2026-04-05' });
    const je = await jeFor(res.body.reference);
    // Wages in March, cash in April - collapsing the two would put one of
    // them in the wrong month.
    expect(new Date(je.date).getMonth()).toBe(3);
  }, 30000);

  it('refuses to pay a run that was never approved', async () => {
    const { body } = await draft();
    const res = await auth('post', `/api/payroll-runs/${body.run._id}/pay`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/approved/i);
  }, 30000);

  it('cannot be paid twice', async () => {
    const run = await approved();
    await auth('post', `/api/payroll-runs/${run._id}/pay`).send({});
    const res = await auth('post', `/api/payroll-runs/${run._id}/pay`).send({});
    expect(res.status).toBe(409);
  }, 30000);
});

describe('what is still owed', () => {
  it('reports each agency separately, and what is left after paying staff', async () => {
    const run = await approved();
    await auth('post', `/api/payroll-runs/${run._id}/pay`).send({});

    const { body } = await auth('get', '/api/payroll-runs/liabilities/summary');
    const by = Object.fromEntries(body.liabilities.map(l => [l.accountCode, l]));
    expect(by['240100'].outstanding).toBe(1800);   // SSS still held
    expect(by['240400'].outstanding).toBe(0);      // staff have been paid
    expect(body.totalOutstanding).toBe(4200);      // the four deductions
  }, 30000);
});

describe('a payslip', () => {
  it('shows one person’s figures and what they add up to', async () => {
    const run = await approved();
    const { body } = await auth('get', `/api/payroll-runs/${run._id}/payslip/0`);
    expect(body.payslip.employeeName).toBe('Ana Cruz');
    expect(body.payslip.grossPay).toBe(20000);
    expect(body.payslip.totalDeductions).toBe(2250);
    expect(body.payslip.netPay).toBe(17750);
    expect(body.payslip.status).toBe('Approved');
  }, 30000);
});
