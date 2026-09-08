// Fixed assets: acquire, depreciate, dispose - each posting a balanced entry,
// so the register is a view of the ledger rather than a parallel list kept by
// hand.
//
// 140000 Fixed Assets and 150000 Accumulated Depreciation were headers with no
// children, so equipment could not be recorded at all and the balance sheet
// understated what the business owned by the whole cost of its fit-out.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'AssetSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'AssetSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
beforeEach(async () => {
  await M('FixedAsset').deleteMany({});
  await M('JournalEntry').deleteMany({});
});

const jeFor = (ref) => M('JournalEntry').findOne({ reference: ref }).lean();
const line = (je, code) => je.lines.find(l => l.accountCode === code);
const balances = (je) => expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);

// P60,000 espresso machine, 5 years, P6,000 salvage = P900/month.
const acquire = (over = {}) => auth('post', '/api/fixed-assets').send({
  name: 'Espresso Machine', accountCode: '140200',
  acquisitionCost: 60000, salvageValue: 6000, usefulLifeMonths: 60,
  acquisitionDate: '2026-01-15', paidFromAccount: '111000', ...over,
});

describe('acquiring an asset', () => {
  it('debits the asset class and credits what paid for it', async () => {
    const res = await acquire();
    expect(res.status).toBe(200);
    expect(res.body.asset.assetCode).toMatch(/^FA-/);

    const je = await jeFor(res.body.asset.journalEntryRef);
    expect(line(je, '140200').debit).toBe(60000);
    expect(line(je, '111000').credit).toBe(60000);
    balances(je);
  });

  it('credits payables when bought on account', async () => {
    const res = await acquire({ onAccount: true });
    const je = await jeFor(res.body.asset.journalEntryRef);
    expect(line(je, '220000').credit).toBe(60000);
  });

  it('reports the derived figures so the client need not recompute them', async () => {
    const { body } = await acquire();
    expect(body.asset.netBookValue).toBe(60000);
    expect(body.asset.depreciableBase).toBe(54000);
    expect(body.asset.monthlyDepreciation).toBe(900);
  });

  it('refuses an unknown class, a bad life, and salvage above cost', async () => {
    expect((await acquire({ accountCode: '999999' })).status).toBe(400);
    expect((await acquire({ usefulLifeMonths: 0 })).status).toBe(400);
    expect((await acquire({ salvageValue: 99999 })).status).toBe(400);
    expect((await acquire({ acquisitionCost: 0 })).status).toBe(400);
  });
});

describe('depreciating', () => {
  it('charges expense against accumulated depreciation, not the asset itself', async () => {
    const { body } = await acquire();
    const res = await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2026-04-15' });
    expect(res.status).toBe(200);
    expect(res.body.months).toBe(3);
    expect(res.body.posted).toBe(2700);

    const je = await M('JournalEntry').findOne({ reference: /^FA-DEP/ }).lean();
    expect(line(je, '690000').debit).toBe(2700);
    // The contra account, NOT 140200 - gross cost stays visible.
    expect(line(je, '150200').credit).toBe(2700);
    expect(line(je, '140200')).toBeUndefined();
    balances(je);
  });

  it('refuses when no whole month has passed yet', async () => {
    const { body } = await acquire();
    const res = await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2026-01-31' });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/whole months/i);
  });

  it('never writes the asset below its salvage value', async () => {
    // Far past the end of its life - the charge must stop at the floor.
    const { body } = await acquire();
    const res = await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2040-01-15' });
    expect(res.body.posted).toBe(54000);
    expect(res.body.capped).toBe(true);
    expect(res.body.asset.netBookValue).toBe(6000);
    expect(res.body.asset.status).toBe('Fully Depreciated');
  });

  it('charges nothing more once fully depreciated', async () => {
    const { body } = await acquire();
    await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2040-01-15' });
    const again = await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2041-01-15' });
    expect(again.status).toBe(409);
    // The symptom this prevents: a written-off machine quietly reducing profit forever.
    const fresh = await M('FixedAsset').findById(body.asset._id).lean();
    expect(fresh.accumulatedDepreciation).toBe(54000);
  });

  it('runs every due asset in one month-end pass', async () => {
    await acquire();
    await acquire({ name: 'Chiller', accountCode: '140200', acquisitionCost: 24000, salvageValue: 0, usefulLifeMonths: 24 });

    const res = await auth('post', '/api/fixed-assets/run-depreciation').send({ asOf: '2026-03-15' });
    expect(res.status).toBe(200);
    expect(res.body.posted).toBe(2);
    // 900x2 + 1000x2
    expect(res.body.totalAmount).toBeCloseTo(3800, 2);
  });

  it('records each posting so a charge can be traced to its entry', async () => {
    const { body } = await acquire();
    await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2026-03-15' });
    const fresh = await M('FixedAsset').findById(body.asset._id).lean();
    expect(fresh.depreciationHistory).toHaveLength(1);
    expect(fresh.depreciationHistory[0].journalRef).toMatch(/^FA-DEP/);
  });
});

