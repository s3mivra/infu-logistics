// The inventory export is written in the import sheet's own shape.
//
// Stock is stored in base units (g / ml / pcs) with cost per base unit, and the
// export used to print those storage values directly: BEANS PROFILE(2) 1kg,
// bought at P386, came out as "g, 0.39" - rounded until 386 read as 390, in a
// layout no importer could take back. These rows are from the real sheet.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'invexport-secret-0123456789' }));
  await makeUser({ name: 'ExportBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'ExportBoss', 'pw');
  // Stored exactly as the importer stores them: sheet cost per pack, divided
  // by pack size, divided by the unit multiplier.
  await mongoose.model('Inventory').create([
    { itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
      packSize: 1, unitCost: 386 / 1000, stockQty: 3000, srp: 386, businessType: 'fb' },
    { itemCode: 'G40005', itemName: 'ALASKA CONDENSED', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
      packSize: 0.377, unitCost: 66 / 377, stockQty: 754, businessType: 'fb' },
    { itemCode: 'G40007', itemName: 'STRAW SMALL', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      packSize: 100, unitCost: 45 / 100, stockQty: 250, businessType: 'fb' },
    { itemCode: 'G80004', itemName: 'DRIED STRAWBERRY', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      packSize: null, unitCost: 369, stockQty: 0, businessType: 'fb' },
  ]);
}, 120000);

afterAll(async () => { await stop(); });

const exportSheet = async () => {
  const res = await request(app).get('/api/export/inventory').set({ Authorization: `Bearer ${tok}` });
  expect(res.status).toBe(200);
  const col = (name) => res.body.columns.indexOf(name);
  const byCode = Object.fromEntries(res.body.rows.filter(r => r[col('Product')]).map(r => [r[col('Code')], r]));
  return { byCode, col, columns: res.body.columns };
};

describe('inventory export, in the import sheet shape', () => {
  it('leads with exactly the columns the importer reads', async () => {
    const { columns } = await exportSheet();
    expect(columns.slice(0, 9)).toEqual(['Code', 'Product', 'Pack', 'Unit', 'Qty', 'Cost / pack', 'SRP / unit', 'Expiry date', 'Production date']);
  });

  it('says the pack in its own columns and leaves the name alone', async () => {
    const { byCode, col } = await exportSheet();
    expect(byCode.G10001[col('Product')]).toBe('BEANS PROFILE(2)');
    expect([byCode.G10001[col('Pack')], byCode.G10001[col('Unit')]]).toEqual([1, 'kg']);
    // 377 g stays 377 g rather than becoming 0.377 kg - it is how the tin is sold.
    expect([byCode.G40005[col('Pack')], byCode.G40005[col('Unit')]]).toEqual([377, 'g']);
    expect([byCode.G40007[col('Pack')], byCode.G40007[col('Unit')]]).toEqual([100, 'pcs']);
  });

  it('costs per pack, as it is bought, and prices per unit, as it is sold', async () => {
    const { byCode, col } = await exportSheet();
    expect(byCode.G10001[col('Cost / pack')]).toBe(386);
    expect(byCode.G10001[col('SRP / unit')]).toBe(386);   // per kg, and the pack is 1 kg
    expect(byCode.G40005[col('Cost / pack')]).toBe(66);
    expect(byCode.G40007[col('Cost / pack')]).toBe(45);
  });

  it('counts packs, as a plain number', async () => {
    const { byCode, col } = await exportSheet();
    expect(byCode.G10001[col('Qty')]).toBe(3);
    expect(byCode.G40005[col('Qty')]).toBe(2);
    expect(byCode.G40007[col('Qty')]).toBe(2.5);
  });

  it('leaves Pack blank for an item that has no pack, so it stays unpacked', async () => {
    const { byCode, col } = await exportSheet();
    expect(byCode.G80004[col('Product')]).toBe('DRIED STRAWBERRY');
    expect(byCode.G80004[col('Pack')]).toBe('');
    expect(byCode.G80004[col('Unit')]).toBe('pcs');
    expect(byCode.G80004[col('Qty')]).toBe(0);
    expect(byCode.G80004[col('Cost / pack')]).toBe(369);
  });

  it('keeps the storage figures, at full precision, as reference columns', async () => {
    const { byCode, col } = await exportSheet();
    // 0.386, not 0.39 - the rounding that turned P386/kg into P390/kg.
    expect(byCode.G10001[col('Cost per Base Unit')]).toBe(0.386);
    expect(byCode.G10001[col('Base Unit')]).toBe('g');
    expect(byCode.G10001[col('Total Value')]).toBe(1158);
  });
});
