// #8 stock transfer workflow: request -> approve -> release moves base-unit qty
// between two per-location items, writes StockCard audit rows, posts NO journal
// entry (internal asset move), and blocks invalid transitions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, superTok, staffTok, itemA, itemB;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'xSuper', role: 'superadmin' });
  await makeUser({ name: 'xStaff', role: 'staff' });
  superTok = await loginStaff(app, 'xSuper');
  staffTok = await loginStaff(app, 'xStaff');

  await auth('post', '/api/stock-locations', superTok).send({ name: 'Warehouse' });
  await auth('post', '/api/stock-locations', superTok).send({ name: 'Store Front' });
  const a = await auth('post', '/api/inventory', superTok).send({ itemName: 'Sugar WH', unit: 'g', unitCost: 0.1, stockQty: 1000, stockLocation: 'Warehouse' });
  const b = await auth('post', '/api/inventory', superTok).send({ itemName: 'Sugar SF', unit: 'g', unitCost: 0.1, stockQty: 0, stockLocation: 'Store Front' });
  itemA = a.body.item; itemB = b.body.item;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('#8 stock transfer workflow', () => {
  const Inventory = () => mongoose.model('Inventory');

  it('moves quantity through request -> approve -> release and leaves the ledger untouched', async () => {
    const { debits: dr0, credits: cr0 } = await trialBalance();

    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: itemA._id, toItemId: itemB._id, qtyBase: 300, note: 'restock front' });
    expect(req1.status).toBe(200);
    const id = req1.body.transfer._id;
    expect(req1.body.transfer.status).toBe('Requested');

    // Cannot release before approval.
    const early = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(early.status).toBe(400);

    const appr = await auth('post', `/api/stock-transfers/${id}/approve`, superTok);
    expect(appr.status).toBe(200);
    expect(appr.body.transfer.status).toBe('Approved');

    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(200);
    expect(rel.body.transfer.status).toBe('Released');

    const a = await Inventory().findById(itemA._id).lean();
    const b = await Inventory().findById(itemB._id).lean();
    expect(a.stockQty).toBe(700);
    expect(b.stockQty).toBe(300);

    // Internal move - the ledger did not change.
    const { debits: dr1, credits: cr1 } = await trialBalance();
    expect(dr1).toBeCloseTo(dr0, 2);
    expect(cr1).toBeCloseTo(cr0, 2);

    // Audit rows exist on both sides.
    const StockCard = mongoose.model('StockCard');
    const cards = await StockCard.find({ reference: rel.body.transfer.reference }).lean();
    expect(cards.length).toBe(2);
  });

  it('rejects a transfer that exceeds source stock', async () => {
    const r = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: itemA._id, toItemId: itemB._id, qtyBase: 999999 });
    expect(r.status).toBe(400);
  });

  it('rejects same source and destination', async () => {
    const r = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: itemA._id, toItemId: itemA._id, qtyBase: 10 });
    expect(r.status).toBe(400);
  });

  it('by-location analytics groups on-hand value per location', async () => {
    const r = await auth('get', '/api/stock-analytics/by-location', staffTok);
    expect(r.status).toBe(200);
    const names = r.body.locations.map(l => l.location);
    expect(names).toContain('Warehouse');
    expect(names).toContain('Store Front');
  });
});