describe('disposing', () => {
  it('books a gain when it sells for more than it is carried at', async () => {
    const { body } = await acquire();
    await auth('post', `/api/fixed-assets/${body.asset._id}/depreciate`).send({ asOf: '2028-07-15' }); // 30 months
    const nbv = (await M('FixedAsset').findById(body.asset._id).lean());
    const carrying = nbv.acquisitionCost - nbv.accumulatedDepreciation;

    const res = await auth('post', `/api/fixed-assets/${body.asset._id}/dispose`).send({ proceeds: carrying + 5000 });
    expect(res.status).toBe(200);
    expect(res.body.gain).toBeCloseTo(5000, 2);

    const je = await jeFor(res.body.reference);
    expect(line(je, '820000').credit).toBeCloseTo(5000, 2);
    // Both the asset AND its contra must leave the books.
    expect(line(je, '140200').credit).toBe(60000);
    expect(line(je, '150200').debit).toBeCloseTo(nbv.accumulatedDepreciation, 2);
    balances(je);
  });

  it('books a loss when scrapped for nothing', async () => {
    const { body } = await acquire();
    const res = await auth('post', `/api/fixed-assets/${body.asset._id}/dispose`).send({ proceeds: 0, note: 'Scrapped' });
    expect(res.body.loss).toBe(60000);
    const je = await jeFor(res.body.reference);
    expect(line(je, '920000').debit).toBe(60000);
    balances(je);
  });

  it('cannot be disposed of twice', async () => {
    const { body } = await acquire();
    await auth('post', `/api/fixed-assets/${body.asset._id}/dispose`).send({ proceeds: 100 });
    const again = await auth('post', `/api/fixed-assets/${body.asset._id}/dispose`).send({ proceeds: 100 });
    expect(again.status).toBe(409);
  });

  it('drops out of the totals once disposed', async () => {
    const { body } = await acquire();
    await auth('post', `/api/fixed-assets/${body.asset._id}/dispose`).send({ proceeds: 0 });
    const list = await auth('get', '/api/fixed-assets');
    // History, not something the business still owns.
    expect(list.body.totals.count).toBe(0);
    expect(list.body.totals.netBookValue).toBe(0);
  });
});

describe('the register', () => {
  it('totals cost, accumulated depreciation and net book value', async () => {
    await acquire();
    await acquire({ name: 'Grinder', acquisitionCost: 12000, salvageValue: 0, usefulLifeMonths: 24 });
    const res = await auth('get', '/api/fixed-assets');
    expect(res.body.totals.count).toBe(2);
    expect(res.body.totals.cost).toBe(72000);
    expect(res.body.totals.netBookValue).toBe(72000);
  });

  it('lists the available asset classes with their paired contra accounts', async () => {
    const res = await auth('get', '/api/fixed-assets/classes');
    const m = res.body.classes.find(c => c.code === '140200');
    expect(m.accumCode).toBe('150200');
  });
});

