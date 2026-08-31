// A client's special pricing lives scattered across every PRODUCT that
// mentions them (clientDiscounts / clientBulkBreaks are arrays keyed by
// clientId) - there is no single document to read "what deals does this
// client have". GET /api/client-accounts/:id/pricing does the reverse lookup
// and reshapes it into "P590 base, P550 at 20+"-style rows for the client's
// own account view.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, client;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'cspSuper', role: 'superadmin' });
  await makeUser({ name: 'cspStaff', role: 'staff' });
  superTok = await loginStaff(app, 'cspSuper');
  staffTok = await loginStaff(app, 'cspStaff');
  await mongoose.model('Category').create({ name: 'CspCat', department: 'Logistics' });
  client = await mongoose.model('ClientAccount').create({
    clientCode: 'CSP-1', username: 'csp_client', name: 'CSP Client', password: 'x', paymentMethod: 'Cash', isActive: true,
  });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('GET /api/client-accounts/:id/pricing', () => {
  it('is superadmin-only', async () => {
    const res = await auth('get', `/api/client-accounts/${client._id}/pricing`, staffTok);
    expect(res.status).toBe(403);
  });

  it('404s for a bogus id', async () => {
    const res = await auth('get', '/api/client-accounts/not-an-id/pricing', superTok);
    expect(res.status).toBe(404);
  });

  it('returns an empty list for a client nobody has priced specially', async () => {
    const bare = await mongoose.model('ClientAccount').create({
      clientCode: 'CSP-BARE', username: 'csp_bare', name: 'No Deals', password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    const res = await auth('get', `/api/client-accounts/${bare._id}/pricing`, superTok);
    expect(res.status).toBe(200);
    expect(res.body.products).toEqual([]);
  });

  it('reports the flat rate as an actual peso price, and every volume break sorted by quantity', async () => {
    await mongoose.model('Product').create({
      name: 'CSP Product', category: 'CspCat', basePrice: 590,
      clientDiscounts: [{ clientId: String(client._id), percent: 10 }],
      clientBulkBreaks: [
        { clientId: String(client._id), minQty: 50, price: 500 },
        { clientId: String(client._id), minQty: 20, price: 550 },
      ],
    });

    const res = await auth('get', `/api/client-accounts/${client._id}/pricing`, superTok);
    expect(res.status).toBe(200);
    const row = res.body.products.find(p => p.name === 'CSP Product');
    expect(row).toBeTruthy();
    expect(row.basePrice).toBe(590);
    expect(row.flatPercent).toBe(10);
    expect(row.flatPrice).toBe(531);           // 590 * 0.90
    // Sorted ascending by minQty regardless of storage order.
    expect(row.breaks).toEqual([
      { minQty: 20, price: 550 },
      { minQty: 50, price: 500 },
    ]);
  });

  it('includes a product with only a volume break and no flat rate', async () => {
    await mongoose.model('Product').create({
      name: 'CSP Volume Only', category: 'CspCat', basePrice: 300,
      clientBulkBreaks: [{ clientId: String(client._id), minQty: 10, price: 270 }],
    });
    const res = await auth('get', `/api/client-accounts/${client._id}/pricing`, superTok);
    const row = res.body.products.find(p => p.name === 'CSP Volume Only');
    expect(row.flatPercent).toBeNull();
    expect(row.flatPrice).toBeNull();
    expect(row.breaks).toEqual([{ minQty: 10, price: 270 }]);
  });

  it('never surfaces another client\'s deal on this client\'s list', async () => {
    const other = await mongoose.model('ClientAccount').create({
      clientCode: 'CSP-OTHER', username: 'csp_other', name: 'Someone Else', password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    await mongoose.model('Product').create({
      name: 'CSP Not Mine', category: 'CspCat', basePrice: 100,
      clientDiscounts: [{ clientId: String(other._id), percent: 50 }],
    });
    const res = await auth('get', `/api/client-accounts/${client._id}/pricing`, superTok);
    expect(res.body.products.some(p => p.name === 'CSP Not Mine')).toBe(false);
  });
});
