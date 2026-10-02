// Two batches of the same product on one purchase order - same delivery,
// different expiry. Each line is received on its own, so each goes into stock
// as its own batch with its own date.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, invId;
const auth = () => ({ Authorization: `Bearer ${tok}` });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PoBatchBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'PoBatchBoss');
  const inv = await mongoose.model('Inventory').create({
    itemCode: 'OAT-1', itemName: 'OATSIDE BARISTA EDITION', stockQty: 0, unit: 'ml',
    unitCost: 0, displayUnit: 'L', unitMultiplier: 1000, packSize: 1, businessType: 'log',
  });
  invId = String(inv._id);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('one product, two batches on a purchase order', () => {
  it('each batch goes into stock with its own expiry', async () => {
    const line = { invId, itemName: 'OATSIDE BARISTA EDITION', unit: 'L', packSize: 1, unitCost: 115 };
    const created = await request(app).post('/api/purchase-orders').set(auth()).send({
      supplier: 'Oat Supplier',
      lines: [
        { ...line, orderedQty: 10, expiryDate: '2027-03-31' },
        { ...line, orderedQty: 6, expiryDate: '2027-05-31' },
      ],
    });
    expect(created.body.success, JSON.stringify(created.body)).toBe(true);
    const po = created.body.purchaseOrder;
    expect(po.lines).toHaveLength(2);

    const r = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth()).send({ received: [
      { lineId: po.lines[0]._id, receivedQty: 10, expiryDate: '2027-03-31' },
      { lineId: po.lines[1]._id, receivedQty: 6, expiryDate: '2027-05-31' },
    ] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const item = await mongoose.model('Inventory').findById(invId).lean();
    expect(item.stockQty).toBe(16000);   // 16 L, in ml
    const batches = (item.expiryBatches || []).map(b => [new Date(b.expiryDate).toISOString().slice(0, 10), b.qty]).sort();
    expect(batches).toEqual([['2027-03-31', 10000], ['2027-05-31', 6000]]);
    // The soonest one is what the expiry warning watches.
    expect(new Date(item.expiryDate).toISOString().slice(0, 10)).toBe('2027-03-31');
  });
});
