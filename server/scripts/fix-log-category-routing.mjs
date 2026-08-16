// Corrective, non-destructive: reassign any `log` category whose department is
// an fb station (Kitchen/Bar) to 'Logistics' so the logistics order queue serves
// it. Only the department label changes.
//
// Run from the server directory:  node scripts/fix-log-category-routing.mjs
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const before = await db.collection('categories')
  .find({ businessType: 'log', department: { $in: ['Kitchen', 'Bar'] } },
        { projection: { name: 1, department: 1 } }).toArray();

if (before.length === 0) {
  console.log('Nothing to fix - no log categories carry an fb department.');
} else {
  console.log('Fixing log categories with an fb department:');
  before.forEach(c => console.log(`  ${c.name}: ${c.department} -> Logistics`));
  const r = await db.collection('categories').updateMany(
    { businessType: 'log', department: { $in: ['Kitchen', 'Bar'] } },
    { $set: { department: 'Logistics' } }
  );
  console.log(`matched=${r.matchedCount} modified=${r.modifiedCount}`);
}

await mongoose.disconnect();
