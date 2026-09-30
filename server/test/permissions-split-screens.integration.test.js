// Payroll, Fixed Assets, Bank Reconciliation and Shifts & Cash each have their
// own permission now, instead of riding on accounting / superadmin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { withSplitScreens, resolvePermissions } from '../lib/authz.js';

let ctx, app;
const tok = {};
const get = (t, p) => request(app).get(p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  // Let the one-time upgrade grant finish first - it would (rightly) hand
  // Fixed Assets to anyone already holding accounting.view.
  for (let i = 0; i < 100 && !(await mongoose.model('Settings').exists({ key: 'permsSplitScreensV1' })); i++) await new Promise(r => setTimeout(r, 100));
  await makeUser({ name: 'psAssets', role: 'staff', permissions: ['orders.view', 'assets.view'] });
  await makeUser({ name: 'psShifts', role: 'staff', permissions: ['orders.view', 'shifts.view'] });
  await makeUser({ name: 'psBooks', role: 'staff', permissions: ['orders.view', 'accounting.view'] });
  for (const n of ['psAssets', 'psShifts', 'psBooks']) tok[n] = await loginStaff(app, n);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('screen permissions', () => {
  it('fixed assets need their own permission, not accounting', async () => {
    expect((await get(tok.psAssets, '/api/fixed-assets')).status).toBe(200);
    expect((await get(tok.psBooks, '/api/fixed-assets')).status).toBe(403);
  });

  it('shift history and time-clock records need shifts.view', async () => {
    expect((await get(tok.psShifts, '/api/shifts')).status).toBe(200);
    expect((await get(tok.psShifts, '/api/clock/entries')).status).toBe(200);
    expect((await get(tok.psAssets, '/api/shifts')).status).toBe(403);
  });

  it('whoever had accounting keeps these screens on upgrade', () => {
    expect(withSplitScreens(['accounting.view'])).toEqual(expect.arrayContaining(['payroll.view', 'assets.view', 'bankrec.view']));
    expect(withSplitScreens(['accounting.view'])).not.toContain('payroll.manage');
    expect(withSplitScreens(['accounting.manage'])).toEqual(expect.arrayContaining(['payroll.manage', 'assets.manage', 'bankrec.manage']));
    expect(withSplitScreens(['pos.use'])).toEqual(['pos.use']);
  });

  it('built-in roles come with them', () => {
    const fin = resolvePermissions({ role: 'finance' });
    expect(fin).toEqual(expect.arrayContaining(['payroll.manage', 'assets.manage', 'bankrec.manage']));
    const admin = resolvePermissions({ role: 'admin' });
    expect(admin).toEqual(expect.arrayContaining(['payroll.view', 'assets.view', 'bankrec.view']));
    // Shifts & Cash was owner-only; nobody gets it without being given it.
    expect(admin).not.toContain('shifts.view');
  });
});
