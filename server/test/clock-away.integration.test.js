// A clocked-in screen pings the server; when the pings stop for 15 minutes
// (power cut, tablet off) the person is clocked out at the last ping.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, ownerTok, anaTok, benTok;
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const Clock = () => mongoose.model('ClockEntry');

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Owner', role: 'superadmin' });
  await makeUser({ name: 'Ana', role: 'Staff' });
  await makeUser({ name: 'Ben', role: 'Staff' });
  ownerTok = await loginStaff(app, 'Owner');
  anaTok = await loginStaff(app, 'Ana');
  benTok = await loginStaff(app, 'Ben');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('away from the clock', () => {
  it('clocks out someone not seen for 15 minutes, at the last ping, and leaves the others', async () => {
    expect((await as(anaTok)('post', '/api/clock/in').send({})).body.success).toBe(true);
    expect((await as(benTok)('post', '/api/clock/in').send({})).body.success).toBe(true);
    expect((await as(benTok)('post', '/api/clock/heartbeat').send({})).body.isClockedIn).toBe(true);
    const lastSeen = new Date(Date.now() - 20 * 60000);
    await Clock().updateOne({ staffName: 'Ana' }, { $set: { clockIn: new Date(Date.now() - 3 * 3600000), lastSeenAt: lastSeen } });

    const res = await as(ownerTok)('post', '/api/clock/sweep').send({});
    expect(res.body.closed).toBe(1);
    const ana = await Clock().findOne({ staffName: 'Ana' }).lean();
    expect(ana.autoClockedOut).toBe(true);
    expect(new Date(ana.clockOut).getTime()).toBe(lastSeen.getTime());
    expect(ana.durationMinutes).toBe(160);
    const ben = await Clock().findOne({ staffName: 'Ben' }).lean();
    expect(ben.clockOut).toBeUndefined();
  });

  it('each person clocks in as themselves', async () => {
    const st = await as(benTok)('get', '/api/clock/status');
    expect(st.body.entry.staffName).toBe('Ben');
  });
});
