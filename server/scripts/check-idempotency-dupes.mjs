// Read-only pre-deploy check: `idempotencyKey` on Order just moved to a
// unique+sparse index (server.js). Mongoose builds that index automatically
// on next boot — if any duplicate non-null idempotencyKey values already
// exist (from the TOCTOU race this index change was added to close), the
// index build fails, silently, and the new duplicate-order guard in
// orders.js's catch(E11000) handler never actually activates.
//
// Run against the target DB BEFORE deploying this change:
//   node scripts/check-idempotency-dupes.mjs
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const dupes = await db.collection('orders').aggregate([
  { $match: { idempotencyKey: { $ne: null } } },
  { $group: { _id: '$idempotencyKey', count: { $sum: 1 }, orderIds: { $push: '$_id' } } },
  { $match: { count: { $gt: 1 } } },
]).toArray();

if (dupes.length === 0) {
  console.log('No duplicate idempotencyKey values found — safe to deploy the unique index.');
} else {
  console.log(`Found ${dupes.length} duplicate idempotencyKey value(s) — the unique index build WILL fail until these are resolved:`);
  dupes.forEach(d => console.log(`  ${d._id}: ${d.count} orders -> ${d.orderIds.join(', ')}`));
  console.log('\nResolve by clearing idempotencyKey on all but one order per group (they are the same logical request), then re-run this check.');
}

await mongoose.disconnect();
