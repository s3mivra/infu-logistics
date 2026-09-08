// One registry describing every exportable dataset, instead of a bespoke
// endpoint per screen.
//
// An export and an import template are NOT the same list, and treating them as
// one was a real defect. An export carries what the system knows: codes it
// assigned, balances it derived, statuses it computed. An import template has
// to carry what a person must supply - which leaves some of those out and adds
// fields the export never shows.
//
// The bills case made it obvious. The export reads
//   Bill No | Supplier | Description | Amount | Paid | Outstanding | Status | Due Date
// but the importer needs an ACCOUNT to charge the bill to, and cannot use Bill
// No, Paid, Outstanding or Status at all. Handed that sheet, an operator fills
// in four columns nothing reads, never sees the one column that is required,
// and every row is rejected.
//
// So an importable dataset also declares `importSpec`: the columns its
// importer actually reads, which are required, what each one means, and an
// example row. That is what `?template=1` returns.
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
    importSpec: {
      endpoint: '/api/inventory/import',
      intro: 'One row per stock item. Cost matters as much as quantity: an item at zero cost posts zero cost of sale, and every drink built on it reads as 100% margin.',
      columns: [
        { name: 'itemName', required: true, note: 'Stored in capitals, however you type it.', example: 'Full Milk' },
        { name: 'itemCode', note: 'Yours, if you use one. Left blank, the system assigns one.', example: 'RM-MILK' },
        { name: 'unit', required: true, note: 'kg, L or pcs. Grams and millilitres are promoted to kg / L.', example: 'L' },
        { name: 'qty', required: true, note: 'How much you hold now, in the unit above.', example: '20' },
        { name: 'unitCost', required: true, note: 'Cost of ONE unit. Zero here means zero cost of sale later.', example: '82' },
        { name: 'lowStockThreshold', note: 'Warn below this. Blank for no warning.', example: '5' },
        { name: 'expiryDate', note: 'YYYY-MM-DD.', example: '2026-12-31' },
        { name: 'stockLocation', note: 'Where it is kept.', example: 'Main bar' },
      ],
    },
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
    label: 'Clients', model: 'ClientAccount', importable: true,
    sort: { name: 1 },
    importSpec: {
      endpoint: '/api/client-accounts/import',
      intro: 'One row per client. There is deliberately NO username or password column: each client gets a 7-day onboarding link and chooses their own. A spreadsheet does not get to decide who can sign in.',
      columns: [
        { name: 'name', required: true, note: 'Must be unique.', example: 'Kasa Lokal' },
        { name: 'phone', example: '0917 555 0101' },
        { name: 'email', note: 'Checked; a malformed address is rejected with the row.', example: 'ar@kasalokal.ph' },
        { name: 'paymentMethod', note: 'How they usually pay. Defaults to Cash.', example: 'Account' },
        { name: 'creditLimit', note: 'Pesos they may owe at once. Blank = no client limit; 0 = no credit at all.', example: '50000' },
        { name: 'creditTermsDays', note: 'Days to pay. Blank uses the shop default.', example: '30' },
        { name: 'segments', note: 'Comma-separated. Used for pricing tiers and filters.', example: 'wholesale, cafe' },
        { name: 'contactNotes', example: 'Invoice to accounts@, not to the branch' },
      ],
    },
    columns: ['Client Code', 'Name', 'Username', 'Payment Method', 'Credit Limit', 'Credit Terms (days)', 'Credit Balance', 'Segments', 'Active'],
    toRow: (c) => [
      c.clientCode || '', c.name || '', c.username || '', c.paymentMethod || '',
      c.creditLimit ?? '', c.creditTermsDays ?? '', money(c.creditBalance),
      (c.segments || []).join(', '), yes(c.isActive !== false),
    ],
  },

  suppliers: {
    label: 'Suppliers', model: 'Supplier', importable: true,
    sort: { name: 1 },
    importSpec: {
      endpoint: '/api/suppliers/import',
      intro: 'One row per supplier. A name that already exists is left alone rather than overwritten, so a corrected sheet can be re-imported safely.',
      columns: [
        { name: 'name', required: true, note: 'Must be unique. Case and spacing are normalised before the duplicate check.', example: 'Metro Beans' },
        { name: 'contactPerson', note: 'Who you deal with.', example: 'Joy Cruz' },
        { name: 'phone', example: '0917 555 0100' },
        { name: 'email', example: 'joy@metrobeans.ph' },
        { name: 'address', example: '12 Bonifacio St, Quezon City' },
        { name: 'paymentTerms', note: 'What their invoices say, in their words.', example: '30 days' },
        { name: 'notes', note: 'Anything worth remembering.', example: 'Delivers Tuesdays only' },
      ],
    },
    columns: ['Name', 'Contact', 'Phone', 'Email', 'Address', 'Terms', 'Credit Balance', 'Active'],
    toRow: (s) => [
      s.name || '', s.contactPerson || '', s.phone || '', s.email || '',
      s.address || '', s.paymentTerms || '', money(s.creditBalance), yes(s.isActive !== false),
    ],
  },

  // ── Payables / receivables ───────────────────────────────────────────────
  bills: {
    label: 'Bills', model: 'Bill', importable: true,
    sort: { createdAt: -1 },
    importSpec: {
      endpoint: '/api/bills/import',
      intro: 'One row per unpaid supplier invoice you already hold. Every row arrives as PENDING and posts nothing - approve each bill afterwards to book the payable. Import the supplier list first; bills are matched to suppliers by name.',
      columns: [
        { name: 'supplier', required: true, note: 'Must already exist, spelled as it is in Suppliers.', example: 'Metro Beans' },
        { name: 'description', required: true, note: 'What the invoice is for.', example: 'March coffee beans' },
        { name: 'amount', required: true, note: 'The invoice total, in pesos.', example: '12000' },
        { name: 'expenseAccountCode', required: true, note: 'Which account this is charged to when approved. Without it the bill can never be approved - see the Accounts sheet.', example: '510000' },
        { name: 'dueDate', note: 'YYYY-MM-DD. When the supplier expects payment.', example: '2026-04-15' },
      ],
    },
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

  fixedAssets: {
    label: 'Fixed Assets', model: 'FixedAsset', importable: true,
    sort: { acquisitionDate: -1 },
    importSpec: {
      endpoint: '/api/fixed-assets/import',
      intro: 'One row per asset the business owns. Each row posts its own acquisition entry against cash. An asset already part-worn keeps its accumulated depreciation - otherwise everything imports looking brand new and the balance sheet overstates what you own.',
      columns: [
        { name: 'name', required: true, example: 'La Marzocco espresso machine' },
        { name: 'class', required: true, note: 'The name or the code from the Accounts sheet.', example: 'Machinery & Equipment' },
        { name: 'acquisitionCost', required: true, note: 'What was paid, before any depreciation.', example: '60000' },
        { name: 'usefulLifeMonths', required: true, note: '60 months = 5 years.', example: '60' },
        { name: 'salvageValue', note: 'What it will still be worth at the end. Depreciation stops there.', example: '6000' },
        { name: 'acquisitionDate', note: 'YYYY-MM-DD. Defaults to today. A closed month is refused.', example: '2026-01-15' },
        { name: 'accumulatedDepreciation', note: 'Already worn off, if you are carrying it in part-used.', example: '2700' },
        { name: 'serialNumber', example: 'LM-77120' },
        { name: 'location', example: 'Main bar' },
        { name: 'supplierName', example: 'Espresso Supply Co' },
        { name: 'referenceNumber', note: 'Their invoice number.', example: 'SI-004821' },
      ],
    },
    columns: ['Asset Code', 'Name', 'Class', 'Acquired', 'Cost', 'Salvage', 'Life (months)', 'Accum. Depreciation', 'Net Book Value', 'Status', 'Serial', 'Location'],
    toRow: (a) => [
      a.assetCode || '', a.name || '', a.accountCode || '', day(a.acquisitionDate),
      money(a.acquisitionCost), money(a.salvageValue), a.usefulLifeMonths ?? '',
      money(a.accumulatedDepreciation),
      money((a.acquisitionCost || 0) - (a.accumulatedDepreciation || 0)),
      a.status || '', a.serialNumber || '', a.location || '',
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
    importSpec: {
      endpoint: '/api/expenses/import',
      intro: 'One row per expense. Each posts its own balanced entry immediately - unlike bills there is no approval step, so check the sheet before importing. A date inside a closed month is refused.',
      columns: [
        { name: 'amount', required: true, note: 'The full amount, before any tax withheld.', example: '3500' },
        { name: 'categoryCode', required: true, note: 'Which expense account. See the Accounts sheet.', example: '610000' },
        { name: 'description', required: true, example: 'March electricity' },
        { name: 'paymentMethod', required: true, note: 'What it was paid from. See the Valid Values sheet.', example: 'Cash on Hand' },
        { name: 'date', note: 'YYYY-MM-DD. Defaults to today.', example: '2026-03-31' },
        { name: 'vendor', note: 'Who was paid.', example: 'Meralco' },
        { name: 'refNo', note: 'Their invoice or OR number.', example: 'OR-99120' },
        { name: 'withholdingRate', note: 'Percent withheld, if you withhold. Only read when the Withholding Tax module is on. Rent is usually 5, professional fees 10.', example: '5' },
      ],
    },
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

  add('fixedAssets', 'Class', statuses.assetClasses,
      'Either the code (140200) or the name (Machinery & Equipment).');
  add('fixedAssets', 'Status', statuses.assetStatus, 'Derived from the numbers; not settable on import.');
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
