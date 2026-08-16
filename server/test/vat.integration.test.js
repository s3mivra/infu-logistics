// VAT end-to-end: the settings toggle, the per-product exemption, and the
// restamping of orders that are already on the counter when VAT is switched on.
//
// That last one is the case that actually bit us: enabling VAT left the pending
// sale showing 0%, because the rate is stamped at ring-up and nothing went back
// to fix the orders already open.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, superTok, vatProd, exemptProd;

const setSetting = (key, value) =>
  request(app).patch(`/api/settings/${key}`).set('Authorization', `Bearer ${superTok}`).send({ value });

const placeOrder = (items) =>
  request(app).post('/api/orders').set('Authorization', `Bearer ${staffTok}`)
    .send({ items, table: 'Takeout', paymentMethod: 'Cash' });

const line = (p, price, qty = 1) => ({ productId: String(p._id), name: p.name, price, quantity: qty });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'vat_super', role: 'superadmin' });
  await makeUser({ name: 'vat_staff', role: 'staff' });
  superTok = await loginStaff(app, 'vat_super');
  staffTok = await loginStaff(app, 'vat_staff');

  const Product = mongoose.model('Product');
  await mongoose.model('Category').create({ name: 'VatCat', department: 'Logistics' });
  vatProd = await Product.create({ name: 'Freight Service', category: 'VatCat', basePrice: 1120 });
  exemptProd = await Product.create({ name: 'Raw Produce', category: 'VatCat', basePrice: 500, vatExempt: true });
});

afterAll(async () => { await ctx?.stop?.(); });

describe('VAT off (non-VAT business)', () => {
  it('books no VAT and leaves the total as the gross', async () => {
    const res = await placeOrder([line(vatProd, 1120)]);
    expect(res.status).toBe(200);
    const o = res.body.order || res.body;
    expect(o.total).toBe(1120);
    expect(o.vatAmount).toBe(0);
    expect(o.vatRate).toBe(0);
  });
});

describe('VAT on', () => {
  beforeAll(async () => {
    await setSetting('vatEnabled', true);
    await setSetting('vatRate', 12);
  });

  it('splits a VATable sale without changing what the customer pays', async () => {
    const res = await placeOrder([line(vatProd, 1120)]);
    const o = res.body.order || res.body;
    expect(o.total).toBe(1120);          // inclusive pricing - unchanged
    expect(o.vatAmount).toBe(120);
    expect(o.vatableSales).toBe(1000);
    expect(o.vatRate).toBe(0.12);
  });

  it('treats a VAT-exempt product as exempt sales, with no VAT', async () => {
    const res = await placeOrder([line(exemptProd, 500)]);
    const o = res.body.order || res.body;
    expect(o.total).toBe(500);
    expect(o.vatAmount).toBe(0);
    expect(o.vatExemptSales).toBe(500);
    expect(o.vatableSales).toBe(0);
  });

  it('splits a mixed basket and reconciles to the collected total', async () => {
    const res = await placeOrder([line(vatProd, 1120), line(exemptProd, 500)]);
    const o = res.body.order || res.body;
    expect(o.total).toBe(1620);
    expect(o.vatExemptSales).toBe(500);
    expect(o.vatableSales).toBe(1000);
    expect(o.vatAmount).toBe(120);
    expect(+(o.vatableSales + o.vatAmount + o.vatExemptSales).toFixed(2)).toBe(o.total);
  });

  it('honours a manually entered rate', async () => {
    await setSetting('vatRate', 8);
    const res = await placeOrder([line(vatProd, 108)]);
    const o = res.body.order || res.body;
    expect(o.vatRate).toBe(0.08);
    expect(o.vatAmount).toBe(8);
    expect(o.vatableSales).toBe(100);
    await setSetting('vatRate', 12);
  });
});

describe('VAT-exclusive pricing', () => {
  beforeAll(async () => {
    await setSetting('vatEnabled', true);
    await setSetting('vatRate', 12);
    await setSetting('vatInclusive', false);
  });
  afterAll(async () => { await setSetting('vatInclusive', true); });

  it('adds VAT on top: a ₱100 net line rings up at ₱112', async () => {
    const res = await placeOrder([line(vatProd, 100)]);
    const o = res.body.order || res.body;
    expect(o.vatableSales).toBe(100);
    expect(o.vatAmount).toBe(12);
    expect(o.total).toBe(112);
    expect(o.isVatInclusive).toBe(false);
  });

  it('restamps an open order upward when switched to exclusive', async () => {
    await setSetting('vatInclusive', true);
    const res = await placeOrder([line(vatProd, 100)]);
    const created = res.body.order || res.body;
    expect(created.total).toBe(100);           // inclusive: VAT sits inside ₱100

    const patched = await setSetting('vatInclusive', false);
    expect(patched.body.ordersRestamped).toBeGreaterThan(0);

    const after = await mongoose.model('Order').findById(created._id).lean();
    expect(after.isVatInclusive).toBe(false);
    expect(after.total).toBe(112);             // exclusive: VAT added on top
    expect(after.vatAmount).toBe(12);
  });
});

describe('switching VAT on restamps orders already open', () => {
  it('applies VAT to a pending order placed before the toggle', async () => {
    await setSetting('vatEnabled', false);

    const res = await placeOrder([line(vatProd, 1120)]);
    const created = res.body.order || res.body;
    expect(created.vatAmount).toBe(0);   // rung up as non-VAT

    const patched = await setSetting('vatEnabled', true);
    expect(patched.status).toBe(200);
    expect(patched.body.ordersRestamped).toBeGreaterThan(0);

    const after = await mongoose.model('Order').findById(created._id).lean();
    expect(after.vatRate).toBe(0.12);
    expect(after.vatAmount).toBe(120);
    expect(after.vatableSales).toBe(1000);
    // The customer's total must NOT move - only the split does.
    expect(after.total).toBe(created.total);
  });

  it('leaves completed orders alone - booked history is not re-priced', async () => {
    await setSetting('vatEnabled', false);
    const res = await placeOrder([line(vatProd, 1120)]);
    const created = res.body.order || res.body;

    await mongoose.model('Order').findByIdAndUpdate(created._id, { status: 'Completed' });
    await setSetting('vatEnabled', true);

    const after = await mongoose.model('Order').findById(created._id).lean();
    expect(after.vatAmount).toBe(0);
    expect(after.vatRate).toBe(0);
  });
});

describe('percentage tax is mutually exclusive with VAT', () => {
  it('reports itself inapplicable while VAT is on', async () => {
    await setSetting('vatEnabled', true);
    const res = await request(app)
      .get('/api/reports/percentage-tax?start=2020-01-01&end=2030-01-01')
      .set('Authorization', `Bearer ${superTok}`);
    expect(res.status).toBe(200);
    expect(res.body.notApplicable).toBe(true);
    expect(res.body.taxDue).toBe(0);
  });

  it('computes normally once VAT is off again', async () => {
    await setSetting('vatEnabled', false);
    const res = await request(app)
      .get('/api/reports/percentage-tax?start=2020-01-01&end=2030-01-01')
      .set('Authorization', `Bearer ${superTok}`);
    expect(res.body.notApplicable).toBeUndefined();
    expect(res.body.rate).toBe(0.03);
  });
});
