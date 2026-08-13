// Load-test data seeder — Part 2 of the pre-launch spec (4-tenant KVM2).
//
// Generates realistic-volume BACKDATED Completed order history (plus matching
// Sales & COGS journal entries) so k6 scenarios exercise the dashboard, P&L,
// balance sheet, and order-history endpoints against real data sizes instead
// of empty databases — which hide exactly the query-shape problems this whole
// exercise exists to catch (see the Part 1 dashboard-aggregation fix).
//
// Run this AFTER Part 1 (the TenantStats/ProductStats counters) ships, then
// run `node scripts/backfill-stats.mjs` once afterward so the seeded history
// is reflected in the counters the dashboard actually reads — this script
// deliberately does NOT touch TenantStats/ProductStats itself, to keep the
// backfill script as the single place that ever computes them from history.
//
// Run against ONE tenant's MONGO_URI at a time (one deployment per business,
// per this repo's architecture) — re-run per tenant with each tenant's env.
//
// Usage (from server/):
//   node scripts/seed-load-test-data.mjs
//   node scripts/seed-load-test-data.mjs --orders=50000 --months=12
//   node scripts/seed-load-test-data.mjs --clean         # remove previously seeded orders/journal entries only
//
// Scope / deliberate simplifications (documented, not accidental):
//   - Does NOT mutate Inventory.stockQty or write StockCard rows. Decrementing
//     real stock 20k-50k times would leave inventory in a nonsensical state for
//     anyone manually testing the SAME environment afterward. If you need
//     inventory-specific load (low-stock/velocity queries), seed Inventory
//     quantities separately.
//   - Complimentary orders (~2% of volume) get an Order doc but no journal
//     entry (the real ERP engine's comp branch is a separate code path not
//     worth duplicating here) — this still exercises the dashboard's comp-
//     revenue math, just not the accounting reports for that slice.
//   - COGS is estimated at a flat 35% of revenue per order, not derived from
//     actual recipes — fine for load-testing query shape/volume, not for
//     testing COGS accuracy (that's what the real ERP engine's own tests are for).
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const BUSINESS_TYPE = (args['business-type'] || process.env.BUSINESS_TYPE || 'fb').toLowerCase();
// `?? 30000`, not `|| 30000` — `--orders=0` (e.g. to top up inventory/products
// without adding any orders) is a legitimate, meaningful value, and `||`
// would silently discard it (0 is falsy) and fall back to the 30000 default.
const ORDER_COUNT = args.orders !== undefined ? Number(args.orders) : 30000;
const MONTHS_BACK = Number(args.months) || 9;
const SEED_TAG = 'LOAD-TEST'; // stamped into orderNumber prefix + a marker field so --clean can find these later
const BATCH_SIZE = 2000;

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

if (args.clean) {
  console.log(`[clean] Removing previously seeded load-test orders/journal entries for businessType=${BUSINESS_TYPE}...`);
  const or = await db.collection('orders').deleteMany({ businessType: BUSINESS_TYPE, loadTestSeed: true });
  const jr = await db.collection('journalentries').deleteMany({ reference: { $regex: `^${SEED_TAG}-` } });
  console.log(`[clean] Removed ${or.deletedCount} order(s), ${jr.deletedCount} journal entry(ies).`);
  await mongoose.disconnect();
  process.exit(0);
}

