// A sale belongs to the day it was completed: a reservation made days ago and
// paid today is in today's reports, not on the day it was reserved.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, tok;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  await makeUser({ name: 'sdBoss', role: 'superadmin' });
  tok = await loginStaff(ctx.app, 'sdBoss');
}, 120000);
afterAll(async () => { await ctx.stop(); });

const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

describe('sales reports date a sale by when it was completed', () => {
  it('a reservation from 3 days ago, completed today, is in today\'s sales summary', async () => {
    const Order = mongoose.model('Order');
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    const o = await Order.create({ businessType: 'log', orderNumber: 'SD-1', status: 'Completed', paymentMethod: 'Cash', total: 750, subtotal: 750,
      items: [{ name: 'Thing', price: 750, quantity: 1 }], completedAt: new Date() });
    await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: threeDaysAgo } });
    const old = await Order.create({ businessType: 'log', orderNumber: 'SD-2', status: 'Completed', paymentMethod: 'Cash', total: 10, subtotal: 10,
      items: [{ name: 'Old', price: 10, quantity: 1 }] });
    await Order.collection.updateOne({ _id: old._id }, { $set: { createdAt: threeDaysAgo }, $unset: { completedAt: 1 } });

    const today = ymd(new Date());
    const r = await request(ctx.app).get(`/api/reports/sales-summary?start=${today}&end=${today}`).set('Authorization', `Bearer ${tok}`);
    expect(r.status).toBe(200);
    const nums = r.body.rows.map(x => x.orderNumber);
    expect(nums).toContain('SD-1');
    expect(nums).not.toContain('SD-2');

    const back = ymd(threeDaysAgo);
    const r2 = await request(ctx.app).get(`/api/reports/sales-summary?start=${back}&end=${back}`).set('Authorization', `Bearer ${tok}`);
    const nums2 = r2.body.rows.map(x => x.orderNumber);
    expect(nums2).not.toContain('SD-1');
    expect(nums2).toContain('SD-2');
  });
});
