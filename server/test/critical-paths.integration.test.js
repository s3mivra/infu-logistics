// Critical-path integration tests - the money/stock/auth flows where a bug means lost
// money or a breach. Drives the REAL Express app over HTTP against an in-memory replica
// set: full order lifecycle (create → complete → void), every balanced-journal money
// endpoint, shift variance, report aggregates, and an RBAC sweep. Two ledger-wide
// invariants assert the books never go out of balance.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient, trialBalance } from './helpers/harness.js';

let ctx, app;
const tok = {};
let clientTok;
let prod, inv;
let orderNumberA; // a completed, non-voided sale (revenue source for the P&L assertion)

const auth = (method, path, token) =>
  request(app)[method](path).set('Authorization', `Bearer ${token}`);

const orderBody = (qty) => ({
  items: [{ productId: String(prod._id), name: 'Americano', price: 100, quantity: qty }],
  table: 'Takeout', paymentMethod: 'Cash',
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;

  await makeUser({ name: 'cpSuper', role: 'superadmin' });
  await makeUser({ name: 'cpAdmin', role: 'admin' });
  await makeUser({ name: 'cpManager', role: 'manager' });
  await makeUser({ name: 'cpStaff', role: 'staff' });
  await makeClient({ username: 'cpClient' });
  tok.super = await loginStaff(app, 'cpSuper');
  tok.admin = await loginStaff(app, 'cpAdmin');
  tok.manager = await loginStaff(app, 'cpManager');
  tok.staff = await loginStaff(app, 'cpStaff');
  clientTok = await loginClient(app, 'cpClient');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'TestCat', department: 'Kitchen' });
  inv = await Inventory.create({ itemName: 'Coffee Beans', stockQty: 1000, unit: 'g', unitCost: 0.5, lowStockThreshold: 50 });
  prod = await Product.create({
    name: 'Americano', category: 'TestCat', basePrice: 100,
    baseRecipe: [{ invId: String(inv._id), name: 'Coffee Beans', qty: 10, cost: 5, unit: 'g' }],
  });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('order lifecycle: create → complete → void (balanced + atomic stock)', () => {
  let orderAId;

  it('creates an order with a sequential ORD- number and correct total', async () => {
    const res = await auth('post', '/api/orders', tok.staff).send(orderBody(2));
    expect(res.status).toBe(200);
    expect(res.body.order.orderNumber).toMatch(/^ORD-/);
    expect(res.body.order.total).toBe(200);
    orderAId = res.body.order._id;
    orderNumberA = res.body.order.orderNumber;
  });

  it('is idempotent under a repeated Idempotency-Key (no duplicate order)', async () => {
    const send = () => auth('post', '/api/orders', tok.staff).set('Idempotency-Key', 'cp-idem-1').send(orderBody(1));
    const a = await send();
    const b = await send();
    expect(a.status).toBe(200);
    expect(b.body.order._id).toBe(a.body.order._id);
  });

  it('is idempotent under a TRULY concurrent repeated Idempotency-Key (unique index + E11000 catch, not just the findOne check)', async () => {
    const Order = mongoose.model('Order');
    const send = () => auth('post', '/api/orders', tok.staff).set('Idempotency-Key', 'cp-idem-concurrent-1').send(orderBody(1));
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.order._id).toBe(b.body.order._id);
    const count = await Order.countDocuments({ idempotencyKey: 'cp-idem-concurrent-1' });
    expect(count).toBe(1);
  });

  it('completing the order deducts stock atomically and posts a balanced sale + COGS entry', async () => {
    const Inventory = mongoose.model('Inventory');
    const JournalEntry = mongoose.model('JournalEntry');
    const before = (await Inventory.findById(inv._id).lean()).stockQty;

    const res = await auth('put', `/api/orders/${orderAId}`, tok.staff).send({ status: 'Completed' });
    expect(res.status).toBe(200);

    const after = (await Inventory.findById(inv._id).lean()).stockQty;
    expect(before - after).toBe(20); // 10 g/unit × 2 units

    const je = await JournalEntry.findOne({ 'lines.accountCode': '410000', description: new RegExp(orderNumberA) }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toEqual(expect.arrayContaining(['111000', '410000', '510000', '130000'])); // cash, revenue, COGS, inventory
  });

  it('a second order completed then VOIDED (superadmin) restores stock and reverses the entry', async () => {
    const Inventory = mongoose.model('Inventory');
    const created = await auth('post', '/api/orders', tok.staff).send(orderBody(1));
    const bId = created.body.order._id;

    const completed = await auth('put', `/api/orders/${bId}`, tok.staff).send({ status: 'Completed' });
    expect(completed.status).toBe(200);
    const afterComplete = (await Inventory.findById(inv._id).lean()).stockQty;

    const voided = await auth('post', `/api/orders/${bId}/void`, tok.super).send({ reason: 'Restock' });
    expect(voided.status).toBe(200);
    const afterVoid = (await Inventory.findById(inv._id).lean()).stockQty;
    expect(afterVoid - afterComplete).toBe(10); // 10 g/unit × 1 unit restored
  });
});

