// Breadth suite - exercises EVERY route's handler body with valid input, so the whole
// app is executed under test. The money/stock/auth paths are deeply asserted in the
// other integration files; here the goal is to run every endpoint at least once on a
// realistic request and confirm none crashes (status < 500) and the documented success
// status where it's cheap to assert. Together these drive maximal practical coverage.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app;
const T = {};            // role tokens
let clientTok;
const ids = {};          // captured resource ids

const req = (m, p, tok) => {
  const r = request(app)[m](p);
  return tok ? r.set('Authorization', `Bearer ${tok}`) : r;
};
// Floor assertion: the handler ran without crashing.
const ran = (res) => expect(res.status).toBeLessThan(500);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;

  for (const [k, role] of [['super', 'superadmin'], ['admin', 'admin'], ['manager', 'manager'], ['staff', 'staff'], ['cashier', 'cashier']]) {
    await makeUser({ name: `fc_${k}`, role });
    T[k] = await loginStaff(app, `fc_${k}`);
  }
  await makeClient({ username: 'fc_client', paymentMethod: 'Bank Transfer' });
  clientTok = await loginClient(app, 'fc_client');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  const cat = await Category.create({ name: 'Bev', department: 'Kitchen' });
  ids.categoryId = String(cat._id);
  const inv = await Inventory.create({ itemName: 'Milk', stockQty: 5000, unit: 'ml', unitCost: 0.07, lowStockThreshold: 200, displayUnit: 'L', unitMultiplier: 1000 });
  ids.invId = String(inv._id);
  const prod = await Product.create({ name: 'Latte', category: 'Bev', basePrice: 120, baseRecipe: [{ invId: ids.invId, name: 'Milk', qty: 50, cost: 3.5, unit: 'ml' }] });
  ids.productId = String(prod._id);
}, 120000);

