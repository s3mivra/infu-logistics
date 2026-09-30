// A cancelled order gives its number back - but only the most recent one.
//
// Order numbers come from a counter (ORD-2026-A0001, A0002, ...). A ticket
// rung up and cancelled straight away used to burn its number, leaving a gap
// ("where is A0002?"). Now, when the cancelled order holds the LATEST number
// issued, the counter steps back one so the next order takes that number, and
// the cancelled order is kept, renamed ORD-2026-A0002-X, so it is still in the
// history with who cancelled it and why.
//
// Never reused:
//   - an older number (A0002 cancelled after A0003 exists) - numbering never
//     jumps backwards, the gap stays;
//   - a voided or refunded order - those are real sales undone, and keep their
//     number for good (this is only called on a cancel);
//   - a number anything was already posted under - a journal entry or a stock
//     card line naming it - or two orders' history would share one number.
import mongoose from 'mongoose';

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function releaseCancelledOrderNumber(orderId) {
  const Order = mongoose.model('Order');
  const Counter = mongoose.model('Counter');
  const order = await Order.findById(orderId, { orderNumber: 1, status: 1 }).lean();
  if (!order || order.status !== 'Cancelled') return null;
  const num = String(order.orderNumber || '');
  const m = /^(.+)-A(\d+)$/.exec(num);
  if (!m) return null;
  const seq = Number(m[2]);
  // The counter key is fixed as ORD-<year> even when the printed series is
  // renamed (see generateNextSequence): swap whatever label for "ORD".
  const label = m[1];
  const key = `ORD${label.slice(label.indexOf('-'))}`;

  // Anything already posted under this number keeps it.
  const named = new RegExp(`(^|[^A-Za-z0-9])${escapeRx(num)}($|[^0-9])`);
  const [journal, stock] = await Promise.all([
    mongoose.model('JournalEntry').exists({ $or: [{ reference: named }, { description: named }] }),
    mongoose.model('StockCard').exists({ reference: named }),
  ]);
  if (journal || stock) return null;

  // Only the latest: step the counter back only if nothing was issued since.
  const stepped = await Counter.findOneAndUpdate({ _id: key, seq }, { $inc: { seq: -1 } });
  if (!stepped) return null;

  let renamed = null;
  try {
    for (let i = 1; i <= 50 && !renamed; i++) {
      const candidate = i === 1 ? `${num}-X` : `${num}-X${i}`;
      if (await Order.exists({ orderNumber: candidate })) continue;
      const r = await Order.updateOne({ _id: order._id, orderNumber: num, status: 'Cancelled' }, { $set: { orderNumber: candidate } });
      if (r.modifiedCount) renamed = candidate;
      else break;
    }
  } finally {
    // Could not free the number - put the counter back so it is not issued twice.
    if (!renamed) await Counter.updateOne({ _id: key, seq: seq - 1 }, { $inc: { seq: 1 } });
  }
  return renamed ? { released: num, renamedTo: renamed } : null;
}

// The same, for many orders cancelled at once (end-of-day close, midnight
// auto-close). Newest number first, so when the last few tickets of the day
// were all left open, each one in turn is the latest and gives its number back;
// an older one below a kept order stays a gap, as with a single cancel.
export async function releaseCancelledOrderNumbers(orderIds = []) {
  if (!orderIds.length) return [];
  const Order = mongoose.model('Order');
  const orders = await Order.find({ _id: { $in: orderIds } }, { orderNumber: 1 }).lean();
  const seqOf = (n) => Number((/-A(\d+)$/.exec(String(n || '')) || [])[1] || 0);
  orders.sort((a, b) => seqOf(b.orderNumber) - seqOf(a.orderNumber));
  const freed = [];
  for (const o of orders) {
    const r = await releaseCancelledOrderNumber(o._id);
    if (r) freed.push(r);
  }
  return freed;
}
