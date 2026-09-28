// A route that writes a journal entry AND other records must be all-or-nothing.
// These handlers catch their own errors and answer 500 - which, inside a plain
// transaction, would still COMMIT everything written before the failure. The
// atomic() wrapper (lib/atomicRoute.js) rolls back on any error response.
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Boss', role: 'superadmin' });
  tok = await loginStaff(app, 'Boss');
}, 120000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await ctx?.stop?.(); });

const asset = () => request(app).post('/api/fixed-assets').set('Authorization', `Bearer ${tok}`).send({
  name: 'Grinder', accountCode: '140200', acquisitionCost: 24000, salvageValue: 0,
  usefulLifeMonths: 48, acquisitionDate: '2026-02-01', paidFromAccount: '111000',
});

describe('all or nothing', () => {
  it('rolls back the journal entry when the asset record then fails to save', async () => {
    const jeBefore = await M('JournalEntry').countDocuments({});
    // The entry is written first; the asset write after it blows up.
    vi.spyOn(M('FixedAsset'), 'create').mockRejectedValueOnce(new Error('injected failure after the journal entry'));
    const r = await asset();
    expect(r.status).toBe(500);
    expect(await M('JournalEntry').countDocuments({})).toBe(jeBefore);     // nothing half-posted
    expect(await M('FixedAsset').countDocuments({})).toBe(0);
  });

  it('commits both when nothing fails', async () => {
    const jeBefore = await M('JournalEntry').countDocuments({});
    const r = await asset();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await M('JournalEntry').countDocuments({})).toBe(jeBefore + 1);
    expect(await M('FixedAsset').countDocuments({})).toBe(1);
  });

  it('rolls back on a refusal the handler itself answers (a 4xx after a write)', async () => {
    const before = await M('JournalEntry').countDocuments({});
    const r = await request(app).post('/api/fixed-assets').set('Authorization', `Bearer ${tok}`).send({ name: '' });
    expect(r.status).toBe(400);
    expect(await M('JournalEntry').countDocuments({})).toBe(before);
  });
});
