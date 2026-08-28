// Hub Network Overview (#12): unified inventory, branch comparison, central
// reporting across linked businesses. Each linked business is a fully
// separate deployment/database - network-summary calls out to each partner's
// own API using the same link-token trust already used for transfers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hub-network-test-secret-0123456789' }));
  await makeUser({ name: 'HubBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'HubBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('hub internal summary (what a partner pulls from this business)', () => {
  it('rejects a request with no/invalid link token', async () => {
    const res = await request(app).get('/api/hub/internal/summary');
    expect(res.status).toBe(401);
    const res2 = await request(app).get('/api/hub/internal/summary').set('x-link-token', 'not-a-real-token');
    expect(res2.status).toBe(403);
  });

  it('returns this business\'s own inventory + today/month sales given a valid link token', async () => {
    await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Hub Summary Widget', unit: 'pcs', stockQty: 42, unitCost: 10 });

    const LinkedBusiness = mongoose.model('LinkedBusiness');
    const link = await LinkedBusiness.create({
      businessType: 'log', role: 'client', partnerSlug: 'partner-x', partnerName: 'Partner X',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'test-link-token-abc', status: 'active',
    });

    const res = await request(app).get('/api/hub/internal/summary').set('x-link-token', link.linkToken);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toBeTruthy();
    expect(res.body.inventory.some(i => i.itemName.toUpperCase() === 'HUB SUMMARY WIDGET' && i.stockQty === 42)).toBe(true);
    expect(res.body.today).toHaveProperty('revenue');
    expect(res.body.month).toHaveProperty('revenue');
  });
});

describe('GET /api/hub/network-summary', () => {
  it('includes own snapshot and gracefully reports an unreachable partner instead of failing the whole request', async () => {
    const LinkedBusiness = mongoose.model('LinkedBusiness');
    await LinkedBusiness.deleteMany({});
    await LinkedBusiness.create({
      businessType: 'log', role: 'client', partnerSlug: 'ghost-branch', partnerName: 'Ghost Branch',
      partnerUrl: 'http://127.0.0.1:1', linkToken: 'irrelevant', status: 'active',
    });

    const res = await request(app).get('/api/hub/network-summary').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.own).toBeTruthy();
    expect(res.body.own.inventory.some(i => i.itemName.toUpperCase() === 'HUB SUMMARY WIDGET')).toBe(true);

    const ghost = res.body.partners.find(p => p.partnerSlug === 'ghost-branch');
    expect(ghost.ok).toBe(false);
    expect(ghost.error).toBeTruthy();
  }, 20000);

  it('a suspended link is excluded from the network', async () => {
    const LinkedBusiness = mongoose.model('LinkedBusiness');
    await LinkedBusiness.updateMany({}, { $set: { status: 'suspended' } });
    const res = await request(app).get('/api/hub/network-summary').set(auth(superToken));
    expect(res.body.partners.length).toBe(0);
  });
});
