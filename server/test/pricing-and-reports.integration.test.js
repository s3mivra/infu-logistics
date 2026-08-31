// Coverage for the reorder/vendor-statement/audit-export/turnover/trend endpoints
// and the segment + bulk-quantity discount pricing rules added alongside them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, cat;

const auth = (method, path, token) =>
  request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'pr_super', role: 'superadmin' });
  await makeUser({ name: 'pr_staff', role: 'staff' });
  superTok = await loginStaff(app, 'pr_super');
  staffTok = await loginStaff(app, 'pr_staff');
  cat = await mongoose.model('Category').create({ name: 'PR-Cat', department: 'Kitchen' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('reorder suggestions carry per-line supplier attribution', () => {
  it('resolves the cheapest matching supplier from the catalog onto each suggestion line', async () => {
    const Inventory = mongoose.model('Inventory');
    const inv = await Inventory.create({
      itemCode: 'PR-ITEM', itemName: 'PR Reorder Item', stockQty: 0, unit: 'pcs',
      unitCost: 5, lowStockThreshold: 100, displayUnit: 'pcs', unitMultiplier: 1,
    });

    const expensive = await auth('post', '/api/suppliers', superTok).send({ name: 'PR Pricey Supplier' });
    const cheap = await auth('post', '/api/suppliers', superTok).send({ name: 'PR Cheap Supplier' });
    await auth('post', `/api/suppliers/${expensive.body.supplier._id}/products`, superTok)
      .send({ itemName: 'PR Reorder Item', invId: String(inv._id), unitCost: 20 });
    await auth('post', `/api/suppliers/${cheap.body.supplier._id}/products`, superTok)
      .send({ itemName: 'PR Reorder Item', invId: String(inv._id), unitCost: 8 });

    const res = await auth('get', '/api/reports/purchase-order?days=7', superTok);
    expect(res.status).toBe(200);
    const line = res.body.lines.find(l => l.itemName === 'PR Reorder Item');
    expect(line).toBeTruthy();
    expect(String(line.invId)).toBe(String(inv._id));
    expect(line.supplierId).toBe(String(cheap.body.supplier._id));
    expect(line.supplierName).toBe(cheap.body.supplier.name); // server title-cases the name on create
  });

  it('leaves supplier fields null for an item no supplier catalogs', async () => {
    await mongoose.model('Inventory').create({
      itemCode: 'PR-UNMATCHED', itemName: 'PR Unmatched Item', stockQty: 0, unit: 'pcs',
      unitCost: 3, lowStockThreshold: 100,
    });
    const res = await auth('get', '/api/reports/purchase-order?days=7', superTok);
    const line = res.body.lines.find(l => l.itemName === 'PR Unmatched Item');
    expect(line).toBeTruthy();
    expect(line.supplierId).toBeNull();
  });
});

describe('vendor statement: opening balance -> entries -> closing balance', () => {
  it('carries a prior-period invoice into the opening balance, and shows a new-period invoice as an entry', async () => {
    const inv = await mongoose.model('Inventory').create({
      itemCode: 'PR-VS-ITEM', itemName: 'PR VS Item', stockQty: 0, unit: 'pcs', unitCost: 0,
    });
    const supplier = await auth('post', '/api/suppliers', superTok).send({ name: 'PR VS Supplier' });
    const supplierId = supplier.body.supplier._id;

    const receiveFor = async (date, qty, unitCost) => {
      const po = await auth('post', '/api/purchase-orders', superTok).send({
        supplier: 'PR VS Supplier', supplierId,
        lines: [{ invId: String(inv._id), itemName: 'PR VS Item', unit: 'pcs', packSize: 1, orderedQty: qty, unitCost }],
      });
      await auth('post', `/api/purchase-orders/${po.body.purchaseOrder._id}/receive`, superTok)
        .send({ received: [{ lineId: po.body.purchaseOrder.lines[0]._id, receivedQty: qty }] });
      if (date) {
        // The receipt posts its own JournalEntry with a fresh sequence reference
        // (not the PO number) - back-date the one this call just created rather
        // than trying to guess its reference.
        const je = await mongoose.model('JournalEntry').findOne({ supplierId }).sort({ createdAt: -1 });
        je.date = date;
        await je.save();
      }
    };

    // An invoice booked well before the statement window - should land in openingBalance.
    await receiveFor(new Date('2024-01-15'), 10, 50); // ₱500

    const statement1 = await auth('get', `/api/finance/vendor-statement/${supplierId}?start=2024-05-01&end=2024-07-30`, superTok);
    expect(statement1.status).toBe(200);
    expect(statement1.body.openingBalance).toBeCloseTo(500, 2);
    expect(statement1.body.entries).toHaveLength(0);
    expect(statement1.body.closingBalance).toBeCloseTo(500, 2);

    // An invoice inside a later window - should show as an entry, not fold into opening.
    await receiveFor(new Date('2024-06-01'), 4, 25); // ₱100
    const statement2 = await auth('get', `/api/finance/vendor-statement/${supplierId}?start=2024-05-01&end=2024-07-30`, superTok);
    expect(statement2.body.openingBalance).toBeCloseTo(500, 2);
    expect(statement2.body.entries).toHaveLength(1);
    expect(statement2.body.entries[0].invoiceAmount).toBeCloseTo(100, 2);
    expect(statement2.body.closingBalance).toBeCloseTo(600, 2);
  });

  it('404s for a supplier that does not exist', async () => {
    const res = await auth('get', `/api/finance/vendor-statement/${new mongoose.Types.ObjectId()}?start=2024-05-01&end=2024-07-30`, superTok);
    expect(res.status).toBe(404);
  });

  it('is gated behind accounting.view (staff 403)', async () => {
    const supplier = await auth('post', '/api/suppliers', superTok).send({ name: 'PR VS Gate Supplier' });
    const res = await auth('get', `/api/finance/vendor-statement/${supplier.body.supplier._id}?start=2024-05-01&end=2024-07-30`, staffTok);
    expect(res.status).toBe(403);
  });
});

describe('audit log CSV export', () => {
  it('rejects an export with no date range', async () => {
    const res = await auth('get', '/api/audit-logs/export', superTok);
    expect(res.status).toBe(400);
  });

  it('streams a CSV for a bounded range', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await auth('get', `/api/audit-logs/export?start=${today}&end=${today}`, superTok);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toBe('Timestamp,User,Action,Target,Notes');
  });

  it('is gated behind audit.view (staff 403)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await auth('get', `/api/audit-logs/export?start=${today}&end=${today}`, staffTok);
    expect(res.status).toBe(403);
  });
});

