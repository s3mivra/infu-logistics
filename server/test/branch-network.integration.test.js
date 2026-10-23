// Multi-branch: transfers between two branches, consolidated reports and the
// shared catalog - checked against TWO real branch databases.
//
// Branch A is the app under test, on its own database. Branch B is a second
// database on the same replica set, driven through lib/branchNetwork.js (the
// same code B's own app would run) and reachable from A over HTTP through a
// small stand-in server that mounts B's internal hub routes. So every call A
// makes to "the other branch" really crosses a network boundary, and every
// assertion about "both sides" reads two separate sets of books.
//
// Pinned here:
//   1. a transfer goes request -> approve -> ship -> receive, and each side's
//      copy follows the other's;
//   2. shipping is atomic: one short line rolls back the whole shipment;
//   3. every step is idempotent - repeated, concurrent or replayed;
//   4. both ledgers balance, and inter-branch clearing nets to zero across
//      the two branches once the goods arrive;
//   5. the consolidated report adds the branches up and keeps the breakdown;
//   6. catalog sync creates and updates products, and a branch's own price
//      survives a re-sync.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import express from 'express';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { ACCOUNTS } from '../lib/chartOfAccounts.js';
import {
  defineBranchModels, createTransfer, receiveTransfer, applyPartnerState, syncPayload,
  applyCatalog, setPriceOverride, branchReport,
} from '../lib/branchNetwork.js';

const A_SLUG = 'unknown';          // the harness URI has no semivra_<slug> in it
const B_SLUG = 'branch-b';
const TOKEN_AB = 'link-token-a-b-0123456789';
const acctMeta = (code) => ACCOUNTS[code] || null;

let app, stop, tok, server, envB;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const A = (name) => mongoose.model(name);

// Branch B's own books, in its own database.
function branchB() {
  const conn = mongoose.connection.useDb('semivra_branch_b', { useCache: true });
  const reg = (name) => conn.models[name] || conn.model(name, mongoose.model(name).schema);
  const models = {
    Inventory: reg('Inventory'), StockCard: reg('StockCard'), JournalEntry: reg('JournalEntry'),
    Order: reg('Order'), Product: reg('Product'),
    ...defineBranchModels(conn),
  };
  return { conn, businessType: 'log', self: B_SLUG, models };
}

// What branch B's API would answer when A calls it.
function startBranchBServer() {
  const b = express();
  b.use(express.json());
  b.use((req, res, next) => (req.get('x-link-token') === TOKEN_AB ? next() : res.status(403).json({ error: 'Invalid link token.' })));
  b.post('/api/hub/internal/branch-transfer', async (req, res) => {
    try { const out = await applyPartnerState(envB, A_SLUG, req.body); res.json({ ok: true, status: out.doc?.status }); }
    catch (err) { res.status(err.httpStatus || 500).json({ error: err.message }); }
  });
  b.get('/api/hub/internal/branch-report', async (req, res) => {
    const start = new Date(`${req.query.start}T00:00:00`); const end = new Date(`${req.query.end}T23:59:59.999`);
    res.json({ tenant: B_SLUG, branchCode: 'AC-B001', ...(await branchReport(envB, { start, end }, acctMeta)) });
  });
  return new Promise((resolve) => { const s = b.listen(0, '127.0.0.1', () => resolve(s)); });
}

// B tells A about its copy, exactly as B's push would.
const pushBtoA = (doc) => request(app).post('/api/hub/internal/branch-transfer').set('x-link-token', TOKEN_AB).send(syncPayload(doc));

const ledger = async (JE) => {
  const rows = await JE.aggregate([{ $unwind: '$lines' }, { $group: { _id: '$lines.accountCode', d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } }]);
  const by = Object.fromEntries(rows.map(r => [r._id, +(r.d - r.c).toFixed(2)]));
  const totals = rows.reduce((t, r) => ({ d: t.d + r.d, c: t.c + r.c }), { d: 0, c: 0 });
  return { by, balanced: Math.abs(totals.d - totals.c) < 0.005 };
};
const stockValue = async (Inv) => (await Inv.find({ businessType: 'log' }).lean()).reduce((t, i) => t + i.stockQty * (i.unitCost || 0), 0);

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'branch-network-test-secret-0123456789' }));
  await makeUser({ name: 'NetOwner', role: 'superadmin' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  tok = await loginStaff(app, 'NetOwner');

  envB = branchB();
  server = await startBranchBServer();
  await A('LinkedBusiness').create({
    businessType: 'log', role: 'hub', partnerSlug: B_SLUG, partnerName: 'Branch B',
    partnerUrl: `http://127.0.0.1:${server.address().port}`, linkToken: TOKEN_AB, status: 'active',
  });
}, 120000);

