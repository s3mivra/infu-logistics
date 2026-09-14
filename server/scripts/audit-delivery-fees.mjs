// Read-only report: delivery orders whose recorded total is missing the fee.
//
// Until the fix in features/orders.js (recomputeOrderTotals), changing an
// order's status recalculated its total WITHOUT the delivery fee. Any delivery
// order that went Pending -> Preparing -> Completed therefore finished with
// total = sale only, and that is the amount its revenue, A/R and journal entry
// were booked at. This lists those orders so the accountant can decide how to
// correct them (usually one adjusting entry per period, not an edit per order).
//
// Detection: a completed, non-complimentary order with a delivery fee whose
// total is lower than subtotal - discount + fee (VAT-inclusive pricing, the
// system standard). VAT-exclusive orders are listed separately for a manual
// look, because their total legitimately adds VAT on top.
//
// Writes nothing. Usage (from server/):
//   node scripts/audit-delivery-fees.mjs                   table to stdout
//   node scripts/audit-delivery-fees.mjs --csv > fees.csv  spreadsheet
//   node scripts/audit-delivery-fees.mjs --business-type=log
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const btArg = args.find(a => a.startsWith('--business-type='));
const BUSINESS_TYPE = (btArg ? btArg.split('=')[1] : (process.env.BUSINESS_TYPE || 'fb')).toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

await mongoose.connect(process.env.MONGO_URI);
const orders = await mongoose.connection.db.collection('orders').find({
  businessType: BUSINESS_TYPE,
  status: 'Completed',
  isComplimentary: { $ne: true },
  deliveryFee: { $gt: 0 },
}, {
  projection: { orderNumber: 1, createdAt: 1, completedAt: 1, customerName: 1, table: 1, paymentMethod: 1,
    subtotal: 1, discount: 1, deliveryFee: 1, total: 1, isVatInclusive: 1, arPaidAmount: 1, arSettled: 1 },
}).sort({ createdAt: 1 }).toArray();

const missing = [];
const review = [];
for (const o of orders) {
  const expected = r2((o.subtotal || 0) - (o.discount || 0) + (o.deliveryFee || 0));
  const short = r2(expected - (o.total || 0));
  if (o.isVatInclusive === false) { review.push({ ...o, expected, short }); continue; }
  if (short > 0.05) missing.push({ ...o, expected, short });
}

const month = (d) => (d ? new Date(d).toISOString().slice(0, 7) : 'unknown');
if (asCsv) {
  console.log('orderNumber,date,customer,type,payment,subtotal,discount,deliveryFee,recordedTotal,expectedTotal,missing,arPaid,arSettled');
  for (const o of missing) {
    const cells = [o.orderNumber, new Date(o.createdAt).toISOString().slice(0, 10), o.customerName || '', o.table || '', o.paymentMethod || '',
      r2(o.subtotal), r2(o.discount), r2(o.deliveryFee), r2(o.total), o.expected, o.short, r2(o.arPaidAmount), o.arSettled ? 'yes' : 'no'];
    console.log(cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
} else {
  console.log(`Business type: ${BUSINESS_TYPE}`);
  console.log(`Completed delivery orders checked: ${orders.length}`);
  console.log(`Missing their fee: ${missing.length}, totalling P${r2(missing.reduce((s, o) => s + o.short, 0)).toFixed(2)}`);
  const byMonth = {};
  for (const o of missing) byMonth[month(o.createdAt)] = r2((byMonth[month(o.createdAt)] || 0) + o.short);
  for (const [m, amt] of Object.entries(byMonth)) console.log(`  ${m}: P${amt.toFixed(2)}`);
  if (missing.length) {
    console.log('\nOrder              Date        Payment          Recorded     Should be    Missing');
    for (const o of missing) {
      console.log(`${String(o.orderNumber).padEnd(18)} ${new Date(o.createdAt).toISOString().slice(0, 10)}  ${String(o.paymentMethod || '').padEnd(15)} ${r2(o.total).toFixed(2).padStart(11)} ${o.expected.toFixed(2).padStart(12)} ${o.short.toFixed(2).padStart(10)}`);
    }
  }
  if (review.length) console.log(`\n${review.length} VAT-exclusive delivery order(s) need a manual look: ${review.map(o => o.orderNumber).join(', ')}`);
}
await mongoose.disconnect();