describe('inventory turnover ratio', () => {
  it('returns a computed ratio (or null when there is no inventory value yet)', async () => {
    const res = await auth('get', '/api/reports/inventory-turnover', superTok);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cogs');
    expect(res.body).toHaveProperty('avgInventoryValue');
    expect(res.body).toHaveProperty('turnoverRatio');
    expect(res.body.estimate).toBe(true);
  });
});

describe('sales trend', () => {
  it('buckets revenue and reports a vs-prior-period change', async () => {
    const prod = await mongoose.model('Product').create({ name: 'PR Trend Product', category: 'PR-Cat', basePrice: 50 });
    const created = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Trend Product', price: 50, quantity: 2 }],
      table: 'Takeout', paymentMethod: 'Cash',
    });
    await auth('put', `/api/orders/${created.body.order._id}`, staffTok).send({ status: 'Completed' });

    const res = await auth('get', '/api/reports/sales-trend?period=week', superTok);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.buckets)).toBe(true);
    expect(res.body.currentTotal).toBeGreaterThanOrEqual(100);
    expect(res.body).toHaveProperty('changePct');
  });

  it('rejects a range over the 92-day cap', async () => {
    const res = await auth('get', '/api/reports/sales-trend?start=2024-01-01&end=2024-12-31', superTok);
    expect(res.status).toBe(400);
  });
});

describe('segment discounts: precedence over the flat product discount', () => {
  it('applies the highest matching segment rate for an on-behalf client order', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'PR-SEG-1', username: 'pr_seg_client', name: 'PR Segment Client',
      password: 'x', paymentMethod: 'Cash', isActive: true, segments: ['wholesale'],
    });
    const prod = await mongoose.model('Product').create({
      name: 'PR Segment Product', category: 'PR-Cat', basePrice: 100, discountPercent: 5,
      segmentDiscounts: [{ segment: 'wholesale', percent: 20 }, { segment: 'vip', percent: 50 }],
    });

    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Segment Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // 20% (wholesale) beats the flat 5% default; the client isn't tagged 'vip' so 50% doesn't apply.
    expect(res.body.order.total).toBeCloseTo(80, 2);
  });

  it('falls back to the flat product discount when the buyer has no matching segment', async () => {
    const prod = await mongoose.model('Product').create({
      name: 'PR Segment Product 2', category: 'PR-Cat', basePrice: 100, discountPercent: 5,
      segmentDiscounts: [{ segment: 'wholesale', percent: 20 }],
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Segment Product 2', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', // no clientAccountId
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(95, 2);
  });
});

