// Two gaps from the pre-production audit, both about the books telling the
// whole truth:
//
//   1. Journal entries recorded no author. Now every posting is stamped with
//      who made it, from the request, whatever route wrote it.
//   2. The 3% percentage tax was computed for a report and never booked, so a
//      non-VAT business's P&L overstated net income and its balance sheet
//      left out a debt to the BIR. It is now accrued monthly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, bossTok, crewTok;
const M = (n) => mongoose.model(n);
const as = (tok, m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

// A completed sale dated inside `month` (YYYY-MM), written directly so its
// date can be in the past.
const soldIn = (month, total) => M('Order').create({
  orderNumber: `T-${Math.random().toString(36).slice(2, 9)}`, status: 'Completed',
  total, discount: 0, subtotal: total, createdAt: new Date(`${month}-15T10:00:00+08:00`),
  items: [{ name: 'X', price: total, quantity: 1 }],
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Boss', role: 'superadmin' });
  await makeUser({ name: 'Crew', role: 'staff' });
  bossTok = await loginStaff(app, 'Boss');
  crewTok = await loginStaff(app, 'Crew');
}, 120000);

afterAll(async () => { await ctx?.stop?.(); });

describe('every journal entry names who posted it', () => {
  it('stamps the user on an entry posted through a route', async () => {
    const r = await as(bossTok, 'post', '/api/expenses')
      .send({ amount: 250, categoryCode: '640000', paymentMethod: 'Cash on Hand', description: 'Water bill' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const je = await M('JournalEntry').findOne({ description: /Water bill/ }).lean();
    expect(je.postedBy).toBe('Boss');
    expect(je.postedById).toBeTruthy();
  });

  it('leaves it empty when no person posted it (a system job)', async () => {
    const je = await M('JournalEntry').create({
      reference: 'SYS-1', description: 'system',
      lines: [{ accountCode: '111000', debit: 1, credit: 0 }, { accountCode: '310000', debit: 0, credit: 1 }],
    });
    expect(je.postedBy).toBe('');
  });
});

describe('the 3% percentage tax reaches the books', () => {
  it('accrues 3% of the month, dated its last day', async () => {
    await soldIn('2026-02', 10000);
    await soldIn('2026-02', 5000);
    const r = await as(bossTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: '2026-02' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.amount).toBe(450);
    const je = await M('JournalEntry').findOne({ reference: 'PCT-2026-02' }).lean();
    const byCode = Object.fromEntries(je.lines.map(l => [l.accountCode, l]));
    expect(byCode['745000'].debit).toBe(450);
    expect(byCode['230400'].credit).toBe(450);
    expect(new Date(je.date).getDate()).toBe(28);
    expect(je.postedBy).toBe('Boss');
  });

  it('posts nothing when run again with nothing changed', async () => {
    const r = await as(bossTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: '2026-02' });
    expect(r.body.posted).toBe(false);
    expect(await M('JournalEntry').countDocuments({ reference: /^PCT-2026-02/ })).toBe(1);
  });

  it('corrects itself after a sale in that month is voided', async () => {
    await M('Order').updateOne({ total: 5000, status: 'Completed' }, { $set: { status: 'Voided' } });
    const r = await as(bossTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: '2026-02' });
    expect(r.body.amount).toBe(-150);
    expect(r.body.reference).toBe('PCT-2026-02-ADJ1');
    const lines = await M('JournalEntry').aggregate([
      { $match: { reference: /^PCT-2026-02/ } }, { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '230400' } },
      { $group: { _id: null, net: { $sum: { $subtract: ['$lines.credit', '$lines.debit'] } } } },
    ]);
    expect(lines[0].net).toBe(300);                       // 3% of the 10,000 that stands
  });

  it('shows up in the P&L as an expense', async () => {
    const r = await as(bossTok, 'get', '/api/reports/pnl?start=2026-02-01&end=2026-02-28');
    expect(JSON.stringify(r.body)).toMatch(/745000/);
  });

  it('refuses a month that has not ended', async () => {
    const future = new Date(); future.setMonth(future.getMonth() + 1);
    const ym = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}`;
    const r = await as(bossTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: ym });
    expect(r.status).toBe(400);
  });

  it('refuses a closed month', async () => {
    await M('ClosedPeriod').create({ year: 2026, month: 1, isOpen: false });
    const r = await as(bossTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: '2026-01' });
    expect(r.status).toBe(423);
  });

  it('needs accounting.manage', async () => {
    const r = await as(crewTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: '2026-02' });
    expect(r.status).toBe(403);
  });

  it('refuses for a VAT-registered business, which does not owe it', async () => {
    await M('Settings').updateOne({ key: 'vatEnabled' }, { $set: { value: true } }, { upsert: true });
    const r = await as(bossTok, 'post', '/api/reports/percentage-tax/accrue').send({ month: '2026-03' });
    expect(r.status).toBe(400);
    await M('Settings').updateOne({ key: 'vatEnabled' }, { $set: { value: false } });
  });
});
