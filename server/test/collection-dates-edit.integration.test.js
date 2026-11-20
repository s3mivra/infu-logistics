// The owner correcting the dates on a collection: the list and the books move together.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, owner, staff;
const M = (n) => mongoose.model(n);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'DateOwner', role: 'superadmin' });
  await makeUser({ name: 'DateStaff', role: 'admin' });
  owner = await loginStaff(app, 'DateOwner');
  staff = await loginStaff(app, 'DateStaff');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('editing the dates of a collection', () => {
  it('moves the collected and deposited dates, and the journal entry with them', async () => {
    const o = await M('Order').create({ businessType: 'log', orderNumber: 'CD-1', status: 'Completed', paymentMethod: 'On Account', total: 1000, subtotal: 1000, items: [],
      arPayments: [{ amount: 1000, paymentMethod: 'Bank Transfer', collectionDate: new Date('2026-11-10T03:00:00Z'), depositDate: null, journalRef: 'ARS-CD-1' }] });
    await M('JournalEntry').create({ reference: 'ARS-CD-1', date: new Date('2026-11-10T03:00:00Z'), description: 'A/R collection CD-1',
      lines: [{ accountCode: '111000', accountName: 'Cash', debit: 1000, credit: 0 }, { accountCode: '120000', accountName: 'A/R', debit: 0, credit: 1000 }], totalDebit: 1000, totalCredit: 1000 });
    const pid = String(o.arPayments[0]._id);
    const path = `/api/orders/${o._id}/ar-payments/${pid}/dates`;
    expect((await request(app).patch(path).set('Authorization', `Bearer ${staff}`).send({ collectionDate: '2026-11-12' })).status).toBe(403);
    const r = await request(app).patch(path).set('Authorization', `Bearer ${owner}`).send({ collectionDate: '2026-11-12', depositDate: '2026-11-13' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = (await M('Order').findById(o._id).lean()).arPayments[0];
    expect(new Date(p.collectionDate).toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(new Date(p.depositDate).toISOString().slice(0, 10)).toBe('2026-11-13');
    // The books: the original stays, a reversal on its day, and a new entry on the new day.
    expect(p.journalRef).toMatch(/^ARS-CD-1-RD/);
    const fresh = await M('JournalEntry').findOne({ reference: p.journalRef }).lean();
    expect(new Date(fresh.date).toISOString().slice(0, 10)).toBe('2026-11-12');
    const rev = await M('JournalEntry').findOne({ reference: /^ARS-CD-1-RDREV/ }).lean();
    expect(new Date(rev.date).toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(rev.lines.find(l => l.accountCode === '111000').credit).toBe(1000);
    // Banked before it was collected is refused.
    expect((await request(app).patch(path).set('Authorization', `Bearer ${owner}`).send({ depositDate: '2026-11-01' })).status).toBe(400);
  });
});
