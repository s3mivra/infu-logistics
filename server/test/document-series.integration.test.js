// What every document is called.
//
// The prefixes were hard-coded one route at a time, so a business whose books
// already say "SI-2026-000123" had no way to make this system agree with its
// own paperwork - and the billing counter was keyed on "BIL-" while storing the
// number without it, so statements printed as a bare "2026-09-0001".
//
// The rule that makes renaming safe: a prefix is a LABEL, and each series keeps
// counting in a counter keyed on its own canonical code. Renaming changes what
// future documents are called and nothing else.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { normalizePrefix, DOC_SERIES } from '../lib/docSeries.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const setPrefix = (key, value) => auth('patch', `/api/settings/${key}`).send({ value });

const placeOrder = async () => {
  const res = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash',
    items: [{ productId: String(product._id), name: 'Widget', price: 100, quantity: 1 }],
  });
  return res.body.order;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'SeriesSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'SeriesSuper');
  await M('Category').create({ name: 'Goods' });
  product = await M('Product').create({ name: 'Widget', category: 'Goods', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Order').deleteMany({});
  await M('Settings').deleteMany({ key: { $in: DOC_SERIES.map(s => s.key) } });
  await M('Counter').deleteMany({});
  // The cache is cleared through the route the UI actually uses.
  await setPrefix('docPrefixORD', 'ORD');
});

describe('the document numbering registry', () => {
  it('lists every series with a worked sample of what it prints', async () => {
    const res = await auth('get', '/api/settings/document-series');
    expect(res.status).toBe(200);

    const byCode = Object.fromEntries(res.body.series.map(s => [s.code, s]));
    expect(byCode.ORD.sample).toMatch(/^ORD-/);
    expect(byCode.OR.label).toBe('Official receipt');
    expect(byCode.OR.registered).toBe(true);
    // Every series the screen renders arrives pre-filled - nothing is blank.
    for (const s of res.body.series) {
      expect(s.prefix).toBeTruthy();
      expect(s.sample).toContain(s.prefix);
    }
  });

  it('ships a default for each series before anything is configured', async () => {
    await M('Settings').deleteMany({ key: { $in: DOC_SERIES.map(s => s.key) } });
    const res = await auth('get', '/api/settings/document-series');
    const byCode = Object.fromEntries(res.body.series.map(s => [s.code, s.prefix]));
    expect(byCode).toMatchObject({ ORD: 'ORD', BIL: 'BIL', OR: 'OR', PO: 'PO', CV: 'CV' });
  });
});

describe('renaming a series', () => {
  it('changes what a new order is called', async () => {
    await setPrefix('docPrefixORD', 'SO');
    const order = await placeOrder();
    expect(order.orderNumber).toMatch(/^SO-\d{4}-A\d{4}$/);
  });

  it('carries the prefix onto the billing number, which used to drop it', async () => {
    const order = await placeOrder();
    expect(order.billingNumber).toMatch(/^BIL-\d{4}-\d{2}-\d{4}$/);

    await setPrefix('docPrefixBIL', 'SOA');
    const next = await placeOrder();
    expect(next.billingNumber).toMatch(/^SOA-\d{4}-\d{2}-\d{4}$/);
  });

  it('never restarts the sequence it renames', async () => {
    const first = await placeOrder();
    const firstSeq = first.orderNumber.slice(-4);

    await setPrefix('docPrefixORD', 'TCKT');
    const second = await placeOrder();

    expect(second.orderNumber).toMatch(/^TCKT-/);
    // The number carried on from where it was, under its new name.
    expect(Number(second.orderNumber.slice(-4))).toBe(Number(firstSeq) + 1);
  });

  it('renames a reference-numbered series too', async () => {
    await setPrefix('docPrefixPO', 'PUR');
    const supplier = await M('Supplier').create({ name: 'Acme' });
    const res = await auth('post', '/api/purchase-orders').send({
      supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered',
      lines: [{ itemName: 'Boxes', unit: 'pcs', orderedQty: 5, unitCost: 10 }],
    });
    expect(res.body.purchaseOrder.poNumber).toMatch(/^PUR-\d{4}-\d{6}$/);
  });
});

describe('a prefix people actually type', () => {
  it('tidies up whatever was entered', () => {
    expect(normalizePrefix('or-')).toBe('OR');          // trailing separator is the formatter's job
    expect(normalizePrefix('  si  ')).toBe('SI');
    expect(normalizePrefix('O.R. #')).toBe('OR');       // punctuation that would break a filename
    expect(normalizePrefix('', 'ORD')).toBe('ORD');     // never blank
    expect(normalizePrefix('ABCDEFGHIJKLMNOP').length).toBeLessThanOrEqual(12);
  });

  it('prints the same receipt number whether or not the dash was typed', async () => {
    await setPrefix('orPrefix', 'OR-');
    const stored = await M('Settings').findOne({ key: 'orPrefix' }).lean();
    expect(stored.value).toBe('OR');

    const order = await placeOrder();
    await auth('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
    const fresh = await M('Order').findById(order._id).lean();
    expect(fresh.orNumber).toMatch(/^OR-\d{8}$/);
  });

  it('falls back to the default rather than leaving a document unlabelled', async () => {
    await setPrefix('docPrefixORD', '###');
    const order = await placeOrder();
    expect(order.orderNumber).toMatch(/^ORD-/);
  });
});
