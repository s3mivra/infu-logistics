// EOD variance export - EODRecord itself only ever stored the lock flag, so
// the variance report is reconstructed from the StockCard 'Adjustment'
// entries locking creates (see /api/inventory/eod-history* routes).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'eod-hist-test-secret-0123456789' }));
  await makeUser({ name: 'EodBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'EodBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('EOD variance history', () => {
  it('locking a day with a variance shows up in history + variance report', async () => {
    const inv = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'EOD Variance Widget', unit: 'pcs', stockQty: 50, unitCost: 10 });
    expect(inv.body.success).toBe(true);
    const id = inv.body.item._id;

    const lockRes = await request(app).post('/api/inventory/count').set(auth(superToken))
      .send({ counts: { [id]: 45 }, reasons: { [id]: 'Breakage' }, adminName: 'EodBoss' });
    expect(lockRes.body.success).toBe(true);

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const list = await request(app).get('/api/inventory/eod-history').set(auth(superToken));
    expect(list.body.success).toBe(true);
    expect(list.body.records.some(r => r.dateString === todayStr && r.lockedBy === 'EodBoss')).toBe(true);

    const variance = await request(app).get(`/api/inventory/eod-history/${todayStr}/variance`).set(auth(superToken));
    expect(variance.body.success).toBe(true);
    const row = variance.body.rows.find(r => r.itemName.toUpperCase() === 'EOD VARIANCE WIDGET');
    expect(row).toBeTruthy();
    expect(row.qtyChange).toBe(-5);
    expect(row.valueImpact).toBe(-50); // -5 * 10
    expect(row.reason).toBe('Breakage');
    expect(variance.body.totalValueImpact).toBeLessThanOrEqual(-50);
  });

  it('rejects a malformed date', async () => {
    const res = await request(app).get('/api/inventory/eod-history/not-a-date/variance').set(auth(superToken));
    expect(res.status).toBe(400);
  });
});
