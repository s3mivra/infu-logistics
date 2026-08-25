// One-time cleanup: past inventory imports (before the SRP-gating fix) created a
// shop/POS listing for EVERY imported item, even raw materials that only ever
// carry a unit cost and never an SRP - they ended up visible at basePrice ₱0.
// This hides those listings (isAvailable: false) without deleting anything, so
// they drop out of the shop/POS but stay in the database and can be restored
// (or given a real SRP and re-enabled) at any time.
//
// Only targets products that look auto-synced from an inventory import: a
// single-ingredient recipe (baseRecipe.length === 1) linked to an Inventory item
// (baseRecipe[0].invId set) with no price (basePrice <= 0). A hand-made
// complimentary/promo menu item is very unlikely to match this shape, so this
// should not sweep up anything a shop owner deliberately priced at ₱0.
//
// Usage (from server/):
//   node scripts/hide-zero-srp-products.mjs                       report + apply, BUSINESS_TYPE=log
//   node scripts/hide-zero-srp-products.mjs --dry-run              report only, no writes
//   node scripts/hide-zero-srp-products.mjs --business-type=log    override BUSINESS_TYPE
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const businessTypeArg = args.find(a => a.startsWith('--business-type='));
const BUSINESS_TYPE = (businessTypeArg ? businessTypeArg.split('=')[1] : (process.env.BUSINESS_TYPE || 'log')).toLowerCase();

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const filter = {
  businessType: BUSINESS_TYPE,
  isAvailable: { $ne: false },
  isArchived: { $ne: true },
  $or: [{ basePrice: { $lte: 0 } }, { basePrice: { $exists: false } }],
  baseRecipe: { $size: 1 },
  'baseRecipe.0.invId': { $exists: true, $ne: null },
};

const candidates = await db.collection('products')
  .find(filter, { projection: { productCode: 1, name: 1, basePrice: 1, category: 1 } })
  .toArray();

if (candidates.length === 0) {
  console.log(`Nothing to hide - no zero-SRP inventory-linked products found for businessType="${BUSINESS_TYPE}".`);
} else {
  console.log(`${dryRun ? '[dry-run] Would hide' : 'Hiding'} ${candidates.length} zero-SRP product(s) from the shop/POS:`);
  candidates.forEach(p => console.log(`  ${p.productCode || '(no code)'} - ${p.name} (₱${p.basePrice ?? 0}, ${p.category || 'no category'})`));
  if (!dryRun) {
    const r = await db.collection('products').updateMany(filter, { $set: { isAvailable: false } });
    console.log(`matched=${r.matchedCount} modified=${r.modifiedCount}`);
  }
}

await mongoose.disconnect();