// --- Product catalog: use what's there, or seed a minimal synthetic one so
// this script runs standalone against a fresh tenant with no manual setup. ---
let products = await db.collection('products').find({ businessType: BUSINESS_TYPE, isArchived: { $ne: true } }, { projection: { name: 1, productCode: 1, basePrice: 1 } }).toArray();
if (products.length === 0) {
  console.log('[seed] No product catalog found — creating a minimal synthetic one for load-testing.');
  const synthetic = Array.from({ length: 20 }, (_, i) => ({
    businessType: BUSINESS_TYPE,
    name: `Load Test Item ${i + 1}`,
    productCode: `LOADTEST-${i + 1}`,
    category: 'Load Test',
    basePrice: 50 + Math.round(Math.random() * 450),
    isAvailable: true,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.collection('products').insertMany(synthetic);
  products = synthetic.map(p => ({ name: p.name, productCode: p.productCode, basePrice: p.basePrice }));
}
console.log(`[seed] Using ${products.length} product(s) from the catalog.`);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// --- Inventory: same "use what's there, or seed synthetic" pattern as
// products above. This was missing in the original version of this script —
// it seeded orders and a product catalog but never any actual Inventory
// documents, so every inventory endpoint (list/expiring/history/restock) had
// nothing to operate on. That's a bigger gap for a `log` tenant than `fb`:
// logistics products are mostly a 1:1 label over a stocked good (see
// resolveLinkedInventory in server.js, matched by itemCode===productCode or
// itemName===product.name) — no stock effectively means no sellable products
// at all for that business type, not just an empty report. Synthetic items
// here are linked 1:1 to the synthetic products above by itemCode for
// exactly that reason, whether or not this run's businessType is `log`.
//
// Collection name is 'inventories', NOT 'inventory' — Mongoose pluralizes
// the 'Inventory' model with the standard y→ies English rule (verified
// against a live container: mongoose.model('Inventory').collection.name ===
// 'inventories'). Every other collection this script touches (orders,
// products, journalentries) happens to already be a regular plural, which is
// exactly how this got missed initially. ---
const invCount = await db.collection('inventories').countDocuments({ businessType: BUSINESS_TYPE });
if (invCount === 0) {
  console.log('[seed] No inventory found — creating synthetic stock linked 1:1 to the product catalog.');
  const syntheticInventory = products.map((p, i) => ({
    businessType: BUSINESS_TYPE,
    tenantId: null,
    itemCode: p.productCode || `LOADTEST-${i + 1}`,
    itemName: p.name,
    stockQty: 500 + Math.round(Math.random() * 1500), // base units (pcs)
    unit: 'pcs',
    unitCost: round2((p.basePrice || 100) * 0.4), // rough cost basis, not a real recipe costing
    lowStockThreshold: 50,
    displayUnit: 'pcs',
    unitMultiplier: 1,
    srp: p.basePrice || 0,
    expiryBatches: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.collection('inventories').insertMany(syntheticInventory);
  console.log(`[seed] Created ${syntheticInventory.length} inventory item(s).`);
} else {
  console.log(`[seed] Using ${invCount} existing inventory item(s).`);
}

const PAYMENT_METHODS = ['Cash', 'GCash', 'Card', 'Maya'];
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

// Business-hours-weighted timestamp somewhere in the last MONTHS_BACK months.
const now = Date.now();
const rangeStart = now - MONTHS_BACK * 30 * 86400000;
function randomBackdatedTimestamp() {
  const day = rangeStart + rand(now - rangeStart);
  const d = new Date(day);
  d.setHours(8 + rand(13), rand(60), rand(60), 0); // 8am-9pm spread
  return d;
}

function buildItems() {
  const lineCount = 1 + rand(4); // 1-4 line items
  const items = [];
  for (let i = 0; i < lineCount; i++) {
    const p = pick(products);
    const qty = 1 + rand(3);
    items.push({
      productId: p._id ? String(p._id) : null,
      productCode: p.productCode || '',
      name: p.name,
      price: p.basePrice || 100,
      quantity: qty,
      fulfilledQty: qty,
      productDiscountPercent: 0,
      vatExempt: false,
      selectedAddOns: [],
      hasDiscount: true,
      department: 'Kitchen',
      itemStatus: 'Served',
      discountPercent: 0,
      isCombo: false,
      comboItems: [],
    });
  }
  return items;
}

function buildOrder(seq) {
  const items = buildItems();
  const itemsGross = round2(items.reduce((s, it) => s + it.price * it.quantity, 0));
  const isComplimentary = Math.random() < 0.02;
  const roll = Math.random();
  const status = roll < 0.02 ? 'Cancelled' : roll < 0.05 ? 'Voided' : roll < 0.07 ? 'Refunded' : 'Completed';
  const hasDiscount = !isComplimentary && Math.random() < 0.1;
  const discount = hasDiscount ? round2(itemsGross * 0.1) : 0;
  const total = isComplimentary ? 0 : round2(itemsGross - discount);
  const createdAt = randomBackdatedTimestamp();

  return {
    businessType: BUSINESS_TYPE,
    tenantId: null,
    orderNumber: `${SEED_TAG}-${seq}`,
    loadTestSeed: true,
    isBackdated: true,
    isArchived: true, // seeded history — keep it out of "today"-scoped operational views
    status,
    isParked: false,
    customerName: 'Load Test Customer',
    paymentMethod: pick(PAYMENT_METHODS),
    items,
    isVatInclusive: true,
    discountType: isComplimentary ? 'Complimentary' : hasDiscount ? 'Promo' : 'None',
    subtotal: itemsGross,
    vatableSales: 0,
    vatExemptSales: 0,
    vatRate: 0,
    vatAmount: 0,
    discountPercent: hasDiscount ? 10 : 0,
    discount: isComplimentary ? itemsGross : discount,
    total,
    isVatExempt: false,
    scPwdOrder: 'vat-first',
    cashier: 'LoadTestSeed',
    amountPaid: total,
    depositRemaining: 0,
    transactionType: status === 'Refunded' ? 'REFUND' : 'NORMAL',
    isComplimentary,
    voidReason: status === 'Voided' ? 'Restock' : status === 'Refunded' ? 'REFUND: load-test seed' : '',
    createdAt,
    updatedAt: createdAt,
  };
}

function journalEntryFor(order) {
  // Only Completed, non-complimentary orders get a journal entry (see the
  // "Scope" note at the top of this file for why).
  if (order.status !== 'Completed' || order.isComplimentary) return null;
  const cogs = round2(order.total * 0.35);
  const lines = [
    { accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: order.total + (order.discount || 0) },
  ];
  if (order.discount > 0) lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: order.discount, credit: 0 });
  lines.push({ accountCode: paymentAccountFor(order.paymentMethod), accountName: order.paymentMethod, debit: order.total, credit: 0 });
  if (cogs > 0) {
    lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: cogs, credit: 0 });
    lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: cogs });
  }
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return {
    date: order.createdAt,
    reference: `${SEED_TAG}-${order.orderNumber}`,
    description: `Sales & COGS for Order ${order.orderNumber} (load-test seed)`,
    lines,
    totalDebit,
    totalCredit,
    createdAt: order.createdAt,
    updatedAt: order.createdAt,
  };
}

