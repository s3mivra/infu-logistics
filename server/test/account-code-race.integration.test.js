// Two writers picking "the next free account code" under the same parent at
// the same moment - the setup import and the startup payment-method seeding -
// used to collide: one of them lost its row to a duplicate-key error
// (seen as "E11000 ... code_1 dup key: 112001"). The loser now re-reads what
// is taken and picks the next code instead.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'raceOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'raceOwner');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('choosing a new account code', () => {
  it('takes the next code when another writer claimed the chosen one first', async () => {
    const Account = mongoose.model('Account');
    const realCreate = Account.create.bind(Account);
    let stolen = null;
    // The first create: someone else takes that exact code a moment before.
    const spy = vi.spyOn(Account, 'create').mockImplementationOnce(async (doc) => {
      stolen = doc.code;
      await realCreate({ code: doc.code, name: 'Taken meanwhile', type: doc.type, parent: doc.parent, custom: true, normalBalance: 'Debit' });
      return realCreate(doc);   // now a duplicate, exactly as in the race
    });
    const res = await request(app).post('/api/setup/accounts/import').set('Authorization', `Bearer ${tok}`)
      .send({ rows: [{ code: 'B-101599', name: 'Cash in bank - Race Test', goesUnder: '112000', keepSeparate: 'Yes' }] });
    spy.mockRestore();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.skipped).toEqual([]);
    const made = await Account.findOne({ externalCode: 'B-101599' }).lean();
    expect(made).toBeTruthy();
    expect(made.code).not.toBe(stolen);
    expect(made.code.startsWith('112')).toBe(true);
  });
});
