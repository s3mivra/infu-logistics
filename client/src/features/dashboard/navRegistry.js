// One list of everywhere you can go in the dashboard.
//
// The sidebar and the Ctrl+K command palette used to keep separate hand-written
// copies of this, and they had drifted: the palette was missing Hub, Quotations
// and the Admin Panel entirely (three destinations you could not search for),
// listed Bank Reconciliation, Withholding Tax and Payroll even when those
// modules were switched off, and sent Production with the wrong nav mode - so
// jumping there by search left the sidebar highlighting nothing and you could
// not tell where you had landed.
//
// Both now render from here, so a new screen is one entry rather than two that
// have to be kept in step. The ledger and report sub-pages live here too, and
// LedgerTab builds its own sub-nav from the same constants.
import {
  ShoppingCart, Package, Network, Factory, Truck, Users, FileText, ChefHat,
  BarChart3, BarChart2, DollarSign, Clock, ShieldCheck, Building2, Landmark,
  Receipt, Settings, TrendingUp, RefreshCw, Banknote, HandCoins, Download,
} from 'lucide-react';

// `mode` is the sidebar's own highlight state (libellus = Operations,
// negotium = Management). It MUST match the group the entry is rendered in, or
// the destination opens with nothing highlighted. Keeping it beside the group
// here is what makes that impossible to get wrong again.
export const NAV_GROUPS = [
  {
    key: 'operations',
    label: 'Operations',
    mode: 'libellus',
    items: [
      { id: 'orders', label: 'Orders & POS', icon: ShoppingCart, perm: 'orders.view', hint: 'Take and manage orders' },
      { id: 'inventory', label: 'Inventory & Stock', icon: Package, perm: 'inventory.view', hint: 'Stock levels, expiry' },
      { id: 'hub', label: 'Hub', icon: Network, perm: 'inventory.view', hint: 'Linked businesses, transfers' },
      // Raw materials -> finished item, approval-gated. Was logistics-only,
      // which hid it from exactly the business that needs it most: a cafe
      // makes its own Spanish Milk, Breve Milk, Biscoff Based and cold brew
      // from bought-in stock, and those in turn are recipe materials.
      { id: 'production', label: 'Production', icon: Factory, perm: 'inventory.view', hint: 'Batches, raw materials' },
      { id: 'procurement', label: 'Procurement', icon: Truck, perm: 'procurement.view', hint: 'Suppliers, POs' },
      { id: 'clients', label: 'Clients', icon: Users, perm: 'orders.view', hint: 'Balances, credit limits' },
      // Prices asked for, not sales made. Lives beside Clients because
      // that is who asks, and nothing on it touches the books.
      { id: 'quotations', label: 'Quotations', icon: FileText, perm: 'orders.view', hint: 'Prices asked for' },
      { id: 'products', labelFor: (bt) => (bt === 'log' ? 'Catalog Setup' : 'Menu Setup'), icon: ChefHat, perm: 'products.view', hint: 'Products, prices' },
    ],
  },
  {
    key: 'management',
    label: 'Management',
    mode: 'negotium',
    items: [
      { id: 'analytics', label: 'Analytics', icon: BarChart3, perm: 'analytics.view', hint: 'Sales dashboard' },
      { id: 'reports', label: 'Reports', icon: BarChart2, perm: 'reports.view', sub: 'salessummary', hint: 'Sales summaries' },
      { id: 'ledger', label: 'Ledger', icon: FileText, perm: 'accounting.view', sub: 'journal', hint: 'Journal entries' },
      // Pricing Control's server calls are requireStaff, not superadmin-only,
      // so it is gated on products.manage like Menu Setup - a hardcoded
      // superadmin check here previously left managers unable to find promos.
      { id: 'pricing', label: 'Pricing Control', icon: DollarSign, perm: 'products.manage', hint: 'Prices, margins, discounts' },
      { id: 'history', label: 'Shifts & Cash', icon: Clock, superOnly: true, hint: 'Shift history, X-reading' },
      { id: 'audit', label: 'Audit Report', icon: ShieldCheck, perm: 'audit.view', hint: 'Who changed what' },
      { id: 'fixedassets', label: 'Fixed Assets', icon: Building2, perm: 'accounting.view', hint: 'Register, depreciation' },
      // Optional modules: each appears only where the business has switched it
      // on. A cafe on percentage tax withholds nothing, and a screen it can
      // never use is noise in both the sidebar and the search results.
      { id: 'bankrec', label: 'Bank Reconciliation', icon: Landmark, perm: 'accounting.view', module: 'bankReconciliation', hint: 'Match the statement' },
      { id: 'wht', label: 'Withholding Tax', icon: Receipt, perm: 'accounting.view', module: 'withholdingTax', hint: 'Held for the BIR' },
      { id: 'payroll', label: 'Payroll', icon: Users, perm: 'accounting.view', module: 'payroll', hint: 'Runs and payslips' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    mode: 'negotium',
    items: [
      { id: 'settings', label: 'Settings', icon: Settings, hint: 'Preferences, appearance' },
      // Not a dashboard tab - a route outside the tabbed shell.
      { id: 'admin-panel', label: 'Admin Panel', icon: ShieldCheck, superOnly: true, route: '/admin/admin-panel', hint: 'Users, roles, tenants' },
    ],
  },
];

// Ledger and Reports are one component with a two-level sub-nav. These are the
// pages inside it - defined here so the palette can offer them directly (they
// are otherwise two clicks deep) and LedgerTab can render its own nav from the
// same source.
export const LEDGER_TAB_GROUPS = [
  ['Books', [
    ['journal', 'General Ledger', FileText],
    ['trial', 'Trial Balance', BarChart2],
    ['pnl', 'P&L', TrendingUp],
    ['balance', 'Balance Sheet', BarChart2],
  ]],
  ['AR & AP', [
    ['araap', 'AR & AP', Truck],
    ['bills', 'Bills (AP)', Receipt],
  ]],
  ['Cash Out', [
    ['revolving', 'Revolving Funds', RefreshCw],
    ['expenses', 'Expenses', Receipt],
  ]],
  ['Setup', [
    ['accperiods', 'Accounts & Periods', Settings],
    ['backdate', 'Backdate Sale', Clock],
    // Always visible to any staff - the server itself scopes what comes back:
    // without requisitions.view you only ever see your OWN filed slips, not
    // anyone else's. Approve or Reject still require requisitions.approve.
    ['approvals', 'Approvals', ShieldCheck],
    // The only diagnostic that answers "is every document stamped with this
    // server's business type", which is what a mis-scoped report looks like
    // from the outside.
    ['tenancy', 'Tenancy Health', ShieldCheck],
    // Every per-screen export in one action - the alternative is visiting a
    // dozen tabs and assembling the archive by hand.
    ['exportall', 'Export All', Download],
  ]],
];

export const REPORT_TAB_GROUPS = [
  ['Sales', [
    ['salessummary', 'Sales Summary', BarChart3],
    ['salesline', 'Sales Line Items', FileText],
    ['payments', 'By Payment', Banknote],
    ['profitcat', 'By Category', BarChart2],
    ['menueng', 'Menu Engineering', TrendingUp],
  ]],
  ['Receivable', [
    ['arreport', 'A/R Report', Truck],
    ['collections', 'Collections', Banknote],
  ]],
  ['Payable', [
    ['apreport', 'A/P Report', Receipt],
    ['supplierpay', 'Supplier Payments', Banknote],
    ['checkvouchers', 'Check Vouchers', Receipt],
    ['advances', 'Advances', HandCoins],
  ]],
  ['Financials', [
    ['pnlmonthly', 'Monthly P&L', BarChart3],
    ['bsmonthly', 'Monthly Balance Sheet', BarChart3],
    ['percentagetax', 'Percentage Tax', FileText],
  ]],
  ['Operations', [
    ['pricelog', 'Price Changes', TrendingUp],
    ['variance', 'Cashier Variance', Users],
    ['commissions', 'Commissions', Users],
  ]],
];

// One visibility rule, applied identically wherever nav is drawn. `moduleOn` is
// optional: a caller that does not have it (or has not loaded modules yet) sees
// module-gated entries rather than having them silently vanish.
export const navItemVisible = (item, { can, isSuperAdmin, moduleOn }) => {
  if (item.superOnly) return !!isSuperAdmin;
  if (item.perm && !(isSuperAdmin || can?.(item.perm))) return false;
  if (item.module && moduleOn && !moduleOn(item.module)) return false;
  return true;
};

export const navLabel = (item, businessType) =>
  (item.labelFor ? item.labelFor(businessType) : item.label);

// The groups a given user actually sees, with hidden items already removed and
// empty groups dropped.
export const visibleNavGroups = (access) =>
  NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(it => navItemVisible(it, access)) }))
    .filter(g => g.items.length > 0);

