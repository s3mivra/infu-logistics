// Opening balances: carrying an existing business's balance sheet into the
// books so day-to-day posting means something. Each account is given its
// NATURAL balance as a positive number and the entry is assembled server-side,
// with whatever does not balance plugged to Owner's Capital.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'OpenSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'OpenSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

// Opening balances are once-per-business, so each test starts from a clean slate.
async function clearOpenings() {
  await mongoose.model('JournalEntry').deleteMany({ reference: /^OPEN-/ });
}
const post = (body) => auth('post', '/api/finance/opening-balances', superTok).send(body);
const lineFor = (e, code) => e.lines.find(l => l.accountCode === code);

describe('posting opening balances', () => {
  it('carries assets as debits and liabilities as credits, plugging equity', async () => {
    await clearOpenings();
    const res = await post({
      lines: [
        { accountCode: '111000', amount: 50000 },  // cash (asset)
        { accountCode: '130000', amount: 20000 },  // inventory (asset)
        { accountCode: '220000', amount: 30000 },  // payables (liability)
      ],
      note: 'Carried in from prior books',
    });
    expect(res.status).toBe(200);
    const e = res.body.entry;
    expect(lineFor(e, '111000').debit).toBe(50000);
    expect(lineFor(e, '130000').debit).toBe(20000);
    expect(lineFor(e, '220000').credit).toBe(30000);
    // 70,000 assets - 30,000 liabilities = 40,000 owner's stake.
    expect(lineFor(e, '310000').credit).toBe(40000);
    expect(res.body.balancingEntry).toBe(40000);
    expect(e.totalDebit).toBeCloseTo(e.totalCredit, 2);
    expect(e.description).toMatch(/Carried in from prior books/);
  });

  it('needs no plug when the sheet already balances', async () => {
    await clearOpenings();
    const res = await post({ lines: [{ accountCode: '111000', amount: 5000 }, { accountCode: '220000', amount: 5000 }] });
    expect(res.body.balancingEntry).toBe(0);
    expect(lineFor(res.body.entry, '310000')).toBeUndefined();
  });

  it('flips the side on a negative amount, for contra balances', async () => {
    await clearOpenings();
    // Accumulated depreciation is an asset code carrying a credit balance.
    const res = await post({ lines: [{ accountCode: '111000', amount: 10000 }, { accountCode: '150000', amount: -4000 }] });
    expect(res.status).toBe(200);
    expect(lineFor(res.body.entry, '150000').credit).toBe(4000);
    expect(lineFor(res.body.entry, '150000').debit).toBe(0);
  });

  it('refuses P&L accounts - results belong in equity, not this period', async () => {
    await clearOpenings();
    const res = await post({ lines: [{ accountCode: '410000', amount: 1000 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/balance sheet only/i);
  });

  it('refuses an unknown account code', async () => {
    await clearOpenings();
    const res = await post({ lines: [{ accountCode: '999999', amount: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown account/i);
  });

  it('ignores zero rows but refuses an entry that is entirely zero', async () => {
    await clearOpenings();
    const mixed = await post({ lines: [{ accountCode: '111000', amount: 100 }, { accountCode: '130000', amount: 0 }] });
    expect(mixed.status).toBe(200);
    expect(lineFor(mixed.body.entry, '130000')).toBeUndefined();

    await clearOpenings();
    const empty = await post({ lines: [{ accountCode: '111000', amount: 0 }] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/nothing to carry/i);
  });

  it('requires at least one line', async () => {
    await clearOpenings();
    expect((await post({ lines: [] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});

describe('guarding against double-posting', () => {
  it('refuses a second set, since it would double every carried-in balance', async () => {
    await clearOpenings();
    expect((await post({ lines: [{ accountCode: '111000', amount: 1000 }] })).status).toBe(200);

    const second = await post({ lines: [{ accountCode: '111000', amount: 1000 }] });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already posted/i);
  });

  it('allows an explicit override with force', async () => {
    await clearOpenings();
    await post({ lines: [{ accountCode: '111000', amount: 1000 }] });
    const forced = await post({ lines: [{ accountCode: '111000', amount: 1000 }], force: true });
    expect(forced.status).toBe(200);
  });
});

describe('reading back opening balances', () => {
  it('returns null before anything is posted, then the entry', async () => {
    await clearOpenings();
    const before = await auth('get', '/api/finance/opening-balances', superTok);
    expect(before.body.entry).toBeNull();

    await post({ lines: [{ accountCode: '111000', amount: 250 }] });
    const after = await auth('get', '/api/finance/opening-balances', superTok);
    expect(after.body.entry).toBeTruthy();
    expect(after.body.entry.reference).toMatch(/^OPEN-/);
  });
});
