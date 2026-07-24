// Edge cases & error branches — pushes coverage into the variant flows and guard paths
// the happy-path suites don't reach: split-payment & complimentary completion, insufficient
// stock/tender, void variants (spoilage/comp/AR-settled block), settle-AR error branches,
// custom account + client-account CRUD, the cookie refresh/logout flow, and a 401/404/400 sweep.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app;
const T = {};
const ids = {};

const req = (m, p, tok) => { const r = request(app)[m](p); return tok ? r.set('Authorization', `Bearer ${tok}`) : r; };
const mkOrder = (body) => req('post', '/api/orders', T.staff).send(body);
const complete = (id) => req('put', `/api/orders/${id}`, T.staff).send({ status: 'Completed' });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  for (const [k, role] of [['super', 'superadmin'], ['staff', 'staff']]) {
    await makeUser({ name: `ec_${k}`, role });
    T[k] = await loginStaff(app, `ec_${k}`);
  }
  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'EC', department: 'Kitchen' });
  const inv = await Inventory.create({ itemName: 'EC Bean', stockQty: 100000, unit: 'g', unitCost: 0.5 });
  ids.invId = String(inv._id);
  const prod = await Product.create({ name: 'EC Brew', category: 'EC', basePrice: 100, baseRecipe: [{ invId: ids.invId, name: 'EC Bean', qty: 10, cost: 5, unit: 'g' }] });
  ids.productId = String(prod._id);
  // A product that needs more stock than exists → completion must fail.
  const scarce = await Inventory.create({ itemName: 'EC Scarce', stockQty: 5, unit: 'g', unitCost: 1 });
  const scarceProd = await Product.create({ name: 'EC Scarce Brew', category: 'EC', basePrice: 50, baseRecipe: [{ invId: String(scarce._id), name: 'EC Scarce', qty: 100, cost: 100, unit: 'g' }] });
  ids.scarceProductId = String(scarceProd._id);
}, 120000);

afterAll(async () => { await ctx.stop(); });

const line = (p, q = 1) => ({ items: [{ productId: ids[p], name: p === 'productId' ? 'EC Brew' : 'EC Scarce Brew', price: 100, quantity: q }], table: 'Takeout' });

