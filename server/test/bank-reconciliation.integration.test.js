// Bank reconciliation: explaining the gap between the ledger and the bank.
//
// The two disagree for legitimate reasons - a cheque not yet presented, a
// deposit not yet landed - and reconciling accounts for every peso of it. The
// value is the residual: when the difference cannot be explained, an entry is
// missing, duplicated, or the money is gone.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'BankSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'BankSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const BANK = '112000';   // Cash in Bank

// One entry touching the bank account: debit = money in, credit = money out.
const post = (reference, debit, credit, date) => M('JournalEntry').create({
  date: new Date(date), reference, description: reference,
  lines: debit
    ? [{ accountCode: BANK, accountName: 'Cash in Bank', debit, credit: 0 },
       { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: debit }]
    : [{ accountCode: '610000', accountName: 'Salaries & Wages', debit: credit, credit: 0 },
       { accountCode: BANK, accountName: 'Cash in Bank', debit: 0, credit }],
  totalDebit: debit || credit, totalCredit: debit || credit,
});

const enable = (on = true) =>
  auth('patch', '/api/settings/bankReconciliationEnabled').send({ value: on });

const openRec = (statementBalance, statementDate = '2026-03-31') =>
  auth('post', '/api/bank-reconciliations')
    .send({ accountCode: BANK, statementDate, statementBalance });

beforeEach(async () => {
  for (const n of ['JournalEntry', 'BankReconciliation', 'Settings']) await M(n).deleteMany({});
  await enable(true);
});

describe('the switch', () => {
  it('hides the module entirely when it is off', async () => {
    await enable(false);
    const res = await auth('get', '/api/bank-reconciliations');
    // 404, not 403: to a business that does not use it, it does not exist.
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not switched on/i);
  }, 30000);

  it('is off until someone turns it on', async () => {
    await M('Settings').deleteMany({});
    const { body } = await auth('get', '/api/settings/modules');
    const mod = body.modules.find(m => m.name === 'bankReconciliation');
    expect(mod.enabled).toBe(false);
    expect(mod.label).toBe('Bank Reconciliation');
  }, 30000);

  it('reports every optional module, on or off', async () => {
    const { body } = await auth('get', '/api/settings/modules');
    expect(body.modules.map(m => m.name).sort())
      .toEqual(['bankReconciliation', 'payroll', 'withholdingTax']);
  }, 30000);
});

describe('reconciling a month', () => {
  beforeEach(async () => {
    // 50,000 banked, 12,000 paid out, both in March.
    await post('DEP-1', 50000, 0, '2026-03-05');
    await post('CHK-1', 0, 12000, '2026-03-20');
  });

  it('captures the ledger balance when it is opened', async () => {
    const { body } = await openRec(38000);
    expect(body.reconciliation.ledgerBalance).toBe(38000);   // 50,000 - 12,000
  }, 30000);

  it('refuses to reconcile anything but a cash or bank account', async () => {
    const res = await auth('post', '/api/bank-reconciliations')
      .send({ accountCode: '410000', statementDate: '2026-03-31', statementBalance: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cash or bank/i);
  }, 30000);

  it('lists every line that touched the account, none ticked yet', async () => {
    const { body: created } = await openRec(38000);
    const { body } = await auth('get', `/api/bank-reconciliations/${created.reconciliation._id}`);
    expect(body.lines).toHaveLength(2);
    expect(body.lines.every(l => !l.cleared)).toBe(true);
    // Nothing ticked: the whole 50,000 is "in transit" and the 12,000 is
    // outstanding, so the statement does not yet explain the ledger.
    expect(body.summary.depositsInTransit).toBe(50000);
    expect(body.summary.outstandingPayments).toBe(12000);
  }, 30000);

  it('balances once both sides are ticked off', async () => {
    const { body: created } = await openRec(38000);
    const id = created.reconciliation._id;
    const { body: opened } = await auth('get', `/api/bank-reconciliations/${id}`);

    const { body } = await auth('post', `/api/bank-reconciliations/${id}/clear`)
      .send({ lines: opened.lines });
    expect(body.summary.depositsInTransit).toBe(0);
    expect(body.summary.outstandingPayments).toBe(0);
    expect(body.summary.difference).toBe(0);
    expect(body.summary.reconciles).toBe(true);
  }, 30000);

  it('keeps the two kinds of timing difference apart', async () => {
    // The bank has seen the deposit but not the cheque: the statement reads
    // 50,000 and the ledger 38,000, explained entirely by the unpresented
    // 12,000. Netting the two into one number would hide that.
    const { body: created } = await openRec(50000);
    const id = created.reconciliation._id;
    const { body: opened } = await auth('get', `/api/bank-reconciliations/${id}`);
    const deposit = opened.lines.filter(l => l.debit > 0);

    const { body } = await auth('post', `/api/bank-reconciliations/${id}/clear`).send({ lines: deposit });
    expect(body.summary.depositsInTransit).toBe(0);
    expect(body.summary.outstandingPayments).toBe(12000);
    expect(body.summary.reconciles).toBe(true);
  }, 30000);

  it('un-ticks a line when it is left out of the next save', async () => {
    const { body: created } = await openRec(38000);
    const id = created.reconciliation._id;
    const { body: opened } = await auth('get', `/api/bank-reconciliations/${id}`);
    await auth('post', `/api/bank-reconciliations/${id}/clear`).send({ lines: opened.lines });

    const { body } = await auth('post', `/api/bank-reconciliations/${id}/clear`).send({ lines: [] });
    expect(body.summary.clearedCount).toBe(0);
  }, 30000);
});

describe('closing it', () => {
  beforeEach(async () => {
    await post('DEP-1', 50000, 0, '2026-03-05');
    await post('CHK-1', 0, 12000, '2026-03-20');
  });

  it('refuses while a peso is still unexplained', async () => {
    // The statement says 40,000; the books say 38,000 and nothing is ticked.
    const { body: created } = await openRec(40000);
    const res = await auth('post', `/api/bank-reconciliations/${created.reconciliation._id}/finish`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/out by/i);
    // The difference is the finding, so it comes back with the refusal.
    expect(res.body.summary.difference).not.toBe(0);
  }, 30000);

  it('closes when everything is accounted for', async () => {
    const { body: created } = await openRec(38000);
    const id = created.reconciliation._id;
    const { body: opened } = await auth('get', `/api/bank-reconciliations/${id}`);
    await auth('post', `/api/bank-reconciliations/${id}/clear`).send({ lines: opened.lines });

    const res = await auth('post', `/api/bank-reconciliations/${id}/finish`).send({ notes: 'Agreed to BPI statement' });
    expect(res.status).toBe(200);
    expect(res.body.reconciliation.status).toBe('Reconciled');
    expect(res.body.reconciliation.reconciledBy).toBe('BankSuper');
  }, 30000);

  it('will not open two for the same account and date', async () => {
    await openRec(38000);
    const res = await openRec(38000);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  }, 30000);

  it('never touches the ledger', async () => {
    // A reconciliation states a fact about a difference. It does not get to
    // force the books to agree with the bank - a charge the bank made has to
    // be booked as its own expense, where the P&L will show it.
    const before = await M('JournalEntry').countDocuments({});
    const { body: created } = await openRec(38000);
    const id = created.reconciliation._id;
    const { body: opened } = await auth('get', `/api/bank-reconciliations/${id}`);
    await auth('post', `/api/bank-reconciliations/${id}/clear`).send({ lines: opened.lines });
    await auth('post', `/api/bank-reconciliations/${id}/finish`).send({});
    expect(await M('JournalEntry').countDocuments({})).toBe(before);
  }, 30000);
});
