// Leave and overtime: staff file, a roster manager decides (never their own),
// and the payroll timesheet adds days worked, paid leave and approved overtime
// at the daily rate on the staff record.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { leaveDays, suggestedGross } from '../features/timeoff.js';

let ctx, app, cashier, manager;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'toBoss', role: 'superadmin' });
  cashier = await makeUser({ name: 'toCashier', role: 'cashier' });
  manager = await makeUser({ name: 'toManager', role: 'manager' });
  cashier = await mongoose.model('User').findOne({ name: 'toCashier' }).lean();
  manager = await mongoose.model('User').findOne({ name: 'toManager' }).lean();
  tok.boss = await loginStaff(app, 'toBoss');
  tok.cashier = await loginStaff(app, 'toCashier');
  tok.manager = await loginStaff(app, 'toManager');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('time-off maths', () => {
  it('counts leave days inclusively and prices overtime at 125%', () => {
    expect(leaveDays('2026-03-02', '2026-03-04')).toBe(3);
    expect(leaveDays('2026-03-04', '2026-03-02')).toBe(0);
    // 10 days + 1 paid leave at 800, plus 4h OT at 100/h * 1.25
    expect(suggestedGross({ dailyRate: 800, daysWorked: 10, paidLeaveDays: 1, overtimeHours: 4 })).toBe(9300);
  });
});

