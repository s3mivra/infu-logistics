// Cash paid out of the till has to leave the books when it leaves the drawer.
//
// A pay-out used to record the movement and nothing else, on the assumption
// that somebody would file the expense afterwards. If nobody did, book cash
// stayed higher than the money in the till and the shift count never showed it
// (the pay-out is already part of what the drawer is expected to hold).
//
// A pay-out that names what it was spent on now files that expense at once.
// One that does not - a safe drop, a change fund - is left marked unfiled and
// is reported when the drawer is closed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const cashBalance = async () => {
  const entries = await M('JournalEntry').find({ 'lines.accountCode': '111000' }).lean();
  return entries.reduce((sum, je) => sum + je.lines
    .filter(l => l.accountCode === '111000')
    .reduce((t, l) => t + (l.debit || 0) - (l.credit || 0), 0), 0);
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'DrawerSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'DrawerSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('Shift').deleteMany({});
  await M('JournalEntry').deleteMany({});
  await auth('post', '/api/shifts/start').send({ startingCash: 2000 });
});

describe('cash paid out of the till', () => {
  it('files the expense when it says what it was spent on', async () => {
    const res = await auth('post', '/api/shifts/movement')
      .send({ type: 'out', amount: 350, reason: 'Milk run', expenseAccount: '610000' });
    expect(res.status).toBe(200);
    expect(res.body.journalRef).toMatch(/EXP/);

    const je = await M('JournalEntry').findOne({ reference: res.body.journalRef }).lean();
    expect(je.lines.find(l => l.accountCode === '610000').debit).toBe(350);
    expect(je.lines.find(l => l.accountCode === '111000').credit).toBe(350);
    expect(await cashBalance()).toBe(-350);

    const move = (await M('Shift').findOne({ status: 'Open' }).lean()).movements.at(-1);
    expect(move.filed).toBe(true);
    expect(move.expenseAccount).toBe('610000');
  }, 30000);

  it('refuses an account that is not an expense category', async () => {
    const res = await auth('post', '/api/shifts/movement')
      .send({ type: 'out', amount: 100, reason: 'Nope', expenseAccount: '111000' });
    expect(res.status).toBe(400);
    expect(await M('Shift').findOne({ status: 'Open' }).lean()).toMatchObject({ movements: [] });
  }, 30000);

  it('leaves moved cash unfiled and reports it at close', async () => {
    await auth('post', '/api/shifts/movement').send({ type: 'out', amount: 500, reason: 'Safe drop' });
    const move = (await M('Shift').findOne({ status: 'Open' }).lean()).movements.at(-1);
    expect(move.filed).toBe(false);
    expect(await cashBalance()).toBe(0);   // nothing posted - the deposit will

    // Expected = 2000 float - 500 dropped; counting that exactly means no variance.
    const close = await auth('post', '/api/shifts/end').send({ actualCash: 1500 });
    expect(close.body.success).toBe(true);
    expect(close.body.unfiledPayOuts).toHaveLength(1);
    expect(close.body.unfiledPayOuts[0]).toMatchObject({ amount: 500, reason: 'Safe drop' });
  }, 30000);

  it('reports nothing when every pay-out filed its expense', async () => {
    await auth('post', '/api/shifts/movement').send({ type: 'out', amount: 200, reason: 'Ice', expenseAccount: '610000' });
    await auth('post', '/api/shifts/movement').send({ type: 'in', amount: 100, reason: 'Change fund back' });
    const close = await auth('post', '/api/shifts/end').send({ actualCash: 1900 });
    expect(close.body.unfiledPayOuts).toEqual([]);
  }, 30000);
});
