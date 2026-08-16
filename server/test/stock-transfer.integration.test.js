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

    // Internal move — the ledger did not change.
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
