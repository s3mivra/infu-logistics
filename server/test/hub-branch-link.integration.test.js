// Where "Open" on another branch actually sends you.
//
// A linked branch is its own deployment, so the Hub keeps an address for it.
// That address was doing double duty: the server calls the partner's API on it
// AND the screen offered it as a link. They are not the same thing. The API
// address is an internal container name on an internal port -
// http://infu-main-api:5002 - which a browser cannot resolve, and which is the
// API root rather than a dashboard even when it can.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const link = (extra = {}) => M('LinkedBusiness').create({
  businessType: 'log', role: 'hub', partnerSlug: 'infu-main', partnerName: 'infu-main',
  partnerUrl: 'http://infu-main-api:5002', linkToken: 'tok', status: 'active', linkedAt: new Date(),
  ...extra,
});

const network = async () => (await auth('get', '/api/hub/network-summary')).body;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'HubSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'HubSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => { await M('LinkedBusiness').deleteMany({}); });

describe('the link to another branch', () => {
  it('is never the internal API address', async () => {
    await link();
    const net = await network();
    const partner = net.partners.find(p => p.partnerSlug === 'infu-main');

    expect(partner.dashboardUrl).not.toBe('http://infu-main-api:5002');
    expect(partner.dashboardUrl).not.toMatch(/-api/);
    expect(partner.dashboardUrl).not.toMatch(/:5002/);
  });

  it('falls back to the API host with the internal parts taken off', async () => {
    await link();
    const net = await network();
    // Not where the server calls it, but somewhere a browser can actually go.
    expect(net.partners[0].dashboardUrl).toBe('http://infu-main');
  });

  it('uses the address staff were told to use, when one is stored', async () => {
    await link({ partnerAppUrl: 'https://main.semivra.app' });
    const net = await network();
    expect(net.partners[0].dashboardUrl).toBe('https://main.semivra.app');
  });

  it('still points somewhere when that branch is unreachable', async () => {
    // The partner's API is not answering - the link must still be right, since
    // that is exactly when somebody wants to go and look at it.
    await link({ partnerUrl: 'http://nowhere-api:5002' });
    const net = await network();
    const partner = net.partners[0];
    expect(partner.ok).toBe(false);
    expect(partner.dashboardUrl).toBe('http://nowhere');
  });
});
