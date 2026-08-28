// Hub transfers must arrive as real, valued stock - and must show up in the
// item's stock card history.
//
// Two bugs this locks down:
//
//  1. An auto-created receiving item was built with `unitCost: 0` and no
//     descriptors, so the shipment was valued at nothing: the inbound journal
//     entry posted 0 and the stock landed worthless. The sending item's cost
//     and display descriptors now travel with the shipment.
//
//  2. Both stock cards were written with itemId/movementType/qty/note - none
//     of which exist on StockCardSchema, so mongoose's strict mode silently
//     dropped them. The card ended up with no inventoryId and no qtyChange,
//     which is why a transfer that moved stock AND posted a ledger entry never
//     appeared under the item's History action.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hub-valuation-test-secret-0123456789' }));
  await makeUser({ name: 'ValBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ValBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

// Stand in for a shipment arriving from a partner business.
const inbound = (over = {}) => mongoose.model('CrossTransfer').create({
  businessType: 'log', direction: 'inbound',
  partnerSlug: 'sender-co', partnerName: 'Sender Co',
  itemName: 'Imported Widget', unit: 'pcs', qtyBase: 100,
  unitCost: 12, displayUnit: 'box', unitMultiplier: 1, packSize: 24,
  stockCategory: 'Dry Goods',
  reference: `HT-VAL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  status: 'Pending',
  ...over,
});

describe('receiving a hub transfer', () => {
  it('auto-creates the item with the sender\'s cost and descriptors, not a zero-cost stub', async () => {
    const t = await inbound();

    const res = await request(app).post(`/api/hub/transfers/${t._id}/accept`).set(auth(superToken))
      .send({ createNew: true });
    expect(res.status).toBe(200);

    const item = await mongoose.model('Inventory').findOne({ itemName: 'Imported Widget' }).lean();
    expect(item.stockQty).toBe(100);
    expect(item.unitCost).toBe(12);          // was 0 before this fix
    expect(item.displayUnit).toBe('box');
    expect(item.packSize).toBe(24);
  });

  it('posts the inbound journal entry at real value, not zero', async () => {
    const je = await mongoose.model('JournalEntry')
      .findOne({ description: /Hub transfer in.*Imported Widget/ }).lean();
    expect(je).toBeTruthy();
    // 100 units x PHP 12 - the whole point: the receiving books show what the
    // goods are actually worth.
    expect(je.totalDebit).toBe(1200);
    expect(je.lines.find(l => l.debit > 0).accountCode).toBe('130000');
  });

  it('the receipt shows up in the item\'s stock card history', async () => {
    const item = await mongoose.model('Inventory').findOne({ itemName: 'Imported Widget' }).lean();

    // This is the exact call the History action button makes.
    const res = await request(app).get(`/api/inventory/history/${item._id}`).set(auth(superToken));
    expect(res.status).toBe(200);

    const card = res.body.history.find(h => h.type === 'Transfer In');
    expect(card).toBeTruthy();               // previously absent entirely
    expect(card.qtyChange).toBe(100);
    expect(card.balanceAfter).toBe(100);
    expect(card.unitCost).toBe(12);
  });

  it('blends the incoming cost into an existing item by weighted average', async () => {
    const existing = await mongoose.model('Inventory').create({
      businessType: 'log', itemName: 'Blend Widget', unit: 'pcs', stockQty: 100, unitCost: 10,
    });
    const t = await inbound({ itemName: 'Blend Widget', qtyBase: 100, unitCost: 12 });

    const res = await request(app).post(`/api/hub/transfers/${t._id}/accept`).set(auth(superToken))
      .send({ itemId: String(existing._id) });
    expect(res.status).toBe(200);

    const after = await mongoose.model('Inventory').findById(existing._id).lean();
    expect(after.stockQty).toBe(200);
    // 100@10 + 100@12 -> 200@11. Neither keeping 10 nor overwriting with 12.
    expect(after.unitCost).toBeCloseTo(11, 6);
  });

  it('still receives when the sender sent no cost - it just falls back, never crashes', async () => {
    // A partner running an older build sends none of the descriptor fields.
    const t = await inbound({ itemName: 'Legacy Widget', unitCost: 0, displayUnit: '', packSize: null });

    const res = await request(app).post(`/api/hub/transfers/${t._id}/accept`).set(auth(superToken))
      .send({ createNew: true });
    expect(res.status).toBe(200);

    const item = await mongoose.model('Inventory').findOne({ itemName: 'Legacy Widget' }).lean();
    expect(item.stockQty).toBe(100);
    expect(item.unitCost).toBe(0);
  });
});

describe('sending side', () => {
  it('records the outgoing movement as a NEGATIVE stock card on the source item', async () => {
    const item = await mongoose.model('Inventory').create({
      businessType: 'log', itemName: 'Outbound Widget', unit: 'pcs', stockQty: 500, unitCost: 8,
    });
    await mongoose.model('LinkedBusiness').create({
      businessType: 'log', role: 'client', partnerSlug: 'release-partner', partnerName: 'Release Partner',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'release-token', status: 'active',
    });
    const out = await mongoose.model('CrossTransfer').create({
      businessType: 'log', direction: 'outbound',
      partnerSlug: 'release-partner', partnerName: 'Release Partner',
      itemId: item._id, itemName: item.itemName, unit: 'pcs', qtyBase: 120,
      unitCost: 8, reference: 'HT-REL-1', status: 'Pending',
    });

    // The partner calls this back on us once they accept.
    const res = await request(app).post('/api/hub/internal/transfer-release')
      .set('x-link-token', 'release-token').send({ reference: out.reference });
    expect(res.status).toBe(200);

    const after = await mongoose.model('Inventory').findById(item._id).lean();
    expect(after.stockQty).toBe(380);

    const hist = await request(app).get(`/api/inventory/history/${item._id}`).set(auth(superToken));
    const card = hist.body.history.find(h => h.type === 'Transfer Out');
    expect(card).toBeTruthy();
    // Negative: stock LEFT. A card that doesn't sign its movement makes the
    // running balance in the history meaningless.
    expect(card.qtyChange).toBe(-120);
    expect(card.balanceAfter).toBe(380);
  });
});
