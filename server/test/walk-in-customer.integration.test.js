// A dine-in sale with no name, and the repeat-customer promotion.
//
// A named walk-in with three completed orders is promoted into a client
// account of their own. That count is kept by NAME, so a nameless sale filed
// under a stand-in would have been promoted too: the third anonymous dine-in
// created a client literally called "Walk-in", and then every nameless order in
// the shop was pulled onto it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Owner', role: 'superadmin' });
  tok = await loginStaff(app, 'Owner');
  await M('Category').create({ name: 'Coffee' });
  product = await M('Product').create({ name: 'Latte', category: 'Coffee', basePrice: 130 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Order').deleteMany({});
  await M('ClientAccount').deleteMany({ source: 'pos' });
});

// Ring a dine-in sale under a name and complete it. The promotion runs after
// the response, so it is given a moment to land before anything is counted.
const completedSale = async (customerName) => {
  const placed = await auth('post', '/api/orders').send({
    table: 'Dine-In', paymentMethod: 'Cash', customerName,
    items: [{ productId: String(product._id), name: 'Latte', price: 130, quantity: 1 }],
  });
  expect(placed.body.success).toBe(true);
  await auth('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
  return placed.body.order;
};
// The promotion runs after the response and hashes a password, so it lands a
// moment later. Poll for it rather than guess at a delay: a fixed wait that is
// too short makes "nothing was promoted" pass for the wrong reason.
const waitFor = async (check, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
};
const accountNamed = (re) => M('ClientAccount').findOne({ name: re, source: 'pos' }).lean();

describe('a sale nobody put a name to', () => {
  it('is taken as it is, filed under the stand-in', async () => {
    const order = await completedSale('Walk-in');
    expect(order.customerName.toLowerCase()).toBe('walk-in');
  });

  it('is never promoted into a client, however many there are', async () => {
    // A real regular rung alongside, as the control: once their promotion has
    // landed, a Walk-in one would have had every chance to land too.
    for (let i = 0; i < 4; i++) await completedSale('Walk-in');
    for (let i = 0; i < 3; i++) await completedSale('Control Customer');
    expect(await waitFor(() => accountNamed(/^control customer$/i))).toBe(true);

    // Four is past the threshold. A stand-in is still not a person.
    expect(await M('ClientAccount').countDocuments({ name: /walk/i })).toBe(0);
    // And none of the nameless sales were pulled onto an account either.
    const linked = await M('Order').countDocuments({ customerName: /^walk/i, clientAccountId: { $nin: [null, ''] } });
    expect(linked).toBe(0);
  });

  it('holds for "Guest" as well, which was always the case', async () => {
    for (let i = 0; i < 3; i++) await completedSale('Guest');
    for (let i = 0; i < 3; i++) await completedSale('Control Customer');
    expect(await waitFor(() => accountNamed(/^control customer$/i))).toBe(true);
    expect(await M('ClientAccount').countDocuments({ name: /guest/i })).toBe(0);
  });
});

describe('a regular who does give a name', () => {
  it('is still promoted on the third completed order', async () => {
    // The guard must not cost the feature it protects.
    for (let i = 0; i < 3; i++) await completedSale('Maria Santos');
    expect(await waitFor(() => accountNamed(/^maria santos$/i))).toBe(true);

    const account = await accountNamed(/^maria santos$/i);
    expect(account.clientCode).toMatch(/^CUS-1000-/);
    // Her earlier sales roll up under the new code too.
    expect(await M('Order').countDocuments({ clientAccountId: String(account._id) })).toBe(3);
  });

  it('is not held back just for sharing letters with the stand-in', async () => {
    for (let i = 0; i < 3; i++) await completedSale('Walker');
    expect(await waitFor(() => accountNamed(/^walker$/i))).toBe(true);
  });
});