afterAll(async () => { await ctx.stop(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('public + health', () => {
  it('GET /health', async () => { const r = await req('get', '/health'); expect([200, 503]).toContain(r.status); expect(r.body.businessType).toBe('log'); });
  it('GET /api/products (public)', async () => ran(await req('get', '/api/products')));
  it('GET /api/categories (public)', async () => ran(await req('get', '/api/categories')));
  it('GET /api/combos (public)', async () => ran(await req('get', '/api/combos')));
  it('GET /api/addons (public)', async () => ran(await req('get', '/api/addons')));
});

describe('catalog CRUD: categories, products, addons, modifier-groups, combos, discounts', () => {
  it('POST/PUT/DELETE category', async () => {
    const c = await req('post', '/api/categories', T.staff).send({ name: 'Pastry', department: 'Kitchen' });
    expect(c.status).toBe(200);
    const cid = c.body.category?._id || c.body._id || c.body.category?.id;
    ran(await req('put', `/api/categories/${cid}`, T.staff).send({ name: 'Pastries' }));
    ran(await req('delete', `/api/categories/${cid}`, T.staff));
  });

  it('POST/PUT/PATCH/DELETE product', async () => {
    // products.manage required as of the Phase 7 permissions sweep - staff
    // (view-only by design) can no longer create products; admin can.
    const p = await req('post', '/api/products', T.admin).send({ name: 'Espresso', category: 'Bev', basePrice: 90 });
    expect(p.status).toBe(200);
    const pid = p.body.product?._id || p.body._id;
    ids.tmpProduct = pid;
    ran(await req('put', `/api/products/${pid}`, T.staff).send({ name: 'Espresso', basePrice: 95, category: 'Bev' }));
    ran(await req('patch', `/api/products/${pid}/availability`, T.super).send({ isAvailable: false }));
    ran(await req('patch', `/api/products/${pid}/oos`, T.super).send({ isOutOfStock: true }));
    ran(await req('delete', `/api/products/${pid}`, T.staff));
  });

  it('POST/DELETE addon', async () => {
    const a = await req('post', '/api/addons', T.super).send({ name: 'Extra Shot', price: 20 });
    expect(a.status).toBe(200);
    const aid = a.body.addOn?._id || a.body.addon?._id || a.body._id;
    ran(await req('delete', `/api/addons/${aid}`, T.super));
  });

  it('POST/PUT/DELETE modifier-group', async () => {
    const m = await req('post', '/api/modifier-groups', T.super).send({ name: 'Milk Choice', isRequired: true, minSelect: 1, maxSelect: 1, options: [{ name: 'Oat', price: 10 }] });
    expect(m.status).toBe(200);
    const mid = m.body.group?._id || m.body._id || m.body.modifierGroup?._id;
    ran(await req('put', `/api/modifier-groups/${mid}`, T.super).send({ name: 'Milk' }));
    ran(await req('delete', `/api/modifier-groups/${mid}`, T.super));
  });

  it('POST/PUT/DELETE combo', async () => {
    const c = await req('post', '/api/combos', T.super).send({ name: 'Combo A', price: 150, items: [{ productId: ids.productId, quantity: 1 }] });
    expect(c.status).toBe(200);
    const cid = c.body.combo?._id || c.body._id;
    ran(await req('put', `/api/combos/${cid}`, T.super).send({ name: 'Combo A2', price: 160 }));
    ran(await req('delete', `/api/combos/${cid}`, T.super));
  });

  it('GET/POST/DELETE discount', async () => {
    ran(await req('get', '/api/discounts', T.staff));
    // Create/delete require products.manage (#Audit-1a) - staff's default role
    // doesn't carry it, so this exercises admin instead.
    const d = await req('post', '/api/discounts', T.admin).send({ name: 'Promo10', percentage: 10 });
    expect(d.status).toBe(200);
    const did = d.body.discount?._id || d.body._id;
    ran(await req('delete', `/api/discounts/${did}`, T.admin));
  });

  it('GET/POST/DELETE role', async () => {
    ran(await req('get', '/api/roles', T.staff));
    const r = await req('post', '/api/roles', T.super).send({ name: 'Barista' });
    expect(r.status).toBe(200);
    const rid = r.body.role?._id || r.body._id;
    ran(await req('delete', `/api/roles/${rid}`, T.staff));
  });
});

describe('inventory: list, create, restock, batches, expiry, revalue, edit, history', () => {
  it('GET /api/inventory + expiring + history', async () => {
    ran(await req('get', '/api/inventory', T.staff));
    ran(await req('get', '/api/inventory/expiring', T.staff));
    ran(await req('get', '/api/inventory/history', T.staff));
    ran(await req('get', `/api/inventory/history/${ids.invId}`, T.staff));
  });
  it('POST create inventory item', async () => {
    // inventory.manage required as of the Phase 7 permissions sweep - staff
    // (view-only by design) can no longer create/restock inventory; admin can.
    const r = await req('post', '/api/inventory', T.admin).send({ itemName: 'Sugar', stockQty: 1000, unit: 'g', unitCost: 0.2, displayUnit: 'kg', unitMultiplier: 1000, creditAccount: '111000' });
    expect(r.status).toBe(200);
    ids.sugarId = r.body.item?._id || r.body._id;
  });
  it('POST restock', async () => ran(await req('post', `/api/inventory/restock/${ids.invId}`, T.staff).send({ addedStock: 1000, totalCost: 70, expiryDate: '2027-03-01', creditAccount: '111000' })));
  it('POST add batch + DELETE batch', async () => {
    const b = await req('post', `/api/inventory/${ids.invId}/batches`, T.super).send({ qty: 500, expiryDate: '2027-01-01', unitCost: 0.07 });
    ran(b);
    ran(await req('delete', `/api/inventory/${ids.invId}/batches/0`, T.super));
  });
  it('PATCH expiry', async () => ran(await req('patch', `/api/inventory/${ids.invId}/expiry`, T.staff).send({ expiryDate: '2027-06-01' })));
  it('POST revalue', async () => ran(await req('post', '/api/inventory/revalue', T.super).send({})));
  it('PUT edit inventory', async () => ran(await req('put', `/api/inventory/${ids.sugarId}`, T.super).send({ itemName: 'Sugar', lowStockThreshold: 100 })));
  it('POST import', async () => ran(await req('post', '/api/inventory/import', T.super).send({ items: [{ itemName: 'Cocoa', qty: 2, unit: 'kg', unitCost: 300 }] })));
  it('DELETE inventory item', async () => ran(await req('delete', `/api/inventory/${ids.sugarId}`, T.super)));
});

describe('EOD inventory count', () => {
  it('GET eod-data', async () => ran(await req('get', '/api/inventory/eod-data', T.staff)));
  it('POST count', async () => ran(await req('post', '/api/inventory/count', T.staff).send({ counts: [{ inventoryId: ids.invId, actualPhysicalCount: 4900 }] })));
  it('POST eod/reopen', async () => ran(await req('post', '/api/inventory/eod/reopen', T.staff).send({})));
});

describe('accounts / COA / periods / payment-method-map / settings', () => {
  it('GET coa + accounts', async () => { ran(await req('get', '/api/coa', T.staff)); ran(await req('get', '/api/accounts', T.staff)); });
  it('POST/PUT/DELETE custom account', async () => {
    const a = await req('post', '/api/accounts', T.super).send({ code: '111001', name: 'Cash Drawer 2', type: 'asset', parent: '111000' });
    ran(a);
    const aid = a.body.account?._id || a.body._id;
    if (aid) { ran(await req('put', `/api/accounts/${aid}`, T.super).send({ name: 'Drawer 2' })); ran(await req('delete', `/api/accounts/${aid}`, T.super)); }
  });
  it('GET periods + close + reopen', async () => {
    ran(await req('get', '/api/periods', T.staff));
    const c = await req('post', '/api/periods/close', T.super).send({ year: 2020, month: 1 });
    ran(c);
    const pid = c.body.period?._id || c.body._id;
    if (pid) ran(await req('post', `/api/periods/${pid}/reopen`, T.super).send({}));
  });
  it('GET/PUT/DELETE payment-method-map', async () => {
    ran(await req('get', '/api/payment-method-map', T.staff));
    ran(await req('put', '/api/payment-method-map', T.super).send({ method: 'GCash', accountCode: '113000' }));
    ran(await req('delete', '/api/payment-method-map/GCash', T.super));
  });
  it('GET settings + PATCH', async () => {
    ran(await req('get', '/api/settings', T.staff));
    ran(await req('patch', '/api/settings/autoCloseEnabled', T.super).send({ value: true }));
  });
  it('GET finance/balances + expenses/categories', async () => {
    ran(await req('get', '/api/finance/balances', T.super));
    ran(await req('get', '/api/expenses/categories', T.super));
  });
});

describe('reports (all variants)', () => {
  const range = '?start=2000-01-01&end=2100-01-01';
  for (const path of [
    `/api/reports/pnl${range}`, `/api/reports/pnl-monthly${range}`,
    `/api/reports/balance-sheet`, `/api/reports/balance-sheet-monthly${range}`,
    `/api/reports/menu-engineering${range}`, `/api/reports/cashier-variance${range}`,
    `/api/reports/purchase-order`, `/api/reports/profit-by-category${range}`,
    `/api/reports/sales-by-payment${range}`, `/api/reports/sales-summary${range}`,
  ]) {
    it(`GET ${path.split('?')[0]}`, async () => ran(await req('get', path, T.super)));
  }
});

describe('admin utilities', () => {
  it('GET tenancy-report + POST rebackfill', async () => {
    ran(await req('get', '/api/admin/tenancy-report', T.super));
    ran(await req('post', '/api/admin/tenancy-rebackfill', T.super).send({}));
  });
  it('POST seed-payment-subaccounts', async () => ran(await req('post', '/api/admin/seed-payment-subaccounts', T.super).send({})));
  it('POST backdate-sale', async () => ran(await req('post', '/api/admin/backdate-sale', T.super).send({ date: '2026-01-15', amount: 250, paymentMethod: 'Cash', customerName: 'Walk-in' })));
  it('GET audit-log + audit-logs', async () => { ran(await req('get', '/api/audit-log', T.super)); ran(await req('get', '/api/audit-logs', T.super)); });
  it('GET analytics/dashboard', async () => ran(await req('get', '/api/analytics/dashboard', T.staff)));
});

describe('users management', () => {
  it('GET users', async () => ran(await req('get', '/api/users', T.staff)));
  it('POST/PUT/PATCH/DELETE user', async () => {
    const u = await req('post', '/api/users', T.super).send({ name: 'fc_temp', password: 'secret123', role: 'Staff' });
    expect(u.status).toBe(200);
    const uid = u.body.user?._id || u.body._id;
    ran(await req('put', `/api/users/${uid}`, T.super).send({ role: 'Cashier' }));
    ran(await req('patch', `/api/users/${uid}`, T.super).send({ role: 'Manager' }));
    ran(await req('delete', `/api/users/${uid}`, T.super));
  });
  it('PATCH own password', async () => ran(await req('patch', '/api/users/me/password', T.staff).send({ currentPassword: 'pw', newPassword: 'newpassword1' })));
});

describe('shifts + bank deposits + clock', () => {
  it('GET shifts + current', async () => { ran(await req('get', '/api/shifts', T.super)); ran(await req('get', '/api/shifts/current', T.cashier)); });
  it('shift start → end → bank deposit', async () => {
    const s = await req('post', '/api/shifts/start', T.cashier).send({ startingCash: 1000 });
    expect(s.status).toBe(200);
    const sid = s.body.shift._id;
    const e = await req('post', '/api/shifts/end', T.cashier).send({ actualCash: 1500 });
    expect(e.status).toBe(200);
    ran(await req('post', '/api/bank-deposits', T.cashier).send({ shiftId: sid, amount: 100, sourceAccount: '111000', destAccount: '112000' }));
    ran(await req('get', `/api/bank-deposits?shiftId=${sid}`, T.staff));
  });
  it('clock in/break/out/status/entries', async () => {
    ran(await req('post', '/api/clock/in', T.staff).send({}));
    ran(await req('post', '/api/clock/break/start', T.staff).send({}));
    ran(await req('post', '/api/clock/break/end', T.staff).send({}));
    ran(await req('post', '/api/clock/out', T.staff).send({}));
    ran(await req('get', '/api/clock/status', T.staff));
    ran(await req('get', '/api/clock/entries', T.super));
  });
});

describe('QR sessions', () => {
  it('generate → heartbeat → close', async () => {
    const g = await req('post', '/api/sessions/generate', T.staff).send({ table: 'T1' });
    expect(g.status).toBe(200);
    const sid = g.body.sessionId;
    ran(await req('post', `/api/sessions/${sid}/heartbeat`));
    ran(await req('post', `/api/sessions/${sid}/close`));
  });
});

describe('order operations: park, complimentary, dispatch, partial, refund, archive', () => {
  const mkOrder = async (qty = 1) => {
    const r = await req('post', '/api/orders', T.staff).send({ items: [{ productId: ids.productId, name: 'Latte', price: 120, quantity: qty }], table: 'Takeout', paymentMethod: 'Cash' });
    return r.body.order;
  };
  it('GET orders/:id', async () => { const o = await mkOrder(); ran(await req('get', `/api/orders/${o._id}`)); });
  it('park → parked list → recall(delete parked)', async () => {
    const o = await mkOrder();
    const p = await req('post', '/api/orders/park', T.staff).send({ orderId: o._id });
    ran(p);
    ran(await req('get', '/api/orders/parked', T.staff));
    ran(await req('delete', `/api/orders/parked/${o._id}`, T.staff));
  });
  it('complimentary apply + remove', async () => {
    const o = await mkOrder();
    ran(await req('put', `/api/orders/${o._id}/complimentary`, T.staff).send({ reasonType: 'EMPLOYEE_MEAL', approvedBy: 'fc_super', forEmployee: 'fc_staff' }));
    ran(await req('delete', `/api/orders/${o._id}/complimentary`, T.staff));
  });
  it('dispatch status', async () => { const o = await mkOrder(); ran(await req('patch', `/api/orders/${o._id}/dispatch`, T.staff).send({ dispatchStatus: 'Preparing' })); });
  it('partial-delivery + partial-fulfill', async () => {
    const o = await mkOrder(3);
    ran(await req('post', `/api/orders/${o._id}/partial-delivery`, T.staff).send({ deliveredItems: [{ index: 0, qty: 1 }] }));
    ran(await req('post', `/api/orders/${o._id}/partial-fulfill`, T.staff).send({ mode: 'partial', items: [{ index: 0, qty: 1 }] }));
  });
  it('refund a completed order', async () => {
    const o = await mkOrder();
    await req('put', `/api/orders/${o._id}`, T.staff).send({ status: 'Completed' });
    ran(await req('post', `/api/orders/${o._id}/refund`, T.super).send({ reason: 'Customer request', amount: 120 }));
  });
  it('GET archives + POST archive', async () => {
    ran(await req('get', '/api/orders/archives', T.super));
    ran(await req('post', '/api/orders/archive', T.staff).send({}));
  });
});

describe('revolving funds: list, transactions, close', () => {
  it('list + open + transactions + close', async () => {
    ran(await req('get', '/api/revolving-funds', T.super));
    const f = await req('post', '/api/revolving-funds', T.super).send({ name: 'FC Fund', initialAmount: 500 });
    expect(f.status).toBe(200);
    const fid = f.body.fund._id;
    ran(await req('get', `/api/revolving-funds/${fid}/transactions`, T.super));
    ran(await req('patch', `/api/revolving-funds/${fid}/close`, T.super).send({}));
  });
});
