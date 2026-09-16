// A backup you can actually restore from.
//
// The dataset exports are reports - chosen columns, derived figures. They
// cannot rebuild the system: no ids, no settings, no counters, so restoring
// from one leaves a database that looks similar and behaves differently.
//
// This is the real thing: every document of every collection, back exactly as
// it was, references intact. The test that matters is the one below - take a
// backup, purge everything, put it back, and check the business is the same.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'BackupSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'BackupSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

// A small but real business: catalogue, client, a completed sale with its
// ledger entry, stock, and a setting somebody changed.
const buildBusiness = async () => {
  await M('Category').create({ name: 'Goods', department: 'Logistics' });
  const product = await M('Product').create({ name: 'Crate', category: 'Goods', basePrice: 250, productCode: 'CRATE' });
  const clientRes = await auth('post', '/api/client-accounts').send({ username: 'backupco', password: 'secret123', name: 'Backup Co', paymentMethod: 'On Account' });
  await auth('post', '/api/inventory').send({
    itemName: 'Crate', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
    stockQty: 40, unitCost: 150, creditAccount: '111000',
  });
  await auth('patch', '/api/settings/reservationDays').send({ value: 14 });
  const order = await auth('post', '/api/orders').send({
    table: 'Pickup', paymentMethod: 'On Account', clientAccountId: clientRes.body.client._id,
    items: [{ productId: String(product._id), name: 'Crate', price: 250, quantity: 4 }],
  });
  await auth('put', `/api/orders/${order.body.order._id}`).send({ status: 'Completed' });
  return { clientId: clientRes.body.client._id, orderNumber: order.body.order.orderNumber };
};

const census = async () => ({
  orders: await M('Order').countDocuments({}),
  journal: await M('JournalEntry').countDocuments({}),
  products: await M('Product').countDocuments({}),
  clients: await M('ClientAccount').countDocuments({}),
  inventory: await M('Inventory').countDocuments({}),
  stockCards: await M('StockCard').countDocuments({}),
});

describe('what a backup contains', () => {
  it('carries every collection, including the ones the reports never touch', async () => {
    await buildBusiness();
    const res = await auth('get', '/api/backup/snapshot');
    expect(res.status).toBe(200);
    const names = res.body.collections.map(c => c.name);

    // The things a report-style export leaves behind, and which a restored
    // system is broken without.
    for (const needed of ['Settings', 'User', 'Counter', 'Order', 'JournalEntry', 'Inventory', 'ClientAccount', 'StockCard', 'Category', 'Product']) {
      expect(names).toContain(needed);
    }
    // Login and QR sessions are deliberately left out - restoring a dead
    // session would hand back access that should have died with the database.
    expect(names).not.toContain('RefreshSession');
    expect(names).not.toContain('QRSession');
    expect(res.body.documents).toBeGreaterThan(0);
    expect(res.body.businessType).toBe('log');
  }, 60000);

  it('summarises what it would contain without building it', async () => {
    const res = await auth('get', '/api/backup/summary');
    expect(res.status).toBe(200);
    expect(res.body.documents).toBeGreaterThan(0);
    expect(res.body.collections[0].count).toBeGreaterThanOrEqual(res.body.collections.at(-1).count);
  }, 30000);
});

