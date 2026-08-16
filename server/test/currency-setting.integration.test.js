// Currency display config - GET/PATCH /api/settings/currency. Display-level
// only (symbol + ISO code); NOT FX/multi-currency, so these tests only assert
// the config round-trips and validates, not any conversion behavior.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'curSuper', role: 'superadmin' });
  await makeUser({ name: 'curStaff', role: 'staff' });
  superTok = await loginStaff(app, 'curSuper');
  staffTok = await loginStaff(app, 'curStaff');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('currency setting', () => {
  it('defaults to PHP/₱ when unset', async () => {
    const res = await auth('get', '/api/settings/currency', staffTok);
    expect(res.status).toBe(200);
    expect(res.body.currency).toEqual({ symbol: '₱', code: 'PHP' });
  });

  it('rejects a non-3-letter ISO code', async () => {
    const res = await auth('patch', '/api/settings/currency', superTok).send({ symbol: '$', code: 'US' });
    expect(res.status).toBe(400);
  });

  it('requires settings.manage (plain staff 403)', async () => {
    const res = await auth('patch', '/api/settings/currency', staffTok).send({ symbol: '$', code: 'USD' });
    expect(res.status).toBe(403);
  });

  it('sets and reads back a new currency', async () => {
    const set = await auth('patch', '/api/settings/currency', superTok).send({ symbol: '$', code: 'usd' });
    expect(set.status).toBe(200);
    expect(set.body.currency).toEqual({ symbol: '$', code: 'USD' }); // code upcased
    const get = await auth('get', '/api/settings/currency', staffTok);
    expect(get.body.currency).toEqual({ symbol: '$', code: 'USD' });
  });
});
