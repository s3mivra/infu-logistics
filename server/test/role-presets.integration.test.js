// The ready-made job roles: created once, and each opens what that job needs
// and nothing past it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { ROLE_PRESETS } from '../lib/authz.js';

let ctx, app;
const tok = {};
const as = (who, m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok[who]}`);
const day = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  // The roles are created in the start-up work that runs after the app answers.
  for (let i = 0; i < 100 && !(await mongoose.model('Settings').exists({ key: 'rolePresetsSeedV1' })); i++) await new Promise((r) => setTimeout(r, 100));
  await mongoose.model('Settings').updateOne({ key: 'payrollEnabled' }, { $set: { value: true } }, { upsert: true });
  for (const [who, role] of [['rpWare', 'Warehouse'], ['rpBuy', 'Purchasing'], ['rpHr', 'HR / Payroll'], ['rpSell', 'Salesperson'], ['rpDrive', 'Driver']]) {
    await makeUser({ name: who, role });
    tok[who] = await loginStaff(app, who);
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('job roles', () => {
  it('all five exist as ordinary, editable roles', async () => {
    const names = (await mongoose.model('Role').find().lean()).map((r) => r.name);
    for (const r of ROLE_PRESETS) expect(names).toContain(r.name);
  });

  it('warehouse receives deliveries but cannot raise a purchase order', async () => {
    const id = new mongoose.Types.ObjectId();
    const rec = await as('rpWare', 'post', `/api/purchase-orders/${id}/receive`).send({ received: [] });
    expect(rec.status, JSON.stringify(rec.body)).not.toBe(403);
    expect((await as('rpWare', 'post', '/api/purchase-orders').send({})).status).toBe(403);
    expect((await as('rpWare', 'get', '/api/journal')).status).toBe(403);
  });

  it('purchasing raises orders; HR runs payroll from the timesheet without the books', async () => {
    expect((await as('rpBuy', 'post', '/api/purchase-orders').send({})).status).not.toBe(403);
    expect((await as('rpHr', 'get', `/api/payroll/timesheet?start=${day}&end=${day}`)).status).toBe(200);
    expect((await as('rpHr', 'get', '/api/payroll/rules')).status).toBe(200);
    expect((await as('rpHr', 'get', '/api/journal')).status).toBe(403);
  });

  it('the driver sees the delivery sheet and no other report; the salesperson sells but no books', async () => {
    expect((await as('rpDrive', 'get', `/api/reports/delivery-sheet?date=${day}`)).status).not.toBe(403);
    expect((await as('rpDrive', 'get', '/api/reports/commissions')).status).toBe(403);
    expect((await as('rpSell', 'get', '/api/journal')).status).toBe(403);
    expect((await as('rpSell', 'get', '/api/payroll/rules')).status).toBe(403);
  });
});