describe('order completion variants', () => {
  it('split payment (Cash + GCash) books cash AND A/R', async () => {
    const o = await mkOrder({ ...line('productId'), payments: [{ method: 'Cash', amount: 60 }, { method: 'GCash', amount: 40 }] });
    expect(o.status).toBe(200);
    const done = await complete(o.body.order._id);
    expect(done.status).toBe(200);
    const je = await mongoose.model('JournalEntry').findOne({ 'lines.accountCode': '410000', description: new RegExp(o.body.order.orderNumber) }).lean();
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('111000'); // cash leg
    expect(codes).toContain('120000'); // GCash → A/R leg
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('complimentary completion books Complimentary Expense (540000)', async () => {
    const o = await mkOrder(line('productId'));
    await req('put', `/api/orders/${o.body.order._id}/complimentary`, T.staff).send({ reasonType: 'EMPLOYEE_MEAL', approvedBy: 'ec_super' });
    const done = await complete(o.body.order._id);
    expect(done.status).toBe(200);
    // The comp entry's description carries the COMP- ref (not the ORD- number), so match the account.
    const je = await mongoose.model('JournalEntry').findOne({ 'lines.accountCode': '540000' }).sort({ createdAt: -1 }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('insufficient stock blocks completion (400)', async () => {
    const o = await mkOrder({ items: [{ productId: ids.scarceProductId, name: 'EC Scarce Brew', price: 50, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' });
    const done = await complete(o.body.order._id);
    expect(done.status).toBe(400);
  });

  it('Preparing transition records cash tender + change', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Cash' });
    const r = await req('put', `/api/orders/${o.body.order._id}`, T.staff).send({ status: 'Preparing', amountTendered: 200, paymentMethod: 'Cash' });
    expect(r.status).toBe(200);
    expect(r.body.order.changeDue).toBeCloseTo(100, 2);
  });

  it('insufficient tender is rejected (400)', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Cash' });
    const r = await req('put', `/api/orders/${o.body.order._id}`, T.staff).send({ status: 'Preparing', amountTendered: 10, paymentMethod: 'Cash' });
    expect(r.status).toBe(400);
  });
});

describe('void variants', () => {
  it('void with reason Spoilage', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Cash' });
    await complete(o.body.order._id);
    const v = await req('post', `/api/orders/${o.body.order._id}/void`, T.super).send({ reason: 'Spoilage' });
    expect(v.status).toBe(200);
  });

  it('void a completed complimentary order', async () => {
    const o = await mkOrder(line('productId'));
    await req('put', `/api/orders/${o.body.order._id}/complimentary`, T.staff).send({ reasonType: 'EMPLOYEE_MEAL', approvedBy: 'ec_super' });
    await complete(o.body.order._id);
    const v = await req('post', `/api/orders/${o.body.order._id}/void`, T.super).send({ reason: 'Restock' });
    expect(v.status).toBe(200);
  });

  it('cannot void an A/R-settled order (403); settle-AR error branches', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Bank Transfer' });
    const id = o.body.order._id;
    await complete(id);
    // settle the A/R first
    const s = await req('post', `/api/orders/${id}/settle-ar`, T.super).send({ amount: 100, paymentMethod: 'Bank Transfer' });
    expect(s.status).toBe(200);
    // re-settling is rejected
    const again = await req('post', `/api/orders/${id}/settle-ar`, T.super).send({ amount: 100, paymentMethod: 'Bank Transfer' });
    expect(again.status).toBe(400);
    // voiding a settled order is blocked
    const v = await req('post', `/api/orders/${id}/void`, T.super).send({ reason: 'Restock' });
    expect(v.status).toBe(403);
  });

  it('settle-AR rejects a cash sale (400)', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Cash' });
    await complete(o.body.order._id);
    const s = await req('post', `/api/orders/${o.body.order._id}/settle-ar`, T.super).send({ amount: 100, paymentMethod: 'Cash' });
    expect(s.status).toBe(400);
  });

  it('an unmapped settlement tender parks funds in Unassigned Receipts (118000)', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Bank Transfer' });
    const id = o.body.order._id;
    await complete(id);
    // "CryptoWallet" is not a seeded default, has no override, and no matching
    // custom sub-account → the settlement must debit the Unassigned clearing account.
    const s = await req('post', `/api/orders/${id}/settle-ar`, T.super).send({ amount: 100, paymentMethod: 'CryptoWallet' });
    expect(s.status).toBe(200);
    const je = await mongoose.model('JournalEntry').findOne({ reference: new RegExp(`ARS.*${o.body.order.orderNumber}`) }).lean();
    const debit = je.lines.find(l => l.debit > 0);
    expect(debit.accountCode).toBe('118000');
  });

  it('a known settlement tender routes to its mapped account, not Unassigned', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'GCash' });
    const id = o.body.order._id;
    await complete(id);
    const s = await req('post', `/api/orders/${id}/settle-ar`, T.super).send({ amount: 100, paymentMethod: 'GCash' });
    expect(s.status).toBe(200);
    const je = await mongoose.model('JournalEntry').findOne({ reference: new RegExp(`ARS.*${o.body.order.orderNumber}`) }).lean();
    const debit = je.lines.find(l => l.debit > 0);
    expect(debit.accountCode).not.toBe('118000');   // routed to a real E-Wallet account
    expect(debit.accountCode.startsWith('113')).toBe(true);
  });
});

