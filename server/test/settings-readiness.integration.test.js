// What still has to be set before a business starts trading.
//
// Most settings can be put right whenever somebody notices. One cannot: the
// receipt serial start number locks the moment the first receipt is issued,
// because moving it afterwards would renumber receipts already in customers'
// hands. Nothing stopped a shop ringing up its first sale before setting it,
// and by the time anyone noticed, it was permanent.
//
// So the check has to say what is outstanding AND how long it can still be put
// right - the second half being the part that actually matters.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const readiness = async () => (await auth('get', '/api/settings/readiness')).body;

const KEYS = ['businessTimeZone', 'orStartNumber', 'orPrefix', 'birPermitNo', 'birMachineId', 'businessTin'];
const set = (key, value) => M('Settings').updateOne({ key }, { $set: { value } }, { upsert: true });

const completedSale = async () => {
  const res = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash',
    items: [{ productId: String(product._id), name: 'Widget', price: 100, quantity: 1 }],
  });
  await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });
  return res.body.order._id;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ReadySuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ReadySuper');
  await M('Category').create({ name: 'Goods' });
  product = await M('Product').create({ name: 'Widget', category: 'Goods', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([M('Order').deleteMany({}), M('Settings').deleteMany({ key: { $in: KEYS } })]);
});

describe('a business that has not traded yet', () => {
  it('names the setting that will lock, and says it still can be changed', async () => {
    const r = await readiness();
    expect(r.ready).toBe(false);
    expect(r.serialLocked).toBe(false);
    expect(r.urgent).toBeTruthy();
    expect(r.urgent.key).toBe('orStartNumber');
    expect(r.urgent.note).toMatch(/before your first sale/i);
  });

  it('lists the rest without crying wolf about them', async () => {
    const r = await readiness();
    const bySeverity = r.items.reduce((acc, i) => ({ ...acc, [i.key]: i.severity }), {});
    expect(bySeverity.orStartNumber).toBe('locks');
    expect(bySeverity.businessTimeZone).toBe('important');
    expect(bySeverity.birPermitNo).toBe('receipts');
    // Only one thing is worth interrupting someone for.
    expect(r.items.filter(i => i.severity === 'locks')).toHaveLength(1);
  });

  it('stops warning about a setting once it is filled in', async () => {
    await set('orStartNumber', 1250);
    const r = await readiness();
    expect(r.urgent).toBeNull();
    const serial = r.items.find(i => i.key === 'orStartNumber');
    expect(serial.set).toBe(true);
    expect(serial.note).toMatch(/1250/);
    expect(serial.note).toMatch(/still changeable/i);
  });

  it('is ready once everything is set', async () => {
    for (const [k, v] of [
      ['orStartNumber', 1250], ['businessTimeZone', 'Asia/Manila'],
      ['businessTin', '123-456-789-000'], ['birPermitNo', 'ATP-1'], ['birMachineId', 'MID-1'],
    ]) await set(k, v);

    const r = await readiness();
    expect(r.ready).toBe(true);
    expect(r.outstanding).toBe(0);
  });
});

describe('once the first receipt has been issued', () => {
  it('stops offering the serial start number - it is no longer actionable', async () => {
    await completedSale();

    const r = await readiness();
    expect(r.serialLocked).toBe(true);
    expect(r.receiptsIssued).toBeGreaterThan(0);
    expect(r.urgent).toBeNull();
    // Still listing it would be advice nobody can act on.
    expect(r.items.find(i => i.key === 'orStartNumber')).toBeUndefined();
  });

  it('still asks for the things that can be fixed later', async () => {
    await completedSale();
    const r = await readiness();
    expect(r.items.some(i => i.key === 'birPermitNo' && !i.set)).toBe(true);
    expect(r.ready).toBe(false);
  });

  it('agrees with the server that refuses to move the series', async () => {
    await completedSale();
    const r = await readiness();
    expect(r.serialLocked).toBe(true);

    // The banner and the route it warns about must tell the same story.
    const blocked = await auth('patch', '/api/settings/orStartNumber').send({ value: 9000 });
    expect(blocked.status).toBe(409);
  });
});
