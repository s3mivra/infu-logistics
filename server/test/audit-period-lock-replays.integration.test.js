// Regression tests for the 2026-11 audit: closed periods closed to every
// posting path (M89, M91, M103, AC13) and replay-safe production and
// depreciation (M88, M89). Each case replays the exploit proven against the
// unpatched server.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { withLedgerMaintenance } from '../lib/ledgerGuard.js';

let ctx, app, superTok, mgrTok;
const M = (n) => mongoose.model(n);
const auth = (m, p, t = superTok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb', jwtSecret: 'audit-period-lock-secret-0123456789' });
  app = ctx.app;
  await makeUser({ name: 'PlSuper', role: 'superadmin' });
  await makeUser({ name: 'PlMgr', role: 'manager' });
  superTok = await loginStaff(app, 'PlSuper');
  mgrTok = await loginStaff(app, 'PlMgr');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  for (const n of ['ClosedPeriod', 'JournalEntry', 'FixedAsset']) {
    await withLedgerMaintenance(() => M(n).deleteMany({}));
  }
  await M('ClosedPeriod').create({ year: 2026, month: 3, isOpen: false, closedBy: 'PlSuper' });
});

const acquire = () => auth('post', '/api/fixed-assets').send({
  name: 'Espresso Machine', accountCode: '140200',
  acquisitionCost: 60000, salvageValue: 6000, usefulLifeMonths: 60,
  acquisitionDate: '2026-01-15', paidFromAccount: '111000',
});

describe('the journal itself refuses a closed month', () => {
  it('any new entry dated in a closed month is rejected with status 423', async () => {
    const err = await M('JournalEntry').create({
      date: new Date('2026-03-10T10:00:00+08:00'), reference: 'DIRECT-1',
      lines: [
        { accountCode: '111000', accountName: 'Cash', debit: 10, credit: 0 },
        { accountCode: '400000', accountName: 'Sales', debit: 0, credit: 10 },
      ],
    }).then(() => null, (e) => e);
    expect(err?.status).toBe(423);
    expect(await M('JournalEntry').countDocuments({ reference: 'DIRECT-1' })).toBe(0);
  });

  it('the month boundary follows the business time zone, not the server clock', async () => {
    // 00:30 on 1 April in Manila is still 31 March in UTC: April is open.
    const ok = await M('JournalEntry').create({
      date: new Date('2026-04-01T00:30:00+08:00'), reference: 'BOUNDARY-1',
      lines: [
        { accountCode: '111000', accountName: 'Cash', debit: 10, credit: 0 },
        { accountCode: '400000', accountName: 'Sales', debit: 0, credit: 10 },
      ],
    }).then(() => true, () => false);
    expect(ok).toBe(true);
  });

  it('a declared ledger maintenance (superadmin restore) is still allowed', async () => {
    const ok = await withLedgerMaintenance(() => M('JournalEntry').create({
      date: new Date('2026-03-10T10:00:00+08:00'), reference: 'MAINT-1',
      lines: [
        { accountCode: '111000', accountName: 'Cash', debit: 10, credit: 0 },
        { accountCode: '400000', accountName: 'Sales', debit: 0, credit: 10 },
      ],
    })).then(() => true, () => false);
    expect(ok).toBe(true);
  });
});

describe('depreciation (M89)', () => {
  it('refuses an "as of" date inside a closed month', async () => {
    const a = await acquire();
    const res = await auth('post', `/api/fixed-assets/${a.body.asset._id}/depreciate`).send({ asOf: '2026-03-31' });
    expect(res.status).toBe(423);
    expect(String(res.body.error)).toMatch(/closed/i);
  });

  it('refuses a future "as of" date', async () => {
    const a = await acquire();
    const res = await auth('post', `/api/fixed-assets/${a.body.asset._id}/depreciate`).send({ asOf: '2031-01-31' });
    expect(res.status).toBe(400);
    expect(await M('JournalEntry').countDocuments({ reference: /^FA-DEP/ })).toBe(0);
  });

  it('parallel runs post once', async () => {
    const a = await acquire();
    const id = a.body.asset._id;
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      auth('post', `/api/fixed-assets/${id}/depreciate`).send({ asOf: '2026-06-30', nonce: i })));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    const entries = await M('JournalEntry').find({ reference: /^FA-DEP/ }).lean();
    expect(entries.length).toBe(1);
    const asset = await M('FixedAsset').findById(id).lean();
    expect(asset.depreciationHistory.length).toBe(1);
    expect(asset.accumulatedDepreciation).toBeCloseTo(entries[0].totalDebit, 2);
  });
});

describe('production orders (M88)', () => {
  it('parallel approvals consume the materials once', async () => {
    const mat = await M('Inventory').create({ itemName: 'PL Green Beans', stockQty: 6000, unit: 'g', unitCost: 1, unitMultiplier: 1 });
    const filed = await auth('post', '/api/production-orders', mgrTok).send({
      materials: [{ invId: String(mat._id), itemName: 'PL Green Beans', qty: 1000, unit: 'g' }],
      outputType: 'new', outputName: 'PL Roasted Beans', outputQty: 850, outputUnit: 'g',
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    const id = filed.body.order._id;
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      auth('post', `/api/production-orders/${id}/approve`, mgrTok).send({ nonce: i })));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect((await M('Inventory').findById(mat._id).lean()).stockQty).toBe(5000);

    const recs = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      auth('post', `/api/production-orders/${id}/reconcile`, mgrTok).send({ actualOutputQty: 850, nonce: i })));
    expect(recs.filter((r) => r.status === 200).length).toBe(1);
    const out = await M('Inventory').findOne({ itemName: /PL Roasted Beans/i }).lean();
    expect(out.stockQty).toBe(850);
  });
});
