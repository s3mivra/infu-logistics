// A count sheet's dates come in, every row of them. A product already in stock
// whose count did not go up used to keep its old expiry - only an increase
// recorded the sheet's date.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const imp = (items) => request(app).post('/api/inventory/import').set('Authorization', `Bearer ${tok}`).send({ items });
const batchesOf = async (code) => {
  const it = await mongoose.model('Inventory').findOne({ itemCode: code }).lean();
  return { qty: it.stockQty, batches: (it.expiryBatches || []).map(b => [b.expiryDate ? new Date(b.expiryDate).toISOString().slice(0, 10) : null, b.qty]).sort() };
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'impDates', role: 'superadmin' });
  tok = await loginStaff(app, 'impDates');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('dates on a count sheet', () => {
  it('a recount with the same quantity still takes the new date, and a second row adds its batch', async () => {
    expect((await imp([{ itemCode: 'TEA-1', itemName: 'HIBISCUS TEA', displayUnit: 'pcs', qty: 10, unitCost: 380, expiryDate: '2027-03-31' }])).status).toBe(200);
    expect(await batchesOf('TEA-1')).toEqual({ qty: 10, batches: [['2027-03-31', 10]] });

    const r = await imp([
      { itemCode: 'TEA-1', itemName: 'HIBISCUS TEA', displayUnit: 'pcs', qty: 10, unitCost: 380, expiryDate: '2027-05-31' },
      { itemCode: 'TEA-1', itemName: 'HIBISCUS TEA', displayUnit: 'pcs', qty: 5, unitCost: 380, expiryDate: '2027-07-31' },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await batchesOf('TEA-1')).toEqual({ qty: 15, batches: [['2027-05-31', 10], ['2027-07-31', 5]] });
  });

  it('a row with no date leaves the batches as they were', async () => {
    await imp([{ itemCode: 'TEA-2', itemName: 'GREEN TEA', displayUnit: 'pcs', qty: 8, unitCost: 300, expiryDate: '2027-04-30' }]);
    await imp([{ itemCode: 'TEA-2', itemName: 'GREEN TEA', displayUnit: 'pcs', qty: 8, unitCost: 300 }]);
    expect(await batchesOf('TEA-2')).toEqual({ qty: 8, batches: [['2027-04-30', 8]] });
  });
});
