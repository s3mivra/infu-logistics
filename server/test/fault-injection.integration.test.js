// Fault injection - drives the `catch (err) { 500 }` branch of read handlers by making
// their PRIMARY query throw. We mock one specific model method per route (e.g. Order.find)
// with a chainable stub that rejects on await. This is deterministic and leak-free: only
// that single query rejects, so every other/background DB op (audit logs, etc.) still runs
// - no stray unhandled rejection. (A global exec mock would also reject fire-and-forget
// ops in other handlers, surfacing as an intermittent unhandled rejection.)
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;

// A query/aggregate stub that rejects when awaited but supports the full chain
// (.sort().lean().session().limit()....exec()) - every property returns the same proxy.
const rejectingQuery = (e) => {
  const proxy = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (_resolve, reject) => reject(e);
      if (prop === 'catch') return (reject) => Promise.resolve().then(() => reject(e));
      if (prop === 'finally') return () => Promise.reject(e);
      return () => proxy; // sort/lean/limit/skip/select/session/populate/exec/...
    },
  });
  return proxy;
};

const breakModel = (modelName, method) => {
  vi.spyOn(mongoose.model(modelName), method).mockImplementation(() => rejectingQuery(new Error('injected DB failure')));
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'fi_super', role: 'superadmin' });
  tok = await loginStaff(app, 'fi_super');
}, 120000);

afterAll(async () => { await ctx.stop(); });
afterEach(() => vi.restoreAllMocks());

// [method, path, modelName, modelMethod] - the handler's primary DB op.
const R = '?start=2000-01-01&end=2100-01-01';
const ROUTES = [
  ['get', '/api/orders', 'Order', 'find'],
  ['get', '/api/orders/archives', 'Order', 'find'],
  ['get', '/api/orders/parked', 'Order', 'find'],
  // newly hardened (previously lacked try/catch and hung on DB failure)
  ['get', '/api/roles', 'Role', 'find'],
  ['get', '/api/categories', 'Category', 'find'],
  ['get', '/api/inventory', 'Inventory', 'find'],
  ['get', '/api/journal', 'JournalEntry', 'find'],
  ['get', '/api/users', 'User', 'find'],
  ['get', '/api/inventory/expiring', 'Inventory', 'find'],
  ['get', '/api/products', 'Product', 'find'],
  ['get', '/api/combos', 'Combo', 'find'],
  ['get', '/api/addons', 'AddOn', 'find'],
  ['get', '/api/discounts', 'Discount', 'find'],
  ['get', '/api/accounts', 'Account', 'find'],
  ['get', '/api/periods', 'ClosedPeriod', 'find'],
  ['get', '/api/modifier-groups', 'ModifierGroup', 'find'],
  ['get', '/api/revolving-funds', 'RevolvingFund', 'find'],
  ['get', '/api/client-accounts', 'ClientAccount', 'find'],
  ['get', '/api/payment-method-map', 'PaymentMethodMap', 'find'],
  ['get', '/api/bank-deposits', 'BankDeposit', 'find'],
  ['get', '/api/finance/ar-outstanding', 'Order', 'find'],
  ['get', '/api/finance/ap-outstanding', 'JournalEntry', 'aggregate'],
  ['get', '/api/finance/balances', 'JournalEntry', 'aggregate'],
  ['get', `/api/reports/pnl${R}`, 'JournalEntry', 'aggregate'],
  ['get', `/api/reports/balance-sheet`, 'JournalEntry', 'aggregate'],
  ['get', `/api/reports/sales-summary${R}`, 'Order', 'find'],
  ['get', `/api/reports/sales-by-payment${R}`, 'Order', 'aggregate'],
  ['get', `/api/reports/percentage-tax${R}`, 'Order', 'aggregate'],
  ['get', '/api/reports/purchase-order', 'Inventory', 'find'],
];

describe('fault injection: read handlers degrade to 500 when their query throws', () => {
  for (const [m, p, model, method] of ROUTES) {
    it(`${m.toUpperCase()} ${p.split('?')[0]} → 500 when ${model}.${method} fails`, async () => {
      breakModel(model, method);
      const res = await request(app)[m](p).set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  }
});

// Newly hardened write handlers. We reject the one static they call (create /
// findByIdAndDelete) - a single, awaited, no-chain op → deterministic and leak-free.
const WRITES = [
  ['post', '/api/roles', 'Role', 'create', { name: 'FiRole' }],
  ['delete', '/api/roles/000000000000000000000000', 'Role', 'findByIdAndDelete', {}],
  ['post', '/api/categories', 'Category', 'create', { name: 'FiCat', department: 'Kitchen' }],
  ['delete', '/api/categories/000000000000000000000000', 'Category', 'findByIdAndDelete', {}],
  ['post', '/api/products', 'Product', 'create', { name: 'FiProd', basePrice: 1, category: 'X' }],
  ['delete', '/api/users/000000000000000000000000', 'User', 'findByIdAndDelete', {}],
];

describe('fault injection: hardened write handlers degrade to 500', () => {
  for (const [m, p, model, method, body] of WRITES) {
    it(`${m.toUpperCase()} ${p.split('?')[0]} → 500 when ${model}.${method} fails`, async () => {
      vi.spyOn(mongoose.model(model), method).mockRejectedValue(new Error('injected DB failure'));
      const res = await request(app)[m](p).set('Authorization', `Bearer ${tok}`).send(body);
      expect(res.status).toBe(500);
    });
  }
});
