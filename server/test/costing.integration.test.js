// Costing sheets (features/costing.js): saved, listed, changed and deleted;
// only what a sheet is made of is stored; staff without product management
// can read but not change them; and a price applied from a sheet goes through
// the normal price-change route, approval gate included.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { cleanSheet } from '../features/costing.js';

let ctx, as, asStaff;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  await makeUser({ name: 'costSuper', role: 'superadmin' });
  await makeUser({ name: 'costStaff', role: 'staff', permissions: ['products.view', 'products.manage'] });
  const s = await loginStaff(ctx.app, 'costSuper'), t = await loginStaff(ctx.app, 'costStaff');
  as = (m, p) => request(ctx.app)[m](p).set('Authorization', `Bearer ${s}`);
  asStaff = (m, p) => request(ctx.app)[m](p).set('Authorization', `Bearer ${t}`);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('costing sheets', () => {
  it('keeps only what a sheet is made of, within bounds', () => {
    expect(cleanSheet({}).error).toMatch(/name/);
    const { sheet } = cleanSheet({ name: '  Latte  ', method: 'margin', rate: 150, vatRate: 12, lines: [{ kind: 'weird', amount: -5, hack: 1 }, { kind: 'stock', invId: 'abc', qty: 18, unit: 'g' }] });
    expect(sheet).toMatchObject({ name: 'Latte', method: 'margin', rate: 0, vatRate: 12 });   // a margin of 150% is impossible
    expect(sheet.lines[0]).toEqual({ kind: 'amount', invId: null, name: '', qty: 0, unit: '', amount: 0, percent: 0 });
    expect(sheet.lines[1]).toMatchObject({ kind: 'stock', invId: 'abc', qty: 18, unit: 'g' });
  });

  it('saves, lists, changes and deletes a sheet', async () => {
    const created = await as('post', '/api/costing/sheets').send({ name: 'Iced Latte 16oz', method: 'markup', rate: 60, lines: [{ kind: 'amount', name: 'Cup', amount: 6 }], lastCost: 6, lastSrp: 10 });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.sheet._id;
    expect((await as('get', '/api/costing/sheets')).body.sheets.map(s => s.name)).toContain('Iced Latte 16oz');
    const changed = await as('put', `/api/costing/sheets/${id}`).send({ name: 'Iced Latte 16oz', rate: 70, lines: [], appliedPrice: 120 });
    expect(changed.body.sheet).toMatchObject({ rate: 70, appliedPrice: 120 });
    expect(changed.body.sheet.appliedAt).toBeTruthy();
    expect((await as('delete', `/api/costing/sheets/${id}`)).status).toBe(200);
    expect((await as('delete', `/api/costing/sheets/${id}`)).status).toBe(404);
  });

  it('someone who can only view products can read sheets but not change them', async () => {
    await makeUser({ name: 'costViewer', role: 'staff', permissions: ['products.view'] });
    const v = await loginStaff(ctx.app, 'costViewer');
    const asViewer = (m, p) => request(ctx.app)[m](p).set('Authorization', `Bearer ${v}`);
    expect((await asViewer('get', '/api/costing/sheets')).status).toBe(200);
    expect((await asViewer('post', '/api/costing/sheets').send({ name: 'Nope' })).status).toBe(403);
  });

  it('a price applied from a costing by someone without approval rights waits for sign-off', async () => {
    const p = await mongoose.model('Product').create({ name: 'COST LATTE', basePrice: 150, category: 'Coffee', businessType: 'fb' });
    const r = await asStaff('put', `/api/products/${p._id}`).set('X-Change-Reason', encodeURIComponent('Costing: Latte')).send({ basePrice: 165 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.pendingApproval?.length).toBe(1);
    expect((await mongoose.model('Product').findById(p._id).lean()).basePrice).toBe(150);   // unchanged until approved
    const byOwner = await as('put', `/api/products/${p._id}`).set('X-Change-Reason', encodeURIComponent('Costing: Latte')).send({ basePrice: 165 });
    expect(byOwner.body.pendingApproval).toBeUndefined();
    expect((await mongoose.model('Product').findById(p._id).lean()).basePrice).toBe(165);
  });
});
