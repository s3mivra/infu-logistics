// Tips, the stamp card, QR feedback and the prep list (features/cafe-extras.js).
// A cafe keeps these; none of them posts to the ledger.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, tillTok;
const as = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'cafeBoss', role: 'superadmin' });
  await makeUser({ name: 'cafeTill', role: 'staff', permissions: ['pos.use', 'orders.view', 'shifts.view'] });
  tok = await loginStaff(app, 'cafeBoss');
  tillTok = await loginStaff(app, 'cafeTill');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('tips', () => {
  it('collects into a pool, and a payout must share out exactly that pool', async () => {
    const entries = await M('JournalEntry').countDocuments({});
    expect((await as('post', '/api/tips', tillTok).send({ amount: 120, method: 'Cash' })).status).toBe(200);
    expect((await as('post', '/api/tips', tillTok).send({ amount: 80.5, method: 'GCash', note: 'table 4' })).status).toBe(200);
    expect((await as('post', '/api/tips', tillTok).send({ amount: 0 })).status).toBe(400);

    const before = (await as('get', '/api/tips')).body;
    expect(before).toMatchObject({ pool: 200.5, poolCount: 2, collected: 200.5 });

    const short = await as('post', '/api/tips/payout').send({ shares: [{ name: 'Ana', amount: 100 }, { name: 'Ben', amount: 100 }] });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/must match exactly/);

    const paid = await as('post', '/api/tips/payout').send({ shares: [{ name: 'Ana', amount: 100.25 }, { name: 'Ben', amount: 100.25 }] });
    expect(paid.status).toBe(200);
    const after = (await as('get', '/api/tips')).body;
    expect(after.pool).toBe(0);
    expect(after.payouts[0]).toMatchObject({ total: 200.5, paidBy: 'cafeBoss' });
    // Tips are the staff's money: nothing was posted to the books.
    expect(await M('JournalEntry').countDocuments({})).toBe(entries);
  });

  it('a tip already shared out cannot be removed; one still in the pool can', async () => {
    const paidTip = (await as('get', '/api/tips')).body.tips[0];
    expect((await as('delete', `/api/tips/${paidTip._id}`, tillTok)).status).toBe(409);
    const fresh = (await as('post', '/api/tips', tillTok).send({ amount: 30 })).body.tip;
    expect((await as('delete', `/api/tips/${fresh._id}`, tillTok)).status).toBe(200);
    expect((await as('get', '/api/tips')).body.pool).toBe(0);
  });

  it('sharing out the pool is not for the till', async () => {
    await as('post', '/api/tips', tillTok).send({ amount: 50 });
    expect((await as('post', '/api/tips/payout', tillTok).send({ shares: [{ name: 'Me', amount: 50 }] })).status).toBe(403);
  });
});

