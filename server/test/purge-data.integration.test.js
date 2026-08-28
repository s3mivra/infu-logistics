// Purge Data is now a checklist - only the selected categories move, menu
// defaults OFF (it used to be permanently protected), everything else
// defaults ON. The confirmation phrase is checked server-side regardless of
// what the client claims to have shown the user.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'purge-test-secret-0123456789' }));
  await makeUser({ name: 'PurgeBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'PurgeBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('purge data', () => {
  it('rejects a wrong confirmation phrase', async () => {
    const res = await request(app).post('/api/admin/purge-data').set(auth(superToken)).send({ confirmPhrase: 'nope' });
    expect(res.status).toBe(400);
  });

  it('lists categories with menu defaulting off, everything else on', async () => {
    const res = await request(app).get('/api/admin/purge-data/categories').set(auth(superToken));
    expect(res.body.success).toBe(true);
    const menu = res.body.categories.find(c => c.key === 'menu');
    expect(menu.defaultOn).toBe(false);
    expect(res.body.categories.find(c => c.key === 'orders').defaultOn).toBe(true);
  });

  it('only purges the selected categories, leaving everything else untouched', async () => {
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'Purge Test Product', basePrice: 100, category: 'Test' });
    expect(prod.body.success).toBe(true);
    const productId = prod.body.product._id;

    const inv = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Purge Test Item', unit: 'pcs', stockQty: 10, unitCost: 5 });
    expect(inv.status).toBe(200);

    // Purge only inventory - product must survive.
    const res = await request(app).post('/api/admin/purge-data').set(auth(superToken))
      .send({ confirmPhrase: 'PURGE', categories: ['inventory'] });
    expect(res.body.success).toBe(true);
    expect(res.body.categories).toEqual(['inventory']);
    expect(res.body.deleted.inventory).toBeGreaterThanOrEqual(1);
    expect(res.body.deleted.products).toBeUndefined(); // menu category wasn't selected

    const stillThere = await request(app).get(`/api/products/${productId}`).set(auth(superToken));
    expect([200, 404]).toContain(stillThere.status); // route may not exist; check via list instead
    const list = await request(app).get('/api/products').set(auth(superToken));
    expect(list.body.products.some(p => p._id === productId)).toBe(true);
  });

  it('"transfers" is its own purge category, independent of "inventory"', async () => {
    const invA = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Purge Transfer Source', unit: 'pcs', stockQty: 20, unitCost: 5 });
    const invB = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Purge Transfer Dest', unit: 'pcs', stockQty: 0, unitCost: 5 });
    const t = await request(app).post('/api/stock-transfers').set(auth(superToken))
      .send({ fromItemId: invA.body.item._id, toItemId: invB.body.item._id, qtyBase: 5 });
    expect(t.body.success).toBe(true);

    // Purging "inventory" alone must NOT touch transfer history.
    const invOnly = await request(app).post('/api/admin/purge-data').set(auth(superToken))
      .send({ confirmPhrase: 'PURGE', categories: ['inventory'] });
    expect(invOnly.body.success).toBe(true);
    expect(invOnly.body.deleted.stockTransfers).toBeUndefined();
    const stillThere = await request(app).get('/api/stock-transfers').set(auth(superToken));
    expect(stillThere.body.transfers.some(x => String(x._id) === String(t.body.transfer._id))).toBe(true);

    // Purging "transfers" alone clears it.
    const res = await request(app).post('/api/admin/purge-data').set(auth(superToken))
      .send({ confirmPhrase: 'PURGE', categories: ['transfers'] });
    expect(res.body.success).toBe(true);
    expect(res.body.deleted.stockTransfers).toBeGreaterThanOrEqual(1);

    const after = await request(app).get('/api/stock-transfers').set(auth(superToken));
    expect(after.body.transfers.length).toBe(0);
  });

  it('lists "transfers" as its own category, defaulting on', async () => {
    const res = await request(app).get('/api/admin/purge-data/categories').set(auth(superToken));
    const transfers = res.body.categories.find(c => c.key === 'transfers');
    expect(transfers).toBeTruthy();
    expect(transfers.defaultOn).toBe(true);
  });

  it('purges the menu only when explicitly selected', async () => {
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'Purge Menu Test Product', basePrice: 50, category: 'Test' });
    const productId = prod.body.product._id;

    const res = await request(app).post('/api/admin/purge-data').set(auth(superToken))
      .send({ confirmPhrase: 'PURGE', categories: ['menu'] });
    expect(res.body.success).toBe(true);
    expect(res.body.deleted.products).toBeGreaterThanOrEqual(1);

    const list = await request(app).get('/api/products').set(auth(superToken));
    expect(list.body.products.some(p => p._id === productId)).toBe(false);
  });

  it('rejects an empty category list', async () => {
    const res = await request(app).post('/api/admin/purge-data').set(auth(superToken))
      .send({ confirmPhrase: 'PURGE', categories: [] });
    expect(res.status).toBe(400);
  });
});
