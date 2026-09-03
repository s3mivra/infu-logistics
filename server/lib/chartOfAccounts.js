// Canonical Chart of Accounts - 6-digit SAP-style structure (Non-VAT SME).
// Parents are header accounts (isParent: true, not posted to directly); leaves are
// the posting accounts the POS books to. Used for P&L / Balance Sheet grouping.

export const ACCOUNTS = {
  // ===== 100000 ASSETS =====
  '100000': { name: 'Assets',                     type: 'asset', isParent: true },
  '110000': { name: 'Current Assets',             type: 'asset', isParent: true, parent: '100000' },
  '111000': { name: 'Cash on Hand',               type: 'asset', parent: '110000' },
  '112000': { name: 'Cash in Bank',               type: 'asset', parent: '110000' },
  '113000': { name: 'E-Wallet',                   type: 'asset', parent: '110000' },
  '114000': { name: 'Petty Cash / Revolving Fund',type: 'asset', parent: '110000' },
  // A customer's check is NOT cash until the bank clears it. Parking received
  // checks here (rather than straight into Cash in Bank) keeps the bank
  // balance honest and makes a bounced check a reversal of a real, visible
  // asset instead of a silent hole in cash. Cleared checks move 115000 -> 112000.
  '115000': { name: 'Checks on Hand (Undeposited)', type: 'asset', parent: '110000' },
  '118000': { name: 'Unassigned Receipts',        type: 'asset', parent: '110000' },
  '120000': { name: 'Accounts Receivable',        type: 'asset', parent: '100000' },
  '130000': { name: 'Inventory',                  type: 'asset', parent: '100000' },
  '140000': { name: 'Fixed Assets',               type: 'asset', isParent: true, parent: '100000' },
  '150000': { name: 'Accumulated Depreciation',   type: 'asset', isParent: true, parent: '100000' },
  '160000': { name: 'Other Assets',               type: 'asset', isParent: true, parent: '100000' },
  // We paid a supplier MORE than a bill required (or ahead of one existing at
  // all) - an asset, since THEY now owe US either a future credit or a cash
  // refund. Lives here rather than folded into 220000 Accounts Payable so a
  // supplier's payable and receivable balances are never netted against each
  // other without someone deciding to do that explicitly.
  '160100': { name: 'Supplier Credit Balance (Overpayments)', type: 'asset', parent: '160000' },

  // ===== NON-TRADE RECEIVABLES =====
  // 120000 Accounts Receivable is the TRADE control account - it only ever
  // receives sales-driven entries. Money owed to us that did NOT arise from
  // selling something (a cash advance to staff, a prepayment to a supplier)
  // is a non-trade receivable and belongs in its own section, so the balance
  // sheet never implies we sold more than we did. Kept as a separate parent
  // under 100000 rather than restructuring 120000, which is referenced by
  // hardcoded string across the posting paths.
  '170000': { name: 'Non-Trade Receivables',      type: 'asset', isParent: true, parent: '100000' },
  // Cash handed to an employee ahead of spending it. Cleared by liquidating
  // against real expenses, or by deducting from payroll - see features/advances.js.
  '170100': { name: 'Advances to Employees',      type: 'asset', parent: '170000' },
  // Paid to a supplier BEFORE a bill exists (a deposit on an order). Distinct
  // from 160100, which is what is left over after OVERpaying a bill that did.
  '170200': { name: 'Advances to Suppliers',      type: 'asset', parent: '170000' },

  // ===== 200000 LIABILITIES =====
  '200000': { name: 'Liabilities',                type: 'liability', isParent: true },
  '210000': { name: 'Current Liabilities',        type: 'liability', isParent: true, parent: '200000' },
  '220000': { name: 'Accounts Payable',           type: 'liability', parent: '200000' },
  '230000': { name: 'Taxes Payable',              type: 'liability', parent: '200000' },
  '240000': { name: 'Payroll Liabilities',        type: 'liability', parent: '200000' },
  '250000': { name: 'Loans Payable',              type: 'liability', isParent: true, parent: '200000' },
  '260000': { name: 'Other Liabilities',          type: 'liability', parent: '200000' },
  // A client paid MORE than they owed - a liability, since WE now owe THEM
  // either a future credit against their next invoice or a cash refund.
  // Mirrors 160100 on the asset side; kept out of 120000 Accounts Receivable
  // for the same reason (never silently netted against what they still owe).
  '260100': { name: 'Client Credit Balance (Overpayments)', type: 'liability', parent: '260000' },
  // A customer paid a deposit/downpayment BEFORE we billed them - we owe them
  // goods or services, not cash back. Distinct from 260100, which is what is
  // left over after they OVERpaid an invoice that already existed.
  '260200': { name: 'Customer Advances / Deposits', type: 'liability', parent: '260000' },

  // ===== 300000 EQUITY =====
  '300000': { name: 'Equity',                     type: 'equity', isParent: true },
  '310000': { name: "Owner's Capital",            type: 'equity', parent: '300000' },
  '315000': { name: "Owner's Drawing",            type: 'equity', parent: '310000' },
  '320000': { name: 'Additional Capital',         type: 'equity', parent: '300000' },
  '330000': { name: 'Retained Earnings',          type: 'equity', parent: '300000' },
  '340000': { name: 'Current Year Earnings',      type: 'equity', parent: '300000' },

  // ===== 400000 REVENUE =====
  '400000': { name: 'Revenue',                    type: 'revenue', isParent: true },
  '410000': { name: 'Product Sales',              type: 'revenue', parent: '400000' },
  '420000': { name: 'Service Sales',              type: 'revenue', parent: '400000' },
  '430000': { name: 'Sales Discounts',            type: 'contra-revenue', parent: '400000' },
  '440000': { name: 'Sales Returns & Allowances', type: 'contra-revenue', parent: '400000' },

  // ===== 500000 COST OF SALES =====
  '500000': { name: 'Cost of Sales',              type: 'expense', cogs: true, isParent: true },
  '510000': { name: 'Cost of Goods Sold',         type: 'expense', cogs: true, parent: '500000' },
  '520000': { name: 'Freight-In / Purchase Costs',type: 'expense', cogs: true, parent: '500000' },
  '530000': { name: 'Inventory Adjustments',      type: 'expense', cogs: true, parent: '500000' },
  '535000': { name: 'Spoilage, Variance & Waste', type: 'expense', cogs: true, parent: '530000' },
  '540000': { name: 'Complimentary Expense',      type: 'expense', cogs: true, parent: '500000' },

  // ===== 600000 OPERATING EXPENSES =====
  '600000': { name: 'Operating Expenses',         type: 'expense', isParent: true },
  '610000': { name: 'Salaries & Wages',           type: 'expense', parent: '600000' },
  '620000': { name: 'Employee Benefits',          type: 'expense', parent: '600000' },
  '630000': { name: 'Rent Expense',               type: 'expense', parent: '600000' },
  '640000': { name: 'Utilities Expense',          type: 'expense', parent: '600000' },
  '650000': { name: 'Office Supplies Expense',    type: 'expense', parent: '600000' },
  '660000': { name: 'Marketing & Advertising',    type: 'expense', parent: '600000' },
  '670000': { name: 'Transportation & Delivery',  type: 'expense', parent: '600000' },
  '680000': { name: 'Repairs & Maintenance',      type: 'expense', parent: '600000' },
  '690000': { name: 'Depreciation Expense',       type: 'expense', parent: '600000' },

  // ===== 700000 ADMINISTRATIVE EXPENSES =====
  '700000': { name: 'Administrative Expenses',    type: 'expense', isParent: true },
  '710000': { name: 'Professional Fees',          type: 'expense', parent: '700000' },
  '720000': { name: 'Bank Charges',               type: 'expense', parent: '700000' },
  '730000': { name: 'Insurance Expense',          type: 'expense', parent: '700000' },
  '740000': { name: 'Licenses & Permits',         type: 'expense', parent: '700000' },
  '750000': { name: 'Communication Expense',      type: 'expense', parent: '700000' },
  '760000': { name: 'Miscellaneous Expense',      type: 'expense', parent: '700000' },

  // ===== 800000 OTHER INCOME =====
  '800000': { name: 'Other Income',               type: 'other-income', isParent: true },
  '810000': { name: 'Interest Income',            type: 'other-income', parent: '800000' },
  '820000': { name: 'Gain on Asset Disposal',     type: 'other-income', parent: '800000' },
  '830000': { name: 'Other Non-Operating Income', type: 'other-income', parent: '800000' },

  // ===== 900000 OTHER EXPENSES =====
  '900000': { name: 'Other Expenses',             type: 'expense', isParent: true },
  '910000': { name: 'Interest Expense',           type: 'expense', parent: '900000' },
  '920000': { name: 'Loss on Asset Disposal',     type: 'expense', parent: '900000' },
  '930000': { name: 'Other Non-Operating Expenses', type: 'expense', parent: '900000' },
};

