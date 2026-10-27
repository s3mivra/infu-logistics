// The Ledger Editor: the superadmin corrects or voids a posted entry. The
// ledger stays append-only - the original is kept, a reversal and (for a
// correction) the corrected entry are posted, linked to it, with the reason.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const LINES = [{ accountCode: '630000', debit: 1500, credit: 0 }, { accountCode: '111000', debit: 0, credit: 1500 }];
const net = async (code) => (await M('JournalEntry').find({ 'lines.accountCode': code }).lean())
  .flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'leBoss', role: 'superadmin' });
  await makeUser({ name: 'leDir', role: 'staff', permissions: ['accounting.view', 'accounting.manage', 'journal.approve'] });
  for (const n of ['leBoss', 'leDir']) tok[n] = await loginStaff(app, n);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('ledger editor', () => {
  let origId;

  it('only the superadmin may correct or void', async () => {
    const r = await as(tok.leDir, 'post', '/api/journal').send({ description: 'Rent', lines: LINES });
    origId = r.body.entry._id;
    expect((await as(tok.leDir, 'post', `/api/journal/${origId}/correct`).send({ reason: 'x', lines: LINES })).status).toBe(403);
    expect((await as(tok.leDir, 'post', `/api/journal/${origId}/void`).send({ reason: 'x' })).status).toBe(403);
  });

  it('a reason is required and the lines must balance', async () => {
    expect((await as(tok.leBoss, 'post', `/api/journal/${origId}/correct`).send({ lines: LINES })).status).toBe(400);
    const bad = await as(tok.leBoss, 'post', `/api/journal/${origId}/correct`).send({ reason: 'typo',
      lines: [{ accountCode: '630000', debit: 1200 }, { accountCode: '111000', credit: 1000 }] });
    expect(bad.status).toBe(400);
  });

  it('a correction keeps the original, reverses it, and posts the new amount', async () => {
    const r = await as(tok.leBoss, 'post', `/api/journal/${origId}/correct`).send({ reason: 'Rent was 1,200', description: 'Rent (fixed)',
      lines: [{ accountCode: '630000', debit: 1200 }, { accountCode: '111000', credit: 1200 }] });
    expect(r.status).toBe(200);
    expect(await M('JournalEntry').exists({ _id: origId })).toBeTruthy();
    expect(String(r.body.reversal.reverses)).toBe(origId);
    expect(String(r.body.corrected.correctionOf)).toBe(origId);
    expect(r.body.corrected.changeReason).toBe('Rent was 1,200');
    expect(await net('630000')).toBe(1200);
    const list = await as(tok.leBoss, 'get', '/api/journal?limit=50');
    expect(list.body.entries.find((e) => e._id === origId).reversed).toBe(true);
    const hist = await as(tok.leBoss, 'get', `/api/journal/${origId}/history`);
    expect(hist.body.related).toHaveLength(2);
    expect(await M('AuditLog').exists({ action: 'JournalEntry_CORRECT', targetReference: origId })).toBeTruthy();
  });

  it('a changed entry cannot be changed twice, nor its reversal', async () => {
    expect((await as(tok.leBoss, 'post', `/api/journal/${origId}/void`).send({ reason: 'again' })).status).toBe(409);
    const rev = await M('JournalEntry').findOne({ reverses: origId }).lean();
    expect((await as(tok.leBoss, 'post', `/api/journal/${rev._id}/void`).send({ reason: 'x' })).status).toBe(409);
  });

  it('voiding the corrected entry takes it to zero', async () => {
    const cor = await M('JournalEntry').findOne({ correctionOf: origId }).lean();
    const r = await as(tok.leBoss, 'post', `/api/journal/${cor._id}/void`).send({ reason: 'Not ours' });
    expect(r.status).toBe(200);
    expect(await net('630000')).toBe(0);
  });
});
