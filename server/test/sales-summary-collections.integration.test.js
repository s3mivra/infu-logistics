// Sales Summary lists the A/R collected in its range under the sales,
// whatever day the sale itself was made; a bounced check is left out.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const at = (day, hh = '10') => new Date(`${day}T${hh}:00:00+08:00`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'SsOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'SsOwner');
  const base = { businessType: 'log', status: 'Completed', paymentMethod: 'On Account', subtotal: 1000, total: 1000, items: [{ name: 'X', quantity: 1, price: 1000 }] };
  await mongoose.model('Order').create([
    // Sold on the 13th on account, paid on the 15th.
    { ...base, orderNumber: 'SS-AR-1', customerName: 'Albi Coffee', createdAt: at('2026-11-13'),
      arPayments: [{ amount: 1000, paymentMethod: 'Bank Transfer', referenceNumber: 'BT-77', collectionDate: at('2026-11-15', '14') }] },
    // Sold on the 14th, part paid by a check on the 15th that bounced.
    { ...base, orderNumber: 'SS-AR-2', customerName: 'Bad Check Co', createdAt: at('2026-11-14'),
      arPayments: [{ amount: 400, paymentMethod: 'Check', checkNumber: '1234', checkStatus: 'Bounced', collectionDate: at('2026-11-15', '15') }] },
    // An ordinary cash sale on the 15th.
    { ...base, orderNumber: 'SS-CASH-1', paymentMethod: 'Cash', customerName: 'Walk-in', createdAt: at('2026-11-15', '09') },
  ]);
}, 120000);

afterAll(async () => { await ctx.stop(); });

const report = (start, end) => request(app).get(`/api/reports/sales-summary?start=${start}&end=${end}`).set('Authorization', `Bearer ${tok}`);

describe('Sales Summary with A/R collected', () => {
  it('the day the money came in lists it under the sales, not the bounced check', async () => {
    const r = await report('2026-11-15', '2026-11-15');
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x) => x.orderNumber)).toEqual(['SS-CASH-1']);   // sales: only that day's
    expect(r.body.collections).toHaveLength(1);
    expect(r.body.collections[0]).toMatchObject({ orderNumber: 'SS-AR-1', customerName: 'ALBI COFFEE', method: 'Bank Transfer', reference: 'BT-77', amount: 1000 });
    expect(new Date(r.body.collections[0].saleDate).toISOString().slice(0, 10)).toBe('2026-11-13');
    expect(r.body.collections[0].daysToPay).toBe(2);   // sold the 13th, paid the 15th
    expect(r.body.collectionTotals).toEqual({ total: 1000, count: 1, undeposited: 0, methods: { 'Bank Transfer': 1000 }, customers: { 'ALBI COFFEE': { count: 1, amount: 1000 } } });
  });

  it('the day of the credit sale shows the sale and no collection', async () => {
    const r = await report('2026-11-13', '2026-11-13');
    expect(r.body.rows.map((x) => x.orderNumber)).toEqual(['SS-AR-1']);
    expect(r.body.collections).toEqual([]);
  });
});