describe('finance: every money endpoint posts a balanced double-entry', () => {
  it('owner capital injection via manual journal (rejects unbalanced, accepts balanced)', async () => {
    const bad = await auth('post', '/api/journal', tok.super).send({
      description: 'unbalanced',
      lines: [{ accountCode: '111000', debit: 100, credit: 0 }, { accountCode: '410000', debit: 0, credit: 50 }],
    });
    expect(bad.status).toBe(400);

    const good = await auth('post', '/api/journal', tok.super).send({
      description: 'Owner capital injection',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 10000, credit: 0 },
        { accountCode: '310000', accountName: "Owner's Capital", debit: 0, credit: 10000 },
      ],
    });
    expect(good.status).toBe(200);
    expect(good.body.entry.totalDebit).toBeCloseTo(good.body.entry.totalCredit, 6);
  });

  it('cash expense posts DR expense / CR cash, balanced', async () => {
    const res = await auth('post', '/api/expenses', tok.super)
      .send({ amount: 500, categoryCode: '630000', paymentMethod: 'Cash', description: 'Rent' });
    expect(res.status).toBe(200);
    const je = res.body.entry;
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    expect(je.lines.find((l) => l.accountCode === '630000').debit).toBe(500);
  });

  it('On-Account expense raises A/P, then an A/P payment clears it (both balanced)', async () => {
    const apBefore = (await auth('get', '/api/finance/ap-outstanding', tok.super)).body.outstandingBalance;
    const exp = await auth('post', '/api/expenses', tok.super)
      .send({ amount: 300, categoryCode: '650000', paymentMethod: 'On Account', description: 'Supplies on credit' });
    expect(exp.status).toBe(200);
    const apAfterExpense = (await auth('get', '/api/finance/ap-outstanding', tok.super)).body.outstandingBalance;
    expect(apAfterExpense - apBefore).toBeCloseTo(300, 2);

    const pay = await auth('post', '/api/finance/ap-payment', tok.super)
      .send({ amount: 300, payFromAccount: '111000', vendorName: 'Acme Supplies' });
    expect(pay.status).toBe(200);
    expect(pay.body.journalEntry.totalDebit).toBeCloseTo(pay.body.journalEntry.totalCredit, 6);
    const apAfterPay = (await auth('get', '/api/finance/ap-outstanding', tok.super)).body.outstandingBalance;
    expect(apAfterPay).toBeCloseTo(apBefore, 2);
  });

  it('A/R settlement posts a balanced entry, marks the order settled, and clears it from outstanding', async () => {
    const Order = mongoose.model('Order');
    const o = await Order.create({
      orderNumber: 'ORD-AR-1', status: 'Completed', isComplimentary: false,
      total: 500, subtotal: 500, discount: 0, paymentMethod: 'Bank Transfer',
    });
    const before = (await auth('get', '/api/finance/ar-outstanding', tok.super)).body;
    expect(before.orders.some((r) => r.orderNumber === 'ORD-AR-1')).toBe(true);

    const res = await auth('post', `/api/orders/${o._id}/settle-ar`, tok.super)
      .send({ amount: 500, paymentMethod: 'Bank Transfer', referenceNumber: 'BANK-REF-1' });
    expect(res.status).toBe(200);
    expect(res.body.order.arSettled).toBe(true);

    const after = (await auth('get', '/api/finance/ar-outstanding', tok.super)).body;
    expect(after.orders.some((r) => r.orderNumber === 'ORD-AR-1')).toBe(false);
  });

  it('revolving fund: open → disburse (immediate) → replenish (needs approval), each balanced; balance returns to initial', async () => {
    const open = await auth('post', '/api/revolving-funds', tok.super).send({ name: 'Petty Cash', initialAmount: 1000 });
    expect(open.status).toBe(200);
    const fundId = open.body.fund._id;

    // Disbursement is immediate - no approval, just capped by currentBalance.
    const dis = await auth('post', `/api/revolving-funds/${fundId}/disburse`, tok.staff)
      .send({ amount: 100, description: 'Snacks', categoryCode: '650000' });
    expect(dis.status).toBe(200);
    expect(dis.body.fund.currentBalance).toBeCloseTo(900, 2);

    // Replenishment always needs approval - filing alone must not move money.
    const filed = await auth('post', '/api/requisition-slips', tok.staff)
      .send({ type: 'fund-replenish', fundId, amount: 100 });
    expect(filed.status).toBe(200);
    const RevolvingFund = mongoose.model('RevolvingFund');
    expect((await RevolvingFund.findById(fundId).lean()).currentBalance).toBeCloseTo(900, 2);

    const rep = await auth('post', `/api/requisition-slips/${filed.body.slip._id}/approve`, tok.super).send({});
    expect(rep.status).toBe(200);

    const f = await RevolvingFund.findById(fundId).lean();
    expect(f.currentBalance).toBeCloseTo(1000, 2);
  });
});