// Flat destination list for the command palette: every top-level screen, plus
// the ledger and report pages that are otherwise two clicks deep.
export const paletteDestinations = (access) => {
  const out = [];
  for (const group of visibleNavGroups(access)) {
    for (const item of group.items) {
      out.push({
        key: `${group.key}:${item.id}:${item.sub || ''}`,
        id: item.id,
        label: navLabel(item, access.businessType),
        hint: item.hint || group.label,
        mode: group.mode,
        sub: item.sub,
        route: item.route,
      });
    }
  }
  // Sub-pages inherit the parent's permission - if you cannot open Ledger at
  // all, its pages must not be searchable either.
  const canLedger = navItemVisible({ perm: 'accounting.view' }, access);
  const canReports = navItemVisible({ perm: 'reports.view' }, access);
  const addSubPages = (groups, tabId, parentLabel) => {
    for (const [groupLabel, pages] of groups) {
      for (const [sub, label] of pages) {
        out.push({
          key: `${tabId}:${sub}`,
          id: tabId,
          label,
          hint: `${parentLabel} → ${groupLabel}`,
          mode: 'negotium',
          sub,
        });
      }
    }
  };
  if (canLedger) addSubPages(LEDGER_TAB_GROUPS, 'ledger', 'Ledger');
  if (canReports) addSubPages(REPORT_TAB_GROUPS, 'reports', 'Reports');
  return out;
};
