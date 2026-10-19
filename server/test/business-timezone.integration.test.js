// The business's own clock, as a setting.
//
// Two notions of "a day" had grown up side by side: report ranges were cut in
// the SERVER's local time, while daily grouping, the EOD lock and the midnight
// close hardcoded Asia/Manila. On a server left on UTC they disagreed by eight
// hours, so a day's report and that same day's count covered different sales.
//
// One setting now drives both, and it can be changed without a redeploy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { businessDayStart, businessDayEnd, businessDateStr, businessClosingDateStr, businessTimeZone, setBusinessTimeZone } from '../lib/businessTime.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'TzSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'TzSuper');
}, 120000);

afterAll(async () => {
  setBusinessTimeZone('Asia/Manila');
  await ctx.stop();
});

describe('day boundaries follow the business, not the server', () => {
  it('cuts the day at local midnight in the configured zone', () => {
    setBusinessTimeZone('Asia/Manila');
    // Manila is UTC+8, so its day starts at 16:00 UTC the day before.
    expect(businessDayStart('2026-09-16').toISOString()).toBe('2026-09-15T16:00:00.000Z');
    expect(businessDayEnd('2026-09-16').toISOString()).toBe('2026-09-16T15:59:59.999Z');

    setBusinessTimeZone('UTC');
    expect(businessDayStart('2026-09-16').toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(businessDayEnd('2026-09-16').toISOString()).toBe('2026-09-16T23:59:59.999Z');
  });

  it('handles a zone that observes daylight saving on both sides of the change', () => {
    setBusinessTimeZone('America/Los_Angeles');
    expect(businessDayStart('2026-01-16').toISOString()).toBe('2026-01-16T08:00:00.000Z');  // PST
    expect(businessDayStart('2026-09-16').toISOString()).toBe('2026-09-16T07:00:00.000Z');  // PDT
    // The spring-forward day is 23 hours long, and the range still ends the
    // instant before the next day begins.
    const end = businessDayEnd('2026-03-08');
    expect(end.toISOString()).toBe('2026-03-09T06:59:59.999Z');
  });

  it('names the day a moment belongs to in the same zone', () => {
    setBusinessTimeZone('Asia/Manila');
    // 15:30 UTC is already the next day in Manila.
    expect(businessDateStr(new Date('2026-09-15T16:30:00Z'))).toBe('2026-09-16');
    setBusinessTimeZone('UTC');
    expect(businessDateStr(new Date('2026-09-15T16:30:00Z'))).toBe('2026-09-15');
  });
});

describe('the setting itself', () => {
  it('is applied to the running server the moment it is saved', async () => {
    const res = await auth('patch', '/api/settings/businessTimeZone').send({ value: 'Asia/Singapore' });
    expect(res.status).toBe(200);
    expect(res.body.timeZone).toBe('Asia/Singapore');
    expect(businessTimeZone()).toBe('Asia/Singapore');           // no restart needed
    expect(await mongoose.model('Settings').findOne({ key: 'businessTimeZone' }).lean())
      .toMatchObject({ value: 'Asia/Singapore' });
  }, 30000);

  it('refuses a zone it does not know, and leaves the old one in place', async () => {
    await auth('patch', '/api/settings/businessTimeZone').send({ value: 'Asia/Manila' });
    const bad = await auth('patch', '/api/settings/businessTimeZone').send({ value: 'Mars/Olympus_Mons' });
    expect(bad.status).toBe(400);
    expect(businessTimeZone()).toBe('Asia/Manila');
  }, 30000);

  it('reports run against the configured zone', async () => {
    await auth('patch', '/api/settings/businessTimeZone').send({ value: 'Asia/Manila' });
    const res = await auth('get', '/api/reports/vat?start=2026-09-16&end=2026-09-16');
    expect(res.status).toBe(200);
    // Whole Manila day, not the server's.
    expect(new Date(res.body.period.start).toISOString()).toBe('2026-09-15T16:00:00.000Z');
    expect(new Date(res.body.period.end).toISOString()).toBe('2026-09-16T15:59:59.999Z');
  }, 30000);
});

// The midnight auto-close fires just AFTER the business's own midnight, so
// "today" already names the new day by the time it runs. Sealing the register
// under that date would lock a day nobody has traded yet and leave the day just
// closed unlocked - which is exactly what the EOD count would then reopen on.
describe('the day the midnight close seals', () => {
  it('is the day that just ended, not the one just starting', () => {
    setBusinessTimeZone('Asia/Manila');
    // 00:00:05 on 11 March, Manila time - five seconds into the new day.
    const justPastMidnight = new Date('2026-03-10T16:00:05.000Z');
    expect(businessDateStr(justPastMidnight)).toBe('2026-03-11');      // the new day
    expect(businessClosingDateStr(justPastMidnight)).toBe('2026-03-10'); // the one being closed
  });

  it("follows the business's own zone, not the server's", () => {
    // Five seconds past midnight UTC - but already 08:00 the same morning in
    // Manila, where the day that just closed is a different one entirely.
    const justPastUtcMidnight = new Date('2026-03-11T00:00:05.000Z');
    setBusinessTimeZone('UTC');
    expect(businessClosingDateStr(justPastUtcMidnight)).toBe('2026-03-10');
    setBusinessTimeZone('Asia/Manila');
    expect(businessClosingDateStr(justPastUtcMidnight)).toBe('2026-03-11');
  });

  it('still names the closing day an hour into it', () => {
    setBusinessTimeZone('Asia/Manila');
    // 00:59 - the close has been delayed, but the day it seals is unchanged.
    expect(businessClosingDateStr(new Date('2026-03-10T16:59:00.000Z'))).toBe('2026-03-10');
  });
});
