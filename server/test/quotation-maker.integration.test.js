// A quotation made by staff, like a manual order: priced lines for a client
// (or a prospect), accepted on the client's behalf, then ordered at the
// quoted price - and nothing posted until it is an order.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, client, prod;
const M = (n) => mongoose.model(n);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'QuoteOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'QuoteOwner');
  client = await M('ClientAccount').create({ clientCode: 'CUS-Q1', username: 'qclient', password: 'x', name: 'CAFE NOMI', isActive: true });
  prod = await M('Product').create({ name: 'MATCHA POWDER 1KG', category: 'POWDERS', basePrice: 800, businessType: 'log' });
  for (let i = 0; i < 120; i++) {
    if ((await request(app).get('/health')).body.startup === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

describe('the quotation maker', () => {
  let q;
  it('makes a priced quotation for a client, with the discount on each line, and posts nothing', async () => {
    const je = await M('JournalEntry').countDocuments();
    const r = await as('post', '/api/quotations').send({
      clientAccountId: String(client._id), discountPercent: 10, validUntil: '2026-12-31', quoteNotes: 'Delivery within 3 days',
      lines: [{ productId: String(prod._id), name: prod.name, quantity: 5, price: 800 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    q = r.body.quotation;
    expect(q).toMatchObject({ status: 'Quoted', clientName: 'CAFE NOMI', quotedTotal: 3600 });
    expect(q.lines[0]).toMatchObject({ quotedPrice: 720, quantity: 5 });
    expect(await M('JournalEntry').countDocuments()).toBe(je);
  });

  it('can be made for a prospect with no account', async () => {
    const r = await as('post', '/api/quotations').send({ clientName: 'Walk-in Prospect', clientContact: '0917', lines: [{ name: 'Custom blend', quantity: 1, price: 1500 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.quotation.clientAccountId).toBeNull();
    // ...but cannot be accepted until they have an account.
    expect((await as('post', `/api/quotations/${r.body.quotation._id}/accept`)).status).toBe(409);
  });

  it('accepted for the client, the order charges the quoted price and is tied to the quotation', async () => {
    const acc = await as('post', `/api/quotations/${q._id}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.items[0]).toMatchObject({ price: 720, quantity: 5 });
    const order = await as('post', '/api/orders').send({ items: acc.body.items, clientAccountId: acc.body.clientAccountId, table: 'Walk In' });
    expect(order.body.success, JSON.stringify(order.body)).toBe(true);
    expect(order.body.order.total).toBe(3600);
    const saved = await M('Quotation').findById(q._id).lean();
    expect(String(saved.orderId)).toBe(String(order.body.order._id));
  });
});
