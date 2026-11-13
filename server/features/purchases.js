// Purchases brought in from a spreadsheet: an Excel file or the linked
// purchases Google Sheet (features/inventory-sheet.js, kind "purchases").
//
// One row per item bought: date, reference (OR / invoice no.), product code,
// product, quantity, amount paid, and optionally supplier and where the money
// came from. Two switches decide what each import touches - which matters most
// for backdated purchases, whose stock may already have been counted and whose
// payment may already be in the opening balances:
//
//   affectStock  add the quantity to stock (weighted average cost, a dated
//                Restock line on the stock card) - the same as Receive Stock
//   affectMoney  post the purchase to the books on its date: Inventory Asset
//                debited, cash / bank / Accounts Payable credited
//
// With both off the purchase is only RECORDED (Purchases list, reports), and
// nothing else changes. Every row is recorded either way.
//
// Permissions: inventory.manage to import at all; a date before today needs
// sales.backdate (the app's backdating permission); posting money needs
// accounting.manage or funds.spend. A closed month refuses money postings.
//
// Pulling the same sheet twice is safe: a row already imported (same date,
// reference, item, quantity and amount) is skipped, not doubled.
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { captureError } from '../lib/errorLog.js';
import { sheetDay, SHEET_DATE_HELP } from '../lib/sheetDate.js';
import { parseAmount } from '../lib/setupBooks.js';
import { businessDateStr, businessDayStart } from '../lib/businessTime.js';
import { basePerPack, effectiveDisplay } from '../lib/units.js';
import { requirePermission, hasPermission } from '../lib/authz.js';
import { roundMoney } from '../lib/money.js';

export const MAX_PURCHASE_ROWS = 2000;

// Where the money came from: a word on the sheet or an account code.
const PAID_FROM = [
  { re: /^(cash|cash on hand|petty)/i, code: '111000', name: 'Cash on Hand' },
  { re: /^(bank|check|cheque|gcash|maya|transfer|online)/i, code: '112000', name: 'Cash in Bank' },
  { re: /^(credit|on credit|on account|account|payable|a\/p|ap|utang|terms)/i, code: '220000', name: 'Accounts Payable' },
];
export function paidFromOf(value, fallback = '111000') {
  const v = String(value ?? '').trim();
  if (!v) return PAID_FROM.find((p) => p.code === fallback) || PAID_FROM[0];
  if (/^(111|112|113|220)\d{3}$/.test(v)) return { code: v, name: PAID_FROM.find((p) => v.startsWith(p.code.slice(0, 3)))?.name || v };
  return PAID_FROM.find((p) => p.re.test(v)) || null;
}

// One spreadsheet row -> a clean purchase line, or { error }. Pure: the
// caller supplies the stock items and today's business date.
export function readPurchaseRow(r = {}, { items, today }) {
  const text = (v) => String(v ?? '').trim();
  const code = text(r.itemCode), name = text(r.itemName);
  const reference = text(r.reference);
  if (!code && !name && !text(r.qty) && !text(r.amountPaid)) return { empty: true };
  const day = sheetDay(r.date);
  if (!day) return { error: `The date is ${day === '' ? 'missing' : 'not a date'}. ${SHEET_DATE_HELP}` };
  if (day > today) return { error: `${day} is in the future.` };
  if (!code && !name) return { error: 'Which product? Give its product code or name.' };
  const item = (code && items.byCode.get(code.toLowerCase())) || (name && items.byName.get(name.toLowerCase())) || null;
  if (!item) return { error: `No stock item with ${code ? `code "${code}"` : `the name "${name}"`}. Add it to Inventory first, or fix the code.` };
  const qty = parseAmount(r.qty);
  if (!(qty > 0)) return { error: `"${text(r.qty) || 'blank'}" is not a quantity above zero.` };
  const amountPaid = parseAmount(r.amountPaid);
  if (Number.isNaN(amountPaid) || amountPaid < 0) return { error: `"${text(r.amountPaid) || 'blank'}" is not an amount paid.` };
  const paid = paidFromOf(r.paidFrom, r._defaultPaidFrom);
  if (!paid) return { error: `"${text(r.paidFrom)}" is not a way of paying - use Cash, Bank or Credit.` };
  // Counted the way the stock screen shows it: packs for logistics, kg / L /
  // pcs for food and beverage.
  const perUnit = items.businessType === 'log' ? basePerPack(item) : effectiveDisplay(item).mult;
  const unit = items.businessType === 'log' ? 'pcs' : effectiveDisplay(item).displayUnit;
  return {
    line: {
      day, reference, item, qty, qtyBase: +(qty * perUnit).toFixed(6), unit,
      amountPaid: roundMoney(amountPaid), unitCost: roundMoney(amountPaid / qty),
      supplier: text(r.supplier).slice(0, 120), paidFrom: paid.code, paidFromName: paid.name,
      notes: text(r.notes).slice(0, 300), backdated: day < today,
    },
  };
}

