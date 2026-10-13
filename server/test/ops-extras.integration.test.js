// The store checklist, the supplier statement and one client's record
// (features/ops-extras.js), and the cafe/logistics-only routes refusing the
// other kind of business.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, tillTok;
const as = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'opsOwner', role: 'superadmin' });
  await makeUser({ name: 'opsTill', role: 'staff', permissions: ['pos.use', 'shifts.view'] });
  tok = await loginStaff(app, 'opsOwner');
  tillTok = await loginStaff(app, 'opsTill');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('the store checklist', () => {
  it('starts with a list for opening and one for closing, nothing ticked', async () => {
    const res = await as('get', '/api/store-checklist', tillTok);
    expect(res.status).toBe(200);
    expect(res.body.opening.total).toBeGreaterThan(0);
    expect(res.body.opening.done).toBe(0);
    expect(res.body.closing.items.every(i => !i.done)).toBe(true);
  });

  it('remembers who ticked a step, and a tick can be taken back', async () => {
    const step = (await as('get', '/api/store-checklist', tillTok)).body.opening.items[0].item;
    expect((await as('post', '/api/store-checklist/tick', tillTok).send({ kind: 'opening', item: step })).status).toBe(200);
    expect((await as('post', '/api/store-checklist/tick', tillTok).send({ kind: 'opening', item: step })).status).toBe(200);   // twice is still once
    let view = (await as('get', '/api/store-checklist')).body.opening;
    expect(view.done).toBe(1);
    expect(view.items[0]).toMatchObject({ done: true, by: 'opsTill' });

    await as('post', '/api/store-checklist/tick', tillTok).send({ kind: 'opening', item: step, done: false });
    view = (await as('get', '/api/store-checklist')).body.opening;
    expect(view.done).toBe(0);
    expect(await M('ChecklistDay').countDocuments({ kind: 'opening' })).toBe(1);
  });

  it('only the steps on the list can be ticked, and only settings can change the list', async () => {
    expect((await as('post', '/api/store-checklist/tick', tillTok).send({ kind: 'opening', item: 'Something not listed' })).status).toBe(400);
    expect((await as('put', '/api/store-checklist/lists', tillTok).send({ opening: ['x'] })).status).toBe(403);
    const saved = await as('put', '/api/store-checklist/lists').send({ opening: ['Unlock', 'Unlock', '  ', 'Count cash'], closing: ['Lock up'] });
    expect(saved.body).toMatchObject({ opening: ['Unlock', 'Count cash'], closing: ['Lock up'] });
    expect((await as('get', '/api/store-checklist')).body.opening.items.map(i => i.item)).toEqual(['Unlock', 'Count cash']);
  });
});