describe('bulk quantity discounts: combined with product discount via max, not stacked', () => {
  it('applies the qualifying bulk-break rate when it beats the flat discount', async () => {
    const prod = await mongoose.model('Product').create({
      name: 'PR Bulk Product', category: 'PR-Cat', basePrice: 100, discountPercent: 5,
      bulkBreaks: [{ minQty: 5, percent: 15 }, { minQty: 10, percent: 25 }],
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Bulk Product', price: 100, quantity: 5 }],
      table: 'Takeout', paymentMethod: 'Cash',
    });
    expect(res.status).toBe(200);
    // 5 * 100 = 500 gross; 15% bulk break beats the flat 5% → 425.
    expect(res.body.order.total).toBeCloseTo(425, 2);
  });

  it('does not apply a break the quantity does not qualify for', async () => {
    const prod = await mongoose.model('Product').create({
      name: 'PR Bulk Product 2', category: 'PR-Cat', basePrice: 100, discountPercent: 5,
      bulkBreaks: [{ minQty: 10, percent: 25 }],
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Bulk Product 2', price: 100, quantity: 3 }],
      table: 'Takeout', paymentMethod: 'Cash',
    });
    expect(res.status).toBe(200);
    // Below minQty 10 → falls back to the flat 5% discount → 285.
    expect(res.body.order.total).toBeCloseTo(285, 2);
  });
});

// clientBulkBreaks is the client-specific counterpart to bulkBreaks above:
// a client who already has a discount on a product gets an even bigger break
// once they order enough of it - but quoted as a real PRICE ("₱180 each at
// 50+"), not a percent, and unlike bulkBreaks it applies to NOBODY else at
// the same quantity.
describe('client-specific bulk pricing: a quoted price at volume, only for the named client', () => {
  it('converts the quoted price to a discount and combines it via max with the flat rate', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'PR-CBB-1', username: 'pr_cbb_client', name: 'PR Client Bulk Client',
      password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    const prod = await mongoose.model('Product').create({
      name: 'PR Client Bulk Product', category: 'PR-Cat', basePrice: 200, discountPercent: 5,
      // 50+ of this, for THIS client, is ₱150 each - a 25% break, well past
      // their existing 5% flat rate.
      clientBulkBreaks: [{ clientId: String(client._id), minQty: 50, price: 150 }],
    });

    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Client Bulk Product', price: 200, quantity: 50 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // 50 * ₱150 = 7500, not 50 * 200 * 0.95 = 9500.
    expect(res.body.order.total).toBeCloseTo(7500, 2);
  });

  it('does not apply below the quantity threshold - falls back to the flat rate', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'PR-CBB-2', username: 'pr_cbb_client2', name: 'PR Client Bulk Client 2',
      password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    const prod = await mongoose.model('Product').create({
      name: 'PR Client Bulk Product 2', category: 'PR-Cat', basePrice: 200, discountPercent: 5,
      clientBulkBreaks: [{ clientId: String(client._id), minQty: 50, price: 150 }],
    });

    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Client Bulk Product 2', price: 200, quantity: 10 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // Only 10, not 50+ - just the flat 5%: 10 * 200 * 0.95 = 1900.
    expect(res.body.order.total).toBeCloseTo(1900, 2);
  });

  it('never applies to a DIFFERENT client, even at the qualifying quantity', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const namedClient = await ClientAccount.create({
      clientCode: 'PR-CBB-3', username: 'pr_cbb_client3', name: 'PR Client Bulk Client 3',
      password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    const otherClient = await ClientAccount.create({
      clientCode: 'PR-CBB-4', username: 'pr_cbb_client4', name: 'PR Someone Else',
      password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    const prod = await mongoose.model('Product').create({
      name: 'PR Client Bulk Product 3', category: 'PR-Cat', basePrice: 200,
      clientBulkBreaks: [{ clientId: String(namedClient._id), minQty: 50, price: 150 }],
    });

    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Client Bulk Product 3', price: 200, quantity: 50 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(otherClient._id),
    });
    expect(res.status).toBe(200);
    // The break is quoted to a DIFFERENT client - this buyer pays full price.
    expect(res.body.order.total).toBeCloseTo(10000, 2);
  });

  it('among several qualifying tiers, the best (lowest) price wins', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'PR-CBB-5', username: 'pr_cbb_client5', name: 'PR Client Bulk Client 5',
      password: 'x', paymentMethod: 'Cash', isActive: true,
    });
    const prod = await mongoose.model('Product').create({
      name: 'PR Client Bulk Product 4', category: 'PR-Cat', basePrice: 200,
      clientBulkBreaks: [
        { clientId: String(client._id), minQty: 20, price: 180 },
        { clientId: String(client._id), minQty: 50, price: 150 },
      ],
    });

    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PR Client Bulk Product 4', price: 200, quantity: 60 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // Qualifies for both tiers (20+ and 50+); the better price (150) wins.
    expect(res.body.order.total).toBeCloseTo(9000, 2);
  });
});