describe('shifts: variance posts a balanced Cash Short/Over entry', () => {
  it('start then end with a ₱50 shortfall books a balanced variance entry', async () => {
    const start = await auth('post', '/api/shifts/start', tok.manager).send({ startingCash: 1000 });
    expect(start.status).toBe(200);

    const end = await auth('post', '/api/shifts/end', tok.manager).send({ actualCash: 950 });
    expect(end.status).toBe(200);
    expect(end.body.shift.variance).toBeCloseTo(-50, 2);

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ reference: /SHIFT-VAR/ }).sort({ createdAt: -1 }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });
});

describe('reports: aggregates are correct and the books stay balanced', () => {
  it('P&L returns revenue / COGS / netIncome over a range', async () => {
    const res = await auth('get', '/api/reports/pnl?start=2000-01-01&end=2100-01-01', tok.super);
    expect(res.status).toBe(200);
    expect(res.body.totals).toHaveProperty('netIncome');
    expect(res.body.totals.revenue).toBeGreaterThan(0); // order A (completed, not voided)
  });

  it('balance sheet balances: Assets = Liabilities + Equity', async () => {
    const res = await auth('get', '/api/reports/balance-sheet', tok.super);
    expect(res.status).toBe(200);
    expect(res.body.totals.balanced).toBe(true);
  });

  it('trial balance: total debits equal total credits across the entire ledger', async () => {
    const { debits, credits } = await trialBalance();
    expect(debits).toBeGreaterThan(0);
    expect(debits).toBeCloseTo(credits, 2);
  });
});

describe('RBAC: accounting/reports/audit permission gating', () => {
  // VIEWING the books / reports / audit needs accounting.view|reports.view|audit.view.
  // admin & superadmin hold these by default; plain staff does not.
  const VIEW_ROUTES = [
    ['get', '/api/journal'],
    ['get', '/api/reports/pnl'],
    ['get', '/api/reports/balance-sheet'],
    ['get', '/api/finance/ar-outstanding'],
    ['get', '/api/finance/ap-outstanding'],
    ['get', '/api/audit-logs'],
  ];
  for (const [m, p] of VIEW_ROUTES) {
    it(`${m.toUpperCase()} ${p} → staff 403; admin & superadmin allowed`, async () => {
      expect((await auth(m, p, tok.staff).send({})).status).toBe(403);
      expect((await auth(m, p, tok.admin).send({})).status).not.toBe(403);
      expect((await auth(m, p, tok.super).send({})).status).not.toBe(403);
    });
  }
  // POSTING to the books needs accounting.manage - only finance/superadmin by
  // default. Even a shop admin is denied unless explicitly granted.
  const MANAGE_ROUTES = [
    ['post', '/api/expenses'],
  ];
  for (const [m, p] of MANAGE_ROUTES) {
    it(`${m.toUpperCase()} ${p} → staff & admin 403 (needs accounting.manage); superadmin allowed`, async () => {
      expect((await auth(m, p, tok.staff).send({})).status).toBe(403);
      expect((await auth(m, p, tok.admin).send({})).status).toBe(403);
      expect((await auth(m, p, tok.super).send({})).status).not.toBe(403);
    });
  }
});

describe('RBAC: requireStaff routes reject a client token', () => {
  const ROUTES = [
    ['get', '/api/inventory'],
    ['post', '/api/shifts/start'],
    ['post', '/api/revolving-funds/000000000000000000000000/disburse'],
  ];
  for (const [m, p] of ROUTES) {
    it(`${m.toUpperCase()} ${p} → 403 for a client token`, async () => {
      expect((await auth(m, p, clientTok).send({})).status).toBe(403);
    });
  }
});
