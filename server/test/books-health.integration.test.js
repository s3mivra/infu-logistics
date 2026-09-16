// Do the documents and the ledger still agree?
//
// Every screen is a subledger with a control account behind it. The books can
// balance perfectly (every entry has equal debits and credits) while an
// invoice list no longer adds up to Accounts Receivable - and nothing in the
// app used to say so. This report runs those tie-outs and names the gap.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, client, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const health = async () => (await auth('get', '/api/reports/books-health')).body;
const lineFor = (body, key) => body.checks.find(c => c.key === key);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'HealthSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'HealthSuper');
  await M('Category').create({ name: 'Goods', department: 'Logistics' });
  product = await M('Product').create({ name: 'Crate', category: 'Goods', basePrice: 500 });
  const res = await auth('post', '/api/client-accounts').send({ username: 'healthco', password: 'secret123', name: 'Health Co', paymentMethod: 'On Account' });
  client = res.body.client;
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Order').deleteMany({});
  await M('JournalEntry').deleteMany({});
  await M('Inventory').deleteMany({});
});

describe('a clean set of books', () => {
  it('passes every check on an untouched system', async () => {
    const body = await health();
    expect(body.success).toBe(true);
    expect(body.failing).toBe(0);
  }, 30000);

  it('still agrees after a sale on account is rung up and part-collected', async () => {
    const sale = await auth('post', '/api/orders').send({
      table: 'Pickup', paymentMethod: 'On Account', clientAccountId: client._id,
      items: [{ productId: String(product._id), name: 'Crate', price: 500, quantity: 4 }],
    });
    await auth('put', `/api/orders/${sale.body.order._id}`).send({ status: 'Completed' });

    let body = await health();
    expect(lineFor(body, 'ar')).toMatchObject({ documents: 2000, ledger: 2000, ok: true });

    await auth('post', `/api/orders/${sale.body.order._id}/settle-ar`)
      .send({ amount: 500, paymentMethod: 'Cash on Hand', referenceNumber: 'OR-1' });

    body = await health();
    expect(lineFor(body, 'ar')).toMatchObject({ documents: 1500, ledger: 1500, ok: true });
    expect(body.failing).toBe(0);
  }, 30000);

  it('ties stock on hand to the Inventory account', async () => {
    await auth('post', '/api/inventory').send({
      itemName: 'Sacks', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      stockQty: 20, unitCost: 50, creditAccount: '111000',
    });
    const body = await health();
    expect(lineFor(body, 'inventory')).toMatchObject({ documents: 1000, ledger: 1000, ok: true });
  }, 30000);
});

describe('when they stop agreeing', () => {
  it('names the gap when an invoice is changed behind the ledger', async () => {
    const sale = await auth('post', '/api/orders').send({
      table: 'Pickup', paymentMethod: 'On Account', clientAccountId: client._id,
      items: [{ productId: String(product._id), name: 'Crate', price: 500, quantity: 2 }],
    });
    await auth('put', `/api/orders/${sale.body.order._id}`).send({ status: 'Completed' });
    // The kind of damage a stray script or a hand edit does: the document moves,
    // the ledger does not.
    await M('Order').updateOne({ _id: sale.body.order._id }, { $set: { total: 1500 } });

    const body = await health();
    const ar = lineFor(body, 'ar');
    expect(ar.ok).toBe(false);
    expect(ar.documents).toBe(1500);
    expect(ar.ledger).toBe(1000);
    expect(ar.difference).toBe(500);
    expect(body.failing).toBeGreaterThan(0);
    expect(ar.fix).toMatch(/A\/R Report/i);
  }, 30000);

  it('catches stock counted without a matching entry', async () => {
    await auth('post', '/api/inventory').send({
      itemName: 'Pallets', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      stockQty: 10, unitCost: 100, creditAccount: '111000',
    });
    await M('Inventory').updateOne({ itemName: 'PALLETS' }, { $set: { stockQty: 15 } });
    const body = await health();
    expect(lineFor(body, 'inventory')).toMatchObject({ documents: 1500, ledger: 1000, ok: false });
  }, 30000);

  it('checks the accounting equation from the ledger itself', async () => {
    const body = await health();
    expect(lineFor(body, 'equation').ok).toBe(true);
  }, 30000);
});
