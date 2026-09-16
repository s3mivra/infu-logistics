// The registered receipt series.
//
// A receipt is only a receipt if it carries the serial number it was registered
// under. The number is spent when the sale COMPLETES: an order that is still
// being rung up, or one that gets cancelled, never had a receipt, and burning a
// serial on it would leave a hole in the series that has to be explained to an
// examiner. Once any number has been issued, where the series starts can no
// longer be moved.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const place = async () => {
  const res = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash',
    items: [{ productId: String(product._id), name: 'Widget', price: 100, quantity: 1 }],
  });
  return res.body.order._id;
};
const complete = async (id) => auth('put', `/api/orders/${id}`).send({ status: 'Completed' });
const fresh = async (id) => M('Order').findById(id).lean();

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'OrSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'OrSuper');
  await M('Category').create({ name: 'Goods' });
  product = await M('Product').create({ name: 'Widget', category: 'Goods', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Order').deleteMany({});
  await M('Counter').deleteMany({ _id: 'OR-SERIAL' });
  await M('Settings').deleteMany({ key: { $in: ['orPrefix', 'orStartNumber'] } });
});

describe('the receipt serial series', () => {
  it('issues a number only when the sale completes', async () => {
    const id = await place();
    expect((await fresh(id)).orNumber).toBe('');
    await complete(id);
    expect((await fresh(id)).orNumber).toBeTruthy();
  });

  it('runs consecutively, with the configured prefix and starting point', async () => {
    await M('Settings').updateOne({ key: 'orPrefix' }, { $set: { value: 'OR-' } }, { upsert: true });
    await M('Settings').updateOne({ key: 'orStartNumber' }, { $set: { value: 1000 } }, { upsert: true });

    const first = await place(); await complete(first);
    const second = await place(); await complete(second);

    expect((await fresh(first)).orNumber).toBe('OR-00001001');
    expect((await fresh(second)).orNumber).toBe('OR-00001002');
  });

  it('never re-issues a number when the same sale is saved again', async () => {
    const id = await place();
    await complete(id);
    const issued = (await fresh(id)).orNumber;
    await auth('put', `/api/orders/${id}`).send({ status: 'Completed' });
    expect((await fresh(id)).orNumber).toBe(issued);
  });

  it('spends no serial on an order that is cancelled instead of completed', async () => {
    const id = await place();
    await auth('put', `/api/orders/${id}`).send({ status: 'Cancelled' });
    expect((await fresh(id)).orNumber).toBe('');

    const done = await place(); await complete(done);
    expect((await fresh(done)).orNumber).toMatch(/0*1$/);   // still the first number
  });

  it('refuses to move the start of a series that has already issued receipts', async () => {
    const ok = await auth('patch', '/api/settings/orStartNumber').send({ value: 500 });
    expect(ok.body.success).toBe(true);

    const id = await place(); await complete(id);

    const blocked = await auth('patch', '/api/settings/orStartNumber').send({ value: 9000 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/already been issued/i);
  });
});