function paymentAccountFor(method) {
  switch (method) {
    case 'GCash': return '110200';
    case 'Card': return '110300';
    case 'Maya': return '110400';
    default: return '110000'; // Cash
  }
}

// Continue numbering after whatever this businessType already has, so
// re-running the seeder (e.g. --orders=0 to just top up inventory, or a
// second seeding pass) never collides with orderNumber's unique index —
// every previous run started counting at 1 again, which reliably duplicated
// LOAD-TEST-1..N and made the whole insertMany batch fail with E11000.
let startSeq = 1;
if (ORDER_COUNT > 0) {
  const existing = await db.collection('orders')
    .find({ businessType: BUSINESS_TYPE, orderNumber: { $regex: `^${SEED_TAG}-\\d+$` } }, { projection: { orderNumber: 1 } })
    .toArray();
  const maxSeq = existing.reduce((max, o) => {
    const n = Number(o.orderNumber.slice(SEED_TAG.length + 1));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  startSeq = maxSeq + 1;
}

console.log(`[seed] businessType=${BUSINESS_TYPE} — generating ${ORDER_COUNT} orders across the last ${MONTHS_BACK} months (starting at ${SEED_TAG}-${startSeq})...`);

let inserted = 0;
let journalCount = 0;
let orderBatch = [];
let journalBatch = [];

for (let i = startSeq; i < startSeq + ORDER_COUNT; i++) {
  const order = buildOrder(i);
  orderBatch.push(order);
  const je = journalEntryFor(order);
  if (je) journalBatch.push(je);

  if (orderBatch.length >= BATCH_SIZE || i === startSeq + ORDER_COUNT - 1) {
    await db.collection('orders').insertMany(orderBatch, { ordered: false });
    inserted += orderBatch.length;
    if (journalBatch.length > 0) {
      await db.collection('journalentries').insertMany(journalBatch, { ordered: false });
      journalCount += journalBatch.length;
    }
    process.stdout.write(`\r[seed] ${inserted}/${ORDER_COUNT} orders, ${journalCount} journal entries`);
    orderBatch = [];
    journalBatch = [];
  }
}
console.log('\n[seed] Done.');
console.log('[seed] Next: run `node scripts/backfill-stats.mjs` so the dashboard counters reflect this seeded history.');

await mongoose.disconnect();