describe('backdated sale posts a real, balanced, findable journal entry', () => {
  it('creates a Completed order dated in the past AND a matching journal entry (DR cash / CR Sales Revenue)', async () => {
    const res = await req('post', '/api/admin/backdate-sale', T.super)
      .send({ date: '2020-06-01', amount: 250, paymentMethod: 'Cash', customerName: 'Walk-in', notes: 'paper receipt #1' });
    expect(res.status).toBe(200);
    expect(res.body.journalReference).toMatch(/^BACKDATE-/);

    const order = await mongoose.model('Order').findById(res.body.order._id).lean();
    expect(order.isBackdated).toBe(true);
    expect(new Date(order.createdAt).toISOString().slice(0, 10)).toBe('2020-06-01');

    const je = await mongoose.model('JournalEntry').findOne({ reference: res.body.journalReference }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(250, 2);
    expect(je.totalCredit).toBeCloseTo(250, 2);
    const codes = je.lines.map(l => l.accountCode);
    expect(codes).toContain('111000'); // Cash on Hand debited
    expect(codes).toContain('410000'); // Sales Revenue credited
  });

  it('GET /api/journal?search finds a backdated entry regardless of how far back its date sorts it', async () => {
    const posted = await req('post', '/api/admin/backdate-sale', T.super)
      .send({ date: '2019-01-01', amount: 99, paymentMethod: 'Cash' });
    const ref = posted.body.journalReference;

    const found = await req('get', `/api/journal?search=${ref}`, T.super);
    expect(found.status).toBe(200);
    expect(found.body.entries.some(e => e.reference === ref)).toBe(true);

    const notFound = await req('get', '/api/journal?search=NoSuchReferenceXYZ', T.super);
    expect(notFound.body.entries.length).toBe(0);
  });
});

describe('sales-summary resolves the customer\'s standard CUS-A0000 code; sales-line-items carries item detail', () => {
  it('sales-summary has customerId/customerName but no item fields; sales-line-items has itemCode/itemName per line', async () => {
    const Product = mongoose.model('Product');
    const ClientAccount = mongoose.model('ClientAccount');
    const coded = await Product.create({ name: 'EC Coded Brew', category: 'EC', productCode: 'SKU-EC-1', basePrice: 100, baseRecipe: [{ invId: ids.invId, name: 'EC Bean', qty: 10, cost: 5, unit: 'g' }] });
    const client = await ClientAccount.create({ clientCode: 'CUS-A9001', username: `ec_cus_${Date.now()}`, password: 'x', name: 'Juan Dela Cruz' });

    const o = await mkOrder({
      items: [{ productId: String(coded._id), name: 'EC Coded Brew', price: 100, quantity: 2 }],
      table: 'Takeout', paymentMethod: 'Cash', customerName: 'Juan Dela Cruz', clientAccountId: String(client._id),
    });
    expect(o.status).toBe(200);
    const done = await complete(o.body.order._id);
    expect(done.status).toBe(200);

    const today = new Date().toISOString().slice(0, 10);
    const summary = await req('get', `/api/reports/sales-summary?start=${today}&end=${today}`, T.super);
    expect(summary.status).toBe(200);
    const sRow = summary.body.rows.find(r => r.orderNumber === o.body.order.orderNumber);
    expect(sRow).toBeTruthy();
    // Report text is normalized to caps, regardless of stored casing.
    expect(sRow.customerId).toBe('CUS-A9001');
    expect(sRow.customerName).toBe('JUAN DELA CRUZ');
    expect(sRow.itemCodes).toBeUndefined();
    expect(sRow.itemNames).toBeUndefined();

    const lineItems = await req('get', `/api/reports/sales-line-items?start=${today}&end=${today}`, T.super);
    expect(lineItems.status).toBe(200);
    const lRow = lineItems.body.rows.find(r => r.orderNumber === o.body.order.orderNumber);
    expect(lRow).toBeTruthy();
    expect(lRow.customerId).toBe('CUS-A9001');
    expect(lRow.itemCode).toBe('SKU-EC-1');
    expect(lRow.itemName).toBe('EC CODED BREW');
    expect(lRow.quantity).toBe(2);
    expect(lRow.lineTotal).toBeCloseTo(200, 2);
  });

  it('a genuine walk-in (no linked ClientAccount) gets the reserved CUS-1000-A0001 code', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Cash' });
    await complete(o.body.order._id);
    const today = new Date().toISOString().slice(0, 10);
    const summary = await req('get', `/api/reports/sales-summary?start=${today}&end=${today}`, T.super);
    const sRow = summary.body.rows.find(r => r.orderNumber === o.body.order.orderNumber);
    expect(sRow).toBeTruthy();
    expect(sRow.customerId).toBe('CUS-1000-A0001');
  });
});

describe('client account signup generates the standard customer ID format', () => {
  it('POST /api/client-accounts assigns clientCode matching CUS-1000-A####', async () => {
    const res = await req('post', '/api/client-accounts', T.super)
      .send({ username: `ec_newclient_${Date.now()}`, password: 'x', name: 'New Client' });
    expect(res.status).toBe(200);
    expect(res.body.client.clientCode).toMatch(/^CUS-1000-A\d{4,}$/);
  });
});

