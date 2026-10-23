// The shared catalog across linked branches - checked against TWO real branch
// databases. Branch A is the app under test; branch B is a second database on
// the same replica set, driven through lib/branchNetwork.js (the same code B's
// own app would run). B reads A's master over A's internal route with the link
// token, exactly as it would across the network.
//
// Pinned here: catalog sync creates and updates products, a branch's own price
// survives a re-sync, and a retired SKU is deactivated, never deleted.
// (Transfers and the consolidated books are the hub's - see hub tests.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { defineBranchModels, applyCatalog, setPriceOverride } from '../lib/branchNetwork.js';

const A_SLUG = 'unknown';          // the harness URI has no semivra_<slug> in it
const B_SLUG = 'branch-b';
const TOKEN_AB = 'link-token-a-b-0123456789';

let app, stop, tok, envB;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const A = (name) => mongoose.model(name);

// Branch B's own products, in its own database.
function branchB() {
  const conn = mongoose.connection.useDb('semivra_branch_b', { useCache: true });
  const Product = conn.models.Product || conn.model('Product', mongoose.model('Product').schema);
  return { conn, businessType: 'log', self: B_SLUG, models: { Product, ...defineBranchModels(conn) } };
}

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'branch-network-test-secret-0123456789' }));
  await makeUser({ name: 'NetOwner', role: 'superadmin' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  tok = await loginStaff(app, 'NetOwner');
  envB = branchB();
  await A('LinkedBusiness').create({
    businessType: 'log', role: 'hub', partnerSlug: B_SLUG, partnerName: 'Branch B',
    partnerUrl: 'http://127.0.0.1:9', linkToken: TOKEN_AB, status: 'active',
  });
}, 120000);

afterAll(async () => { await stop?.(); });

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