describe('#8 stock transfer - FEFO by default, or pin a specific batch', () => {
  const Inventory = () => mongoose.model('Inventory');
  const dstr = (d) => new Date(d).toISOString().slice(0, 10);

  const makeBatchedPair = async (fromName, toName) => {
    const fromR = await auth('post', '/api/inventory', superTok).send({ itemName: fromName, unit: 'g', unitCost: 0.2, stockQty: 0, stockLocation: 'Warehouse' });
    const toR = await auth('post', '/api/inventory', superTok).send({ itemName: toName, unit: 'g', unitCost: 0.2, stockQty: 0, stockLocation: 'Store Front' });
    const from = fromR.body.item, to = toR.body.item;
    await auth('post', `/api/inventory/${from._id}/batches`, superTok).send({ qty: 300, expiryDate: '2026-06-01' });
    await auth('post', `/api/inventory/${from._id}/batches`, superTok).send({ qty: 400, expiryDate: '2026-07-01' });
    return { from, to };
  };

  it('FEFO (default): release with no expiryDate draws from the oldest batch and carries its expiry to the destination', async () => {
    const { from, to } = await makeBatchedPair('Flour FEFO Src', 'Flour FEFO Dst');
    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 200 });
    expect(req1.status).toBe(200);
    const id = req1.body.transfer._id;
    await auth('post', `/api/stock-transfers/${id}/approve`, superTok);
    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(200);

    const a = await Inventory().findById(from._id).lean();
    const b = await Inventory().findById(to._id).lean();
    expect(a.stockQty).toBe(500);
    expect(a.expiryBatches.find(x => dstr(x.expiryDate) === '2026-06-01').qty).toBe(100); // 300 - 200, drawn first
    expect(a.expiryBatches.find(x => dstr(x.expiryDate) === '2026-07-01').qty).toBe(400); // untouched

    expect(b.stockQty).toBe(200);
    expect(b.expiryBatches).toHaveLength(1);
    expect(dstr(b.expiryBatches[0].expiryDate)).toBe('2026-06-01');
    expect(b.expiryBatches[0].qty).toBe(200);
  });

  it('pinned batch: release draws only from the chosen expiry lot, even when it is not the oldest', async () => {
    const { from, to } = await makeBatchedPair('Flour Pin Src', 'Flour Pin Dst');
    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 100, expiryDate: '2026-07-01' });
    expect(req1.status).toBe(200);
    expect(req1.body.transfer.expiryDate).toBeTruthy();
    const id = req1.body.transfer._id;
    await auth('post', `/api/stock-transfers/${id}/approve`, superTok);
    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(200);

    const a = await Inventory().findById(from._id).lean();
    const b = await Inventory().findById(to._id).lean();
    expect(a.expiryBatches.find(x => dstr(x.expiryDate) === '2026-06-01').qty).toBe(300); // untouched - NOT the FEFO oldest
    expect(a.expiryBatches.find(x => dstr(x.expiryDate) === '2026-07-01').qty).toBe(300); // 400 - 100

    expect(b.expiryBatches).toHaveLength(1);
    expect(dstr(b.expiryBatches[0].expiryDate)).toBe('2026-07-01');
  });

  it('rejects a pinned batch that cannot cover the requested qty at request time', async () => {
    const { from, to } = await makeBatchedPair('Flour Insuff Src', 'Flour Insuff Dst');
    const r = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 350, expiryDate: '2026-06-01' });
    expect(r.status).toBe(400); // that batch only has 300
  });

  it('release re-validates: a pinned batch drained between request and release fails cleanly', async () => {
    const { from, to } = await makeBatchedPair('Flour Race Src', 'Flour Race Dst');
    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 100, expiryDate: '2026-06-01' });
    const id = req1.body.transfer._id;
    await auth('post', `/api/stock-transfers/${id}/approve`, superTok);

    // Drain the whole June batch out from under it via a second transfer.
    const drain = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 300, expiryDate: '2026-06-01' });
    await auth('post', `/api/stock-transfers/${drain.body.transfer._id}/approve`, superTok);
    const drainRel = await auth('post', `/api/stock-transfers/${drain.body.transfer._id}/release`, staffTok);
    expect(drainRel.status).toBe(200);

    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(400);
  });

  it('an item with no batches transfers exactly as before (regression)', async () => {
    const before = await Inventory().findById(itemA._id).lean();
    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: itemA._id, toItemId: itemB._id, qtyBase: 50 });
    const id = req1.body.transfer._id;
    await auth('post', `/api/stock-transfers/${id}/approve`, superTok);
    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(200);
    const a = await Inventory().findById(itemA._id).lean();
    expect(a.expiryBatches || []).toHaveLength(0);
    expect(a.stockQty).toBe(before.stockQty - 50);
  });
});

describe('#8 stock transfer - FPFO fallback for goods with no real expiry (e.g. beans)', () => {
  const Inventory = () => mongoose.model('Inventory');
  const dstr = (d) => new Date(d).toISOString().slice(0, 10);

  const makeProductionDatedPair = async (fromName, toName) => {
    const fromR = await auth('post', '/api/inventory', superTok).send({ itemName: fromName, unit: 'g', unitCost: 0.2, stockQty: 0, stockLocation: 'Warehouse' });
    const toR = await auth('post', '/api/inventory', superTok).send({ itemName: toName, unit: 'g', unitCost: 0.2, stockQty: 0, stockLocation: 'Store Front' });
    const from = fromR.body.item, to = toR.body.item;
    // Neither batch has an expiryDate - only a production/roast date, like beans.
    await auth('post', `/api/inventory/${from._id}/batches`, superTok).send({ qty: 300, productionDate: '2026-06-01' });
    await auth('post', `/api/inventory/${from._id}/batches`, superTok).send({ qty: 400, productionDate: '2026-07-01' });
    return { from, to };
  };

  it('FPFO (default): release with no pin draws from the oldest-PRODUCED batch and carries its production date to the destination', async () => {
    const { from, to } = await makeProductionDatedPair('Beans FPFO Src', 'Beans FPFO Dst');
    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 200 });
    expect(req1.status).toBe(200);
    const id = req1.body.transfer._id;
    await auth('post', `/api/stock-transfers/${id}/approve`, superTok);
    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(200);

    const a = await Inventory().findById(from._id).lean();
    const b = await Inventory().findById(to._id).lean();
    expect(a.expiryBatches.find(x => dstr(x.productionDate) === '2026-06-01').qty).toBe(100); // 300 - 200, drawn first (oldest produced)
    expect(a.expiryBatches.find(x => dstr(x.productionDate) === '2026-07-01').qty).toBe(400); // untouched

    expect(b.expiryBatches).toHaveLength(1);
    expect(b.expiryBatches[0].expiryDate).toBeFalsy();
    expect(dstr(b.expiryBatches[0].productionDate)).toBe('2026-06-01');
    expect(b.expiryBatches[0].qty).toBe(200);
  });

  it('pinned batch by production date: release draws only from the chosen lot, even when it is not the oldest', async () => {
    const { from, to } = await makeProductionDatedPair('Beans Pin Src', 'Beans Pin Dst');
    const req1 = await auth('post', '/api/stock-transfers', staffTok).send({ fromItemId: from._id, toItemId: to._id, qtyBase: 100, expiryDate: '2026-07-01' });
    expect(req1.status).toBe(200);
    const id = req1.body.transfer._id;
    await auth('post', `/api/stock-transfers/${id}/approve`, superTok);
    const rel = await auth('post', `/api/stock-transfers/${id}/release`, staffTok);
    expect(rel.status).toBe(200);

    const a = await Inventory().findById(from._id).lean();
    expect(a.expiryBatches.find(x => dstr(x.productionDate) === '2026-06-01').qty).toBe(300); // untouched
    expect(a.expiryBatches.find(x => dstr(x.productionDate) === '2026-07-01').qty).toBe(300); // 400 - 100
  });
});
