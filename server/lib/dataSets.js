// One registry describing every exportable dataset, instead of a bespoke
// endpoint per screen.
//
// The important consequence: an export with no rows IS the import template.
// They are the same column list by construction, so a template can never drift
// out of step with what the exporter produces or the importer accepts - which
// is the usual way "download template, fill it in, import fails" happens.
//
// Each entry is pure description: which columns, and how to turn one document
// into a row. Fetching lives in the route (it needs models and request scope);
// everything here is testable without a database.

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const yes = (b) => (b ? 'Yes' : 'No');

// `key` is what the client asks for; `label` names the file and the button.
// `importable` marks the datasets an import actually exists for - the rest are
// export-only on purpose. Importing posted ledger rows would let someone
// rewrite history through a spreadsheet, so those are deliberately one-way.
export const DATASETS = {
  // ── Master data ──────────────────────────────────────────────────────────
  inventory: {
    label: 'Inventory', model: 'Inventory', importable: true,
    sort: { itemName: 1 },
    columns: ['Item Code', 'Item Name', 'Category', 'Unit', 'Qty', 'Unit Cost', 'Total Value', 'Low Stock At', 'Location'],
    toRow: (i) => [
      i.itemCode || '', i.itemName || '', i.stockCategory || '', i.unit || '',
      money(i.stockQty), money(i.unitCost), money((i.stockQty || 0) * (i.unitCost || 0)),
      money(i.lowStockThreshold), i.stockLocation || '',
    ],
  },

  products: {
    label: 'Products', model: 'Product', importable: true,
    sort: { category: 1, name: 1 },
    columns: ['Product Code', 'Name', 'Category', 'Base Price', 'Base Size', 'Barcode', 'Available', 'Archived', 'Recipe Lines', 'Sizes'],
    toRow: (p) => [
      p.productCode || '', p.name || '', p.category || '', money(p.basePrice),
      p.baseSize || '', p.barcode || '', yes(p.isAvailable !== false), yes(p.isArchived),
      (p.baseRecipe || []).length, (p.sizes || []).length,
    ],
  },

  clients: {
    label: 'Clients', model: 'ClientAccount',
    sort: { name: 1 },
    columns: ['Client Code', 'Name', 'Username', 'Payment Method', 'Credit Limit', 'Credit Terms (days)', 'Credit Balance', 'Segments', 'Active'],
    toRow: (c) => [
      c.clientCode || '', c.name || '', c.username || '', c.paymentMethod || '',
      c.creditLimit ?? '', c.creditTermsDays ?? '', money(c.creditBalance),
      (c.segments || []).join(', '), yes(c.isActive !== false),
    ],
  },

  suppliers: {
    label: 'Suppliers', model: 'Supplier',
    sort: { name: 1 },
    columns: ['Name', 'Contact', 'Phone', 'Email', 'Address', 'Terms', 'Credit Balance', 'Active'],
    toRow: (s) => [
      s.name || '', s.contactPerson || '', s.phone || '', s.email || '',
      s.address || '', s.paymentTerms || '', money(s.creditBalance), yes(s.isActive !== false),
    ],
  },

  // ── Payables / receivables ───────────────────────────────────────────────
  bills: {
    label: 'Bills', model: 'Bill',
    sort: { createdAt: -1 },
    columns: ['Bill No', 'Supplier', 'Description', 'Amount', 'Paid', 'Outstanding', 'Status', 'Due Date', 'Source'],
    toRow: (b) => [
      b.billNumber || '', b.supplierName || '', b.description || '',
      money(b.amount), money(b.paidAmount), money((b.amount || 0) - (b.paidAmount || 0)),
      b.status || '', day(b.dueDate), b.source || '',
    ],
  },

  purchaseOrders: {
    label: 'Purchase Orders', model: 'PurchaseOrder',
    sort: { createdAt: -1 },
    columns: ['PO No', 'Supplier', 'Status', 'Total', 'Lines', 'Ordered', 'Expected'],
    toRow: (p) => [
      p.poNumber || '', p.supplierName || '', p.status || '',
      money(p.totalAmount), (p.lines || []).length, day(p.createdAt), day(p.expectedDate),
    ],
  },

  advances: {
    label: 'Advances', model: 'Advance',
    sort: { date: -1 },
    columns: ['Advance No', 'Branch', 'Type', 'Payee', 'Amount', 'Liquidated', 'Outstanding', 'Status', 'Purpose', 'Date'],
    toRow: (a) => [
      a.advanceNumber || '', a.branchCode || '', a.type || '', a.payeeName || '',
      money(a.amount), money(a.liquidatedAmount), money((a.amount || 0) - (a.liquidatedAmount || 0)),
      a.status || '', a.purpose || '', day(a.date),
    ],
  },

  checkVouchers: {
    label: 'Check Vouchers', model: 'CheckVoucher',
    sort: { date: -1 },
    columns: ['Voucher No', 'Branch', 'Date', 'Payee Type', 'Payee', 'Amount', 'Purpose', 'Paid From', 'Reference', 'Status'],
    toRow: (v) => [
      v.voucherNumber || '', v.branchCode || '', day(v.date), v.payeeType || '',
      v.payeeName || '', money(v.amount), v.purpose || '',
      v.sourceAccountName || v.sourceAccount || '', v.referenceNumber || '', v.status || '',
    ],
  },

  revolvingFunds: {
    label: 'Revolving Funds', model: 'RevolvingFund',
    sort: { createdAt: -1 },
    columns: ['Fund Name', 'Custodian', 'Float', 'Balance', 'Spent', 'Status', 'Opened'],
    toRow: (f) => [
      f.name || '', f.custodian || '', money(f.floatAmount),
      money(f.currentBalance), money((f.floatAmount || 0) - (f.currentBalance || 0)),
      f.status || '', day(f.createdAt),
    ],
  },

  // ── Ledger. Export only: importing posted rows would let a spreadsheet
  //    rewrite history, and the balanced-entry guard exists precisely to stop
  //    that happening by accident.
  journal: {
    label: 'Journal Entries', model: 'JournalEntry', dateField: 'date',
    sort: { date: -1 },
    // One row per LINE, not per entry - a journal export that hides the lines
    // cannot be reconciled against anything.
    expand: (e) => (e.lines || []).map(l => [
      day(e.date), e.reference || '', e.description || '',
      l.accountCode || '', l.accountName || '',
      money(l.debit), money(l.credit),
    ]),
    columns: ['Date', 'Reference', 'Description', 'Account Code', 'Account Name', 'Debit', 'Credit'],
  },

  stockCards: {
    label: 'Stock Movements', model: 'StockCard', dateField: 'date',
    sort: { date: -1 },
    columns: ['Date', 'Item', 'Type', 'Reference', 'Qty Change', 'Balance After', 'Unit Cost', 'Remarks'],
    toRow: (c) => [
      day(c.date), c.itemName || '', c.type || '', c.reference || '',
      c.qtyChange ?? '', c.balanceAfter ?? '', money(c.unitCost), c.remarks || '',
    ],
  },

  orders: {
    label: 'Orders', model: 'Order', dateField: 'createdAt',
    sort: { createdAt: -1 },
    columns: ['Order No', 'Date', 'Customer', 'Status', 'Payment', 'Subtotal', 'Discount', 'Total', 'Items'],
    toRow: (o) => [
      o.orderNumber || '', day(o.createdAt), o.customerName || '', o.status || '',
      o.paymentMethod || '', money(o.subtotal), money(o.discount), money(o.total),
      (o.items || []).length,
    ],
  },

  expenses: {
    label: 'Expenses', model: 'JournalEntry', dateField: 'date', importable: true,
    sort: { date: -1 },
    // Expenses are journal entries whose debit side is an expense account, so
    // the export is filtered and flattened in the route rather than mapped 1:1.
    columns: ['Date', 'Reference', 'Category Code', 'Category', 'Amount', 'Paid From', 'Description'],
  },
};

