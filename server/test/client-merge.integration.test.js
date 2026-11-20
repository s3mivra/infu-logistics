// Merging the same customer recorded twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, owner, cashier;
const M = (n) => mongoose.model(n);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'MergeOwner', role: 'superadmin' });
  await makeUser({ name: 'MergeStaff', role: 'admin' });
  owner = await loginStaff(app, 'MergeOwner');
  cashier = await loginStaff(app, 'MergeStaff');
}, 120000);
afterAll(async () => { await ctx.stop(); });

const as = (tok, m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

describe('merging two client accounts', () => {
  it('moves the sales and credit to the account kept, and switches the other off', async () => {
    const dup = await M('ClientAccount').create({ clientCode: 'CUS-1000-A0686', username: '_pos_a0686', password: 'x', name: 'THE COFFEE LAB RESTAURANT AND', source: 'pos', creditBalance: 500, phone: '09170000000' });
    const keep = await M('ClientAccount').create({ clientCode: 'CUS-1000-A0630', username: '_pos_a0630', password: 'x', name: 'THE COFFEE LAB RESTAURANT AND LOUNGE CORPORATION' });
    const sale = (n, extra) => ({ businessType: 'log', orderNumber: n, status: 'Completed', paymentMethod: 'On Account', total: 1000, subtotal: 1000, items: [], ...extra });
    await M('Order').create([
      sale('MG-1', { clientAccountId: String(dup._id), customerName: dup.name }),
      sale('MG-2', { customerName: 'The Coffee Lab Restaurant And' }),   // walk-in sale under the old name
      sale('MG-3', { clientAccountId: String(keep._id), customerName: keep.name }),
    ]);

    expect((await as(cashier, 'post', `/api/clients/${dup._id}/merge-into/${keep._id}`)).status).toBe(403);
    const r = await as(owner, 'post', `/api/clients/${dup._id}/merge-into/${keep._id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.moved).toMatchObject({ sales: 2, creditBalance: 500 });

    const orders = await M('Order').find({ orderNumber: /^MG-/ }).lean();
    expect(orders.every((o) => o.clientAccountId === String(keep._id))).toBe(true);
    expect(new Set(orders.map((o) => o.customerName))).toEqual(new Set([keep.name]));
    const k = await M('ClientAccount').findById(keep._id).lean();
    expect(k).toMatchObject({ creditBalance: 500, phone: '09170000000' });
    const d = await M('ClientAccount').findById(dup._id).lean();
    expect(d).toMatchObject({ isActive: false, creditBalance: 0 });
    expect(String(d.mergedInto)).toBe(String(keep._id));

    // The merged one is gone from the client list, and cannot be merged again.
    const list = await as(owner, 'get', '/api/clients/summary');
    expect(list.body.clients.some((c) => String(c._id) === String(dup._id))).toBe(false);
    expect((await as(owner, 'post', `/api/clients/${dup._id}/merge-into/${keep._id}`)).status).toBe(409);
  });
});