// One-time migration map: old 4-digit code → new 6-digit code (used to rewrite
// historical journal entries; see the boot-time backfill in server.js).
export const CODE_MAP = {
  '1000': '111000', '1010': '112000', '1015': '113000', '1050': '114000',
  '1200': '120000', '1500': '130000',
  '2000': '220000', '2200': '240000', '2300': '260000',
  '3000': '310000', '3100': '315000', '3900': '330000',
  '4000': '410000', '4020': '830000', '4150': '430000', '4200': '530000',
  '5000': '510000', '5010': '930000', '5100': '535000', '5300': '540000',
  '6000': '630000', '6010': '640000', '6020': '610000', '6030': '650000',
  '6040': '660000', '6050': '680000', '6060': '720000', '6090': '760000',
};

// Operator-facing expense categories (used by Expense entry form)
export const EXPENSE_CATEGORIES = [
  { code: '630000', label: 'Rent' },
  { code: '640000', label: 'Utilities (Electricity / Water / Internet)' },
  { code: '610000', label: 'Salaries & Wages' },
  { code: '650000', label: 'Office Supplies (Non-Inventory)' },
  { code: '660000', label: 'Marketing & Advertising' },
  { code: '680000', label: 'Repairs & Maintenance' },
  { code: '720000', label: 'Bank Charges' },
  { code: '710000', label: 'Professional Fees' },
  { code: '730000', label: 'Insurance' },
  { code: '740000', label: 'Licenses & Permits' },
  { code: '750000', label: 'Communication' },
  { code: '760000', label: 'Miscellaneous Expense' },
];