afterAll(async () => { server?.close(); await stop?.(); });

describe('a stock transfer from A to B', () => {
  let flour, sugar, ref;

  beforeAll(async () => {
    flour = await A('Inventory').create({ businessType: 'log', itemName: 'Flour', itemCode: 'FLR-1', unit: 'kg', stockQty: 100, unitCost: 40 });
    sugar = await A('Inventory').create({ businessType: 'log', itemName: 'Sugar', itemCode: 'SGR-1', unit: 'kg', stockQty: 5, unitCost: 60 });
  });

  it('is filed on A and appears on B as a request', async () => {
    const r = await auth('post', '/api/hub/branch-transfers').send({
      partnerSlug: B_SLUG, direction: 'send',
      items: [{ itemId: flour._id, qty: 30 }, { itemId: sugar._id, qty: 10 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warning).toBeUndefined();
    expect(r.body.transfer.partnerSync).toBe(false);
    ref = r.body.transfer.transferRef;
    const onB = await envB.models.BranchTransfer.findOne({ transferRef: ref }).lean();
    expect(onB).toMatchObject({ role: 'receiver', status: 'Requested', fromSlug: A_SLUG, toSlug: B_SLUG });
    expect(onB.lines.map(l => l.itemId)).toEqual([null, null]);   // A's item ids stay on A
  });

  it('cannot ship before approval', async () => {
    const r = await auth('post', `/api/hub/branch-transfers/${ref}/ship`);
    expect(r.status).toBe(409);
  });

  it('is approved on A, and B follows', async () => {
    const r = await auth('post', `/api/hub/branch-transfers/${ref}/approve`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await envB.models.BranchTransfer.findOne({ transferRef: ref })).status).toBe('Approved');
  });

  it('rolls the WHOLE shipment back when one line is short', async () => {
    const r = await auth('post', `/api/hub/branch-transfers/${ref}/ship`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Not enough Sugar/);
    // Flour was taken off first, inside the same transaction - and put back.
    expect((await A('Inventory').findById(flour._id)).stockQty).toBe(100);
    expect(await A('StockCard').countDocuments({ reference: ref })).toBe(0);
    expect(await A('JournalEntry').countDocuments({ reference: `${ref}-SHIP` })).toBe(0);
    expect((await A('BranchTransfer').findOne({ transferRef: ref })).status).toBe('Approved');
    expect((await envB.models.BranchTransfer.findOne({ transferRef: ref })).status).toBe('Approved');
  });

  it('ships once stock is there - once, however many times it is asked', async () => {
    await A('Inventory').updateOne({ _id: sugar._id }, { $set: { stockQty: 20 } });
    const results = await Promise.all([1, 2, 3].map(() => auth('post', `/api/hub/branch-transfers/${ref}/ship`)));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await A('JournalEntry').countDocuments({ reference: `${ref}-SHIP` })).toBe(1);
    expect((await A('Inventory').findById(flour._id)).stockQty).toBe(70);
    expect((await A('Inventory').findById(sugar._id)).stockQty).toBe(10);
    expect(await A('StockCard').countDocuments({ reference: ref, type: 'Transfer Out' })).toBe(2);

    const onB = await envB.models.BranchTransfer.findOne({ transferRef: ref }).lean();
    expect(onB.status).toBe('Shipped');
    expect(onB.totalValue).toBe(30 * 40 + 10 * 60);
  });

  it('is in transit: A has credited inventory, clearing holds the value', async () => {
    const a = await ledger(A('JournalEntry'));
    expect(a.balanced).toBe(true);
    expect(a.by['160200']).toBe(1800);
    expect(a.by['130000']).toBe(-1800);
  });

  it('is received on B at the value A shipped it at, and A follows', async () => {
    const before = await stockValue(A('Inventory'));
    const doc = await receiveTransfer(envB, ref, { by: 'B clerk' });
    const again = await receiveTransfer(envB, ref, { by: 'B clerk' });     // idempotent
    expect(again.status).toBe('Received');
    expect(await envB.models.JournalEntry.countDocuments({ reference: `${ref}-RECV` })).toBe(1);

    const flourB = await envB.models.Inventory.findOne({ itemCode: 'FLR-1' }).lean();
    expect(flourB).toMatchObject({ stockQty: 30, unitCost: 40 });
    expect(await stockValue(envB.models.Inventory)).toBe(1800);
    expect(await stockValue(A('Inventory'))).toBe(before);

    // B's push to A, delivered twice (a lost reply, then the sweep).
    expect((await pushBtoA(doc)).status).toBe(200);
    expect((await pushBtoA(doc)).status).toBe(200);
    expect((await A('BranchTransfer').findOne({ transferRef: ref })).status).toBe('Received');
  });

  it('leaves both ledgers balanced and inter-branch clearing at zero across them', async () => {
    const a = await ledger(A('JournalEntry'));
    const b = await ledger(envB.models.JournalEntry);
    expect(a.balanced).toBe(true);
    expect(b.balanced).toBe(true);
    expect(a.by['160200']).toBe(1800);
    expect(b.by['160200']).toBe(-1800);
    expect(a.by['160200'] + b.by['160200']).toBe(0);
    expect(a.by['130000'] + b.by['130000']).toBe(0);   // stock moved, the group's stock did not change
  });

  it('refuses a step the partner may not take', async () => {
    const forged = { ...syncPayload(await envB.models.BranchTransfer.findOne({ transferRef: ref })), status: 'Cancelled' };
    expect((await pushBtoA(forged)).status).toBe(409);
    const r = await request(app).post('/api/hub/internal/branch-transfer').set('x-link-token', 'wrong').send(forged);
    expect(r.status).toBe(403);
  });
});

describe('a transfer B asks A for', () => {
  let ref;

  it('names the goods by code; A ties them to its own item on approval', async () => {
    await A('Inventory').create({ businessType: 'log', itemName: 'Coffee Beans', itemCode: 'CB-9', unit: 'kg', stockQty: 50, unitCost: 300 });
    const asked = await createTransfer(envB, { partnerSlug: A_SLUG, direction: 'receive', items: [{ itemCode: 'CB-9', itemName: 'Coffee Beans', unit: 'kg', qty: 4 }], by: 'B mgr' });
    ref = asked.transferRef;
    expect((await pushBtoA(asked)).status).toBe(200);
    const onA = await A('BranchTransfer').findOne({ transferRef: ref }).lean();
    expect(onA).toMatchObject({ role: 'sender', status: 'Requested' });

    expect((await auth('post', `/api/hub/branch-transfers/${ref}/approve`)).status).toBe(200);
    expect((await auth('post', `/api/hub/branch-transfers/${ref}/ship`)).status).toBe(200);
    await receiveTransfer(envB, ref, {});
    const a = await ledger(A('JournalEntry'));
    const b = await ledger(envB.models.JournalEntry);
    expect(a.by['160200'] + b.by['160200']).toBe(0);
    expect((await envB.models.Inventory.findOne({ itemCode: 'CB-9' })).stockQty).toBe(4);
  });

  it('cannot be cancelled once shipped', async () => {
    const r = await auth('post', `/api/hub/branch-transfers/${ref}/cancel`);
    expect(r.status).toBe(409);
  });
});

describe('a partner that cannot be reached', () => {
  it('keeps the step here and flags it for the sweep', async () => {
    await A('LinkedBusiness').create({ businessType: 'log', role: 'hub', partnerSlug: 'offline-c', partnerUrl: 'http://127.0.0.1:9', linkToken: 'tok-c', status: 'active' });
    const item = await A('Inventory').create({ businessType: 'log', itemName: 'Milk', unit: 'L', stockQty: 10, unitCost: 80 });
    const r = await auth('post', '/api/hub/branch-transfers').send({ partnerSlug: 'offline-c', direction: 'send', items: [{ itemId: item._id, qty: 1 }] });
    expect(r.status).toBe(200);
    expect(r.body.warning).toMatch(/could not be reached/);
    expect(r.body.transfer.partnerSync).toBe(true);
  });
});

describe('the consolidated report', () => {
  beforeAll(async () => {
    await A('Order').create({ businessType: 'log', status: 'Completed', total: 1000 });
    await A('Order').create({ businessType: 'log', status: 'Completed', total: 500 });
    await envB.models.Order.create({ businessType: 'log', status: 'Completed', total: 700 });
    await envB.models.Order.create({ businessType: 'log', status: 'Pending', total: 9999 });
  });

  it('adds every branch up and keeps the per-branch breakdown', async () => {
    const r = await auth('get', '/api/hub/consolidated-report?start=2000-01-01&end=2100-12-31');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // offline-c is linked and down: named, and the report says it is incomplete.
    expect(r.body.complete).toBe(false);
    expect(r.body.unreachable.map(u => u.slug)).toEqual(['offline-c']);

    const own = r.body.branches.find(b => b.self);
    const b = r.body.branches.find(x => x.slug === B_SLUG);
    expect(own.sales).toMatchObject({ revenue: 1500, orders: 2 });
    expect(b.sales).toMatchObject({ revenue: 700, orders: 1 });
    expect(b.branchCode).toBe('AC-B001');
    expect(r.body.totals.sales.revenue).toBe(2200);
    expect(r.body.totals.sales.orders).toBe(3);

    const ownStock = await stockValue(A('Inventory'));
    const bStock = await stockValue(envB.models.Inventory);
    expect(own.stock.value).toBeCloseTo(ownStock, 2);
    expect(b.stock.value).toBeCloseTo(bStock, 2);
    expect(r.body.totals.stock.value).toBeCloseTo(ownStock + bStock, 2);
    expect(own.share.revenue + b.share.revenue).toBeCloseTo(100, 1);
    for (const k of ['netRevenue', 'netIncome']) {
      expect(r.body.totals.pnl[k]).toBeCloseTo(own.pnl[k] + b.pnl[k], 2);
    }
  });
});

describe('the shared catalog', () => {
  it('keeps a master catalog and syncs it into this branch\'s products', async () => {
    for (const it of [{ sku: 'lat-12', name: 'Latte 12oz', category: 'Coffee', basePrice: 150 }, { sku: 'AME-12', name: 'Americano 12oz', category: 'Coffee', basePrice: 120 }]) {
      expect((await auth('post', '/api/hub/catalog').send(it)).status).toBe(200);
    }
    const s = await auth('post', '/api/hub/catalog/sync').send({ sourceSlug: 'self' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.created).toBe(2);
    const latte = await A('Product').findOne({ productCode: 'LAT-12' }).lean();
    expect(latte).toMatchObject({ name: 'Latte 12oz', basePrice: 150 });
  });

  it('lets a branch set its own price, which a re-sync keeps', async () => {
    const o = await auth('put', '/api/hub/catalog/links/LAT-12/override').send({ price: 165 });
    expect(o.status).toBe(200);
    expect(o.body.link.effectivePrice).toBe(165);
    expect((await A('Product').findOne({ productCode: 'LAT-12' })).basePrice).toBe(165);

    await auth('post', '/api/hub/catalog').send({ sku: 'LAT-12', name: 'Latte 12oz', category: 'Coffee', basePrice: 155 });
    await auth('post', '/api/hub/catalog').send({ sku: 'AME-12', name: 'Americano 12oz', category: 'Coffee', basePrice: 125 });
    const s = await auth('post', '/api/hub/catalog/sync').send({ sourceSlug: 'self' });
    expect(s.body.updated).toBe(1);   // Americano; the Latte keeps its override
    expect((await A('Product').findOne({ productCode: 'LAT-12' })).basePrice).toBe(165);
    expect((await A('Product').findOne({ productCode: 'AME-12' })).basePrice).toBe(125);

    const links = (await auth('get', '/api/hub/catalog/links')).body.links;
    expect(links.find(l => l.sku === 'LAT-12')).toMatchObject({ masterPrice: 155, overridePrice: 165, effectivePrice: 165 });

    // Clearing the override follows the master again.
    await auth('put', '/api/hub/catalog/links/LAT-12/override').send({ price: null });
    expect((await A('Product').findOne({ productCode: 'LAT-12' })).basePrice).toBe(155);
  });

  it('syncs another branch from the master over the link, with its own overrides', async () => {
    const cat = await request(app).get('/api/hub/internal/catalog').set('x-link-token', TOKEN_AB);
    expect(cat.status).toBe(200);
    const first = await applyCatalog(envB, A_SLUG, cat.body.items);
    expect(first.created).toBe(2);
    await setPriceOverride(envB, 'AME-12', 99);
    const again = await applyCatalog(envB, A_SLUG, cat.body.items);
    expect(again.created + again.updated).toBe(0);
    expect((await envB.models.Product.findOne({ productCode: 'AME-12' })).basePrice).toBe(99);
    expect((await A('Product').findOne({ productCode: 'AME-12' })).basePrice).toBe(125);
  });

  it('marks a retired SKU inactive without deleting the product', async () => {
    await auth('post', '/api/hub/catalog').send({ sku: 'AME-12', name: 'Americano 12oz', basePrice: 125, active: false });
    const s = await auth('post', '/api/hub/catalog/sync').send({ sourceSlug: 'self' });
    expect(s.body.deactivated).toBe(1);
    expect(await A('Product').countDocuments({ productCode: 'AME-12' })).toBe(1);
  });
});
