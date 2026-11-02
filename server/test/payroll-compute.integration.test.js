// Payroll worked out by the app: rules, compute, a run from computed lines,
// the employer's shares in the books, and the payroll report.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const start = iso(new Date(today.getFullYear(), today.getMonth(), 1));

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'PcBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'PcBoss');
  await M('Settings').updateOne({ key: 'payrollEnabled' }, { $set: { value: true } }, { upsert: true });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('computed payroll', () => {
  let computed, runId;

  it('computes contributions and tax, with non-taxable pay kept out of tax', async () => {
    const r = await auth('post', '/api/payroll/compute').send({ frequency: 'semiMonthly', lines: [
      { employeeName: 'Rosa Vega', earnings: { basic: 15000, deMinimis: 1000 } },
    ] });
    expect(r.status).toBe(200);
    computed = r.body.lines[0];
    expect(computed).toMatchObject({ sss: 750, philhealth: 375, pagibig: 100, taxableIncome: 13775, withholdingTax: 503.7, nonTaxablePay: 1000, netPay: 14271.3 });
  });

  it('a run saved from computed lines keeps the breakdown, and approving books the employer shares', async () => {
    const r = await auth('post', '/api/payroll-runs').send({ periodStart: start, periodEnd: iso(today), frequency: 'semiMonthly', lines: [computed] });
    expect(r.status).toBe(200);
    runId = r.body.run._id;
    const line = r.body.run.lines[0];
    expect(line.grossPay).toBe(16000);
    expect(line.earnings.map(e => e.key).sort()).toEqual(['basic', 'deMinimis']);
    expect(line.sssER).toBe(1515);
    expect(r.body.run.totals.sssER).toBe(1515);
    const ap = await auth('post', `/api/payroll-runs/${runId}/approve`).send({});
    expect(ap.status).toBe(200);
    const je = await M('JournalEntry').findOne({ reference: ap.body.reference }).lean();
    const dr = (c) => je.lines.filter(l => l.accountCode === c).reduce((s, l) => s + l.debit, 0);
    const cr = (c) => je.lines.filter(l => l.accountCode === c).reduce((s, l) => s + l.credit, 0);
    expect(dr('620000')).toBe(1515 + 375 + 100);
    expect(cr('240100')).toBe(750 + 1515);
    expect(je.totalDebit).toBe(je.totalCredit);
  });

  it('the payroll report adds up approved runs per employee', async () => {
    const r = await auth('get', `/api/payroll/report?start=${start}&end=${iso(today)}`);
    expect(r.status).toBe(200);
    expect(r.body.rows[0]).toMatchObject({ employeeName: 'Rosa Vega', grossPay: 16000, withholdingTax: 503.7, sssER: 1515, runs: 1 });
    expect(r.body.totals.netPay).toBe(14271.3);
  });

  it('rules can be changed and put back', async () => {
    const bad = await auth('put', '/api/payroll/rules').send({ taxTables: { semiMonthly: [{ over: 0, base: 0, rate: 2 }] } });
    expect(bad.status).toBe(400);
    const got = (await auth('get', '/api/payroll/rules')).body.rules;
    got.payTypes = got.payTypes.map(t => (t.key === 'deMinimis' ? { ...t, taxable: true } : t));
    expect((await auth('put', '/api/payroll/rules').send(got)).status).toBe(200);
    const r = await auth('post', '/api/payroll/compute').send({ frequency: 'semiMonthly', lines: [{ employeeName: 'X', earnings: { basic: 15000, deMinimis: 1000 } }] });
    expect(r.body.lines[0].taxableIncome).toBe(14775);
    expect((await auth('put', '/api/payroll/rules').send({ reset: true })).status).toBe(200);
  });
});
