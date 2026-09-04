// Branch code as stored settings: it names this deployment inside a
// consolidated report ("AC-A001"). Two inventories can share one address, so
// the code - not the address - is what the report groups on, and a malformed
// code has to be refused rather than stored: the report would file that
// branch's money under "Unassigned" and the location totals would come out
// short with nothing obviously wrong.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const setCode = (value) => request(app).patch('/api/settings/branchCode')
  .set('Authorization', `Bearer ${tok}`).send({ value });
const readSettings = () => request(app).get('/api/settings').set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'BranchSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'BranchSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => { await mongoose.model('Settings').deleteMany({ key: 'branchCode' }); });

describe('setting a branch code', () => {
  it('stores a valid code', async () => {
    const res = await setCode('AC-A001');
    expect(res.status).toBe(200);
    expect((await readSettings()).body.settings.branchCode).toBe('AC-A001');
  });

  it('normalises case and surrounding space', async () => {
    await setCode('  ac-a002  ');
    expect((await readSettings()).body.settings.branchCode).toBe('AC-A002');
  });

  it('accepts a second inventory at the SAME location', async () => {
    // The case the whole scheme exists for.
    expect((await setCode('AC-A001')).status).toBe(200);
    expect((await setCode('AC-A002')).status).toBe(200);
  });

  it('refuses a malformed code instead of silently storing it', async () => {
    for (const bad of ['ACA001', 'AC-001', 'AC_A001', 'AC-A', 'nonsense']) {
      const res = await setCode(bad);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/AC-A001/);
    }
    // Nothing was written by any of the rejected attempts.
    expect((await readSettings()).body.settings.branchCode).toBeUndefined();
  });

  it('does not overwrite a good code with a bad one', async () => {
    await setCode('AC-A001');
    expect((await setCode('garbage')).status).toBe(400);
    expect((await readSettings()).body.settings.branchCode).toBe('AC-A001');
  });

  it('allows clearing it', async () => {
    await setCode('AC-A001');
    expect((await setCode('')).status).toBe(200);
    expect((await readSettings()).body.settings.branchCode).toBe('');
  });

  it('leaves other settings keys unvalidated', async () => {
    const res = await request(app).patch('/api/settings/someOtherKey')
      .set('Authorization', `Bearer ${tok}`).send({ value: 'anything at all' });
    expect(res.status).toBe(200);
  });
});

describe('the branch code reaches a consolidated report', () => {
  it('is reported alongside this branch financial figures', async () => {
    await setCode('AC-A001');
    const res = await request(app)
      .get('/api/hub/network-financials')
      .set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);

    const self = res.body.branches.find(b => b.self);
    expect(self.branchCode).toBe('AC-A001');
    expect(self.branchCodeValid).toBe(true);
  });

  it('groups this branch under its location', async () => {
    await setCode('AC-A001');
    const res = await request(app)
      .get('/api/hub/network-financials')
      .set('Authorization', `Bearer ${tok}`);

    const mall = res.body.byLocation.find(g => g.locationKey === 'AC-A');
    expect(mall).toBeTruthy();
    expect(mall.branchCount).toBe(1);
    expect(mall.totals).toHaveProperty('netIncome');
    expect(mall.totals).toHaveProperty('totalAssets');
  });

  it('shows an un-coded branch as Unassigned rather than hiding it', async () => {
    // No code set at all - the branch still holds real money.
    const res = await request(app)
      .get('/api/hub/network-financials')
      .set('Authorization', `Bearer ${tok}`);

    const self = res.body.branches.find(b => b.self);
    expect(self.branchCodeValid).toBe(false);
    expect(res.body.byLocation.some(g => g.locationKey === 'Unassigned')).toBe(true);
  });
});