describe('importing a register', () => {
  it('accepts the class by name or by code, and posts each acquisition', async () => {
    const res = await auth('post', '/api/fixed-assets/import').send({
      rows: [
        { name: 'Chest Freezer', class: 'Machinery & Equipment', acquisitionCost: 30000, usefulLifeMonths: 60, acquisitionDate: '2026-02-01' },
        { name: 'Laptop', accountCode: '140300', acquisitionCost: 45000, usefulLifeMonths: 36, acquisitionDate: '2026-02-10' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(await M('JournalEntry').countDocuments({ reference: /^FA-ACQ/ })).toBe(2);
  });

  it('keeps depreciation already taken, so a part-worn asset is not carried in as new', async () => {
    const res = await auth('post', '/api/fixed-assets/import').send({
      rows: [{ name: 'Old Oven', class: 'Machinery & Equipment', acquisitionCost: 20000, usefulLifeMonths: 60, accumulatedDepreciation: 8000 }],
    });
    expect(res.body.created).toBe(1);
    const asset = await M('FixedAsset').findOne({ name: 'Old Oven' }).lean();
    expect(asset.accumulatedDepreciation).toBe(8000);
  });

  it('reports a bad row and imports the rest', async () => {
    const res = await auth('post', '/api/fixed-assets/import').send({
      rows: [
        { name: 'Good', class: 'Vehicles', acquisitionCost: 100000, usefulLifeMonths: 60 },
        { name: 'Bad class', class: 'Spaceship', acquisitionCost: 1000, usefulLifeMonths: 12 },
        { name: 'No cost', class: 'Vehicles', acquisitionCost: 0, usefulLifeMonths: 12 },
      ],
    });
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toHaveLength(2);
    expect(res.body.skipped[0].error).toMatch(/unknown asset class/i);
  });
});

describe('export and template', () => {
  it('exports the register with its derived net book value', async () => {
    await acquire();
    const res = await auth('get', '/api/export/fixedAssets');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toContain('Espresso Machine');
    expect(res.body.rows[0]).toContain(60000);
  });

  it('offers a template asking for what has to be typed in', async () => {
    const t = await auth('get', '/api/export/fixedAssets?template=1');
    const d = await auth('get', '/api/export/fixedAssets');

    // The export reports what the asset is worth now; the template asks what
    // it cost and how long it lasts. Handing someone the export columns
    // invites them to fill in a net book value nobody reads, and leaves out
    // the useful life, without which nothing can be depreciated.
    expect(d.body.columns).toContain('Net Book Value');
    expect(t.body.columns).not.toContain('Net Book Value');
    expect(t.body.columns).toContain('usefulLifeMonths');
    expect(t.body.fields.find(f => f.name === 'usefulLifeMonths').required).toBe(true);
  });

  it('tells the template which classes are accepted', async () => {
    const vv = await auth('get', '/api/export/valid-values');
    const cls = vv.body.table.find(t => t.dataset === 'fixedAssets' && t.column === 'Class');
    expect(cls.values.some(v => v.includes('140200'))).toBe(true);
    expect(cls.note).toMatch(/code|name/i);
  });
});

// Everything the Fixed Assets screen reads. These are not extra assertions on
// the arithmetic - that is covered above and in depreciation.test.js - they
// pin the SHAPE of the responses. Rename `className` or drop `due` and the
// register still returns 200 while the screen quietly shows blank columns.
describe('what the screen reads off these responses', () => {
  it('names every asset class with its paired contra account', async () => {
    const res = await auth('get', '/api/fixed-assets/classes');
    expect(res.status).toBe(200);
    const eq = res.body.classes.find(c => c.code === '140200');
    expect(eq).toMatchObject({ code: '140200', name: 'Machinery & Equipment', accumCode: '150200' });
    expect(eq.accumName).toBeTruthy();   // the picker shows it, so it must exist
  });

  it('decorates each row with the figures the table shows', async () => {
    await acquire();
    const { body } = await auth('get', '/api/fixed-assets');
    const a = body.assets[0];
    expect(a.className).toBe('Machinery & Equipment');
    expect(a.netBookValue).toBe(60000);
    expect(a.monthlyDepreciation).toBe(900);
    expect(a.depreciableBase).toBe(54000);
    expect(a.status).toBe('Active');
    // The "Depreciate" button only appears when something is owed, so the row
    // has to say how much and over how many months.
    expect(a.due).toMatchObject({ months: expect.any(Number), amount: expect.any(Number) });
  });

  it('reports what is owed across the register, for the month-end banner', async () => {
    await acquire();
    const { body } = await auth('get', '/api/fixed-assets');
    expect(body.totals).toMatchObject({
      count: 1, cost: 60000, accumulatedDepreciation: 0, netBookValue: 60000,
      dueNow: expect.any(Number),
    });
  });

  it('returns a forward schedule for the expanded row', async () => {
    const { body: created } = await acquire();
    const { body } = await auth('get', `/api/fixed-assets/${created.asset._id}`);
    expect(body.schedule.length).toBeGreaterThan(0);
    expect(body.schedule[0]).toMatchObject({
      period: 1, charge: 900, accumulated: 900, netBookValue: 59100,
    });
    // It stops at the salvage floor rather than running to zero.
    const last = body.schedule[body.schedule.length - 1];
    expect(last.netBookValue).toBeGreaterThanOrEqual(6000);
  });

  it('filters by status and class, which is what the two pickers send', async () => {
    await acquire();
    await acquire({ name: 'Delivery Van', accountCode: '140400', acquisitionCost: 500000, salvageValue: 0 });

    const byClass = await auth('get', '/api/fixed-assets?accountCode=140400');
    expect(byClass.body.assets).toHaveLength(1);
    expect(byClass.body.assets[0].name).toBe('Delivery Van');

    const byStatus = await auth('get', '/api/fixed-assets?status=Disposed');
    expect(byStatus.body.assets).toHaveLength(0);
  });

  it('reports the rows it could not import, so the screen can list them', async () => {
    const res = await auth('post', '/api/fixed-assets/import').send({
      rows: [
        { name: 'Chest Freezer', class: 'Machinery & Equipment', acquisitionCost: 25000, usefulLifeMonths: 60 },
        { name: 'Nonsense', class: 'Not A Class', acquisitionCost: 1000, usefulLifeMonths: 12 },
      ],
    });
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toHaveLength(1);
    // Row number and reason both shown to whoever filled the sheet in.
    expect(res.body.skipped[0].row).toBe(2);
    expect(res.body.skipped[0].error).toMatch(/class/i);
  });
});
