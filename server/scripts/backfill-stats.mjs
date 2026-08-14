// One-time backfill for the TenantStats/ProductStats dashboard counters
// (server.js: TenantStatsSchema/ProductStatsSchema). Runs the OLD unbounded
// aggregations reports.js used to run on every dashboard load — exactly once —
// and seeds the new counters from the result. After this runs and reports.js
// is switched to read from the counters, that aggregation never needs to run
// full-collection again.
//
// Includes isBackdated orders on purpose: they're real historical completed
// orders and belong in true all-time totals the same as any other order —
// nothing in the match filter below excludes them.
//
// Usage (from server/):
//   node scripts/backfill-stats.mjs                  seed/overwrite the counters
//   node scripts/backfill-stats.mjs --verify          diff existing counters against
//                                                      a fresh aggregation, no writes
//   node scripts/backfill-stats.mjs --business-type=log   override BUSINESS_TYPE
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify');
const businessTypeArg = args.find(a => a.startsWith('--business-type='));
const BUSINESS_TYPE = (businessTypeArg ? businessTypeArg.split('=')[1] : (process.env.BUSINESS_TYPE || 'fb')).toLowerCase();

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

async function computeTenantTotals() {
  const [row] = await db.collection('orders').aggregate([
    { $match: { businessType: BUSINESS_TYPE, status: 'Completed' } },
    { $group: {
      _id: null,
      revenue:       { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
      comp:          { $sum: { $cond: ['$isComplimentary', '$subtotal', 0] } },
      orders:        { $sum: 1 },
      nonCompCount:  { $sum: { $cond: ['$isComplimentary', 0, 1] } },
    } },
  ]).toArray();
  return {
    cumulativeRevenue: row?.revenue || 0,
    cumulativeComp: row?.comp || 0,
    cumulativeOrderCount: row?.orders || 0,
    cumulativeNonCompCount: row?.nonCompCount || 0,
  };
}

async function computeProductTotals() {
  return db.collection('orders').aggregate([
    { $match: { businessType: BUSINESS_TYPE, status: 'Completed', isComplimentary: { $ne: true } } },
    { $unwind: '$items' },
    { $group: {
      _id:     '$items.name',
      qty:     { $sum: '$items.quantity' },
      revenue: { $sum: { $multiply: [{ $ifNull: ['$items.price', 0] }, { $ifNull: ['$items.quantity', 0] }] } },
    } },
  ]).toArray();
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

if (verifyOnly) {
  console.log(`[verify] businessType=${BUSINESS_TYPE} — recomputing from Order history and diffing against stored counters...`);

  const [freshTenant, freshProducts, storedTenantShards, storedProducts] = await Promise.all([
    computeTenantTotals(),
    computeProductTotals(),
    db.collection('tenantstats').find({ businessType: BUSINESS_TYPE }).toArray(),
    db.collection('productstats').find({ businessType: BUSINESS_TYPE }).toArray(),
  ]);

  // TenantStats is sharded (server.js: TENANT_STATS_SHARDS) — sum across every
  // shard doc for this businessType before comparing.
  const tenantFields = ['cumulativeRevenue', 'cumulativeComp', 'cumulativeOrderCount', 'cumulativeNonCompCount'];
  const storedTenant = tenantFields.reduce((o, f) => {
    o[f] = storedTenantShards.reduce((s, doc) => s + (doc[f] || 0), 0);
    return o;
  }, {});

  let mismatches = 0;
  for (const f of tenantFields) {
    const fresh = round2(freshTenant[f]);
    const stored = round2(storedTenant[f] || 0);
    if (fresh !== stored) {
      mismatches++;
      console.log(`  MISMATCH TenantStats.${f} (summed across ${storedTenantShards.length} shard(s)): fresh=${fresh} stored=${stored}`);
    }
  }

  // ProductStats is sharded too — sum every shard doc per productName before comparing.
  const storedByName = new Map();
  for (const p of storedProducts) {
    const prev = storedByName.get(p.productName) || { cumulativeQty: 0, cumulativeRevenue: 0 };
    storedByName.set(p.productName, {
      cumulativeQty: prev.cumulativeQty + (p.cumulativeQty || 0),
      cumulativeRevenue: prev.cumulativeRevenue + (p.cumulativeRevenue || 0),
    });
  }
  const freshNames = new Set();
  for (const p of freshProducts) {
    freshNames.add(p._id);
    const stored = storedByName.get(p._id);
    const freshQty = round2(p.qty || 0);
    const freshRev = round2(p.revenue || 0);
    const storedQty = round2(stored?.cumulativeQty || 0);
    const storedRev = round2(stored?.cumulativeRevenue || 0);
    if (!stored || freshQty !== storedQty || freshRev !== storedRev) {
      mismatches++;
      console.log(`  MISMATCH ProductStats["${p._id}"]: fresh={qty:${freshQty},rev:${freshRev}} stored=${stored ? `{qty:${storedQty},rev:${storedRev}}` : '(missing)'}`);
    }
  }
  for (const name of storedByName.keys()) {
    if (!freshNames.has(name)) {
      mismatches++;
      console.log(`  MISMATCH ProductStats["${name}"]: stored but no longer appears in Order history`);
    }
  }

  if (mismatches === 0) {
    console.log('[verify] OK — counters match the aggregation exactly.');
  } else {
    console.log(`[verify] FAILED — ${mismatches} mismatch(es).`);
    process.exitCode = 1;
  }
} else {
  console.log(`[backfill] businessType=${BUSINESS_TYPE} — aggregating full Order history (this is the LAST time this runs unbounded)...`);

  const [tenantTotals, productTotals] = await Promise.all([
    computeTenantTotals(),
    computeProductTotals(),
  ]);

  // TenantStats/ProductStats are sharded (server.js: STATS_SHARDS) so
  // concurrent app writes spread across multiple documents instead of
  // colliding on one. This one-time backfill isn't concurrent with anything,
  // so it collapses each full total into a single shard (0) — wipe any
  // pre-existing shards for this businessType first so a re-run doesn't
  // double-count.
  await db.collection('tenantstats').deleteMany({ businessType: BUSINESS_TYPE });
  await db.collection('tenantstats').insertOne({
    businessType: BUSINESS_TYPE, shard: 0, ...tenantTotals,
    createdAt: new Date(), updatedAt: new Date(),
  });
  console.log('[backfill] TenantStats seeded (shard 0):', tenantTotals);

  await db.collection('productstats').deleteMany({ businessType: BUSINESS_TYPE });
  if (productTotals.length > 0) {
    await db.collection('productstats').insertMany(productTotals.map(p => ({
      businessType: BUSINESS_TYPE, productName: p._id, shard: 0,
      cumulativeQty: p.qty || 0, cumulativeRevenue: p.revenue || 0,
      createdAt: new Date(), updatedAt: new Date(),
    })));
  }
  console.log(`[backfill] ProductStats seeded (shard 0): ${productTotals.length} product(s).`);
  console.log('[backfill] Done. Run with --verify to confirm the counters match the old aggregation exactly.');
}

await mongoose.disconnect();
