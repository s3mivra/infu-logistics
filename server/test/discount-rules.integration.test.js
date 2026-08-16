// Discount rule engine - configurable conditional rules + evaluation. Tests
// the conditions (min-subtotal, day-of-week, date window, segment) and the
// "best single rule wins" selection. Does NOT test order money-path
// application - this feature deliberately only recommends a percent.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, clientId;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const todayDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).getDay();

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'drSuper', role: 'superadmin' });
  await makeUser({ name: 'drStaff', role: 'staff' });
  superTok = await loginStaff(app, 'drSuper');
  staffTok = await loginStaff(app, 'drStaff');
  const client = await mongoose.model('ClientAccount').create({
    clientCode: 'CUS-DR-1', username: 'wholesaleco', password: 'x', name: 'Wholesale Co', segments: ['wholesale'],
  });
  clientId = String(client._id);
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('discount rules', () => {
  it('plain staff cannot create a rule (settings.manage) but CAN evaluate', async () => {
    const create = await auth('post', '/api/discount-rules', staffTok).send({ name: 'x', percent: 10 });
    expect(create.status).toBe(403);
    const evalRes = await auth('post', '/api/discount-rules/evaluate', staffTok).send({ subtotal: 100 });
    expect(evalRes.status).toBe(200);
  });

  it('a min-subtotal rule only applies above the threshold', async () => {
    await auth('post', '/api/discount-rules', superTok).send({ name: 'Spend 1000 get 10', percent: 10, minSubtotal: 1000 });
    const below = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 500 });
    expect(below.body.bestPercent).toBe(0);
    const above = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 1500 });
    expect(above.body.bestPercent).toBe(10);
  });

  it('best (highest percent) rule wins when several apply', async () => {
    await auth('post', '/api/discount-rules', superTok).send({ name: 'Spend 1000 get 20', percent: 20, minSubtotal: 1000 });
    const res = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 1500 });
    expect(res.body.bestPercent).toBe(20);
    expect(res.body.applicable.length).toBeGreaterThanOrEqual(2); // both the 10 and 20 match
  });

  it('a day-of-week rule only applies on its day', async () => {
    const otherDay = (todayDow + 1) % 7;
    await auth('post', '/api/discount-rules', superTok).send({ name: 'Wrong day', percent: 50, daysOfWeek: [otherDay] });
    const res = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 100 });
    // The 50% rule is scoped to a different weekday, so it must not win.
    expect(res.body.bestPercent).not.toBe(50);
    await auth('post', '/api/discount-rules', superTok).send({ name: 'Right day', percent: 55, daysOfWeek: [todayDow] });
    const res2 = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 100 });
    expect(res2.body.bestPercent).toBe(55);
  });

  it('a segment rule applies only to a client carrying that segment', async () => {
    await auth('post', '/api/discount-rules', superTok).send({ name: 'Wholesale 5', percent: 5, segment: 'wholesale' });
    const anon = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 10 });
    expect(anon.body.applicable.find((r) => r.name === 'Wholesale 5')).toBeUndefined();
    const wholesale = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 10, clientId });
    expect(wholesale.body.applicable.find((r) => r.name === 'Wholesale 5')).toBeTruthy();
  });

  it('an inactive rule never applies', async () => {
    const created = await auth('post', '/api/discount-rules', superTok).send({ name: 'Huge but off', percent: 90, active: false });
    const res = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 100000 });
    expect(res.body.bestPercent).not.toBe(90);
    // Activating it makes it win.
    await auth('patch', `/api/discount-rules/${created.body.rule._id}`, superTok).send({ active: true });
    const res2 = await auth('post', '/api/discount-rules/evaluate', superTok).send({ subtotal: 100000 });
    expect(res2.body.bestPercent).toBe(90);
  });

  it('rejects an end date before the start date', async () => {
    const res = await auth('post', '/api/discount-rules', superTok).send({
      name: 'Bad window', percent: 10, startDate: '2026-12-01', endDate: '2026-11-01',
    });
    expect(res.status).toBe(400);
  });
});