describe('leave and overtime', () => {
  let leaveId, otId;
  it('staff file their own; filing for someone else needs a roster manager', async () => {
    const bad = await as(tok.cashier, 'post', '/api/leave-requests').send({ type: 'Holiday', from: '2026-03-02', to: '2026-03-03' });
    expect(bad.status).toBe(400);
    const back = await as(tok.cashier, 'post', '/api/leave-requests').send({ type: 'Sick', from: '2026-03-05', to: '2026-03-02' });
    expect(back.status).toBe(400);
    const lv = await as(tok.cashier, 'post', '/api/leave-requests').send({ type: 'Vacation', from: '2026-03-02', to: '2026-03-03', reason: 'Family' });
    expect(lv.status, JSON.stringify(lv.body)).toBe(201);
    expect(lv.body.request).toMatchObject({ days: 2, paid: true, status: 'Pending', userName: 'toCashier' });
    leaveId = lv.body.request._id;
    const clash = await as(tok.cashier, 'post', '/api/leave-requests').send({ type: 'Sick', from: '2026-03-03', to: '2026-03-03' });
    expect(clash.status).toBe(409);
    const forOther = await as(tok.cashier, 'post', '/api/overtime-requests').send({ userId: String(manager._id), date: '2026-03-05', hours: 2 });
    expect(forOther.status).toBe(403);
    const ot = await as(tok.cashier, 'post', '/api/overtime-requests').send({ date: '2026-03-05', hours: 3, reason: 'Inventory count' });
    expect(ot.status).toBe(201);
    otId = ot.body.request._id;
    expect((await as(tok.cashier, 'post', '/api/overtime-requests').send({ date: '2026-03-05', hours: 20 })).status).toBe(400);
  });

  it('only a roster manager decides, never on their own request, and a rejection needs a reason', async () => {
    expect((await as(tok.cashier, 'post', `/api/leave-requests/${leaveId}/approve`).send({})).status).toBe(403);
    const own = await as(tok.manager, 'post', '/api/overtime-requests').send({ date: '2026-03-06', hours: 1 });
    expect((await as(tok.manager, 'post', `/api/overtime-requests/${own.body.request._id}/approve`).send({})).status).toBe(403);
    expect((await as(tok.manager, 'post', `/api/leave-requests/${leaveId}/reject`).send({})).status).toBe(400);
    const ok = await as(tok.manager, 'post', `/api/leave-requests/${leaveId}/approve`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.request).toMatchObject({ status: 'Approved', decidedBy: 'toManager' });
    expect((await as(tok.manager, 'post', `/api/leave-requests/${leaveId}/approve`).send({})).status).toBe(409);
    expect((await as(tok.boss, 'post', `/api/overtime-requests/${otId}/approve`).send({})).status).toBe(200);
  });

  it('a roster manager files for someone else; it is theirs, and still decided by another', async () => {
    const r = await as(tok.manager, 'post', '/api/overtime-requests').send({ userId: String(cashier._id), date: '2026-03-07', hours: 1.5 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.request).toMatchObject({ userName: 'toCashier', filedBy: 'toManager' });
    expect((await as(tok.manager, 'post', '/api/overtime-requests').send({ userId: 'not-an-id', date: '2026-03-07', hours: 1 })).status).toBe(404);
    // Leave it pending - the timesheet below counts approved overtime only.
    await as(tok.manager, 'post', `/api/overtime-requests/${r.body.request._id}/reject`).send({ note: 'Filed in error' });
  });

  it('staff pay and government numbers are only shown to someone who manages staff', async () => {
    await as(tok.boss, 'patch', `/api/users/${cashier._id}`).send({ dailyRate: 650, tin: '123-456-789' });
    const mine = await as(tok.cashier, 'get', '/api/users');
    const row = mine.body.users.find(u => u.name === 'toCashier');
    expect(row.name).toBe('toCashier');
    expect(row.dailyRate).toBeUndefined();
    expect(row.tin).toBeUndefined();
    const boss = await as(tok.boss, 'get', '/api/users');
    expect(boss.body.users.find(u => u.name === 'toCashier')).toMatchObject({ dailyRate: 650, tin: '123-456-789' });
  });

  it('the cashier sees only their own; the manager sees everyone', async () => {
    const mine = await as(tok.cashier, 'get', '/api/overtime-requests');
    expect(mine.body.requests.every(r => r.userName === 'toCashier')).toBe(true);
    const all = await as(tok.manager, 'get', '/api/overtime-requests');
    expect(all.body.requests.map(r => r.userName)).toEqual(expect.arrayContaining(['toCashier', 'toManager']));
  });

  it('the timesheet adds worked days, paid leave and approved overtime at the daily rate', async () => {
    const rate = await as(tok.boss, 'patch', `/api/users/${cashier._id}`).send({ dailyRate: 800 });
    expect(rate.status, JSON.stringify(rate.body)).toBe(200);
    expect((await as(tok.boss, 'patch', `/api/users/${cashier._id}`).send({ dailyRate: -1 })).status).toBe(400);
    const ClockEntry = mongoose.model('ClockEntry');
    const at = (d, h) => new Date(`${d}T0${h}:00:00+08:00`);
    await ClockEntry.create([
      { staffId: String(cashier._id), staffName: 'toCashier', date: '2026-03-04', clockIn: at('2026-03-04', 8), clockOut: at('2026-03-04', 9), workedMinutes: 480 },
      { staffId: String(cashier._id), staffName: 'toCashier', date: '2026-03-05', clockIn: at('2026-03-05', 8), clockOut: at('2026-03-05', 9), workedMinutes: 480 },
    ]);
    expect((await as(tok.cashier, 'get', '/api/payroll/timesheet?start=2026-03-01&end=2026-03-15')).status).toBe(403);
    const r = await as(tok.boss, 'get', '/api/payroll/timesheet?start=2026-03-01&end=2026-03-15');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.rows.find(x => x.name === 'toCashier');
    // 2 worked + 2 paid leave = 4 x 800 = 3200; 3h OT at 100/h x 1.25 = 375.
    expect(row).toMatchObject({ dailyRate: 800, daysWorked: 2, hoursWorked: 16, paidLeaveDays: 2, overtimeHours: 3, suggestedGross: 3575, missingRate: false });
    // The manager's own overtime is still pending, so it is not counted.
    expect(r.body.rows.find(x => x.name === 'toManager')).toBeUndefined();
    // Only the part of a leave inside the period counts.
    const half = await as(tok.boss, 'get', '/api/payroll/timesheet?start=2026-03-03&end=2026-03-03');
    expect(half.body.rows.find(x => x.name === 'toCashier').paidLeaveDays).toBe(1);
  });
});
