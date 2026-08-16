// Shift scheduling (roster) - manager CRUD + publish, plus a staffer's
// own-only "my upcoming schedule" view and the permission boundary between
// them. Real Express app over HTTP against an in-memory replica set.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, adminTok, staffTok, staffId;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'schedAdmin', role: 'admin' });
  await makeUser({ name: 'schedStaff', role: 'staff' });
  adminTok = await loginStaff(app, 'schedAdmin');
  staffTok = await loginStaff(app, 'schedStaff');
  staffId = String((await mongoose.model('User').findOne({ name: 'schedStaff' }).lean())._id);
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('roster management (scheduling.manage)', () => {
  let shiftId;

  it('plain staff cannot create a scheduled shift (403)', async () => {
    const res = await auth('post', '/api/scheduling/shifts', staffTok).send({
      staffId, date: ymd(2), startTime: '09:00', endTime: '17:00',
    });
    expect(res.status).toBe(403);
  });

  it('admin creates a Draft shift', async () => {
    const res = await auth('post', '/api/scheduling/shifts', adminTok).send({
      staffId, date: ymd(2), startTime: '09:00', endTime: '17:00', role: 'Cashier',
    });
    expect(res.status).toBe(200);
    expect(res.body.shift.status).toBe('Draft');
    expect(res.body.shift.staffName).toBe('schedStaff');
    shiftId = res.body.shift._id;
  });

  it('rejects an end time not after the start time', async () => {
    const res = await auth('post', '/api/scheduling/shifts', adminTok).send({
      staffId, date: ymd(2), startTime: '17:00', endTime: '09:00',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed time', async () => {
    const res = await auth('post', '/api/scheduling/shifts', adminTok).send({
      staffId, date: ymd(2), startTime: '9am', endTime: '17:00',
    });
    expect(res.status).toBe(400);
  });

  it('a Draft shift is NOT visible in the staffer\'s own schedule yet', async () => {
    const res = await auth('get', '/api/scheduling/my-schedule', staffTok);
    expect(res.status).toBe(200);
    expect(res.body.shifts.find((s) => s._id === shiftId)).toBeUndefined();
  });

  it('publishing the date range flips the Draft to Published', async () => {
    const res = await auth('post', '/api/scheduling/publish', adminTok).send({ from: ymd(0), to: ymd(7) });
    expect(res.status).toBe(200);
    expect(res.body.published).toBeGreaterThanOrEqual(1);
  });

  it('the staffer now sees their own published upcoming shift', async () => {
    const res = await auth('get', '/api/scheduling/my-schedule', staffTok);
    expect(res.status).toBe(200);
    const mine = res.body.shifts.find((s) => s._id === shiftId);
    expect(mine).toBeTruthy();
    expect(mine.role).toBe('Cashier');
  });

  it('a different staffer does NOT see someone else\'s shift', async () => {
    await makeUser({ name: 'otherStaff', role: 'staff' });
    const otherTok = await loginStaff(app, 'otherStaff');
    const res = await auth('get', '/api/scheduling/my-schedule', otherTok);
    expect(res.status).toBe(200);
    expect(res.body.shifts.find((s) => s._id === shiftId)).toBeUndefined();
  });

  it('a past published shift is excluded from my-schedule (today onward only)', async () => {
    const past = await auth('post', '/api/scheduling/shifts', adminTok).send({
      staffId, date: ymd(-3), startTime: '09:00', endTime: '17:00', status: 'Published',
    });
    expect(past.status).toBe(200);
    const res = await auth('get', '/api/scheduling/my-schedule', staffTok);
    expect(res.body.shifts.find((s) => s._id === past.body.shift._id)).toBeUndefined();
  });

  it('admin can delete a shift', async () => {
    const res = await auth('delete', `/api/scheduling/shifts/${shiftId}`, adminTok);
    expect(res.status).toBe(200);
    const gone = await auth('get', '/api/scheduling/my-schedule', staffTok);
    expect(gone.body.shifts.find((s) => s._id === shiftId)).toBeUndefined();
  });
});
