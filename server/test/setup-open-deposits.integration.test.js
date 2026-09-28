// Carrying in the money paid ahead and still unused on switch-over day:
// customer deposits and credits, supplier advances and credits, employee
// advances. The opening balance sheet posts their totals; this sheet registers
// the detail behind them, WITHOUT posting again, so each can be applied to the
// next order or bill - and Books Health finds every register equal to its
// account.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff } from './helpers/harness.js';

let ctx, app, tok, client, supplier;
const M = (n) => mongoose.model(n);
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const importRows = (what, rows, extra = {}) => as('post', `/api/setup/${what}/import`).send({ rows, ...extra });
const journalCount = () => M('JournalEntry').countDocuments();

// Assets 20,000 + 3,000 + 700 + 500 = 24,200 = liabilities 5,000 + 1,000 + capital 18,200.
const BALANCES = [
  { code: '111000', balance: 20000, asOf: '2026-08-31' },
  { code: '170200', balance: 3000 },
  { code: '160100', balance: 700 },
  { code: '170100', balance: 500 },
  { code: '260200', balance: 5000 },
  { code: '260100', balance: 1000 },
  { code: '310000', balance: 18200 },
];
const DEPOSITS = [
  { kind: 'Customer deposit', name: 'Reyes Hardware', reference: 'OR-1001', date: '2026-08-20', amountRemaining: '4,000', note: 'October bulk order' },
  { kind: 'customer deposits', name: 'Walk-in Juan', reference: 'OR-1002', date: '2026-08-21', amountRemaining: 1000 },
  { kind: 'Customer credit', name: 'Reyes Hardware', reference: 'CM-7', amountRemaining: 1000 },
  { kind: 'Supplier advance', name: 'Metro Packaging', reference: 'CV-55', date: '2026-08-10', amountRemaining: 3000 },
  { kind: 'Supplier credit', name: 'Metro Packaging', reference: 'DM-3', amountRemaining: 700 },
  { kind: 'Employee advance', name: 'Ana Cruz', reference: 'CA-12', amountRemaining: 500 },
];

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'odSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'odSuper');
  await makeClient({ username: 'Reyes Hardware' });
  client = await M('ClientAccount').findOne({ name: 'Reyes Hardware' }).lean();
  supplier = await M('Supplier').create({ name: 'Metro Packaging' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('Open Deposits & Advances', () => {
  let opening;

  it('the opening balance sheet reports each kind as a control to match', async () => {
    const res = await importRows('opening-balances', BALANCES);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    opening = res.body;
    expect(opening.controls).toMatchObject({ customerDeposit: 5000, customerCredit: 1000, supplierAdvance: 3000, supplierCredit: 700, employeeAdvance: 500 });
  });

  it('registers every row where that kind lives, and posts nothing', async () => {
    const before = await journalCount();
    const res = await importRows('open-deposits', DEPOSITS);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.skipped).toEqual([]);
    expect(res.body.created).toBe(6);
    expect(res.body.totals).toEqual({ customerDeposit: 5000, customerCredit: 1000, supplierAdvance: 3000, supplierCredit: 700, employeeAdvance: 500 });
    expect(await journalCount()).toBe(before);

    const advances = await M('Advance').find({}).lean();
    const reyes = advances.find(a => a.referenceNumber === 'OR-1001');
    expect(reyes).toMatchObject({ type: 'customer', amount: 4000, clientId: String(client._id), status: 'Open', account: '260200' });
    const walkIn = advances.find(a => a.referenceNumber === 'OR-1002');
    expect(walkIn).toMatchObject({ type: 'customer', clientId: '', payeeName: 'Walk-in Juan' });
    expect(advances.find(a => a.referenceNumber === 'CV-55')).toMatchObject({ type: 'supplier', payeeId: String(supplier._id), account: '170200' });
    expect(advances.find(a => a.referenceNumber === 'CA-12')).toMatchObject({ type: 'employee', account: '170100' });
    expect((await M('ClientAccount').findById(client._id).lean()).creditBalance).toBe(1000);
    expect((await M('Supplier').findById(supplier._id).lean()).creditBalance).toBe(700);
    expect(res.body.note).toMatch(/walk-in/);
  });

  it('Books Health finds every register equal to its account', async () => {
    const res = await as('get', '/api/reports/books-health');
    expect(res.status).toBe(200);
    for (const key of ['deposits', 'clientCredit', 'supplierAdvances', 'supplierCredit', 'employeeAdvances']) {
      const c = res.body.checks.find(x => x.key === key);
      expect(c, key).toBeTruthy();
      expect(c.ok, `${key}: documents ${c.documents} vs ledger ${c.ledger}`).toBe(true);
    }
  });

  it('carrying the same sheet in again doubles nothing', async () => {
    const res = await importRows('open-deposits', DEPOSITS);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toHaveLength(6);
    expect(res.body.skipped[0].error).toMatch(/already carried in/);
    expect((await M('ClientAccount').findById(client._id).lean()).creditBalance).toBe(1000);
    expect(await M('Advance').countDocuments()).toBe(4);
  });

  it('refuses a bad row and says why, keeping the good ones', async () => {
    const res = await importRows('open-deposits', [
      { kind: 'Gift card', name: 'X', reference: 'R1', amountRemaining: 10 },
      { kind: 'Customer credit', name: 'Nobody Inc', reference: 'R2', amountRemaining: 10 },
      { kind: 'Supplier advance', name: 'Unknown Supplier', reference: 'R3', amountRemaining: 10 },
      { kind: 'Employee advance', name: 'Ana Cruz', reference: '', amountRemaining: 10 },
      { kind: 'Employee advance', name: 'Ana Cruz', reference: 'R5', amountRemaining: 0 },
      { kind: 'Employee advance', name: 'Ana Cruz', reference: 'R6', amountRemaining: 10, date: 'not a date' },
      { kind: 'Employee advance', name: 'Ben Uy', reference: 'CA-99', amountRemaining: 250 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped.map(s => s.row)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.body.skipped[0].error).toMatch(/is not a kind/);
    expect(res.body.skipped[1].error).toMatch(/No client account/);
    expect(res.body.skipped[2].error).toMatch(/No supplier/);
  });

  it('a carried-in customer deposit can be applied to that client\'s order', async () => {
    const adv = await M('Advance').findOne({ referenceNumber: 'OR-1001' }).lean();
    const order = await M('Order').create({
      orderNumber: 'OD-APPLY-1', businessType: 'log', status: 'Completed', total: 1500, subtotal: 1500,
      clientAccountId: String(client._id), paymentMethod: 'On Account', items: [],
    });
    const res = await as('post', `/api/advances/${adv._id}/liquidate`).send({ method: 'order', orderId: String(order._id), amount: 1500 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await M('Advance').findById(adv._id).lean();
    expect(after.liquidatedAmount).toBe(1500);
    expect(after.status).toBe('Partially Liquidated');
  });

  it('the template lists the sheet with its kinds', async () => {
    const t = await as('get', '/api/export/openDeposits?template=1');
    expect(t.status).toBe(200);
    expect(t.body.importable).toBe(true);
    expect(t.body.columns).toEqual(['kind', 'name', 'reference', 'date', 'amountRemaining', 'note']);
    const vv = await as('get', '/api/export/valid-values');
    const kinds = vv.body.table.find(r => r.dataset === 'openDeposits' && r.column === 'kind');
    expect(kinds.values).toEqual(['Customer deposit', 'Customer credit', 'Supplier advance', 'Supplier credit', 'Employee advance']);
  });
});
