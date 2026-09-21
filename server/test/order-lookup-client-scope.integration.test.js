// GET /api/orders/:id is open to anyone - a QR diner polls it for their order's
// status - so an anonymous caller gets a projection with no phone, address or
// prices. Any valid token used to unlock the whole document, and a client
// portal login is a valid token: one customer could read another's order in
// full. A client now sees their own order in full and nobody else's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, makeClient, loginClient } from './helpers/harness.js';

let ctx, app, staffTok, aliceTok, aliceId, bobOrder, aliceOrder;
const M = (n) => mongoose.model(n);
const get = (id, tok) => {
  const r = request(app).get(`/api/orders/${id}`);
  return tok ? r.set('Authorization', `Bearer ${tok}`) : r;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'LookupSuper', role: 'superadmin' });
  staffTok = await loginStaff(app, 'LookupSuper');
  await makeClient({ username: 'alice' });
  await makeClient({ username: 'bob' });
  aliceTok = await loginClient(app, 'alice');
  aliceId = String((await M('ClientAccount').findOne({ username: 'alice' }).lean())._id);
  const bobId = String((await M('ClientAccount').findOne({ username: 'bob' }).lean())._id);
  const base = { status: 'Pending', paymentMethod: 'Cash', total: 500, subtotal: 500, items: [{ name: 'Rice', quantity: 1, price: 500 }] };
  bobOrder = await M('Order').create({ ...base, orderNumber: 'ORD-BOB-1', clientId: bobId, customerName: 'Bob',
    customerPhone: '0917 000 0001', deliveryAddress: '12 Bob Street' });
  aliceOrder = await M('Order').create({ ...base, orderNumber: 'ORD-ALICE-1', clientId: aliceId, customerName: 'Alice',
    customerPhone: '0917 000 0002', deliveryAddress: '34 Alice Avenue' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('a client reading an order', () => {
  it('cannot see another customer\'s phone or address', async () => {
    const res = await get(bobOrder._id, aliceTok);
    expect(res.status).toBe(200);
    expect(res.body.orderNumber).toBe('ORD-BOB-1');     // the status projection still answers
    expect(res.body.customerPhone).toBeUndefined();
    expect(res.body.deliveryAddress).toBeUndefined();
  });

  it('sees their own order in full', async () => {
    const res = await get(aliceOrder._id, aliceTok);
    expect(res.body.customerPhone).toBe('0917 000 0002');
    expect(res.body.deliveryAddress).toBe('34 Alice Avenue');
  });
});

describe('everyone else, unchanged', () => {
  it('staff see any order in full', async () => {
    const res = await get(bobOrder._id, staffTok);
    expect(res.body.deliveryAddress).toBe('12 Bob Street');
  });

  it('an anonymous caller gets the status projection', async () => {
    const res = await get(bobOrder._id);
    expect(res.body.status).toBe('Pending');
    expect(res.body.customerPhone).toBeUndefined();
  });
});