export function getAccount(code) {
  return ACCOUNTS[code] || { name: `Account ${code}`, type: 'unknown' };
}

// Leading digit drives classification (works for both 4- and 6-digit codes):
//  1 asset · 2 liability · 3 equity · 4 revenue · 5 cost-of-sales · 6/7 operating/admin expense
//  8 other income · 9 other expense
export function isAssetCode(code)       { return String(code || '').startsWith('1'); }
export function isLiabilityCode(code)   { return String(code || '').startsWith('2'); }
export function isEquityCode(code)      { return String(code || '').startsWith('3'); }
export function isRevenueCode(code)     { return String(code || '').startsWith('4'); }
export function isCogsCode(code)        { return String(code || '').startsWith('5'); }
export function isOtherIncomeCode(code) { return String(code || '').startsWith('8'); }
export function isExpenseCode(code) {
  const c = String(code || '');
  return c.startsWith('5') || c.startsWith('6') || c.startsWith('7') || c.startsWith('9');
}

// The 9 first-level roots every branch of the COA hangs off. Used by
// sectionAncestor() below to find where a leaf account's own report
// "section" (a named group with a subtotal) actually starts.
const SECTION_ROOTS = new Set(['100000', '200000', '300000', '400000', '500000', '600000', '700000', '800000', '900000']);

// Walks a leaf/posting account UP its parent chain and returns the nearest
// ancestor that is itself a direct child of one of the 9 roots - that
// ancestor IS the account's report section (a named group with its own
// subtotal on the P&L / Balance Sheet), same idea as the reference
// spreadsheet's "PAYROLL & BENEFITS" / "CURRENT ASSETS" headers.
//
// Examples with the canonical COA above:
//   '111000' (Cash on Hand)     -> '110000' Current Assets   (one hop: 111000's parent 110000 is itself a root's child)
//   '610000' (Salaries & Wages) -> '610000' itself            (already a direct child of root 600000 - no group above it)
//   '111001' (a custom sub-account someone added under Cash on Hand)
//                                -> '110000' Current Assets   (climbs past 111000 too - a sub-account reports under
//                                                               the SAME section as its parent leaf, not its own section)
// `lookup(code)` resolves ONE account's metadata - defaults to the static
// map here, but callers with custom sub-accounts (created via the Payment
// Routing / Chart of Accounts UI, stored in the DB rather than this file)
// should pass their own acctMeta(code) that merges both, so a custom child
// account still climbs correctly to its real section.
// Returns null for an unknown code.
export function sectionAncestor(code, lookup = (c) => ACCOUNTS[c]) {
  let node = String(code || '');
  let meta = lookup(node);
  if (!meta) return null;
  while (meta.parent && !SECTION_ROOTS.has(node) && !SECTION_ROOTS.has(meta.parent)) {
    node = meta.parent;
    meta = lookup(node);
    if (!meta) break;
  }
  return { code: node, name: (lookup(node) || meta)?.name || node };
}
