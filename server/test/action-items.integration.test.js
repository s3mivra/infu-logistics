// "Needs your action" and the first-time setup checklist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'aiBoss', role: 'superadmin' });
  await makeUser({ name: 'aiCashier', role: 'cashier' });
  for (const n of ['aiBoss', 'aiCashier']) tok[n] = await loginStaff(app, n);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('needs your action', () => {
  it('counts what waits, for someone allowed to act on it', async () => {
    const LINES = [{ accountCode: '630000', debit: 100 }, { accountCode: '111000', credit: 100 }];
    await M('ManualJournal').create({ businessType: 'log', draftNumber: 'MJ-T1', description: 'x', lines: LINES.map((l) => ({ ...l, accountName: 'x', credit: l.credit || 0, debit: l.debit || 0 })), totalDebit: 100, totalCredit: 100, status: 'Pending' });
    const r = await as(tok.aiBoss, 'get', '/api/action-items');
    expect(r.status).toBe(200);
    const j = r.body.items.find((i) => i.id === 'journal');
    expect(j).toMatchObject({ count: 1, tab: 'ledger' });
    expect(r.body.total).toBeGreaterThanOrEqual(1);
  });

  it('a cashier is not shown approvals they cannot make', async () => {
    const r = await as(tok.aiCashier, 'get', '/api/action-items');
    expect(r.status).toBe(200);
    expect(r.body.items.find((i) => i.id === 'journal')).toBeUndefined();
  });

  it('the setup checklist ticks itself from the data, owners only', async () => {
    const r = await as(tok.aiBoss, 'get', '/api/setup-progress');
    expect(r.body.steps.map((s) => s.id)).toEqual(['settings', 'products', 'stock', 'staff', 'opening', 'sale']);
    expect(r.body.steps.find((s) => s.id === 'staff').done).toBe(true);
    expect(r.body.steps.find((s) => s.id === 'sale').done).toBe(false);
    expect((await as(tok.aiCashier, 'get', '/api/setup-progress')).body.steps).toEqual([]);
  });
});
