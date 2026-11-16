// The duplicate checker: catches a record about to be entered twice.
//
// Names (products, stock items, suppliers, clients, categories) compare with
// case, spaces and punctuation ignored, so "Hibiscus Tea", "HIBISCUS-TEA" and
// "hibiscus  tea" are one name:
//   - written the same way (case and spacing aside): refused - it is the same
//     record, and the routes already refuse it for most of these;
//   - the same apart from punctuation: answered 409 with `duplicateOf`, and the
//     app asks "save anyway?" (`allowDuplicate: true` on the retry).
//
// Transactions (a backdated sale, a bill, an expense, a stock receipt) that
// match one already recorded on the same day for the same party and amount
// get the same "save anyway?" - two identical ones can be real, so it is a
// question, not a refusal. Live till sales are not checked: two identical
// coffees in a day are ordinary.
import mongoose from 'mongoose';
import { businessDateStr, businessDayStart } from './businessTime.js';

export const nameKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
const sameWritten = (a, b) => String(a ?? '').trim().replace(/\s+/g, ' ').toUpperCase() === String(b ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

// The existing record whose name reads the same as `name`, or null.
export async function findLookalike(Model, field, name, filter = {}) {
  const key = nameKey(name);
  if (!key) return null;
  const docs = await Model.find(filter, { [field]: 1 }).lean();
  return docs.find((d) => nameKey(d[field]) === key) || null;
}

const dayRange = (value) => {
  const day = businessDateStr(value ? new Date(value) : new Date());
  const from = businessDayStart(day);
  return { day, from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
};
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b) => Math.abs(money(a) - money(b)) < 0.005;

// 409 the app turns into "save anyway?".
export const askDuplicate = (res, message, duplicateOf) => res.status(409).json({ success: false, duplicateOf, error: message });

// Express middleware for a "create a named thing" route.
// `ownCheck`: the route itself already refuses the same name written the same
// way, so leave that case to it (its message and status stay as they were).
export function nameGuard({ model, field, bodyField = field, label, ownCheck = false, scope = () => ({}) }) {
  return async (req, res, next) => {
    try {
      const name = req.body?.[bodyField];
      if (!name || typeof name !== 'string') return next();
      const Model = mongoose.model(model);
      const hit = await findLookalike(Model, field, name, scope(req));
      if (!hit) return next();
      const exact = sameWritten(hit[field], name);
      if (exact && ownCheck) return next();
      if (exact) return res.status(409).json({ success: false, error: `${label} "${hit[field]}" already exists.` });
      if (req.body?.allowDuplicate === true) return next();
      return askDuplicate(res, `${label} "${hit[field]}" already exists, and "${name}" reads the same.`, { id: String(hit._id), name: hit[field] });
    } catch (err) { return next(err); }
  };
}

// Express middleware for transactions: `find(req)` returns the matching
// record already in the books ({ id, label }) or null.
export function transactionGuard(find) {
  return async (req, res, next) => {
    try {
      if (req.body?.allowDuplicate === true) return next();
      const hit = await find(req);
      if (!hit) return next();
      return askDuplicate(res, `This looks like one already recorded: ${hit.label}.`, { id: hit.id, label: hit.label });
    } catch (err) { return next(err); }
  };
}

// ── The transaction matchers ────────────────────────────────────────────────

// A backdated sale: same day, same customer, same items total.
export async function findDuplicateBackdatedSale(req) {
  const b = req.body || {};
  // A sheet import carries its own reference and skips rows already posted.
  if (!Array.isArray(b.items) || !b.items.length || b.importRef || b.replaceExisting) return null;
  const gross = money(b.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0));
  const { from, to } = dayRange(b.date);
  const candidates = await mongoose.model('Order').find(
    { isBackdated: true, status: { $nin: ['Voided', 'Refunded', 'Cancelled'] }, createdAt: { $gte: from, $lt: to } },
    { orderNumber: 1, customerName: 1, subtotal: 1, total: 1, items: 1 },
  ).lean();
  const who = nameKey(b.customerName || 'WALK-IN (BACKDATED)');
  const hit = candidates.find((o) => nameKey(o.customerName) === who && near(o.subtotal, gross) && (o.items || []).length === b.items.length);
  return hit ? { id: String(hit._id), label: `${hit.orderNumber}, ${hit.customerName}, ₱${money(hit.total).toFixed(2)} on the same day` } : null;
}

// A bill: the same supplier and amount entered today. (The same supplier
// invoice number twice is refused outright by the bills route itself.)
export async function findDuplicateBill(req) {
  const b = req.body || {};
  if (!b.supplierId || !mongoose.Types.ObjectId.isValid(b.supplierId) || !(Number(b.amount) > 0)) return null;
  const { from, to } = dayRange();
  const hit = await mongoose.model('Bill').findOne(
    { supplierId: b.supplierId, status: { $ne: 'Rejected' }, amount: money(b.amount), createdAt: { $gte: from, $lt: to } },
    { billNumber: 1, amount: 1, supplierInvoiceNo: 1 },
  ).lean();
  return hit ? { id: String(hit._id), label: `${hit.billNumber}${hit.supplierInvoiceNo ? ` (invoice ${hit.supplierInvoiceNo})` : ''}, ₱${money(hit.amount).toFixed(2)}` } : null;
}

// An expense: same day and amount, and the same payee or reference.
export async function findDuplicateExpense(req) {
  const b = req.body || {};
  if (!(Number(b.amount) > 0)) return null;
  const { from, to } = dayRange(b.date);
  const entries = await mongoose.model('JournalEntry').find(
    { reference: /^EXP/, date: { $gte: from, $lt: to }, totalDebit: money(b.amount) },
    { reference: 1, description: 1, totalDebit: 1 },
  ).lean();
  const ref = String(b.refNo || '').trim(), vendor = String(b.vendor || '').trim();
  const hit = entries.find((e) => {
    const d = String(e.description || '').toUpperCase();
    if (ref) return d.includes(`REF: ${ref.toUpperCase()}`);
    if (vendor) return d.includes(`PAID TO: ${vendor.toUpperCase()}`);
    return nameKey(d).includes(nameKey(b.description));
  });
  return hit ? { id: String(hit._id), label: `${hit.reference}, ₱${money(hit.totalDebit).toFixed(2)} on the same day` } : null;
}

// A stock receipt: the same item, quantity and cost already received today.
export async function findDuplicateRestock(req) {
  const id = req.params?.id;
  const qty = Number(req.body?.addedStock);
  if (!mongoose.Types.ObjectId.isValid(id) || !(qty > 0)) return null;
  const { from, to } = dayRange();
  const cards = await mongoose.model('StockCard').find(
    { inventoryId: id, type: 'Restock', qtyChange: qty, date: { $gte: from, $lt: to } },
    { reference: 1, unitCost: 1, qtyChange: 1, itemName: 1 },
  ).lean();
  const cost = money(req.body?.totalCost);
  const hit = cards.find((c) => near((Number(c.unitCost) || 0) * c.qtyChange, cost) || !cost);
  return hit ? { id: String(hit._id), label: `${hit.reference}: ${hit.qtyChange} of ${hit.itemName} received today` } : null;
}
