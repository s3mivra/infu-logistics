// A backdated sale with a delivery or packaging fee on top: added after the
// discount, booked to Service Sales, and kept with the name it was charged as.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'BfOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'BfOwner');
  // A fresh database: let the startup tasks finish building collections and
  // indexes first, or a sale's transaction collides with them ("catalog changes").
  for (let i = 0; i < 120; i++) {
    if ((await request(app).get('/health')).body.startup === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

const sale = (body) => request(app).post('/api/admin/backdate-sale').set('Authorization', `Bearer ${tok}`).send({
  date: '2026-11-10', paymentMethod: 'Cash', items: [{ name: 'Hibiscus Tea', price: 420, quantity: 2 }], ...body,
});

describe('backdated sale fee', () => {
  it('a packaging fee goes on after the discount, is booked as Service Sales and keeps its name', async () => {
    const r = await sale({ discountPercent: 10, deliveryFee: 30, feeLabel: 'Packaging fee' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // 840 less 10% = 756, plus 30
    expect(r.body.order.total).toBe(786);
    const order = await mongoose.model('Order').findById(r.body.order._id).lean();
    expect(order).toMatchObject({ deliveryFee: 30, feeLabel: 'Packaging fee' });
    const je = await mongoose.model('JournalEntry').findOne({ reference: r.body.journalReference }).lean();
    expect(je.lines.find((l) => l.accountCode === '420000')?.credit).toBe(30);
  });

  it('without a name it is a delivery fee, as before', async () => {
    const r = await sale({ deliveryFee: 50 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const order = await mongoose.model('Order').findById(r.body.order._id).lean();
    expect(order.deliveryFee).toBe(50);
    expect(order.feeLabel || '').toBe('');
  });

  it('takes a delivery fee and a packaging fee together, each kept by name', async () => {
    const r = await sale({ customerName: 'Both Fees', deliveryFee: 80, feeLabel: 'Delivery fee',
      charges: [{ label: 'Delivery fee', amount: 50 }, { label: 'Packaging fee', amount: 30 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.total).toBe(840 + 80);
    const order = await mongoose.model('Order').findById(r.body.order._id).lean();
    expect(order.deliveryFee).toBe(80);
    expect(order.feeLabel).toBe('Delivery & Packaging fee');
    expect(order.charges).toEqual([{ label: 'Delivery fee', amount: 50 }, { label: 'Packaging fee', amount: 30 }]);
    const je = await mongoose.model('JournalEntry').findOne({ reference: r.body.journalReference }).lean();
    expect(je.lines.find((l) => l.accountCode === '420000')?.credit).toBe(80);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });
});
