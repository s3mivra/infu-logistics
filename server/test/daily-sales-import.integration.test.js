// The daily sales summary import (cafe): cash less discounts, a bank (RCBC),
// Grab less commission, and the cash deposits - each day as backdated sales.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const M = (n) => mongoose.model(n);
const post = (body, t = tok) => request(app).post('/api/orders/import-daily').set('Authorization', `Bearer ${t}`).send(body);
const days = [
  { sheetRow: 4, date: '10-01-26', cashSales: 500, discount: 0, bankSales: 400, grabGross: 800, grabCommission: 200, depositDate: '10/08/26', depositSlip: '1111-0001' },
  { sheetRow: 5, date: '10-23-26', cashSales: 1000, discount: 100, discountType: 'PWD, SENIOR & REGULAR', bankSales: 500, grabGross: 800, grabCommission: 200, depositDate: '10/27/26', depositSlip: '2222-0002' },
];
const balance = async (code, refs) => {
  const rows = await M('JournalEntry').aggregate([
    { $match: { reference: { $in: refs } } }, { $unwind: '$lines' }, { $match: { 'lines.accountCode': code instanceof RegExp ? code : String(code) } },
    { $group: { _id: null, dr: { $sum: '$lines.debit' }, cr: { $sum: '$lines.credit' } } },
  ]);
  return Math.round(((rows[0]?.dr || 0) - (rows[0]?.cr || 0)) * 100) / 100;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'DsOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'DsOwner');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('daily sales summary import', () => {
  it('previews the totals and writes nothing', async () => {
    const res = await post({ rows: days, preview: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.summary).toMatchObject({ days: 2, ready: 2, problems: 0, cash: 1500, discount: 100, bank: 900, grab: 1600, commission: 400, deposits: 1400 });
    expect(await M('Order').countDocuments({ importRef: /^DSR-/ })).toBe(0);
  });

  it('imports each day as cash, bank and Grab sales, settles Grab less commission, and posts the deposits', async () => {
    const res = await post({ rows: days, bankMethod: 'Bank Transfer', postDeposits: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.results.every((r) => !r.failed.length)).toBe(true);

    const orders = await M('Order').find({ importRef: /^DSR-/ }).lean();
    expect(orders).toHaveLength(6);
    const cash23 = orders.find((o) => o.importRef === 'DSR-2026-10-23-CASH');
    expect(cash23.total).toBe(900);
    expect(cash23.discount).toBe(100);
    expect(cash23.orderNotes).toMatch(/PWD, SENIOR & REGULAR/);
    // Grab and the bank are not left owed.
    for (const o of orders.filter((x) => !/CASH$/.test(x.importRef))) expect(o.arSettled, o.importRef).toBe(true);

    const refs = (await M('JournalEntry').find({ reference: { $regex: /DSR-|^ORD|BACK/ } }, { reference: 1 }).lean()).map((j) => j.reference);
    const all = (await M('JournalEntry').find({}).lean()).map((j) => j.reference);
    // Commission is an expense; Grab receivable is cleared.
    expect(await balance('670000', all)).toBe(400);
    expect(await balance(/^12/, all)).toBe(0);   // every receivable account, sub-accounts too
    // Cash after discount (500 + 900) went to the bank on the deposit dates.
    const dep = await M('JournalEntry').findOne({ reference: 'DSR-2026-10-23-DEP' }).lean();
    expect(dep.description).toMatch(/2222-0002/);
    expect(new Date(dep.date).toISOString().slice(0, 10) >= '2026-10-26').toBe(true);
    expect(await balance('111000', all)).toBe(0);
    expect(refs.length).toBeGreaterThan(0);
  });

  it('importing the same days again adds nothing', async () => {
    const pre = await post({ rows: days, preview: true });
    expect(pre.body.summary.ready).toBe(0);
    const res = await post({ rows: days });
    expect(res.body.imported).toBe(0);
    expect(await M('Order').countDocuments({ importRef: /^DSR-/ })).toBe(6);
  });

  it('refuses a bad day and says why', async () => {
    const res = await post({ rows: [{ date: 'yesterday-ish', cashSales: 10 }, { date: '10-05-26', cashSales: 10, discount: 50 }], preview: true });
    expect(res.body.summary.problems).toBe(2);
    expect(res.body.days[1].errors[0]).toMatch(/discount is more than the cash/);
  });

  it('needs the backdate permission', async () => {
    await makeUser({ name: 'DsCashier', role: 'staff', permissions: ['pos.use', 'orders.view'] });
    const t = await loginStaff(app, 'DsCashier');
    expect((await post({ rows: days, preview: true }, t)).status).toBe(403);
  });
});
