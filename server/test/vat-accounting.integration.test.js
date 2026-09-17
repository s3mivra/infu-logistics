// VAT, from the register to the return.
//
// The books used to credit the WHOLE receipt to Sales Revenue even while VAT
// was switched on: revenue overstated by the VAT, no liability to remit from,
// and nothing on the balance sheet a BIR return could be built from. A
// VAT-registered business now books the VAT it collects as Output VAT Payable
// (230300) and the creditable VAT it pays as Input VAT (170300).
//
// Switching VAT off must leave every posting exactly as it was before any of
// this existed - that is what the "non-VAT" block at the bottom checks.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { businessDateStr } from '../lib/businessTime.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const setVat = async (enabled, { rate = 12, inclusive = true } = {}) => {
  await M('Settings').updateOne({ key: 'vatEnabled' }, { $set: { value: enabled } }, { upsert: true });
  await M('Settings').updateOne({ key: 'vatRate' }, { $set: { value: rate } }, { upsert: true });
  await M('Settings').updateOne({ key: 'vatInclusive' }, { $set: { value: inclusive } }, { upsert: true });
};

// Net movement on an account across every entry written so far.
const movement = async (code) => {
  const entries = await M('JournalEntry').find({ 'lines.accountCode': code }).lean();
  return entries.reduce((sum, je) => sum + je.lines
    .filter(l => l.accountCode === code)
    .reduce((t, l) => t + (l.credit || 0) - (l.debit || 0), 0), 0);
};
const r2 = (n) => Math.round(n * 100) / 100;

const sell = async (price = 112, quantity = 1) => {
  const res = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash',
    items: [{ productId: String(product._id), name: 'Widget', price, quantity }],
  });
  await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });
  return (await M('Order').findById(res.body.order._id).lean());
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'VatSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'VatSuper');
  await M('Category').create({ name: 'Goods' });
  product = await M('Product').create({ name: 'Widget', category: 'Goods', basePrice: 112 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('JournalEntry').deleteMany({});
  await M('Order').deleteMany({});
});

