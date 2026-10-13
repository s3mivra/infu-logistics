// The read-only reports in features/insights.js, and the affiliate split on
// receivables: each says what the records already hold, and changes nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, staffTok;
const as = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

async function sale(price, extra = {}) {
  const o = await as('post', '/api/orders').send({ table: 'Pickup', items: [{ name: 'Open Item', price, quantity: 1 }], ...extra });
  expect(o.body.success, JSON.stringify(o.body)).toBe(true);
  await as('put', `/api/orders/${o.body.order._id}`).send({ status: 'Preparing', ...(extra.paymentMethod ? { paymentMethod: extra.paymentMethod } : {}) });
  await as('put', `/api/orders/${o.body.order._id}`).send({ status: 'Completed' });
  return o.body.order._id;
}

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'insightOwner', role: 'superadmin' });
  await makeUser({ name: 'insightStaff', role: 'staff', permissions: ['pos.use', 'orders.view'] });
  tok = await loginStaff(app, 'insightOwner');
  staffTok = await loginStaff(app, 'insightStaff');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('the waste log', () => {
  it('lists what was spoiled, what it cost, and the reason given', async () => {
    const a = (await as('post', '/api/inventory').send({ itemName: 'Waste Milk', unit: 'L', stockQty: 20, unitCost: 50 })).body.item._id;
    const b = (await as('post', '/api/inventory').send({ itemName: 'Waste Beans', unit: 'kg', stockQty: 10, unitCost: 400 })).body.item._id;
    expect((await as('post', `/api/inventory/spoilage/${a}`).send({ qty: 2, reason: 'Expired', note: 'back of the chiller' })).status).toBe(200);
    expect((await as('post', `/api/inventory/spoilage/${a}`).send({ qty: 1, reason: 'Spilled' })).status).toBe(200);
    expect((await as('post', `/api/inventory/spoilage/${b}`).send({ qty: 0.5, reason: 'Expired' })).status).toBe(200);

    const res = await as('get', '/api/reports/waste');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.total).toBe(350);                       // 2x50 + 1x50 + 0.5x400
    expect(res.body.byItem.map(r => [r.key.toUpperCase(), r.value])).toEqual([['WASTE BEANS', 200], ['WASTE MILK', 150]]);
    const expired = res.body.byReason.find(r => r.key === 'Expired');
    expect(expired).toMatchObject({ count: 2, value: 300 });
    const noted = res.body.rows.find(r => r.note);
    expect(noted).toMatchObject({ reason: 'Expired', note: 'back of the chiller', qty: 2, unit: 'L' });
  });

  it('covers only the dates asked for', async () => {
    const res = await as('get', '/api/reports/waste?start=2020-01-01&end=2020-01-31');
    expect(res.body).toMatchObject({ success: true, count: 0, total: 0 });
  });

  it('needs the reports permission', async () => {
    expect((await as('get', '/api/reports/waste', staffTok)).status).toBe(403);
  });
});

describe('sales by hour', () => {
  it('adds up to the sales it covers, by hour, weekday and how the order went out', async () => {
    await sale(300);
    await sale(700);
    const res = await as('get', '/api/reports/sales-by-hour');
    expect(res.status).toBe(200);
    expect(res.body.orders).toBe(2);
    expect(res.body.total).toBe(1000);
    for (const list of [res.body.byHour, res.body.byWeekday, res.body.byPlace]) {
      expect(list.reduce((s, r) => s + r.total, 0)).toBe(1000);
      expect(list.reduce((s, r) => s + r.orders, 0)).toBe(2);
    }
    expect(res.body.byWeekday).toHaveLength(7);
    expect(res.body.byPlace[0]).toMatchObject({ label: 'Pickup', orders: 2, average: 500, share: 100 });
    expect(res.body.busiestHour).toBeTruthy();
    expect(res.body.placeLabel).toBe('How it went out');
  });

  it('leaves out complimentary and unfinished orders', async () => {
    const o = await as('post', '/api/orders').send({ table: 'Pickup', items: [{ name: 'Open Item', price: 999, quantity: 1 }] });
    expect(o.body.success).toBe(true);                       // left Pending
    const res = await as('get', '/api/reports/sales-by-hour');
    expect(res.body.total).toBe(1000);
  });
});

describe('the backup indicator', () => {
  it('says it is not known until the backup job has reported', async () => {
    const res = await as('get', '/api/system/backup-status');
    expect(res.body).toMatchObject({ success: true, state: 'unknown', lastBackupAt: null });
  });

  it('is fine after a recent backup, and late after a day and a half', async () => {
    const stamp = (hoursAgo) => M('Settings').findOneAndUpdate({ key: 'lastBackupAt' }, { key: 'lastBackupAt', value: new Date(Date.now() - hoursAgo * 3600000).toISOString() }, { upsert: true });
    await stamp(3);
    expect((await as('get', '/api/system/backup-status')).body).toMatchObject({ state: 'ok', hoursAgo: 3 });
    await stamp(40);
    expect((await as('get', '/api/system/backup-status')).body).toMatchObject({ state: 'late', hoursAgo: 40 });
  });
});

describe('what affiliates owe', () => {
  it('is totalled apart from customers on receivables', async () => {
    const mk = async (username, name) => (await as('post', '/api/client-accounts').send({ username, password: 'secret123', name, paymentMethod: 'On Account' })).body.client;
    const sister = await mk('sisterco', 'Sister Branch');
    const outside = await mk('outsideco', 'Outside Customer');
    expect((await as('patch', `/api/client-accounts/${sister._id}`).send({ isAffiliate: true })).status).toBe(200);

    await sale(400, { clientAccountId: sister._id, paymentMethod: 'On Account' });
    await sale(250, { clientAccountId: outside._id, paymentMethod: 'On Account' });

    const ar = (await as('get', '/api/finance/ar-outstanding')).body;
    expect(ar.affiliateOutstanding).toBe(400);
    expect(ar.tradeOutstanding).toBe(250);
    expect(ar.totalOutstanding).toBe(650);
    expect(ar.orders.filter(o => o.affiliate)).toHaveLength(1);

    // Unticking it puts the balance back with customers; nothing was posted either way.
    const entries = await M('JournalEntry').countDocuments({});
    await as('patch', `/api/client-accounts/${sister._id}`).send({ isAffiliate: false });
    const after = (await as('get', '/api/finance/ar-outstanding')).body;
    expect(after.affiliateOutstanding).toBe(0);
    expect(after.tradeOutstanding).toBe(650);
    expect(await M('JournalEntry').countDocuments({})).toBe(entries);
  });
});