describe('the supplier statement', () => {
  it('runs our account with one supplier in date order, and says how far it is from theirs', async () => {
    const supplier = await M('Supplier').create({ name: 'Statement Supply Co' });
    const bill = (over) => M('Bill').create({
      businessType: 'log', billNumber: `BILL-SS-${Math.random().toString(36).slice(2, 7)}`, supplierId: supplier._id, supplierName: supplier.name,
      source: 'Manual', description: 'goods', amount: 100, status: 'Approved', ...over,
    });
    await bill({ amount: 1000, createdAt: daysAgo(60), supplierInvoiceNo: 'INV-OLD', status: 'Paid', paidAmount: 1000, payments: [{ amount: 400, referenceNumber: 'CV-1', at: daysAgo(50) }, { amount: 600, referenceNumber: 'CV-2', at: daysAgo(40) }] });
    await bill({ amount: 700, createdAt: daysAgo(45), supplierInvoiceNo: 'INV-CARRY' });                                   // unpaid before the window
    await bill({ amount: 500, createdAt: daysAgo(10), supplierInvoiceNo: 'INV-A', status: 'Partially Paid', paidAmount: 200, payments: [{ amount: 200, referenceNumber: 'CV-3', at: daysAgo(5) }] });
    await bill({ amount: 300, createdAt: daysAgo(3), supplierInvoiceNo: 'INV-B' });
    await bill({ amount: 9999, createdAt: daysAgo(2), supplierInvoiceNo: 'INV-PENDING', status: 'Pending' });               // not owed yet
    await bill({ amount: 8888, createdAt: daysAgo(2), supplierInvoiceNo: 'INV-REJECTED', status: 'Rejected' });

    const day = (n) => { const d = daysAgo(n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const res = await as('get', `/api/reports/supplier-statement?supplierId=${supplier._id}&start=${day(20)}&end=${day(0)}&theirBalance=1500`);
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.openingBalance).toBe(700);                           // 1000 - 400 - 600 + 700
    expect(s.rows.map(r => [r.kind, r.reference, r.balance])).toEqual([
      ['bill', 'INV-A', 1200], ['payment', 'CV-3', 1000], ['bill', 'INV-B', 1300],
    ]);
    expect(s.closingBalance).toBe(1300);
    expect(s.totals).toEqual({ charges: 800, payments: 200 });
    expect(s.notCounted).toMatchObject({ pending: 1, pendingAmount: 9999, rejected: 1 });
    expect(s.difference).toBe(200);                               // they say 1500, we say 1300
  });

  it('needs a supplier', async () => {
    expect((await as('get', '/api/reports/supplier-statement')).status).toBe(400);
    expect((await as('get', `/api/reports/supplier-statement?supplierId=${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });
});

describe('one client’s record', () => {
  it('holds their details and orders, never their password or sign-in link, and the taking is logged', async () => {
    const made = (await as('post', '/api/client-accounts').send({ username: 'recordco', password: 'secret123', name: 'Record Co', phone: '0917 000 1111' })).body.client;
    await M('ClientAccount').updateOne({ _id: made._id }, { $set: { onboardingToken: 'tok-should-not-leak', onboardingTokenExpiresAt: new Date(Date.now() + 86400000) } });
    await M('Order').create({ businessType: 'log', orderNumber: 'REC-1', table: 'Pickup', clientAccountId: String(made._id), subtotal: 250, total: 250, status: 'Completed', paymentMethod: 'Cash', items: [{ name: 'Widget', quantity: 2, price: 125 }] });

    const res = await as('get', `/api/client-accounts/${made._id}/record`);
    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({ username: 'recordco', isActive: true });
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).toMatchObject({ orderNumber: 'REC-1', total: 250, items: '2 x Widget' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/tok-should-not-leak|\$2[aby]\$/);     // no token, no password hash
    expect(await M('AuditLog').exists({ action: /export/i })).toBeTruthy();
  });

  it('is not for the till', async () => {
    const any = await M('ClientAccount').findOne({}).lean();
    expect((await as('get', `/api/client-accounts/${any._id}/record`, tillTok)).status).toBe(403);
  });
});

describe('what belongs to the other kind of business', () => {
  it('a logistics server has no tips, stamp cards, feedback or prep list', async () => {
    expect((await as('get', '/api/tips')).status).toBe(404);
    expect((await as('get', '/api/loyalty/card?phone=09171234567')).status).toBe(404);
    expect((await request(app).post('/api/feedback').send({ orderId: 'x', rating: 5 })).status).toBe(404);
    expect((await as('get', '/api/reports/prep-list')).status).toBe(404);
    expect((await as('get', '/api/reports/feedback')).status).toBe(404);
    // ...and does have the delivery sheet.
    expect((await as('get', '/api/reports/delivery-sheet')).status).toBe(200);
  });
});

describe('two people ticking the first step at the same moment', () => {
  it('still leaves one record for the day', async () => {
    await M('ChecklistDay').init();                         // the unique index is in place
    await M('ChecklistDay').deleteMany({});
    const tick = (item) => as('post', '/api/store-checklist/tick', tillTok).send({ kind: 'closing', item });
    await Promise.all([tick('Lock up'), tick('Lock up'), tick('Lock up')]);
    expect(await M('ChecklistDay').countDocuments({ kind: 'closing' })).toBe(1);
    const indexes = await M('ChecklistDay').collection.indexes();
    expect(indexes.some(i => i.unique && i.key.date === 1 && i.key.kind === 1)).toBe(true);
    expect((await as('get', '/api/store-checklist')).body.closing.done).toBe(1);
  });
});