describe('the stamp card', () => {
  it('is one card however the number is typed, and earns a reward every so many stamps', async () => {
    expect((await as('put', '/api/loyalty/settings').send({ perReward: 5 })).status).toBe(200);
    await as('post', '/api/loyalty/stamp', tillTok).send({ phone: '0917 123 4567', name: 'Regular Rita', stamps: 3 });
    const two = await as('post', '/api/loyalty/stamp', tillTok).send({ phone: '+63 917 123 4567', stamps: 3 });
    expect(two.body.card).toMatchObject({ name: 'Regular Rita', stamps: 6, rewardsAvailable: 1, onCard: 1, toNext: 4 });
    expect(await M('LoyaltyCard').countDocuments({})).toBe(1);

    const look = await as('get', '/api/loyalty/card?phone=9171234567', tillTok);
    expect(look.body).toMatchObject({ found: true, card: { stamps: 6, rewardsAvailable: 1 } });
  });

  it('a reward can be redeemed once, and not before it is earned', async () => {
    const first = await as('post', '/api/loyalty/redeem', tillTok).send({ phone: '09171234567' });
    expect(first.body.card).toMatchObject({ rewardsAvailable: 0, rewardsRedeemed: 1 });
    const again = await as('post', '/api/loyalty/redeem', tillTok).send({ phone: '09171234567' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/4 more stamp/);
    expect((await as('post', '/api/loyalty/redeem', tillTok).send({ phone: '0999 000 0000' })).status).toBe(404);
  });

  it('refuses something that is not a phone number', async () => {
    expect((await as('post', '/api/loyalty/stamp', tillTok).send({ phone: 'abc' })).status).toBe(400);
    expect((await as('get', '/api/loyalty/card?phone=12', tillTok)).status).toBe(400);
  });
});

describe('feedback from the table', () => {
  const order = (over) => M('Order').create({ businessType: 'fb', orderNumber: `FB-${Math.random().toString(36).slice(2, 8)}`, table: 'T3', items: [], subtotal: 100, total: 100, status: 'Completed', paymentMethod: 'Cash', ...over });

  it('takes one rating per real order, without an account', async () => {
    const o = await order();
    expect((await request(app).post('/api/feedback').send({ orderId: String(o._id), rating: 5, comment: 'Great flat white' })).status).toBe(200);
    expect((await request(app).post('/api/feedback').send({ orderId: String(o._id), rating: 1 })).status).toBe(409);
  });

  it('refuses an order that does not exist, is old, or was cancelled, and a rating out of range', async () => {
    const post = (body) => request(app).post('/api/feedback').send(body);
    expect((await post({ orderId: String(new mongoose.Types.ObjectId()), rating: 4 })).status).toBe(400);
    expect((await post({ orderId: 'nope', rating: 4 })).status).toBe(400);
    const old = await order({ createdAt: new Date(Date.now() - 3 * 86400000) });
    expect((await post({ orderId: String(old._id), rating: 4 })).status).toBe(400);
    const gone = await order({ status: 'Cancelled' });
    expect((await post({ orderId: String(gone._id), rating: 4 })).status).toBe(400);
    const fine = await order();
    expect((await post({ orderId: String(fine._id), rating: 9 })).status).toBe(400);
    expect((await post({ orderId: String(fine._id), rating: 2, comment: 'Slow' })).status).toBe(200);
  });

  it('is summarised for the owner', async () => {
    const res = await as('get', '/api/reports/feedback');
    expect(res.body).toMatchObject({ success: true, count: 2, average: 3.5, low: 1 });
    expect(res.body.counts.find(c => c.stars === 5).count).toBe(1);
    expect(res.body.entries.map(e => e.comment).sort()).toEqual(['Great flat white', 'Slow']);
  });
});

describe('the prep list', () => {
  it('goes by what sold on the last few of the same weekday', async () => {
    const target = new Date(Date.now() + 86400000);            // tomorrow
    const at = (weeksBack) => new Date(target.getTime() - weeksBack * 7 * 86400000);
    const sold = (weeksBack, items) => M('Order').create({
      businessType: 'fb', orderNumber: `PL-${Math.random().toString(36).slice(2, 8)}`, table: 'Takeout', subtotal: 1, total: 1,
      status: 'Completed', paymentMethod: 'Cash', createdAt: at(weeksBack), items: items.map(([name, quantity]) => ({ name, quantity, price: 1 })),
    });
    await sold(1, [['Latte', 10], ['Croissant', 4]]);
    await sold(2, [['Latte', 13]]);
    await sold(3, [['Latte', 8], ['Croissant', 1]]);
    await sold(4, [['Latte', 6]]);
    await sold(1, [['Latte', 2]]);                               // same day, another order
    await M('Order').create({ businessType: 'fb', orderNumber: 'PL-OTHERDAY', table: 'Takeout', subtotal: 1, total: 1, status: 'Completed', paymentMethod: 'Cash', createdAt: new Date(at(1).getTime() - 86400000), items: [{ name: 'Latte', quantity: 500, price: 1 }] });

    const res = await as('get', `/api/reports/prep-list?date=${ymd(target)}&weeks=4`);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(4);
    const latte = res.body.products.find(p => p.name === 'Latte');
    expect(latte).toMatchObject({ average: 9.8, prepare: 10, most: 13, least: 6, soldOn: 4 });   // (12+13+8+6)/4
    const croissant = res.body.products.find(p => p.name === 'Croissant');
    expect(croissant).toMatchObject({ average: 1.3, prepare: 2, most: 4, least: 0, soldOn: 2 });  // (4+0+1+0)/4
  });
});

describe('two tills at the same moment', () => {
  it('stamping a brand-new number from both still makes one card', async () => {
    await M('LoyaltyCard').init();                          // the unique index is in place
    // Different people at different tills, each for their own order: the app
    // treats an identical request sent twice as a double-click and runs it once.
    const stamp = (t, n) => as('post', '/api/loyalty/stamp', t).send({ phone: '0918 555 0101', orderNumber: `ORD-${n}` });
    const results = await Promise.all([stamp(tillTok, 1), stamp(tok, 2), stamp(tillTok, 3), stamp(tok, 4)]);
    // Every till's stamp lands, on the one card - none is lost, none errors.
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200]);
    expect(await M('LoyaltyCard').countDocuments({ phone: '9185550101' })).toBe(1);
    expect((await M('LoyaltyCard').findOne({ phone: '9185550101' }).lean()).stamps).toBe(4);
    const indexes = await M('LoyaltyCard').collection.indexes();
    expect(indexes.some(i => i.unique && i.key.businessType === 1 && i.key.phone === 1)).toBe(true);
  });
});
