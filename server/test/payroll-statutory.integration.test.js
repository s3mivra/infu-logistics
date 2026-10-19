// Payroll's statutory side: whose number each deduction is remitted under.
//
// The books could already split SSS, PhilHealth, Pag-IBIG and withholding tax
// into their own liabilities, but nothing recorded WHOSE account each share
// belonged to - so the monthly filing had to be retyped by hand from the
// payslips, which is exactly where numbers get transposed. The numbers are
// copied onto the run when it is created, not read back at print time: a number
// corrected next year must not rewrite payslips already issued.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();

const draft = async (lines, payDate = today) => auth('post', '/api/payroll-runs').send({
  periodStart: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
  periodEnd: iso(payDate), payDate: iso(payDate), lines,
});

const LINE = { employeeName: 'Rosa Vega', grossPay: 20000, sss: 900, philhealth: 500, pagibig: 200, withholdingTax: 1500 };

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'PaySuper', role: 'superadmin' });
  tok = await loginStaff(app, 'PaySuper');
  await M('Settings').updateOne({ key: 'payrollEnabled' }, { $set: { value: true } }, { upsert: true });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([M('PayrollRun').deleteMany({}), M('User').deleteMany({ name: 'Rosa Vega' })]);
  await M('User').create({
    name: 'Rosa Vega', password: 'x', role: 'Staff',
    sssNumber: '34-1234567-8', philhealthNumber: '12-345678901-2',
    pagibigNumber: '1234-5678-9012', tin: '123-456-789-000', employeeNumber: 'EMP-004',
  });
});

describe('an employee\'s statutory numbers', () => {
  it('are copied onto the payroll run from the staff record', async () => {
    const res = await draft([LINE]);
    expect(res.status).toBe(200);
    const line = res.body.run.lines[0];
    expect(line.sssNumber).toBe('34-1234567-8');
    expect(line.philhealthNumber).toBe('12-345678901-2');
    expect(line.pagibigNumber).toBe('1234-5678-9012');
    expect(line.tin).toBe('123-456-789-000');
    expect(line.employeeId).toBe('EMP-004');
  });

  it('stay as issued when the staff record is corrected afterwards', async () => {
    const res = await draft([LINE]);
    await M('User').updateOne({ name: 'Rosa Vega' }, { $set: { sssNumber: '99-9999999-9' } });
    const fresh = await M('PayrollRun').findById(res.body.run._id).lean();
    expect(fresh.lines[0].sssNumber).toBe('34-1234567-8');
  });

  it('appear on the payslip', async () => {
    const res = await draft([LINE]);
    const slip = await auth('get', `/api/payroll-runs/${res.body.run._id}/payslip/0`);
    expect(slip.body.payslip.sssNumber).toBe('34-1234567-8');
    expect(slip.body.payslip.tin).toBe('123-456-789-000');
    expect(slip.body.payslip.totalDeductions).toBeCloseTo(3100, 2);
  });

  it('can be typed in directly for someone who is not a system user', async () => {
    const res = await draft([{ ...LINE, employeeName: 'Contract Driver', sssNumber: '11-1111111-1' }]);
    expect(res.body.run.lines[0].sssNumber).toBe('11-1111111-1');
  });
});

describe('the remittance report', () => {
  const approve = async (id) => auth('post', `/api/payroll-runs/${id}/approve`).send({});

  it('breaks each agency down by employee, under their own number', async () => {
    const res = await draft([LINE]);
    await approve(res.body.run._id);

    const remit = await auth('get', `/api/payroll-runs/remittance?agency=sss&start=${iso(new Date(today.getFullYear(), today.getMonth(), 1))}&end=${iso(today)}`);
    expect(remit.status).toBe(200);
    expect(remit.body.agency.label).toBe('SSS');
    expect(remit.body.rows).toHaveLength(1);
    expect(remit.body.rows[0]).toMatchObject({ employeeName: 'Rosa Vega', idNumber: '34-1234567-8', amount: 900 });
    expect(remit.body.total).toBeCloseTo(900, 2);
  });

  it('answers for each agency separately', async () => {
    const res = await draft([LINE]);
    await approve(res.body.run._id);
    const range = `start=${iso(new Date(today.getFullYear(), today.getMonth(), 1))}&end=${iso(today)}`;

    for (const [agency, amount, id] of [
      ['philhealth', 500, '12-345678901-2'],
      ['pagibig', 200, '1234-5678-9012'],
      ['tax', 1500, '123-456-789-000'],
    ]) {
      const r = await auth('get', `/api/payroll-runs/remittance?agency=${agency}&${range}`);
      expect(r.body.total).toBeCloseTo(amount, 2);
      expect(r.body.rows[0].idNumber).toBe(id);
    }
  });

  it('adds up an employee across every run in the period', async () => {
    const first = await draft([LINE]);
    await approve(first.body.run._id);
    const second = await draft([LINE]);
    await approve(second.body.run._id);

    const remit = await auth('get', `/api/payroll-runs/remittance?agency=sss&start=${iso(new Date(today.getFullYear(), today.getMonth(), 1))}&end=${iso(today)}`);
    expect(remit.body.rows).toHaveLength(1);
    expect(remit.body.rows[0].amount).toBeCloseTo(1800, 2);
    expect(remit.body.rows[0].runs).toHaveLength(2);
  });

  it('leaves a draft out - nothing was withheld until it posted', async () => {
    await draft([LINE]);
    const remit = await auth('get', `/api/payroll-runs/remittance?agency=sss&start=${iso(new Date(today.getFullYear(), today.getMonth(), 1))}&end=${iso(today)}`);
    expect(remit.body.rows).toHaveLength(0);
    expect(remit.body.total).toBe(0);
  });

  it('names anyone whose number is missing, before the filing is sent', async () => {
    const res = await draft([{ ...LINE, employeeName: 'Contract Driver' }]);
    await approve(res.body.run._id);
    const remit = await auth('get', `/api/payroll-runs/remittance?agency=sss&start=${iso(new Date(today.getFullYear(), today.getMonth(), 1))}&end=${iso(today)}`);
    expect(remit.body.missingNumbers).toContain('Contract Driver');
  });

  it('rejects an agency it does not file for', async () => {
    const remit = await auth('get', '/api/payroll-runs/remittance?agency=bogus');
    expect(remit.status).toBe(400);
  });
});
