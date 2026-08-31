// QR ("scan to pay") orders must carry the customer's payment reference.
//
// A QR payment settles straight into a wallet. Nothing on our side records
// that it happened, and nothing ties it to an order - except the confirmation
// number the customer reads off their payment app. An accepted QR order
// without one can never be matched to the money, so it is refused outright
// rather than left for someone to reconcile by guesswork later.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, prod;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

const place = (body) => auth('post', '/api/orders', staffTok).send({
  items: [{ productId: String(prod._id), name: 'Widget', price: 250, quantity: 1 }],
  table: 'Takeout',
  ...body,
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'qrStaff', role: 'staff' });
  staffTok = await loginStaff(app, 'qrStaff');
  await mongoose.model('Category').create({ name: 'QRCat', department: 'Kitchen' });
  prod = await mongoose.model('Product').create({ name: 'Widget', category: 'QRCat', basePrice: 250 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('QR payment reference', () => {
  it('refuses a QR order with no reference number', async () => {
    const res = await place({ paymentMethod: 'QR' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reference number is required/i);
  });

  it('refuses one whose reference is only whitespace', async () => {
    const res = await place({ paymentMethod: 'QR', paymentReference: '   ' });
    expect(res.status).toBe(400);
  });

  it('accepts a QR order with a reference and stores it', async () => {
    const res = await place({ paymentMethod: 'QR', paymentReference: '0012 3456 7890' });
    expect(res.status).toBe(200);

    const o = await mongoose.model('Order').findById(res.body.order._id).lean();
    expect(o.paymentMethod).toBe('QR');
    expect(o.paymentReference).toBe('0012 3456 7890');
  });

  it('is a receivable on completion, like every other non-cash tender', async () => {
    const res = await place({ paymentMethod: 'QR', paymentReference: 'REF-ROUTING-1' });
    await auth('put', `/api/orders/${res.body.order._id}`, staffTok).send({ status: 'Completed' });

    const o = await mongoose.model('Order').findById(res.body.order._id).lean();
    const je = await mongoose.model('JournalEntry')
      .findOne({ reference: { $regex: o.orderNumber } }).lean();
    expect(je).toBeTruthy();
    // Only cash books straight to a cash account; everything else sits in A/R
    // until it is actually collected. QR is no exception.
    expect(je.lines.find(l => l.debit > 0).accountCode).toBe('120000');
  });

  it('settles into the E-Wallet account, like the wallets it is funded from', async () => {
    await makeUser({ name: 'qrSuper', role: 'superadmin' });
    const superTok = await loginStaff(app, 'qrSuper');

    const res = await place({ paymentMethod: 'QR', paymentReference: 'REF-SETTLE-1' });
    const id = res.body.order._id;
    await auth('put', `/api/orders/${id}`, staffTok).send({ status: 'Completed' });

    const settled = await auth('post', `/api/orders/${id}/settle-ar`, superTok)
      .send({ amount: 250, paymentMethod: 'QR', referenceNumber: 'QR-SETTLE-REF-1' });
    expect(settled.status).toBe(200);

    const o = await mongoose.model('Order').findById(id).lean();
    const je = await mongoose.model('JournalEntry')
      .findOne({ reference: o.arPayments[0].journalRef }).lean();
    // 113xxx - E-Wallet or its QR sub-account, never Cash on Hand and never
    // the Unassigned Receipts fallback an unmapped tender lands in.
    expect(je.lines.find(l => l.debit > 0).accountCode).toMatch(/^113/);
  });

  it('leaves every other payment method alone - no reference demanded', async () => {
    for (const paymentMethod of ['Cash', 'GCash', 'Bank Transfer']) {
      const res = await place({ paymentMethod });
      expect(res.status, `${paymentMethod} should not require a reference`).toBe(200);
    }
  });

  it('records a reference on a non-QR order when one is given', async () => {
    const res = await place({ paymentMethod: 'Bank Transfer', paymentReference: 'BNK-9911' });
    expect(res.status).toBe(200);
    const o = await mongoose.model('Order').findById(res.body.order._id).lean();
    expect(o.paymentReference).toBe('BNK-9911');
  });
});
