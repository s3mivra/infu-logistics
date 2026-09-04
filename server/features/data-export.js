// One export/template endpoint for every dataset, driven by lib/dataSets.js.
//
// Rather than a bespoke route per screen, the registry says which columns a
// dataset has and how to turn a document into a row. Two consequences worth
// having:
//
//   * the TEMPLATE is the export with no rows, so the two can never disagree
//     about columns - the usual cause of "downloaded the template, filled it
//     in, every row rejected";
//   * a new dataset is a registry entry, not a new route to secure, paginate
//     and get wrong.
//
// Rows are returned as JSON (headers + arrays) and the client turns them into
// a workbook, which keeps xlsx off the server entirely.
import { captureError } from '../lib/errorLog.js';
import {
  DATASETS, accountBalanceRows, ACCOUNT_BALANCE_COLUMNS,
  buildValidValues, VALID_VALUE_COLUMNS,
} from '../lib/dataSets.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';

export default function registerDataExport(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope,
    verifyToken, requireStaff, requirePermission,
    ACCOUNTS, CUSTOM_META, acctMeta, EXPENSE_CATEGORIES,
    JournalEntry, Supplier, StockCategory,
    BILL_STATUSES, PO_STATUSES, ADVANCE_STATUSES, ADVANCE_TYPES,
  } = ctx;

  // Exports carry costs, margins and client terms, so they sit behind the same
  // gate as the reports they duplicate - not merely "is staff".
  const canExport = [requireStaff, requirePermission('accounting.view')];

  const MAX_ROWS = 20000;

  // Only these models are scoped by businessType; the rest are global to the
  // deployment (see the menu-backup notes - scoping them returns nothing).
  const SCOPED = new Set(['Inventory', 'Product', 'Order', 'Category', 'Bill', 'CheckVoucher', 'Advance', 'PurchaseOrder']);

  const scopeFor = (modelName, req) =>
    (SCOPED.has(modelName) ? { businessType: BUSINESS_TYPE, ...tenantScope(req) } : {});

  // ── What can be exported ───────────────────────────────────────────────────
  app.get('/api/export/datasets', verifyToken, ...canExport, async (req, res) => {
    res.json({
      success: true,
      datasets: Object.entries(DATASETS).map(([key, d]) => ({
        key, label: d.label, importable: !!d.importable, dateFiltered: !!d.dateField,
        columns: d.columns,
      })),
    });
  });

  // ── Valid values: the reference sheet that ships with a template ───────────
  app.get('/api/export/valid-values', verifyToken, ...canExport, async (req, res) => {
    try {
      const [suppliers, stockCats] = await Promise.all([
        Supplier.find({}, { name: 1 }).sort({ name: 1 }).lean().catch(() => []),
        StockCategory ? StockCategory.find({}, { name: 1 }).sort({ name: 1 }).lean().catch(() => []) : [],
      ]);
      // Every non-parent, non-COGS expense account, custom ones included - the
      // same set the expense picker offers, so the sheet cannot list a value
      // the importer would then reject.
      const expenseCategories = [];
      const consider = (code, meta) => {
        if (!meta || meta.type !== 'expense' || meta.isParent || meta.cogs) return;
        if (meta.isActive === false) return;
        const friendly = EXPENSE_CATEGORIES.find(c => c.code === code);
        expenseCategories.push({ code, label: friendly?.label || meta.name });
      };
      for (const [code, meta] of Object.entries(ACCOUNTS)) consider(code, meta);
      for (const [code, meta] of CUSTOM_META.entries()) if (!ACCOUNTS[code]) consider(code, meta);
      expenseCategories.sort((a, b) => a.code.localeCompare(b.code));

      const table = buildValidValues({
        expenseCategories,
        // Exactly what the expense form offers, so the sheet cannot list a
        // tender the importer would reject.
        paymentMethods: ['Cash on Hand', 'Bank Transfer', 'GCash', 'Maya', 'Maribank', 'On Account'],
        stockCategories: stockCats.map(c => c.name).filter(Boolean),
        suppliers: suppliers.map(s => s.name).filter(Boolean),
        units: ['g', 'kg', 'ml', 'L', 'pcs'],
        statuses: {
          bill: BILL_STATUSES, po: PO_STATUSES,
          advance: ADVANCE_STATUSES, advanceType: ADVANCE_TYPES,
          voucher: ['Issued', 'Voided'],
        },
      });

      res.json({
        success: true,
        columns: VALID_VALUE_COLUMNS,
        rows: table.map(t => [t.dataset, t.column, t.values.join(' | '), t.note]),
        table,
      });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── The value table: every account with its balance ───────────────────────
  app.get('/api/export/account-balances', verifyToken, ...canExport, async (req, res) => {
    try {
      const match = {};
      if (req.query.asOf) match.date = { $lte: dayEnd(req.query.asOf) };
      const agg = await JournalEntry.aggregate([
        ...(Object.keys(match).length ? [{ $match: match }] : []),
        { $unwind: '$lines' },
        { $group: {
          _id: '$lines.accountCode',
          debit: { $sum: { $ifNull: ['$lines.debit', 0] } },
          credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
        } },
      ]);
      const totals = Object.fromEntries(agg.map(a => [a._id, { debit: a.debit, credit: a.credit }]));
      const rows = accountBalanceRows(totals, acctMeta);
      res.json({
        success: true,
        columns: ACCOUNT_BALANCE_COLUMNS,
        rows: rows.map(r => [r.code, r.name, r.type, r.debit, r.credit, r.balance, r.side]),
        accounts: rows,
      });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── Export one dataset (or its empty template) ────────────────────────────
  app.get('/api/export/:dataset', verifyToken, ...canExport, async (req, res) => {
    try {
      const key = req.params.dataset;
      const def = DATASETS[key];
      if (!def) return res.status(404).json({ success: false, error: `Unknown dataset "${key}".` });

      // template=1 returns the headers with no rows. Deliberately the same
      // endpoint: a template that came from somewhere else could drift.
      if (req.query.template === '1') {
        return res.json({ success: true, dataset: key, label: def.label, columns: def.columns, rows: [], template: true });
      }

      let Model;
      try { Model = mongoose.model(def.model); }
      catch { return res.json({ success: true, dataset: key, label: def.label, columns: def.columns, rows: [] }); }

      const q = scopeFor(def.model, req);
      if (def.dateField && (req.query.start || req.query.end)) {
        q[def.dateField] = {};
        if (req.query.start) q[def.dateField].$gte = dayStart(req.query.start);
        if (req.query.end) q[def.dateField].$lte = dayEnd(req.query.end);
      }

      const limit = Math.min(MAX_ROWS, Math.max(1, parseInt(req.query.limit) || 5000));
      const docs = await Model.find(q).sort(def.sort || { _id: -1 }).limit(limit).lean();

      let rows;
      if (key === 'expenses') {
        // Expenses are journal entries whose debit side is an expense account,
        // so they are filtered and flattened here rather than mapped 1:1.
        const isExpense = (code) => {
          const m = acctMeta(code);
          return m && m.type === 'expense' && !m.isParent && !m.cogs;
        };
        rows = [];
        for (const e of docs) {
          const debitLine = (e.lines || []).find(l => (l.debit || 0) > 0 && isExpense(l.accountCode));
          if (!debitLine) continue;
          const credLine = (e.lines || []).find(l => (l.credit || 0) > 0);
          rows.push([
            new Date(e.date).toISOString().slice(0, 10), e.reference || '',
            debitLine.accountCode, debitLine.accountName || '',
            Math.round((debitLine.debit || 0) * 100) / 100,
            credLine?.accountName || '', e.description || '',
          ]);
        }
      } else if (def.expand) {
        rows = docs.flatMap(def.expand);
      } else {
        rows = docs.map(def.toRow);
      }

      res.json({
        success: true, dataset: key, label: def.label,
        columns: def.columns, rows,
        // Said plainly: a clipped export must never be mistaken for the whole set.
        truncated: docs.length === limit, limit,
      });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