// The same purchase pulled twice is the same row.
export const purchaseKey = (l) => crypto.createHash('sha1')
  .update([l.day, l.reference.toLowerCase(), String(l.item._id), l.qty, l.amountPaid].join('|'))
  .digest('hex');

export default function registerPurchases(ctx) {
  const {
    app, IS_PROD, BUSINESS_TYPE, verifyToken, requireStaff, tenantScope,
    Inventory, StockCard, JournalEntry, mkSeqRef, logAudit, emitToMgr,
  } = ctx;

  const PurchaseRecord = mongoose.models.PurchaseRecord || mongoose.model('PurchaseRecord', new mongoose.Schema({
    businessType: { type: String, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    date: { type: Date, required: true, index: true },
    reference: { type: String, default: '' },
    supplier: { type: String, default: '' },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', index: true },
    itemCode: { type: String, default: '' },
    itemName: { type: String, default: '' },
    qty: Number, unit: String, qtyBase: Number,
    amountPaid: Number, unitCost: Number,
    paidFrom: String,
    affectsStock: Boolean, affectsMoney: Boolean,
    stockRef: { type: String, default: '' },
    journalRef: { type: String, default: '' },
    notes: { type: String, default: '' },
    importKey: { type: String, index: true },
    batch: String,
    importedBy: String,
  }, { timestamps: true }));

  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));

  const loadItems = async (req) => {
    const list = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) },
      { itemName: 1, itemCode: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1 }).lean();
    return {
      businessType: BUSINESS_TYPE,
      byCode: new Map(list.filter((i) => i.itemCode).map((i) => [String(i.itemCode).trim().toLowerCase(), i])),
      byName: new Map(list.map((i) => [String(i.itemName || '').trim().toLowerCase(), i])),
    };
  };

  // Reads every row, checks permissions and duplicates. Nothing is written.
  const readAll = async (req) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const affectStock = req.body?.affectStock === true;
    const affectMoney = req.body?.affectMoney === true;
    const defaultPaidFrom = paidFromOf(req.body?.paidFrom)?.code || '111000';
    const items = await loadItems(req);
    const today = businessDateStr();
    const canBackdate = hasPermission(req.user, 'sales.backdate');
    const lines = [];
    const seen = new Set();
    rows.forEach((r, i) => {
      const got = readPurchaseRow({ ...(r || {}), _defaultPaidFrom: defaultPaidFrom }, { items, today });
      if (got.empty) return;
      const row = i + 2;   // the sheet's own row number, under its header
      if (got.error) { lines.push({ row, status: 'error', error: got.error }); return; }
      const l = got.line;
      if (l.backdated && !canBackdate) {
        lines.push({ row, status: 'error', error: `${l.day} is before today - backdating needs the "backdate" permission.` });
        return;
      }
      l.key = purchaseKey(l);
      if (seen.has(l.key)) { lines.push({ row, status: 'duplicate', note: 'Same as a row above.', line: l }); return; }
      seen.add(l.key);
      lines.push({ row, status: 'ok', line: l });
    });
    const keys = lines.filter((x) => x.status === 'ok').map((x) => x.line.key);
    const done = new Set((await PurchaseRecord.find({ importKey: { $in: keys } }, { importKey: 1 }).lean()).map((d) => d.importKey));
    for (const x of lines) {
      if (x.status === 'ok' && done.has(x.line.key)) { x.status = 'duplicate'; x.note = 'Already imported.'; }
    }
    return { lines, affectStock, affectMoney, defaultPaidFrom };
  };

  const view = (x) => ({
    row: x.row, status: x.status, error: x.error, note: x.note,
    ...(x.line ? {
      date: x.line.day, reference: x.line.reference, itemCode: x.line.item.itemCode || '', itemName: x.line.item.itemName,
      qty: x.line.qty, unit: x.line.unit, amountPaid: x.line.amountPaid, unitCost: x.line.unitCost,
      supplier: x.line.supplier, paidFrom: x.line.paidFromName, backdated: x.line.backdated,
    } : {}),
  });

  // POST /api/purchases/import { rows, affectStock, affectMoney, paidFrom, preview }
  // `preview: true` reads and checks every row and writes nothing.
  app.post('/api/purchases/import', verifyToken, requireStaff, requirePermission('inventory.manage'), async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length) return res.status(400).json({ success: false, error: 'No rows to import.' });
      if (rows.length > MAX_PURCHASE_ROWS) return res.status(400).json({ success: false, error: `Too many rows (${rows.length}) - at most ${MAX_PURCHASE_ROWS} at a time.` });
      if (req.body?.affectMoney === true && !hasPermission(req.user, 'accounting.manage') && !hasPermission(req.user, 'funds.spend')) {
        return res.status(403).json({ success: false, error: 'Posting purchases to the books needs accounting or fund-spending rights. Import with "Affect the money" off, or ask someone who has them.' });
      }
      const { lines, affectStock, affectMoney } = await readAll(req);
      const ok = lines.filter((x) => x.status === 'ok');
      const summary = {
        rows: lines.length, ready: ok.length,
        errors: lines.filter((x) => x.status === 'error').length,
        duplicates: lines.filter((x) => x.status === 'duplicate').length,
        totalPaid: roundMoney(ok.reduce((s, x) => s + x.line.amountPaid, 0)),
        backdated: ok.filter((x) => x.line.backdated).length,
      };
      if (req.body?.preview === true) return res.json({ success: true, preview: true, affectStock, affectMoney, summary, lines: lines.map(view) });

      const batch = `PUR-IMP-${Date.now()}`;
      const results = [];
      for (const x of ok) {
        const l = x.line;
        try {
          await mongoose.connection.transaction(async () => {
            const date = businessDayStart(l.day);
            let stockRef = '', journalRef = '';
            if (affectStock) {
              const item = await Inventory.findById(l.item._id);
              if (!item) throw new Error('The stock item was removed.');
              const value = item.stockQty * item.unitCost + l.amountPaid;
              item.stockQty += l.qtyBase;
              item.unitCost = item.stockQty > 0 ? value / item.stockQty : 0;
              await item.save();
              stockRef = await mkSeqRef('INV-RST');
              await StockCard.create([{
                inventoryId: item._id, itemName: item.itemName, type: 'Restock', reference: stockRef,
                qtyChange: l.qtyBase, unitCost: l.qtyBase > 0 ? l.amountPaid / l.qtyBase : 0, balanceAfter: item.stockQty,
                date,
                remarks: `Purchase${l.reference ? ` ${l.reference}` : ''}${l.supplier ? ` from ${l.supplier}` : ''} (imported${l.backdated ? `, dated ${l.day}` : ''})`,
              }]);
            }
            if (affectMoney && l.amountPaid > 0) {
              journalRef = stockRef || await mkSeqRef('PUR');
              const onCredit = l.paidFrom.startsWith('220');
              await JournalEntry.create([{
                reference: journalRef, date,
                description: `Purchase${l.reference ? ` ${l.reference}` : ''}: ${l.qty} ${l.unit} ${l.item.itemName}${l.supplier ? ` from ${l.supplier}` : ''}${affectStock ? '' : ' (stock not added)'}`,
                lines: [
                  { accountCode: '130000', accountName: 'Inventory Asset', debit: l.amountPaid, credit: 0 },
                  { accountCode: l.paidFrom, accountName: l.paidFromName, debit: 0, credit: l.amountPaid },
                ],
                totalDebit: l.amountPaid, totalCredit: l.amountPaid,
                ...(onCredit && l.supplier ? { supplierName: l.supplier } : {}),
              }]);
            }
            await PurchaseRecord.create([{
              businessType: BUSINESS_TYPE, ...tenantScope(req), date, reference: l.reference, supplier: l.supplier,
              inventoryId: l.item._id, itemCode: l.item.itemCode || '', itemName: l.item.itemName,
              qty: l.qty, unit: l.unit, qtyBase: l.qtyBase, amountPaid: l.amountPaid, unitCost: l.unitCost,
              paidFrom: l.paidFrom, affectsStock: affectStock, affectsMoney: affectMoney && l.amountPaid > 0,
              stockRef, journalRef, notes: l.notes, importKey: l.key, batch, importedBy: req.user?.name || '',
            }]);
          });
          results.push({ row: x.row, status: 'imported' });
        } catch (err) {
          // A closed month refuses the entry (status 423); anything else is the row's problem too.
          results.push({ row: x.row, status: 'error', error: err.message || 'Could not import this row.' });
        }
      }
      const imported = results.filter((r) => r.status === 'imported').length;
      await logAudit(req, { action: 'import', entity: 'Purchase', entityId: batch, after: { imported, affectStock, affectMoney, totalPaid: summary.totalPaid, backdated: summary.backdated } });
      if (imported) emitToMgr('erpUpdated');
      res.json({
        success: true, batch, imported, affectStock, affectMoney,
        failed: results.filter((r) => r.status === 'error'),
        skipped: lines.filter((x) => x.status !== 'ok').map(view),
      });
    } catch (err) { fail(req, res, err); }
  });

  // The recorded purchases, newest first. ?start=YYYY-MM-DD&end=YYYY-MM-DD
  app.get('/api/purchases', verifyToken, requireStaff, requirePermission('inventory.view'), async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
      const start = day(req.query.start), end = day(req.query.end);
      if (start || end) {
        q.date = {};
        if (start) q.date.$gte = businessDayStart(start);
        if (end) q.date.$lt = new Date(businessDayStart(end).getTime() + 24 * 3600 * 1000);
      }
      const purchases = await PurchaseRecord.find(q).sort({ date: -1, createdAt: -1 }).limit(5000).lean();
      res.json({ success: true, purchases, total: roundMoney(purchases.reduce((s, p) => s + (p.amountPaid || 0), 0)) });
    } catch (err) { fail(req, res, err); }
  });
}