// Build the value table for a chart-of-accounts export: every account with its
// balance, on the side that account naturally carries. Kept here so it can be
// tested without a database - the caller supplies the aggregated debit/credit
// totals it already has.
export function accountBalanceRows(totalsByCode, acctMeta) {
  const rows = [];
  for (const [code, t] of Object.entries(totalsByCode || {})) {
    const meta = acctMeta(code);
    if (!meta) continue;
    const debit = Number(t.debit) || 0;
    const credit = Number(t.credit) || 0;
    // Assets and expenses carry debit balances; everything else credit. Showing
    // a raw debit-minus-credit for a liability would render every payable
    // negative, which reads as an error to anyone holding the printout.
    const debitNatured = meta.type === 'asset' || meta.type === 'expense';
    const balance = debitNatured ? debit - credit : credit - debit;
    rows.push({
      code, name: meta.name, type: meta.type,
      debit: money(debit), credit: money(credit),
      balance: money(balance),
      side: debitNatured ? 'Debit' : 'Credit',
    });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export const ACCOUNT_BALANCE_COLUMNS =
  ['Account Code', 'Account Name', 'Type', 'Total Debit', 'Total Credit', 'Balance', 'Normal Side'];

// ── VALID VALUES ─────────────────────────────────────────────────────────────
// The reference sheet that ships WITH a template: for each column that only
// accepts certain values, what those values actually are.
//
// This exists because the alternative is guesswork. Filling a template with a
// plausible-looking label ("Rent", "Miscellaneous Expense") and having every
// row rejected because the importer wanted a code is the single most common way
// a bulk import wastes someone's afternoon - and the error arrives only after
// they have typed a hundred rows.
//
// `sourced` values come from live data (categories an operator created, payment
// methods they configured) and are filled in by the route; the static ones are
// enumerations the code itself defines.
export function buildValidValues({ expenseCategories = [], paymentMethods = [], stockCategories = [], suppliers = [], units = [], statuses = {} } = {}) {
  const table = [];
  const add = (dataset, column, values, note = '') => {
    if (!values || values.length === 0) return;
    table.push({ dataset, column, values: values.map(String), note });
  };

  add('inventory', 'Unit', units, 'Base units. kg and L are accepted and stored as g and ml.');
  add('inventory', 'Category', stockCategories, 'An unrecognised name creates a new stock category.');
  add('expenses', 'Category Code', expenseCategories.map(c => `${c.code} - ${c.label}`),
      'Use the CODE (the six digits), not the label.');
  add('expenses', 'Paid From', paymentMethods, 'Must match a configured payment method exactly.');
  add('products', 'Category', [], '');
  add('bills', 'Status', statuses.bill, '');
  add('purchaseOrders', 'Status', statuses.po, '');
  add('advances', 'Status', statuses.advance, 'Derived from the amounts; not settable on import.');
  add('advances', 'Type', statuses.advanceType, '');
  add('checkVouchers', 'Status', statuses.voucher, '');
  add('bills', 'Supplier', suppliers, 'Must match an existing supplier name.');
  add('purchaseOrders', 'Supplier', suppliers, 'Must match an existing supplier name.');

  return table;
}

export const VALID_VALUE_COLUMNS = ['Dataset', 'Column', 'Accepted Values', 'Notes'];

export const datasetKeys = () => Object.keys(DATASETS);
export const isImportable = (key) => !!DATASETS[key]?.importable;