describe('a database too big to hold in one response', () => {
  it('reads a collection a page at a time, in a stable order, missing nothing', async () => {
    await M('Product').deleteMany({});
    for (let i = 0; i < 25; i++) {
      await M('Product').create({ name: `Paged ${String(i).padStart(2, '0')}`, category: 'Goods', basePrice: 10 + i });
    }

    const seen = [];
    let skip = 0;
    for (;;) {
      const res = await auth('get', `/api/backup/snapshot?collection=Product&skip=${skip}&limit=10`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(25);
      seen.push(...res.body.docs.map(d => String(d._id)));
      if (res.body.done) break;
      skip += 10;
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);          // no document read twice
  }, 60000);

  it('refuses an unknown collection and caps the page size', async () => {
    expect((await auth('get', '/api/backup/snapshot?collection=Nope')).status).toBe(400);
    const capped = await auth('get', '/api/backup/snapshot?collection=Product&limit=999999');
    expect(capped.body.limit).toBeLessThanOrEqual(5000);
  }, 30000);
});

describe('restoring a collection in slices', () => {
  // The browser has to send a big collection in pieces - one request per
  // collection would breach the server's 10MB body limit on any sizeable one.
  // Only the first slice may replace, or each slice would wipe the one before.
  it('replaces on the first slice and adds on the rest', async () => {
    const docs = (await M('Product').find({}).lean()).slice(0, 25);
    expect(docs.length).toBe(25);

    const send = (slice, replace) => auth('post', '/api/backup/restore')
      .send({ collection: 'Product', docs: slice, replace, businessType: 'log', confirm: 'RESTORE' });

    const first = await send(docs.slice(0, 10), true);
    expect(first.body.restored).toBe(10);
    expect(first.body.cleared).toBe(25);          // the old rows went with the first slice
    await send(docs.slice(10, 20), false);
    await send(docs.slice(20), false);

    expect(await M('Product').countDocuments({})).toBe(25);
  }, 60000);
});

describe('purge, then restore', () => {
  it('puts the business back exactly as it was', async () => {
    const before = await census();
    const snapshot = (await auth('get', '/api/backup/snapshot')).body;
    const orderBefore = await M('Order').findOne({ status: 'Completed' }).lean();

    // The disaster: everything gone.
    for (const c of snapshot.collections) await M(c.name).deleteMany({});
    expect((await census()).orders).toBe(0);

    // Sessions are gone with the database, so sign in again the way a person
    // would after a restore... except the users are gone too. Restore the
    // users first, with the token from before the purge (still valid: it is a
    // signed JWT, not a database row).
    for (const c of snapshot.collections) {
      if (!c.docs.length) continue;
      const res = await auth('post', '/api/backup/restore')
        .send({ collection: c.name, docs: c.docs, replace: true, businessType: snapshot.businessType, confirm: 'RESTORE' });
      expect(res.status).toBe(200);
      expect(res.body.failed).toBe(0);
    }

    expect(await census()).toEqual(before);

    // Not just counts: the same documents, with their references intact.
    const orderAfter = await M('Order').findOne({ orderNumber: orderBefore.orderNumber }).lean();
    expect(String(orderAfter._id)).toBe(String(orderBefore._id));
    expect(orderAfter.total).toBe(orderBefore.total);
    expect(String(orderAfter.clientAccountId)).toBe(String(orderBefore.clientAccountId));
    expect(await M('ClientAccount').countDocuments({ _id: orderAfter.clientAccountId })).toBe(1);

    // And the settings someone had changed.
    const setting = await M('Settings').findOne({ key: 'reservationDays' }).lean();
    expect(setting.value).toBe(14);
  }, 120000);

  it('refuses a backup from the other business type, and an unconfirmed restore', async () => {
    const wrongType = await auth('post', '/api/backup/restore')
      .send({ collection: 'Product', docs: [], businessType: 'fb', confirm: 'RESTORE' });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error).toMatch(/fb/);

    const unconfirmed = await auth('post', '/api/backup/restore').send({ collection: 'Product', docs: [] });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error).toMatch(/RESTORE/);

    const unknown = await auth('post', '/api/backup/restore')
      .send({ collection: 'RefreshSession', docs: [], confirm: 'RESTORE' });
    expect(unknown.status).toBe(400);
  }, 30000);

  it('replaces rather than duplicating when restoring over live data', async () => {
    const before = await census();
    const snapshot = (await auth('get', '/api/backup/snapshot')).body;
    for (const c of snapshot.collections) {
      if (!c.docs.length) continue;
      await auth('post', '/api/backup/restore')
        .send({ collection: c.name, docs: c.docs, replace: true, businessType: 'log', confirm: 'RESTORE' });
    }
    expect(await census()).toEqual(before);
  }, 120000);
});