describe('backfill-ledger repairs backdated orders left without a journal entry', () => {
  it('posts the missing entry for an orphaned order and leaves already-linked ones alone', async () => {
    // Simulates what the pre-transaction bug could leave behind: the Order
    // write succeeded but no JournalEntry was ever created for it.
    const Order = mongoose.model('Order');
    const orphan = await Order.create({
      orderNumber: 'ORD-BF-TEST-1', table: 'Backdated', status: 'Completed',
      createdAt: new Date('2021-03-01'), cashier: 'Backdated Entry', customerName: 'Walk-in (backdated)',
      paymentMethod: 'Cash', items: [{ name: 'Historical Sale', price: 500, quantity: 1, productDiscountPercent: 0 }],
      subtotal: 500, discount: 0, vatAmount: 0, vatRate: 0, total: 500, isVatExempt: true,
      transactionType: 'NORMAL', isBackdated: true,
    });

    const linked = await req('post', '/api/admin/backdate-sale', T.super)
      .send({ date: '2021-04-01', amount: 300, paymentMethod: 'Cash' });
    expect(linked.status).toBe(200);
    const linkedOrderNumber = linked.body.order.orderNumber;

    const res = await req('post', '/api/admin/backdate-sale/backfill-ledger', T.super).send({});
    expect(res.status).toBe(200);
    expect(res.body.created.some(c => c.orderNumber === 'ORD-BF-TEST-1')).toBe(true);
    expect(res.body.created.find(c => c.orderNumber === 'ORD-BF-TEST-1').amount).toBe(500);
    // The properly-linked order created just above must NOT be re-posted.
    expect(res.body.created.some(c => c.orderNumber === linkedOrderNumber)).toBe(false);

    const je = await mongoose.model('JournalEntry').findOne({ description: /^Backdated sale: ORD-BF-TEST-1/ }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(500, 2);
    expect(je.totalCredit).toBeCloseTo(500, 2);

    // Re-running is a no-op for the order just backfilled.
    const rerun = await req('post', '/api/admin/backdate-sale/backfill-ledger', T.super).send({});
    expect(rerun.body.created.some(c => c.orderNumber === 'ORD-BF-TEST-1')).toBe(false);
  });
});

describe('purchase-order report reflects usage from completed orders', () => {
  it('returns suggested-order lines after a recipe sale', async () => {
    const o = await mkOrder({ ...line('productId'), paymentMethod: 'Cash' });
    await complete(o.body.order._id);
    const r = await req('get', '/api/reports/purchase-order?days=14', T.super);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.lines)).toBe(true);
  });
});

describe('custom account + client-account CRUD', () => {
  it('account: create (parentCode) → rename → delete', async () => {
    const c = await req('post', '/api/accounts', T.super).send({ parentCode: '640000', name: 'Electricity Sub' });
    expect(c.status).toBe(200);
    const id = c.body.account._id;
    expect((await req('put', `/api/accounts/${id}`, T.super).send({ name: 'Power' })).status).toBe(200);
    expect((await req('delete', `/api/accounts/${id}`, T.super)).status).toBe(200);
  });

  it('client-account: list → create → patch → delete', async () => {
    expect((await req('get', '/api/client-accounts', T.super)).status).toBe(200);
    const c = await req('post', '/api/client-accounts', T.super).send({ username: 'ec_cli', password: 'pw123456', name: 'EC Client', paymentMethod: 'Cash' });
    expect(c.status).toBe(200);
    const id = c.body.client._id;
    expect((await req('patch', `/api/client-accounts/${id}`, T.super).send({ name: 'EC Client 2', isActive: false })).status).toBe(200);
    expect((await req('delete', `/api/client-accounts/${id}`, T.super)).status).toBe(200);
  });
});

describe('cookie auth: login → refresh → logout', () => {
  it('refreshes the access token from the refresh cookie, then logs out', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/users/login').send({ name: 'ec_staff', password: 'pw' });
    expect(login.status).toBe(200);
    const refresh = await agent.post('/api/auth/refresh').send({});
    expect(refresh.status).toBe(200);
    expect(refresh.body.token).toBeTruthy();
    const logout = await agent.post('/api/auth/logout').send({});
    expect(logout.status).toBe(200);
  });

  it('refresh with no cookie is 401', async () => {
    expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(401);
  });
});

describe('negative paths: 401 / 404 / 400', () => {
  it('401 without a token', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
  });
  it('401 with a garbage token', async () => {
    expect((await request(app).get('/api/orders').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
  });
  it('404 for a missing order id', async () => {
    expect((await req('get', '/api/orders/000000000000000000000000')).status).toBe(404);
  });
  it('404 voiding a missing order', async () => {
    expect((await req('post', '/api/orders/000000000000000000000000/void', T.super).send({ reason: 'Restock' })).status).toBe(404);
  });
  it('400 expense with no amount', async () => {
    expect((await req('post', '/api/expenses', T.super).send({ categoryCode: '630000', paymentMethod: 'Cash', description: 'x' })).status).toBe(400);
  });
  it('400 unbalanced manual journal', async () => {
    expect((await req('post', '/api/journal', T.super).send({ description: 'x', lines: [{ accountCode: '111000', debit: 100, credit: 0 }] })).status).toBe(400);
  });
});