describe('a VAT-registered business', () => {
  beforeEach(async () => { await setVat(true); });

  it('splits the VAT out of a sale instead of booking it as revenue', async () => {
    const order = await sell(112);
    expect(order.vatAmount).toBeCloseTo(12, 2);

    // ₱112 collected = ₱100 revenue + ₱12 owed to the BIR.
    expect(r2(await movement('410000'))).toBe(100);
    expect(r2(await movement('230300'))).toBe(12);
    expect(r2(await movement('111000'))).toBe(-112);   // cash is a debit
  });

  it('keeps the books balanced and the VAT out of profit', async () => {
    await sell(112, 5);
    const entries = await M('JournalEntry').find({}).lean();
    for (const je of entries) expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    expect(r2(await movement('410000'))).toBe(500);
    expect(r2(await movement('230300'))).toBe(60);
  });

  it('takes the VAT back out when a sale is refunded', async () => {
    const order = await sell(112);
    const res = await auth('post', `/api/orders/${order._id}/refund`)
      .send({ reason: 'Wrong item', inventoryAction: 'None' });
    expect(res.body.success).toBe(true);
    expect(r2(await movement('230300'))).toBe(0);
    expect(r2(await movement('410000'))).toBe(0);
  });

  it('reverses the VAT on a void as well', async () => {
    const order = await sell(112);
    const res = await auth('post', `/api/orders/${order._id}/void`).send({ reason: 'Rung up twice' });
    expect(res.body.success).toBe(true);
    expect(r2(await movement('230300'))).toBe(0);
  });

  it('bills VAT on an exchange under exclusive pricing, and reverses only what was collected', async () => {
    await setVat(true, { inclusive: false });
    // Exclusive: the ₱112 tag is net, so the customer pays ₱125.44.
    const order = await sell(112);
    expect(order.total).toBeCloseTo(125.44, 2);
    expect(r2(await movement('230300'))).toBe(13.44);

    const swap = await M('Product').create({ name: 'Other Widget', category: 'Goods', basePrice: 112 });
    const res = await auth('post', `/api/orders/${order._id}/exchange`).send({
      returnItems: [{ itemIndex: 0, qty: 1 }],
      newItems: [{ productId: String(swap._id), quantity: 1 }],
      reason: 'Swapped for the other size', inventoryAction: 'None',
    });
    expect(res.body.success).toBe(true);

    // Like-for-like swap: the VAT on the replacement replaces the VAT reversed,
    // so the business still holds exactly one sale's worth.
    expect(r2(await movement('230300'))).toBe(13.44);
    const entries = await M('JournalEntry').find({ reference: /EXCHANGE/ }).lean();
    for (const je of entries) expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    await setVat(true);
  });

  it('holds a delivery fee out of the taxed sale', async () => {
    const res = await auth('post', '/api/orders').send({
      table: 'Manual Delivery', paymentMethod: 'Cash', deliveryFee: 50,
      deliveryAddress: '1 Lane', customerPhone: '0917',
      items: [{ productId: String(product._id), name: 'Widget', price: 112, quantity: 1 }],
    });
    await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });
    expect(r2(await movement('230300'))).toBe(12);          // VAT on the goods only
    expect(r2(await movement('420000'))).toBe(50);          // the fee, passed through
    expect(r2(await movement('111000'))).toBe(-162);
  });

  it('charges VAT on the delivery fee when the business bills it that way', async () => {
    await M('Settings').updateOne({ key: 'deliveryFeeVatable' }, { $set: { value: true } }, { upsert: true });
    const res = await auth('post', '/api/orders').send({
      table: 'Manual Delivery', paymentMethod: 'Cash', deliveryFee: 112,
      deliveryAddress: '1 Lane', customerPhone: '0917',
      items: [{ productId: String(product._id), name: 'Widget', price: 112, quantity: 1 }],
    });
    await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });

    // ₱112 goods + ₱112 delivery, both VAT-inclusive: ₱24 of VAT in total.
    expect(r2(await movement('230300'))).toBe(24);
    expect(r2(await movement('420000'))).toBe(100);   // the service, net of its VAT
    expect(r2(await movement('410000'))).toBe(100);
    expect(r2(await movement('111000'))).toBe(-224);  // the customer still paid ₱224

    const fresh = await M('Order').findById(res.body.order._id).lean();
    expect(fresh.vatAmount).toBeCloseTo(24, 2);
    expect(fresh.deliveryFeeVatable).toBe(true);
    await M('Settings').updateOne({ key: 'deliveryFeeVatable' }, { $set: { value: false } }, { upsert: true });
  });

  it('claims input VAT on a purchase and carries the stock net of it', async () => {
    const created = await auth('post', '/api/inventory').send({
      itemName: 'Beans', unit: 'kg', displayUnit: 'kg', unitMultiplier: 1,
      stockQty: 10, unitCost: 112, claimInputVat: true, creditAccount: '111000',
    });
    expect(created.body.success).toBe(true);
    expect(created.body.item.unitCost).toBeCloseTo(100, 2);   // net of the ₱12 VAT
    expect(r2(await movement('170300'))).toBe(-120);          // input VAT is a debit
    expect(r2(await movement('130000'))).toBe(-1000);         // stock at net cost
    expect(r2(await movement('111000'))).toBe(1120);          // the supplier got the lot
  });

  it('reports the return: output VAT less input VAT', async () => {
    await sell(112, 10);                                     // ₱120 output VAT
    await auth('post', '/api/inventory').send({
      itemName: 'Cups', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      stockQty: 10, unitCost: 112, claimInputVat: true, creditAccount: '111000',
    });                                                      // ₱120 input VAT
    // The business's own date: a VAT range is cut in the business's zone, so
    // `toISOString()` would ask for yesterday until 8am Manila time.
    const today = businessDateStr();
    const res = await auth('get', `/api/reports/vat?start=${today}&end=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.outputVat).toBeCloseTo(120, 2);
    expect(res.body.inputVat).toBeCloseTo(120, 2);
    expect(res.body.netPayable).toBeCloseTo(0, 2);
    expect(res.body.vatableSales).toBeGreaterThan(0);
  });
});

describe('a non-VAT business', () => {
  beforeEach(async () => { await setVat(false); });

  it('books the whole sale to revenue, exactly as before', async () => {
    await sell(112);
    expect(r2(await movement('410000'))).toBe(112);
    expect(r2(await movement('230300'))).toBe(0);
  });

  it('cannot claim input VAT, and the stock keeps its full cost', async () => {
    const created = await auth('post', '/api/inventory').send({
      itemName: 'Lids', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      stockQty: 10, unitCost: 112, claimInputVat: true, creditAccount: '111000',
    });
    expect(created.body.item.unitCost).toBe(112);
    expect(r2(await movement('170300'))).toBe(0);
  });

  it('tells the VAT report it does not apply, and points at percentage tax', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await auth('get', `/api/reports/vat?start=${today}&end=${today}`);
    expect(res.body.notApplicable).toBe(true);
    expect(res.body.reason).toMatch(/percentage tax/i);
  });
});
