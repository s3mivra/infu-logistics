// reports routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { bucketFor, resolveClientKey } from '../lib/credit.js';
import { captureError } from '../lib/errorLog.js';
import { sectionAncestor } from '../lib/chartOfAccounts.js';

export default function registerReports(ctx) {
  const {
    app,
    io,
    server,
    express,
    http,
    Server,
    cors,
    helmet,
    cookieParser,
    Sentry,
    z,
    mongoose,
    bcrypt,
    jwt,
    compression,
    rateLimit,
    crypto,
    pino,
    pinoHttp,
    assertBalanced,
    debitAccountFor,
    suggestedSettleAccount,
    ACCOUNTS,
    EXPENSE_CATEGORIES,
    CODE_MAP,
    resolveUnit,
    displayToBase,
    effectiveDisplay,
    addBatch,
    consumeBatches,
    soonestExpiry,
    sortBatchesFEFO,
    batchesTotal,
    requireStaff,
    evaluateClientAccess,
    computePercentageTax,
    PERCENTAGE_TAX_RATE,
    validateDateRange,
    log,
    SENTRY_ON,
    IS_PROD,
    BUSINESS_TYPE,
    WALK_IN_CUSTOMER_CODE,
    ENV_ORIGINS,
    allowedOrigins,
    corsOriginCheck,
    mkRef,
    resolveLinkedInventory,
    UNIT_TO_BASE,
    baseUnitsPerSale,
    escapeRegex,
    tenantScope,
    BCRYPT_ROUNDS,
    shiftCashFilter,
    ACCESS_TTL,
    REFRESH_TTL_MS,
    REFRESH_COOKIE,
    signAccessToken,
    hashToken,
    refreshCookieOptions,
    requireTrustedOrigin,
    issueSession,
    revokeUserSessions,
    validate,
    zName,
    zMoney,
    zRole,
    loginSchema,
    userCreateSchema,
    addonSchema,
    zRecipe,
    productSchema,
    comboSchema,
    discountSchema,
    roleSchema,
    modifierGroupSchema,
    mkSeqRef,
    loginLimiter,
    orderLimiter,
    generalApiLimiter,
    runStartupTasks,
    CategorySchema,
    Category,
    ModifierGroupSchema,
    ModifierGroup,
    SettingsSchema,
    Settings,
    TenantSchema,
    Tenant,
    tenantSchema,
    AddOnSchema,
    AddOn,
    ProductSchema,
    Product,
    ComboSchema,
    Combo,
    OrderSchema,
    Order,
    QRSessionSchema,
    QRSession,
    InventorySchema,
    Inventory,
    JournalEntrySchema,
    JournalEntry,
    TenantStats,
    ProductStats,
    InventoryMovementSchema,
    InventoryMovement,
    StockCardSchema,
    StockCard,
    ShiftSchema,
    Shift,
    ClockEntrySchema,
    ClockEntry,
    ownerUserIds,
    ownerIdentity,
    logAudit,
    PaymentMethodMapSchema,
    PaymentMethodMap,
    DEFAULT_PAYMENT_ACCOUNT_MAP,
    refreshPaymentMap,
    accountForPaymentMethod,
    ClosedPeriodSchema,
    ClosedPeriod,
    periodLockFor,
    AccountSchema,
    Account,
    BankDepositSchema,
    BankDeposit,
    DEFAULT_ACCOUNTS,
    CUSTOM_META,
    refreshCustomMeta,
    acctMeta,
    UserSchema,
    User,
    ClientAccountSchema,
    ClientAccount,
    RefreshSessionSchema,
    RefreshSession,
    RoleSchema,
    Role,
    AuditLogSchema,
    AuditLog,
    ChangeRequest,
    DiscountSchema,
    Discount,
    SupplierSchema,
    Supplier,
    Bill,
    EODRecordSchema,
    EODRecord,
    CounterSchema,
    Counter,
    emitToOps,
    emitToAll,
    emitToMgr,
    getCategoryPrefix,
    generateNextSequence,
    scheduleMidnightArchive,
    validateOrderMath,
    normalBalanceForCode,
    reportLinesForItem,
    paymentChannel,
    parseClockAt,
    completedBreakMinutes,
    openBreak,
    BREAK_CAP_MIN,
    RevolvingFundSchema,
    RevolvingFund,
    RevolvingFundTxSchema,
    RevolvingFundTx,
    verifyToken,
    verifyClientToken,
    requireSuperAdmin,
    requireSuperOrAdmin,
    verifyOrderAuth,
    requirePermission,
  } = ctx;

  // Reporting gates (superadmin bypasses inside requirePermission); requireStaff is the floor.
  const canViewReports   = [requireStaff, requirePermission('reports.view')];
  const canViewAnalytics = [requireStaff, requirePermission('analytics.view')];

// ============================================================
// PROFIT & LOSS REPORT  (date range, revenue vs expense)
// ============================================================
app.get('/api/reports/pnl', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? dayStart(start) : new Date(new Date().setHours(0,0,0,0));
    const endDate = end ? dayEnd(end) : new Date();
    endDate.setHours(23,59,59,999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      { $unwind: '$lines' },
      { $group: {
          _id: '$lines.accountCode',
          accountName: { $first: '$lines.accountName' },
          totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
          totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
      { $sort: { _id: 1 } }
    ]);

    // Revenue/COGS/OpEx as before, PLUS a proper split for the two accounts
    // this endpoint used to mix in by mistake: 'other-income' (800000-family)
    // was being folded into Revenue, and 900000-family expenses were folded
    // into flat OpEx - both inflate/deflate the wrong line and hide the
    // "non-operating" distinction a normal income statement keeps separate.
    // /api/reports/pnl-monthly already got this right; this brings the
    // single-period view in line with it.
    const revenue = [], otherIncome = [], cogs = [], opex = [], otherExpense = [];
    let totalRevenue = 0, totalOtherIncome = 0, totalCogs = 0, totalOpex = 0, totalOtherExpense = 0, totalContraRevenue = 0;

    for (const r of agg) {
      const code = r._id;
      const meta = acctMeta(code);
      const balance = (r.totalCredit || 0) - (r.totalDebit || 0); // revenue = credit-balance
      const expBalance = (r.totalDebit || 0) - (r.totalCredit || 0); // expense = debit-balance

      if (!meta) continue;
      if (meta.type === 'revenue') {
        revenue.push({ code, name: meta.name, amount: +balance.toFixed(2) });
        totalRevenue += balance;
      } else if (meta.type === 'other-income') {
        otherIncome.push({ code, name: meta.name, amount: +balance.toFixed(2) });
        totalOtherIncome += balance;
      } else if (meta.type === 'contra-revenue') {
        revenue.push({ code, name: meta.name, amount: -(+expBalance.toFixed(2)) });
        totalContraRevenue += expBalance;
      } else if (meta.type === 'expense' && meta.cogs) {
        cogs.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalCogs += expBalance;
      } else if (meta.type === 'expense' && String(code).startsWith('9')) {
        otherExpense.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalOtherExpense += expBalance;
      } else if (meta.type === 'expense') {
        opex.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalOpex += expBalance;
      }
    }

    // Sectioned view (a named group with its own subtotal - "Payroll &
    // Benefits", "Current Assets", etc.) so a screen can render grouped
    // subtotals the way a formal report does, instead of one flat list per
    // bucket. Built from the SAME rows above, just re-bucketed by
    // sectionAncestor() - purely a presentation grouping, doesn't change any
    // total computed above.
    const sectionize = (items) => {
      const bySection = new Map();
      for (const item of items) {
        const sec = sectionAncestor(item.code, acctMeta) || { code: item.code, name: item.name };
        if (!bySection.has(sec.code)) bySection.set(sec.code, { code: sec.code, name: sec.name, items: [], total: 0 });
        const bucket = bySection.get(sec.code);
        bucket.items.push(item);
        bucket.total = +(bucket.total + item.amount).toFixed(2);
      }
      return [...bySection.values()].sort((a, b) => a.code.localeCompare(b.code));
    };

    const netRevenue = totalRevenue - totalContraRevenue;
    const grossProfit = netRevenue - totalCogs;
    // Matches pnl-monthly's formula: gross profit, less operating expenses,
    // plus other income, less other (non-operating) expenses.
    const netIncome = grossProfit - totalOpex + totalOtherIncome - totalOtherExpense;

    res.json({
      success: true,
      period: { start: startDate, end: endDate },
      revenue, otherIncome, cogs, opex, otherExpense,
      sections: { revenue: sectionize(revenue), cogs: sectionize(cogs), opex: sectionize(opex), otherIncome: sectionize(otherIncome), otherExpense: sectionize(otherExpense) },
      totals: {
        revenue: +totalRevenue.toFixed(2),
        contraRevenue: +totalContraRevenue.toFixed(2),
        netRevenue: +netRevenue.toFixed(2),
        cogs: +totalCogs.toFixed(2),
        grossProfit: +grossProfit.toFixed(2),
        grossMargin: netRevenue > 0 ? +((grossProfit / netRevenue) * 100).toFixed(2) : 0,
        opex: +totalOpex.toFixed(2),
        otherIncome: +totalOtherIncome.toFixed(2),
        otherExpense: +totalOtherExpense.toFixed(2),
        netIncome: +netIncome.toFixed(2),
        netMargin: netRevenue > 0 ? +((netIncome / netRevenue) * 100).toFixed(2) : 0,
      }
    });
  } catch (err) {
    log.error({ err }, 'P&L report failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// INVENTORY TURNOVER RATIO - COGS over a period ÷ average inventory value.
// COGS reuses the same accountCode/meta.cogs aggregation as /api/reports/pnl.
// Average inventory value is a 2-point (start, end) approximation: END is the
// current stockQty × unitCost (same math as /api/inventory/revalue's read-only
// onHand calc); START is reconstructed per item from the latest StockCard
// entry at or before the period start (balanceAfter × unitCost at that time),
// falling back to current stock for items with no history that far back.
// There is no daily inventory-valuation snapshot in this app, so this is an
// estimate, not an exact historical figure - the response says so explicitly.
// ============================================================
app.get('/api/reports/inventory-turnover', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? dayStart(start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = end ? dayEnd(end) : new Date();
    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };

    const [agg, items] = await Promise.all([
      JournalEntry.aggregate([
        { $match: { date: { $gte: startDate, $lte: endDate } } },
        { $unwind: '$lines' },
        { $group: {
            _id: '$lines.accountCode',
            totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
            totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } },
        }},
      ]),
      Inventory.find(bizScope, { stockQty: 1, unitCost: 1 }).lean(),
    ]);

    let cogs = 0;
    for (const r of agg) {
      const meta = acctMeta(r._id);
      if (meta?.type === 'expense' && meta.cogs) cogs += (r.totalDebit || 0) - (r.totalCredit || 0);
    }

    const endValue = items.reduce((s, i) => s + (i.stockQty || 0) * (i.unitCost || 0), 0);

    const invIds = items.map(i => String(i._id));
    const startSnapshots = invIds.length ? await StockCard.aggregate([
      { $match: { inventoryId: { $in: invIds }, date: { $lte: startDate } } },
      { $sort: { date: -1 } },
      { $group: { _id: '$inventoryId', balanceAfter: { $first: '$balanceAfter' }, unitCost: { $first: '$unitCost' } } },
    ]) : [];
    const snapMap = new Map(startSnapshots.map(s => [s._id, s]));
    const startValue = items.reduce((s, i) => {
      const snap = snapMap.get(String(i._id));
      const val = snap ? (snap.balanceAfter || 0) * (snap.unitCost || 0) : (i.stockQty || 0) * (i.unitCost || 0);
      return s + val;
    }, 0);

    const avgInventoryValue = (startValue + endValue) / 2;
    const turnoverRatio = avgInventoryValue > 0 ? +((cogs / avgInventoryValue).toFixed(2)) : null;

    res.json({
      success: true,
      period: { start: startDate, end: endDate },
      cogs: +cogs.toFixed(2),
      startValue: +startValue.toFixed(2),
      endValue: +endValue.toFixed(2),
      avgInventoryValue: +avgInventoryValue.toFixed(2),
      turnoverRatio,
      estimate: true,
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// MONTHLY P&L - per-account amounts bucketed by month (parent/child + ratios computed client-side)
// ============================================================
app.get('/api/reports/pnl-monthly', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? dayStart(start) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = end ? dayEnd(end) : new Date();
    if (!end) endDate.setHours(23, 59, 59, 999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      { $unwind: '$lines' },
      { $group: {
        _id: { code: '$lines.accountCode', ym: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        name:   { $first: '$lines.accountName' },
        debit:  { $sum: { $ifNull: ['$lines.debit', 0] } },
        credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
    ]);

    // Ordered list of YYYY-MM buckets spanning the range (incl. empty months).
    const months = [];
    { const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      while (d <= last) { months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() + 1); } }

    const sectionOf = (code, meta) => {
      if (!meta) return null;
      if (meta.type === 'revenue') return 'revenue';
      if (meta.type === 'other-income') return 'otherincome';
      if (meta.type === 'contra-revenue') return 'contra';
      if (meta.type === 'expense' && meta.cogs) return 'cogs';
      if (meta.type === 'expense') return String(code).startsWith('9') ? 'otherexpense' : 'opex';
      return null; // balance-sheet accounts excluded from P&L
    };

    const accounts = {};
    for (const r of agg) {
      const { code, ym } = r._id;
      const meta = acctMeta(code);
      const section = sectionOf(code, meta);
      if (!section) continue;
      const amt = (section === 'revenue' || section === 'otherincome') ? (r.credit - r.debit) : (r.debit - r.credit);
      if (!accounts[code]) {
        const parentCode = meta.parent || code;
        accounts[code] = { code, name: meta.name || r.name, section, parentCode,
          parentName: ACCOUNTS[parentCode]?.name || meta.name || r.name, byMonth: {}, total: 0 };
      }
      accounts[code].byMonth[ym] = +( (accounts[code].byMonth[ym] || 0) + amt ).toFixed(2);
      accounts[code].total = +(accounts[code].total + amt).toFixed(2);
    }
    const accountList = Object.values(accounts).sort((a, b) => a.code.localeCompare(b.code));

    const blank = () => Object.fromEntries(months.map(m => [m, 0]));
    const sec = { revenue: blank(), contra: blank(), cogs: blank(), opex: blank(), otherincome: blank(), otherexpense: blank() };
    for (const a of accountList) for (const [m, v] of Object.entries(a.byMonth)) if (sec[a.section] && m in sec[a.section]) sec[a.section][m] += v;
    const netRevenue = blank(), grossProfit = blank(), netIncome = blank();
    for (const m of months) {
      netRevenue[m]  = +(sec.revenue[m] - sec.contra[m]).toFixed(2);
      grossProfit[m] = +(netRevenue[m] - sec.cogs[m]).toFixed(2);
      // Net income = gross profit − operating expenses + other income − other expenses
      netIncome[m]   = +(grossProfit[m] - sec.opex[m] + sec.otherincome[m] - sec.otherexpense[m]).toFixed(2);
      for (const k of Object.keys(sec)) sec[k][m] = +sec[k][m].toFixed(2);
    }
    const sum = (o) => +Object.values(o).reduce((s, v) => s + v, 0).toFixed(2);

    res.json({
      success: true, period: { start: startDate, end: endDate }, months, accounts: accountList,
      monthTotals: { revenue: sec.revenue, contra: sec.contra, cogs: sec.cogs, opex: sec.opex, otherincome: sec.otherincome, otherexpense: sec.otherexpense, netRevenue, grossProfit, netIncome },
      grandTotals: {
        revenue: sum(sec.revenue), contra: sum(sec.contra), netRevenue: sum(netRevenue),
        cogs: sum(sec.cogs), grossProfit: sum(grossProfit), opex: sum(sec.opex),
        otherincome: sum(sec.otherincome), otherexpense: sum(sec.otherexpense), netIncome: sum(netIncome),
      },
    });
  } catch (err) { log.error({ err }, 'pnl-monthly failed'); (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ============================================================
// BALANCE SHEET (point-in-time: as-of date)
// ============================================================
app.get('/api/reports/balance-sheet', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const asOf = req.query.asOf ? dayEnd(req.query.asOf) : new Date();
    if (!req.query.asOf) asOf.setHours(23, 59, 59, 999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $lte: asOf } } },
      { $unwind: '$lines' },
      { $group: {
          _id: '$lines.accountCode',
          accountName: { $first: '$lines.accountName' },
          totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
          totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
      { $sort: { _id: 1 } }
    ]);

    const assets = [], liabilities = [], equity = [];
    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
    let retainedEarnings = 0; // = revenue − expense − contra-revenue, all-time

    for (const r of agg) {
      const code = r._id;
      const meta = acctMeta(code);
      if (!meta) continue;
      const debit = r.totalDebit || 0;
      const credit = r.totalCredit || 0;

      if (meta.type === 'asset') {
        const bal = debit - credit;
        assets.push({ code, name: meta.name, amount: +bal.toFixed(2) });
        totalAssets += bal;
      } else if (meta.type === 'liability') {
        const bal = credit - debit;
        liabilities.push({ code, name: meta.name, amount: +bal.toFixed(2) });
        totalLiabilities += bal;
      } else if (meta.type === 'equity') {
        const bal = credit - debit;
        equity.push({ code, name: meta.name, amount: +bal.toFixed(2) });
        totalEquity += bal;
      } else if (meta.type === 'revenue' || meta.type === 'other-income') {
        retainedEarnings += (credit - debit);
      } else if (meta.type === 'contra-revenue') {
        retainedEarnings -= (debit - credit);
      } else if (meta.type === 'expense') {
        retainedEarnings -= (debit - credit);
      }
    }
    equity.push({ code: '330000', name: 'Retained Earnings (computed)', amount: +retainedEarnings.toFixed(2) });
    totalEquity += retainedEarnings;

    const totalLiabAndEquity = totalLiabilities + totalEquity;
    const balanced = Math.abs(totalAssets - totalLiabAndEquity) <= 0.01;

    // Sectioned view - groups each flat list into named subtotal blocks
    // (Current Assets, Fixed Assets, Current Liabilities, Accounts Payable,
    // ...) the same way a formal balance sheet is laid out, instead of one
    // undifferentiated list per side. Purely presentational - the flat
    // assets/liabilities/equity arrays and every total above are unchanged.
    const sectionize = (items) => {
      const bySection = new Map();
      for (const item of items) {
        const sec = sectionAncestor(item.code, acctMeta) || { code: item.code, name: item.name };
        if (!bySection.has(sec.code)) bySection.set(sec.code, { code: sec.code, name: sec.name, items: [], total: 0 });
        const bucket = bySection.get(sec.code);
        bucket.items.push(item);
        bucket.total = +(bucket.total + item.amount).toFixed(2);
      }
      return [...bySection.values()].sort((a, b) => a.code.localeCompare(b.code));
    };

    res.json({
      success: true,
      asOf,
      assets, liabilities, equity,
      sections: { assets: sectionize(assets), liabilities: sectionize(liabilities) },
      totals: {
        assets:      +totalAssets.toFixed(2),
        liabilities: +totalLiabilities.toFixed(2),
        equity:      +totalEquity.toFixed(2),
        liabilitiesAndEquity: +totalLiabAndEquity.toFixed(2),
        balanced
      }
    });
  } catch (err) {
    log.error({ err }, 'Balance sheet failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// MONTHLY BALANCE SHEET - cumulative balance as-of each month-end across a range
// ============================================================
app.get('/api/reports/balance-sheet-monthly', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? dayStart(start) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = end ? dayEnd(end) : new Date();
    if (!end) endDate.setHours(23, 59, 59, 999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $lte: endDate } } }, // everything up to range end (balances are cumulative)
      { $unwind: '$lines' },
      { $group: {
        _id: { code: '$lines.accountCode', ym: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        debit: { $sum: { $ifNull: ['$lines.debit', 0] } }, credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
    ]);

    const months = [];
    { const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      while (d <= last) { months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() + 1); } }
    const inRange = new Set(months);

    const acct = {};            // code -> { meta, changes: {ym: signedDelta} }
    const earnings = {};        // ym -> net income delta
    for (const r of agg) {
      const { code, ym } = r._id; const meta = acctMeta(code); if (!meta) continue;
      if (meta.type === 'asset') (acct[code] ??= { meta, changes: {} }).changes[ym] = (acct[code].changes[ym] || 0) + (r.debit - r.credit);
      else if (meta.type === 'liability' || meta.type === 'equity') (acct[code] ??= { meta, changes: {} }).changes[ym] = (acct[code].changes[ym] || 0) + (r.credit - r.debit);
      else {
        let d;
        if (meta.type === 'revenue' || meta.type === 'other-income') d = r.credit - r.debit;
        else d = -(r.debit - r.credit); // contra + expense reduce earnings
        earnings[ym] = (earnings[ym] || 0) + d;
      }
    }

    const allMonths = [...new Set([...Object.values(acct).flatMap(a => Object.keys(a.changes)), ...Object.keys(earnings), ...months])].sort();
    const lastM = months[months.length - 1];

    const mk = (type) => Object.entries(acct).filter(([, a]) => a.meta.type === type).map(([code, a]) => {
      const byMonth = {}; let run = 0;
      for (const ym of allMonths) { run += a.changes[ym] || 0; if (inRange.has(ym)) byMonth[ym] = +run.toFixed(2); }
      return { code, name: a.meta.name, parentCode: a.meta.parent || code, parentName: ACCOUNTS[a.meta.parent || code]?.name || a.meta.name, byMonth, total: byMonth[lastM] || 0 };
    }).sort((x, y) => x.code.localeCompare(y.code));

    const assets = mk('asset'), liabilities = mk('liability'), equity = mk('equity');
    { const byMonth = {}; let run = 0; for (const ym of allMonths) { run += earnings[ym] || 0; if (inRange.has(ym)) byMonth[ym] = +run.toFixed(2); }
      equity.push({ code: '330000', name: 'Retained Earnings (computed)', parentCode: '300000', parentName: 'Equity', byMonth, total: byMonth[lastM] || 0 }); }

    const tot = (rows) => months.reduce((o, m) => { o[m] = +rows.reduce((s, r) => s + (r.byMonth[m] || 0), 0).toFixed(2); return o; }, {});
    res.json({ success: true, period: { start: startDate, end: endDate }, months, asOf: lastM, assets, liabilities, equity,
      monthTotals: { assets: tot(assets), liabilities: tot(liabilities), equity: tot(equity) } });
  } catch (err) { log.error({ err }, 'bs-monthly failed'); (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.get('/api/analytics/dashboard', verifyToken, ...canViewAnalytics, async (req, res) => {
  try {
    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day30ago   = new Date(now.getTime() - 30 * 86400000);
    const day60ago   = new Date(now.getTime() - 60 * 86400000);
    // Every query below MUST be scoped - this dashboard previously had zero
    // businessType/tenant scoping, so an fb deployment sharing a DB with a log
    // deployment (or any leftover cross-type docs) leaked into every number here.
    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };

    // ── Run DB aggregations in parallel (no full table scan into memory) ──────
    const [todayAgg, tenantStatsAgg, dailyAgg, productStats, orders30d, orders7d, inventoryItems] =
      await Promise.all([

      // 1. Today's KPIs
      Order.aggregate([
        { $match: { ...bizScope, status: 'Completed', createdAt: { $gte: todayStart } } },
        { $group: {
          _id: null,
          gross:      { $sum: '$subtotal' },
          revNonComp: { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
          discounts:  { $sum: { $cond: ['$isComplimentary', '$subtotal', { $ifNull: ['$discount', 0] }] } },
          comp:       { $sum: { $cond: ['$isComplimentary', '$subtotal', 0] } },
          count:      { $sum: 1 },
          nonCompCount: { $sum: { $cond: ['$isComplimentary', 0, 1] } },
        }}
      ]),

      // 2. All-time totals - O(shard count) read from the running counters
      //    (TenantStats in server.js, kept up to date by applyStatsDelta in
      //    orders.js on every completion/void/refund) instead of scanning every
      //    completed order this tenant has ever had, on every dashboard load.
      //    TenantStats is sharded (see server.js), so sum across shards.
      TenantStats.aggregate([
        { $match: bizScope },
        { $group: {
          _id: null,
          cumulativeRevenue: { $sum: '$cumulativeRevenue' },
          cumulativeComp: { $sum: '$cumulativeComp' },
          cumulativeOrderCount: { $sum: '$cumulativeOrderCount' },
          cumulativeNonCompCount: { $sum: '$cumulativeNonCompCount' },
        } },
      ]),

      // 3. Daily revenue - last 60 days (grouped in Manila time)
      Order.aggregate([
        { $match: { ...bizScope, status: 'Completed', createdAt: { $gte: day60ago } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Manila' } },
          net:  { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
        }},
        { $sort: { _id: 1 } },
      ]),

      // 4. Product tallies - O(1)-ish read from ProductStats instead of an
      //    $unwind across all history. Size-variant merge into base product
      //    names ("Latte (Large)" → "Latte") still happens in JS below.
      ProductStats.find(bizScope, { productName: 1, cumulativeQty: 1, cumulativeRevenue: 1 }).lean(),

      // 5. Last-30d orders with items (for raw-material velocity)
      Order.find(
        { ...bizScope, status: 'Completed', createdAt: { $gte: day30ago } },
        { items: 1, createdAt: 1 }
      ).lean(),

      // 6. Last-7d orders with items
      Order.find(
        { ...bizScope, status: 'Completed', createdAt: { $gte: new Date(now.getTime() - 7 * 86400000) } },
        { items: 1, createdAt: 1 }
      ).lean(),

      // 7. Inventory (needed for velocity + stock KPIs) - include unit fields so the
      //    UI can display kg/L/pcs correctly (effectiveDisplay needs unit/displayUnit/unitMultiplier).
      Inventory.find(bizScope, { itemCode: 1, itemName: 1, stockQty: 1, unitCost: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1, lowStockThreshold: 1, createdAt: 1 }).lean(),
    ]);

    // ── Today KPIs ─────────────────────────────────────────────────────────────
    const td = todayAgg[0] || {};
    const todayGross    = td.gross || 0;
    const todayRevenue  = td.revNonComp || 0;
    const todayDiscounts= td.discounts || 0;
    const todayComp     = td.comp || 0;
    const todayCount    = td.count || 0;
    const todayAvg      = (td.nonCompCount || 0) > 0 ? todayRevenue / td.nonCompCount : 0;

    // ── All-time totals ─────────────────────────────────────────────────────────
    const at = tenantStatsAgg[0] || {};
    const totalAllTimeRevenue       = at.cumulativeRevenue     || 0;
    const totalAllTimeComplimentary = at.cumulativeComp        || 0;
    const totalAllTimeOrders        = at.cumulativeOrderCount  || 0;

    // ── Daily revenue list ─────────────────────────────────────────────────────
    let bestDay = { date: 'N/A', revenue: 0 };
    const dailyRevenue = dailyAgg.map(({ _id, net }) => {
      const label = new Date(_id + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (net > bestDay.revenue) bestDay = { date: label, revenue: net };
      return { date: label, revenue: net };
    });

    // ── Top products: merge size variants ("Latte (Large)" → "Latte") then take top 5 ──
    const tpMerged = {};
    for (const r of productStats) {
      const base = (r.productName || 'Unknown').replace(/\s*\(.*?\)\s*$/, '').trim() || 'Unknown';
      if (!tpMerged[base]) tpMerged[base] = { name: base, qty: 0, revenue: 0 };
      tpMerged[base].qty += r.cumulativeQty || 0;
      tpMerged[base].revenue += r.cumulativeRevenue || 0;
    }
    const topProducts = Object.values(tpMerged).sort((a, b) => b.qty - a.qty).slice(0, 5);

    // ── Raw-material velocity (weighted ADU: 70% last-7d, 30% last-30d) ────────
    // These use small time-scoped order sets - not the full history
    const [products] = await Promise.all([
      Product.find(bizScope, { name: 1, productCode: 1, baseRecipe: 1, sizes: 1, addOns: 1, isAvailable: 1, isArchived: 1 }).lean(),
    ]);

    // Low-stock filter: an inventory item is hidden from the low-stock list when it is
    // linked ONLY to removed products - either 86'd (isAvailable=false) or actually
    // deleted (isArchived=true, set by DELETE /api/products/:id, which soft-archives
    // rather than hard-deleting). Both signals must be checked: a "Delete" in the
    // Products UI only flips isArchived, leaving isAvailable untouched, so checking
    // isAvailable alone let deleted products keep counting as active here. Items not
    // tied to any product (standalone raw materials) are unaffected.
    const recipeInvIds = (p) => [
      ...(p.baseRecipe || []),
      ...((p.sizes || []).flatMap(s => s.recipe || [])),
      ...((p.addOns || []).flatMap(a => a.recipe || [])),
    ].map(r => r && r.invId).filter(Boolean).map(String);
    const collectLinks = (prods) => {
      const names = new Set(), codes = new Set(), invIds = new Set();
      for (const p of prods) {
        if (p.name) names.add(p.name.toLowerCase());
        if (p.productCode) codes.add(p.productCode);
        for (const id of recipeInvIds(p)) invIds.add(id);
      }
      return { names, codes, invIds };
    };
    const isRemovedProduct = (p) => p.isArchived === true || p.isAvailable === false;
    const activeLinks  = collectLinks(products.filter(p => !isRemovedProduct(p)));
    const removedLinks = collectLinks(products.filter(p => isRemovedProduct(p)));
    const linkedToSet = (set, item) =>
      set.invIds.has(String(item._id)) ||
      (item.itemCode && set.codes.has(item.itemCode)) ||
      (item.itemName && set.names.has(item.itemName.toLowerCase()));
    const isRemovedProductStock = (item) => linkedToSet(removedLinks, item) && !linkedToSet(activeLinks, item);
    // LOG 1:1: inventory keyed by code/name to back recipe-less products.
    const invByCodeVel = {}, invByNameVel = {};
    inventoryItems.forEach(i => { if (i.itemCode) invByCodeVel[i.itemCode] = i; if (i.itemName) invByNameVel[i.itemName] = i; });

    const computeUsage = (subset) => {
      const usage = {};
      subset.forEach(o => {
        (o.items || []).forEach(orderItem => {
          let product = products.find(p => p._id.toString() === (orderItem.productId || '').toString());
          if (!product) {
            const base = (orderItem.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
            product = products.find(p => p.name === base);
          }
          if (!product) return;
          let recipe = product.baseRecipe || [];
          const sm = (orderItem.name || '').match(/\(([^)]+)\)$/);
          if (sm) {
            const sz = (product.sizes || []).find(s => s.name === sm[1]);
            if (sz?.recipe?.length) recipe = sz.recipe;
          }
          if (!recipe.some(r => r.invId)) {
            // 1:1 logistics good: the product itself is the consumed stock item.
            const inv = invByCodeVel[product.productCode] || invByNameVel[product.name];
            if (inv) {
              if (!usage[inv.itemName]) usage[inv.itemName] = { name: inv.itemName, qtyUsed: 0, unit: inv.unit, currentStock: inv.stockQty };
              usage[inv.itemName].qtyUsed += (orderItem.quantity || 0) * baseUnitsPerSale(product, inv);
            }
            return;
          }
          recipe.forEach(ing => {
            if (!usage[ing.name]) {
              const inv = inventoryItems.find(i => i.itemName.toLowerCase() === (ing.name || '').toLowerCase());
              usage[ing.name] = { name: ing.name, qtyUsed: 0, unit: ing.unit, currentStock: inv ? inv.stockQty : 0 };
            }
            usage[ing.name].qtyUsed += (ing.qty || 0) * (orderItem.quantity || 0);
          });
        });
      });
      return usage;
    };

    const daysElapsed30 = Math.max(1, Math.min(30, orders30d.length > 0 ? 30 : 1));
    const daysElapsed7  = Math.max(1, Math.min(7,  orders7d.length  > 0 ? 7  : 1));

    const u7  = computeUsage(orders7d);
    const u30 = computeUsage(orders30d);
    const allIng = new Set([...Object.keys(u7), ...Object.keys(u30)]);
    const rawMaterial = {};
    allIng.forEach(name => {
      const r7  = u7[name],  r30 = u30[name];
      const adu7  = r7  ? r7.qtyUsed  / daysElapsed7  : 0;
      const adu30 = r30 ? r30.qtyUsed / daysElapsed30 : 0;
      const wAdu  = adu7 * 0.7 + adu30 * 0.3;
      const ref   = r7 || r30;
      rawMaterial[name] = { name, unit: ref.unit, currentStock: ref.currentStock, qtyUsed: (r30 || r7).qtyUsed, weightedAdu: wAdu, adu7, adu30, trend: adu30 > 0 ? (adu7 - adu30) / adu30 : 0 };
    });

    const rmEntries = Object.values(rawMaterial);

    // ── Professional velocity / risk tuning ─────────────────────────────────────
    // Lead time = days from reorder to arrival; safety = buffer days of demand.
    // Grace windows suppress false alarms on freshly-onboarded stock - a Day-1 SKU
    // has no sales history to judge, so overstock/dead-stock alarms would be wrong.
    const LEAD_TIME_DAYS = 7;
    const SAFETY_DAYS = 3;
    const OVERSTOCK_GRACE_DAYS = 14;
    const DEADSTOCK_MIN_AGE_DAYS = 30;
    const NEW_SKU_DAYS = 14;
    const nowMs = Date.now();
    const ageDays = (item) => item?.createdAt ? Math.max(0, (nowMs - new Date(item.createdAt).getTime()) / 86400000) : Infinity;
    const aduByName = Object.fromEntries(rmEntries.map(e => [e.name.toLowerCase(), e]));
    const uOf = (item) => aduByName[(item.itemName || '').toLowerCase()];

    // Velocity & Forecast: Daily Burn, Lasts, Buy 1wk/1mo, dynamic ROP, trend tag.
    const mostUsedStock = rmEntries.filter(i => i.weightedAdu > 0).sort((a, b) => b.weightedAdu - a.weightedAdu).slice(0, 5)
      .map(i => {
        const invItem = inventoryItems.find(it => it.itemName.toLowerCase() === i.name.toLowerCase());
        const burn = i.weightedAdu;
        const isNewSku = ageDays(invItem) < NEW_SKU_DAYS || i.adu30 === 0;
        return {
          ...i,
          // Carry inventory fields needed by effectiveDisplay / analyticsDisplay on the client.
          unit:        invItem?.unit,
          displayUnit: invItem?.displayUnit,
          packSize:    invItem?.packSize,
          dailyAvg: burn,
          daysLeft: burn > 0 ? Math.floor(i.currentStock / burn) : Infinity,
          weeklyNeed: Math.ceil(burn * 7),
          monthlyNeed: Math.ceil(burn * 30),
          reorderPoint: Math.ceil(burn * (LEAD_TIME_DAYS + SAFETY_DAYS)),
          isNewSku,
          trendPct: i.adu30 > 0 ? (i.adu7 / i.adu30 - 1) * 100 : null,
        };
      });

    // Low Stock (risk): dynamic Reorder Point once a burn rate exists, else the
    // static min-stock threshold for Day-1 items with no velocity yet.
    const lowestStock = inventoryItems
      .filter(item => !isRemovedProductStock(item))
      .map(item => {
        const adu = uOf(item)?.weightedAdu || 0;
        const rop = adu > 0 ? Math.ceil(adu * (LEAD_TIME_DAYS + SAFETY_DAYS)) : (item.lowStockThreshold || 0);
        return { ...item, adu, reorderPoint: rop,
          daysOfSupply: adu > 0 ? item.stockQty / adu : (item.stockQty <= 0 ? 0 : Infinity),
          belowRop: item.stockQty <= rop && rop > 0 };
      })
      .filter(i => i.belowRop || i.daysOfSupply < Infinity)
      .sort((a, b) => a.daysOfSupply - b.daysOfSupply).slice(0, 5);

    // Overstock watch: only after the launch grace period (else new bulk-buys alarm).
    const highestStock = inventoryItems
      .map(item => { const adu = uOf(item)?.weightedAdu || 0; const dos = adu > 0 ? item.stockQty / adu : (item.stockQty > 0 ? Infinity : 0); return { ...item, adu, daysOfSupply: dos, tiedUpCapital: item.stockQty * (item.unitCost || 0), daysActive: ageDays(item) }; })
      .filter(i => i.daysActive > OVERSTOCK_GRACE_DAYS && i.daysOfSupply > 30 && i.stockQty > 0)
      .sort((a, b) => b.tiedUpCapital - a.tiedUpCapital).slice(0, 5);

    // Slow movers: sells, but slowly - needs a real operating window before judging.
    const slowMovers = inventoryItems
      .filter(item => !isRemovedProductStock(item))
      .map(item => { const adu = uOf(item)?.weightedAdu || 0; return { ...item, adu, daysOfSupply: adu > 0 ? item.stockQty / adu : Infinity, tiedUpCapital: item.stockQty * (item.unitCost || 0), daysActive: ageDays(item) }; })
      .filter(i => i.adu > 0 && i.stockQty > 0 && i.daysActive > DEADSTOCK_MIN_AGE_DAYS)
      .sort((a, b) => a.adu - b.adu)
      .slice(0, 8);

    // Dead stock: in stock, ZERO movement - age guard keeps Day-1 launch stock out.
    const deadStock = inventoryItems
      .filter(item => !isRemovedProductStock(item))
      .map(item => { const adu = uOf(item)?.weightedAdu || 0; return { ...item, adu, tiedUpCapital: item.stockQty * (item.unitCost || 0), daysActive: ageDays(item) }; })
      .filter(i => i.adu === 0 && i.stockQty > 0 && i.daysActive > DEADSTOCK_MIN_AGE_DAYS)
      .sort((a, b) => b.tiedUpCapital - a.tiedUpCapital)
      .slice(0, 10);

    res.json({
      success: true,
      today: { gross: todayGross, revenue: todayRevenue, count: todayCount, avg: todayAvg, discounts: todayDiscounts, comp: todayComp },
      allTime: { revenue: totalAllTimeRevenue, comp: totalAllTimeComplimentary, orders: totalAllTimeOrders },
      dailyRevenue,
      bestDay,
      topProducts,
      mostUsedStock,
      lowestStock,
      highestStock,
      slowMovers,
      deadStock,
    });
  } catch (err) {
    log.error({ err }, 'analytics/dashboard error');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── REPORT: COMPARE BRANCHES/LOCATIONS ────────────────────────────────────────
// Groups Completed orders by Order.location (set by the device at ring-up -
// see client localStorage 'posBranch') for today and all-time, so multiple
// branches sharing this one deployment can be compared side by side. An
// order with no location tag (every order made before this existed, or a
// single-location shop that never set one) lands in "(Unassigned)" - never
// silently dropped. Also folds in each location's live inventory value from
// the existing per-location stock report, since "unified inventory across
// locations" and "compare branches" are the same screen in the UI.
app.get('/api/analytics/by-location', verifyToken, ...canViewAnalytics, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };

    const groupStage = {
      _id: { $ifNull: [{ $cond: [{ $eq: ['$location', ''] }, null, '$location'] }, '(Unassigned)'] },
      revenue: { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
      orderCount: { $sum: 1 },
    };

    const [allTime, today, inventoryItems] = await Promise.all([
      Order.aggregate([
        { $match: { ...bizScope, status: 'Completed' } },
        { $group: groupStage },
      ]),
      Order.aggregate([
        { $match: { ...bizScope, status: 'Completed', createdAt: { $gte: todayStart } } },
        { $group: groupStage },
      ]),
      Inventory.find(bizScope, { stockQty: 1, unitCost: 1, stockLocation: 1 }).lean(),
    ]);

    const byLoc = {};
    const get = (name) => byLoc[name] || (byLoc[name] = { location: name, allTimeRevenue: 0, allTimeOrders: 0, todayRevenue: 0, todayOrders: 0, inventoryValue: 0, itemCount: 0 });
    for (const row of allTime) { const b = get(row._id); b.allTimeRevenue = +row.revenue.toFixed(2); b.allTimeOrders = row.orderCount; }
    for (const row of today) { const b = get(row._id); b.todayRevenue = +row.revenue.toFixed(2); b.todayOrders = row.orderCount; }
    for (const item of inventoryItems) {
      const b = get(item.stockLocation || '(Unassigned)');
      b.inventoryValue += (item.stockQty || 0) * (item.unitCost || 0);
      b.itemCount += 1;
    }

    const locations = Object.values(byLoc)
      .map(b => ({ ...b, inventoryValue: +b.inventoryValue.toFixed(2), avgTicket: b.allTimeOrders > 0 ? +(b.allTimeRevenue / b.allTimeOrders).toFixed(2) : 0 }))
      .sort((a, b) => b.allTimeRevenue - a.allTimeRevenue);

    res.json({ success: true, locations, hasLocationData: locations.some(l => l.location !== '(Unassigned)') });
  } catch (err) {
    log.error({ err }, 'analytics/by-location error');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── REPORT: MENU ENGINEERING (Stars / Plowhorses / Puzzles / Dogs) ───────────
app.get('/api/reports/menu-engineering', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const match = { ...bizScope, status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = dayStart(start);
      if (end) { match.createdAt.$lte = dayEnd(end); }
    }
    const [ordersData, prods, invItems] = await Promise.all([
      Order.find(match, { items: 1 }).lean(),
      Product.find(bizScope, { _id: 1, name: 1, category: 1, basePrice: 1, baseRecipe: 1, sizes: 1 }).lean(),
      Inventory.find(bizScope, { _id: 1, itemCode: 1, itemName: 1, unitCost: 1, unitMultiplier: 1 }).lean(),
    ]);
    const prodMap = Object.fromEntries(prods.map(p => [p._id.toString(), p]));
    const invMap = {};
    invItems.forEach(i => { invMap[i._id.toString()] = i; if (i.itemCode) invMap[i.itemCode] = i; if (i.itemName) invMap[i.itemName] = i; });
    const stat = {};
    for (const o of ordersData) {
      for (const it of (o.items || [])) {
        for (const line of reportLinesForItem(it, prods, prodMap, invMap)) {
          const key = line.name;
          if (!stat[key]) stat[key] = { name: key, qty: 0, revenue: 0, cogs: 0 };
          stat[key].qty += line.qty;
          stat[key].revenue += line.revenue;
          stat[key].cogs += line.cogs;
        }
      }
    }
    const rows = Object.values(stat).map(s => ({
      ...s, profit: s.revenue - s.cogs, margin: s.revenue > 0 ? (s.revenue - s.cogs) / s.revenue * 100 : 0,
    }));
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const avgQty = rows.length ? totalQty / rows.length : 0;
    const avgMargin = rows.length ? rows.reduce((s, r) => s + r.margin, 0) / rows.length : 0;
    rows.forEach(r => {
      const hiVol = r.qty >= avgQty, hiMargin = r.margin >= avgMargin;
      r.quadrant = hiVol && hiMargin ? 'Star' : hiVol && !hiMargin ? 'Plowhorse' : !hiVol && hiMargin ? 'Puzzle' : 'Dog';
    });
    rows.sort((a, b) => b.revenue - a.revenue);
    res.json({ success: true, items: rows, avgQty, avgMargin });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── REPORT: CASHIER VARIANCE TREND ───────────────────────────────────────────
app.get('/api/reports/cashier-variance', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const owner = await ownerIdentity();
    const agg = await Shift.aggregate([
      { $match: { status: { $in: ['Closed', 'Reconciled'] }, variance: { $ne: null }, cashierId: { $nin: owner.ids }, cashierName: { $nin: owner.names } } },
      { $group: {
        _id: '$cashierName',
        shifts: { $sum: 1 },
        totalVariance: { $sum: '$variance' },
        avgVariance: { $avg: '$variance' },
        shortCount: { $sum: { $cond: [{ $lt: ['$variance', 0] }, 1, 0] } },
        worstShort: { $min: '$variance' },
      }},
      { $sort: { avgVariance: 1 } },
    ]);
    res.json({ success: true, cashiers: agg.map(c => ({ cashierName: c._id || 'Unknown', ...c })) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── REPORT: PURCHASE ORDER SUGGESTION (from low stock + velocity) ────────────
app.get('/api/reports/purchase-order', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const days = Math.max(1, parseInt(req.query.days) || 7); // cover N days of supply
    const since = new Date(Date.now() - 30 * 86400000);
    const [inv, orders, products, suppliers] = await Promise.all([
      Inventory.find(bizScope, { itemCode: 1, itemName: 1, stockQty: 1, unit: 1, unitCost: 1, lowStockThreshold: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1 }).lean(),
      Order.find({ ...bizScope, status: 'Completed', createdAt: { $gte: since } }, { items: 1 }).lean(),
      Product.find(bizScope, { _id: 1, name: 1, productCode: 1, baseRecipe: 1, sizes: 1 }).lean(),
      Supplier.find({ ...tenantScope(req), isActive: true, 'catalog.invId': { $ne: null } }, { name: 1, catalog: 1 }).lean(),
    ]);
    const prodMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));
    // Cheapest supplier quote per inventory item, so a reorder suggestion can be
    // grouped into per-supplier draft POs instead of one manually-assigned PO.
    const bestSupplierByInv = {};
    for (const s of suppliers) {
      for (const c of (s.catalog || [])) {
        if (!c.invId) continue;
        const key = c.invId.toString();
        const cur = bestSupplierByInv[key];
        if (!cur || (c.unitCost || 0) < cur.unitCost) {
          bestSupplierByInv[key] = { supplierId: s._id.toString(), supplierName: s.name, unitCost: c.unitCost, packSize: c.packSize };
        }
      }
    }
    // LOG 1:1: resolve the inventory doc that backs a recipe-less product (by code/name).
    const invByCode = {}, invByName = {};
    inv.forEach(i => { if (i.itemCode) invByCode[i.itemCode] = i; if (i.itemName) invByName[i.itemName] = i; });
    // 30-day usage per inventory id (base units)
    const usage = {};
    for (const o of orders) {
      for (const it of (o.items || [])) {
        const base = (it.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
        const prod = prodMap[it.productId] || products.find(p => p.name === base);
        if (!prod) continue;
        let recipe = prod.baseRecipe || [];
        const sm = (it.name || '').match(/\(([^)]+)\)$/);
        if (sm) { const sz = prod.sizes?.find(s => s.name === sm[1]); if (sz?.recipe?.length) recipe = sz.recipe; }
        if (recipe.some(r => r.invId)) {
          for (const ing of recipe) { if (ing.invId) usage[ing.invId] = (usage[ing.invId] || 0) + (ing.qty || 0) * (it.quantity || 0); }
        } else {
          // 1:1 logistics good: one sold unit consumes unitMultiplier base units.
          const linked = invByCode[prod.productCode] || invByName[prod.name];
          if (linked) usage[linked._id.toString()] = (usage[linked._id.toString()] || 0) + (it.quantity || 0) * baseUnitsPerSale(prod, linked);
        }
      }
    }
    const lines = inv.map(i => {
      const adu = (usage[i._id.toString()] || 0) / 30; // avg daily usage (base units)
      const threshold = i.lowStockThreshold || 0;
      const lowFlag = threshold > 0 && i.stockQty <= threshold;
      if (!lowFlag) return null;

      // For LOG mode display in pcs (pack units); otherwise promote g→kg, ml→L.
      const { displayUnit: effUnit, mult: effMult } = effectiveDisplay(i);
      const isLogBiz = (BUSINESS_TYPE || '').toLowerCase() === 'log';
      const packBase = isLogBiz && i.packSize > 0 ? i.packSize * effMult : effMult;
      const displayUnit = isLogBiz ? 'pcs' : effUnit;
      const divisor = isLogBiz ? packBase : effMult;

      // Best qty = whichever is larger: velocity-based cover OR refill to 2× threshold.
      // This ensures items with low/no velocity still get a sensible restock target.
      const velocityTarget = adu * days;               // base units for N-day cover
      const refillTarget   = threshold * 2;            // bring back to 2× the alert floor
      const bestTarget     = Math.max(velocityTarget, refillTarget);
      const needBase       = Math.max(0, bestTarget - i.stockQty);

      const best = bestSupplierByInv[i._id.toString()] || null;
      return {
        invId: i._id, itemCode: i.itemCode || '', unit: i.unit || '', unitCost: i.unitCost || 0,
        itemName: i.itemName, currentStock: Math.round(i.stockQty / divisor), displayUnit,
        avgDailyUse: +(adu / divisor).toFixed(3), suggestedOrder: Math.ceil(needBase / divisor),
        estCost: +((needBase) * (i.unitCost || 0)).toFixed(2), lowStock: true,
        supplierId: best?.supplierId || null, supplierName: best?.supplierName || null,
      };
    }).filter(Boolean).sort((a, b) => (b.suggestedOrder - a.suggestedOrder));
    const totalEstCost = lines.reduce((s, l) => s + l.estCost, 0);
    res.json({ success: true, coverDays: days, lines, totalEstCost });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── GROSS PROFIT BY CATEGORY ─────────────────────────────────────────────────
app.get('/api/reports/profit-by-category', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const match = { ...bizScope, status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = dayStart(start);
      if (end) { match.createdAt.$lte = dayEnd(end); }
    }
    const [ordersData, prods, invItems] = await Promise.all([
      Order.find(match, { items: 1 }).lean(),
      Product.find(bizScope, { _id: 1, name: 1, category: 1, basePrice: 1, baseRecipe: 1, sizes: 1 }).lean(),
      Inventory.find(bizScope, { _id: 1, itemCode: 1, itemName: 1, unitCost: 1, unitMultiplier: 1 }).lean(),
    ]);
    const prodMap  = Object.fromEntries(prods.map(p => [p._id.toString(), p]));
    const invMap   = {};
    invItems.forEach(i => { invMap[i._id.toString()] = i; if (i.itemCode) invMap[i.itemCode] = i; if (i.itemName) invMap[i.itemName] = i; });
    const stats    = {};
    for (const order of ordersData) {
      for (const item of (order.items || [])) {
        for (const line of reportLinesForItem(item, prods, prodMap, invMap)) {
          const cat = line.category || 'Uncategorized';
          if (!stats[cat]) stats[cat] = { category: cat, revenue: 0, estimatedCOGS: 0, items: 0 };
          stats[cat].revenue += line.revenue;
          stats[cat].estimatedCOGS += line.cogs;
          stats[cat].items++;
        }
      }
    }
    const result = Object.values(stats).map(c => ({
      ...c,
      grossProfit: c.revenue - c.estimatedCOGS,
      margin: c.revenue > 0 ? ((c.revenue - c.estimatedCOGS) / c.revenue) * 100 : 0
    })).sort((a, b) => b.revenue - a.revenue);
    res.json({ success: true, categories: result });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── SELLER COMMISSIONS ────────────────────────────────────────────────────────
// Per-seller (Order.cashier, matched against User.name) commission over a date
// range: sales total × that user's commissionRate. Complimentary orders are
// excluded - same convention as profit-by-category - since no revenue actually
// came in to take a commission from. Every user with any sales in range is
// listed, including a 0%-rate one, so an admin can see who still needs a rate
// set rather than have them silently vanish from the report.
app.get('/api/reports/commissions', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = dayStart(start);
      if (end) { match.createdAt.$lte = dayEnd(end); }
    }
    const [agg, users] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $group: { _id: '$cashier', salesTotal: { $sum: '$total' }, orderCount: { $sum: 1 } } },
      ]),
      User.find({}, { name: 1, userCode: 1, commissionRate: 1 }).lean(),
    ]);
    const userByName = new Map(users.map(u => [u.name, u]));
    const sellers = agg
      .filter(r => r._id && r._id !== 'System') // unattributed/system-placed sales earn no one a commission
      .map(r => {
        const u = userByName.get(r._id);
        const rate = u?.commissionRate || 0;
        const salesTotal = +(r.salesTotal || 0).toFixed(2);
        return {
          name: r._id,
          userCode: u?.userCode || null,
          salesTotal,
          orderCount: r.orderCount,
          commissionRate: rate,
          commissionEarned: +((salesTotal * rate) / 100).toFixed(2),
        };
      })
      .sort((a, b) => b.commissionEarned - a.commissionEarned);
    res.json({ success: true, sellers, totalCommission: +sellers.reduce((s, x) => s + x.commissionEarned, 0).toFixed(2) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── SALES BY PAYMENT METHOD ───────────────────────────────────────────────────
app.get('/api/reports/sales-by-payment', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = dayStart(start);
      if (end) { match.createdAt.$lte = dayEnd(end); }
    }
    const result = await Order.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$total' }, subtotal: { $sum: '$subtotal' }, discount: { $sum: '$discount' } } },
      { $sort: { total: -1 } }
    ]);
    const grandTotal = result.reduce((s, r) => s + (r.total || 0), 0);
    res.json({ success: true, grandTotal, breakdown: result.map(r => ({ method: r._id, count: r.count, total: r.total, subtotal: r.subtotal, discount: r.discount, pct: grandTotal > 0 ? (r.total / grandTotal * 100) : 0 })) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── SALES TREND - daily revenue buckets over a bounded range, plus a rolling
// moving average and the % change vs. the immediately-prior period of equal
// length. `period` only picks the default range length (week=7d, month=30d);
// an explicit start/end always wins. Same $dateToString/Asia-Manila bucketing
// as the analytics dashboard's dailyRevenue, and the same validateDateRange
// bound (92 days) every other export/report in this file uses.
app.get('/api/reports/sales-trend', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const period = req.query.period === 'month' ? 'month' : 'week';
    const days = period === 'month' ? 30 : 7;
    const defaultEnd = new Date();
    const defaultStart = new Date(defaultEnd.getTime() - (days - 1) * 86400000);
    // Default window must be expressed in the SAME timezone the buckets are
    // grouped by (Asia/Manila, below), or "today" resolves to a UTC date whose
    // Manila day-end can fall before the current moment - silently dropping
    // sales made during Manila's early-morning hours. en-CA gives YYYY-MM-DD.
    const manilaDateStr = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const startStr = req.query.start || manilaDateStr(defaultStart);
    const endStr = req.query.end || manilaDateStr(defaultEnd);
    const range = validateDateRange(startStr, endStr);
    if (!range.ok) return res.status(400).json({ success: false, error: range.error });
    const { startDate, endDate } = range;

    // Immediately-prior period of equal length, for the vs.-prior % change.
    const spanMs = endDate.getTime() - startDate.getTime();
    const priorEnd = new Date(startDate.getTime() - 1);
    const priorStart = new Date(startDate.getTime() - spanMs - 1);

    const bizScope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const [buckets, priorAgg] = await Promise.all([
      Order.aggregate([
        { $match: { ...bizScope, status: 'Completed', createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Manila' } },
            net: { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
        }},
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { ...bizScope, status: 'Completed', createdAt: { $gte: priorStart, $lte: priorEnd } } },
        { $group: { _id: null, net: { $sum: { $cond: ['$isComplimentary', 0, '$total'] } } } },
      ]),
    ]);

    const currentTotal = buckets.reduce((s, b) => s + (b.net || 0), 0);
    const priorTotal = priorAgg[0]?.net || 0;
    const changePct = priorTotal > 0
      ? +(((currentTotal - priorTotal) / priorTotal) * 100).toFixed(1)
      : (currentTotal > 0 ? 100 : 0);

    // 7-day rolling average of daily revenue, regardless of period - the range
    // length changes with period, the smoothing window doesn't need to.
    const window = 7;
    const series = buckets.map(b => ({ date: b._id, revenue: +(b.net || 0).toFixed(2) }));
    const withMovingAvg = series.map((b, i) => {
      const slice = series.slice(Math.max(0, i - window + 1), i + 1);
      const avg = slice.reduce((s, x) => s + x.revenue, 0) / slice.length;
      return { ...b, movingAvg: +avg.toFixed(2) };
    });

    res.json({
      success: true, period, buckets: withMovingAvg,
      currentTotal: +currentTotal.toFixed(2), priorTotal: +priorTotal.toFixed(2), changePct,
      range: { start: startDate, end: endDate },
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/reports/sales-summary', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = dayStart(start);
      if (end) { match.createdAt.$lte = dayEnd(end); }
    }
    const orders = await Order.find(match, {
      orderNumber: 1, total: 1, paymentMethod: 1, payments: 1, createdAt: 1,
      customerName: 1, clientId: 1, clientAccountId: 1,
    }).sort({ createdAt: 1 }).lean();

    // Resolve to the client's standard CUS-1000-A0000 code, not the raw ObjectId
    // stored on the order (clientId / clientAccountId are internal references).
    // No linked ClientAccount = a genuine walk-in - gets the reserved walk-in code,
    // never a blank ID.
    const clientRefIds = [...new Set(orders.map(o => o.clientId || o.clientAccountId).filter(Boolean))];
    const clientCodeById = clientRefIds.length
      ? Object.fromEntries((await ClientAccount.find({ _id: { $in: clientRefIds } }, { clientCode: 1 }).lean())
          .map(c => [String(c._id), c.clientCode]))
      : {};

    const rows = orders.map(o => {
      const ch = { cash: 0, ewallet: 0, bank: 0, delivery: 0 };
      const methods = {};
      const splits = (o.payments && o.payments.length)
        ? o.payments
        : [{ method: o.paymentMethod || 'Cash', amount: o.total || 0 }];
      for (const p of splits) {
        const amt = Number(p.amount) || 0;
        const m = p.method || 'Cash';
        ch[paymentChannel(m)] += amt;
        methods[m] = (methods[m] || 0) + amt;
      }
      const refId = o.clientId || o.clientAccountId || '';
      return {
        date: o.createdAt, orderNumber: o.orderNumber,
        customerId: (clientCodeById[String(refId)] || WALK_IN_CUSTOMER_CODE).toUpperCase(),
        customerName: (o.customerName || 'WALK-IN').toUpperCase(),
        ...ch, methods, total: Number(o.total) || 0,
      };
    });

    const totals = rows.reduce((t, r) => {
      t.cash += r.cash; t.ewallet += r.ewallet; t.bank += r.bank; t.delivery += r.delivery; t.total += r.total;
      for (const [m, a] of Object.entries(r.methods)) t.methods[m] = (t.methods[m] || 0) + a;
      return t;
    }, { cash: 0, ewallet: 0, bank: 0, delivery: 0, total: 0, methods: {} });

    res.json({ success: true, rows, totals });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── SALES LINE ITEMS ─────────────────────────────────────────────────────────
// One row per order LINE (not per order) - the item-level detail Summary Sales
// deliberately leaves out. Same Completed/non-comp filter and date range as
// sales-summary, so the two reports reconcile against each other.
app.get('/api/reports/sales-line-items', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = dayStart(start);
      if (end) { match.createdAt.$lte = dayEnd(end); }
    }
    const orders = await Order.find(match, {
      orderNumber: 1, paymentMethod: 1, createdAt: 1, customerName: 1, clientId: 1, clientAccountId: 1, items: 1,
    }).sort({ createdAt: 1 }).lean();

    const clientRefIds = [...new Set(orders.map(o => o.clientId || o.clientAccountId).filter(Boolean))];
    const clientCodeById = clientRefIds.length
      ? Object.fromEntries((await ClientAccount.find({ _id: { $in: clientRefIds } }, { clientCode: 1 }).lean())
          .map(c => [String(c._id), c.clientCode]))
      : {};

    // Resolve each combo component's own product code so the report shows it.
    const compIds = [...new Set(orders.flatMap(o => (o.items || [])
      .filter(it => it.isCombo && Array.isArray(it.comboItems))
      .flatMap(it => it.comboItems.map(c => c.productId).filter(Boolean))))];
    const codeByProductId = compIds.length
      ? Object.fromEntries((await Product.find({ _id: { $in: compIds } }, { productCode: 1 }).lean())
          .map(p => [String(p._id), p.productCode || '']))
      : {};

    const rows = [];
    for (const o of orders) {
      const refId = o.clientId || o.clientAccountId || '';
      const customerId = (clientCodeById[String(refId)] || WALK_IN_CUSTOMER_CODE).toUpperCase();
      const customerName = (o.customerName || 'WALK-IN').toUpperCase();
      for (const it of (o.items || [])) {
        const qty = Number(it.quantity) || 0;
        const lineTotal = (Number(it.price) || 0) * qty + (it.selectedAddOns || []).reduce((s, a) => s + (Number(a.price) || 0), 0) * qty;
        const isCombo = it.isCombo && Array.isArray(it.comboItems) && it.comboItems.length > 0;
        rows.push({
          date: o.createdAt, orderNumber: o.orderNumber, paymentMethod: o.paymentMethod,
          customerId, customerName,
          itemCode: (it.productCode || '').toUpperCase(), itemName: (it.name || '').toUpperCase(), quantity: qty, lineTotal,
          isCombo,
        });
        // For a promo/combo, list the products it includes as indented sub-rows.
        // They carry the component quantity but ₱0 - the combo row holds the price,
        // so components are informational and don't double-count the grand total.
        if (isCombo) {
          for (const comp of it.comboItems) {
            rows.push({
              date: o.createdAt, orderNumber: o.orderNumber, paymentMethod: o.paymentMethod,
              customerId, customerName,
              itemCode: (codeByProductId[String(comp.productId)] || '').toUpperCase(),
              itemName: (comp.name || '').toUpperCase() + (comp.sizeName ? ` (${comp.sizeName})` : ''),
              quantity: (Number(comp.quantity) || 1) * qty, lineTotal: 0,
              isComponent: true,
            });
          }
        }
      }
    }
    const grandTotal = rows.reduce((s, r) => s + r.lineTotal, 0);
    res.json({ success: true, rows, grandTotal });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── REPORT: NON-VAT PERCENTAGE TAX (3%) ──────────────────────────────────────
// Read-only. Computes the 3% non-VAT percentage tax over a REQUIRED date range.
// Base = net collected (gross receipts actually received) = Σ order.total, mirroring
// the sales reports' "Completed, non-complimentary" filter (so voids & comps are
// excluded). 410000 is booked gross-of-discount, so an explicit "less: sales
// discounts" line is returned and the figure reconciles to cash received.
// Aggregate-based - no in-memory full scan. No schema/journal changes (report only).
app.get('/api/reports/percentage-tax', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ success: false, error: 'A start and end date are both required.' });
    }
    const startDate = dayStart(start);
    const endDate = dayStart(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date range.' });
    }
    endDate.setHours(23, 59, 59, 999);

    // A VAT-registered business owes 12% VAT and is NOT liable for the 3%
    // percentage tax (NIRC §116) - the two are mutually exclusive. Returning a
    // figure here while VAT is on would invite someone to pay a tax they do not
    // owe, so the report reports its own inapplicability instead.
    const vatRow = await Settings.findOne({ key: 'vatEnabled' }).lean();
    if (vatRow?.value === true || vatRow?.value === 'true') {
      return res.json({
        success: true,
        notApplicable: true,
        reason: 'This business is VAT-registered. VAT-registered taxpayers are not liable for the 3% percentage tax under NIRC §116.',
        period: { start: startDate, end: endDate },
        orders: 0, grossSales: 0, discounts: 0, netCollected: 0,
        rate: PERCENTAGE_TAX_RATE, taxDue: 0, lines: [],
      });
    }

    const agg = await Order.aggregate([
      { $match: { businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Completed', isComplimentary: { $ne: true }, createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: {
          _id: null,
          netCollected: { $sum: { $ifNull: ['$total', 0] } },
          discounts:    { $sum: { $ifNull: ['$discount', 0] } },
          orders:       { $sum: 1 },
      } },
    ]);
    const a = agg[0] || { netCollected: 0, discounts: 0, orders: 0 };
    const tax = computePercentageTax({ netCollected: a.netCollected, discounts: a.discounts });

    res.json({
      success: true,
      period: { start: startDate, end: endDate },
      orders: a.orders,
      ...tax,
      // Explicit, auditable breakdown - the discount subtraction is a visible line.
      lines: [
        { label: 'Gross sales (before discounts)', amount: tax.grossSales },
        { label: 'Less: sales discounts',          amount: -tax.discounts },
        { label: 'Net collected (gross receipts)',  amount: tax.netCollected },
        { label: `Percentage tax due (${(PERCENTAGE_TAX_RATE * 100).toFixed(0)}%)`, amount: tax.taxDue },
      ],
    });
  } catch (err) {
    log.error({ err }, 'Percentage-tax report failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
// ============================================================
// A/R REPORT - every open receivable as of a date, aged, with what has
// already been collected against it.
//
// Distinct from /api/finance/ar-ageing (a live per-client summary for the
// ledger tab): this is the printable invoice-level schedule an owner or an
// auditor asks for - one line per invoice, face value, collected to date,
// balance, age bucket - plus per-client and per-bucket subtotals.
//
// `asOf` (default today) ages the invoices and, importantly, excludes
// collections deposited AFTER that date, so re-running last month's report
// still reproduces last month's numbers instead of silently restating them.
// ============================================================
app.get('/api/reports/ar-aging', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const asOf = req.query.asOf ? dayEnd(req.query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) return res.status(400).json({ success: false, error: 'Invalid asOf date.' });

    // Anything completed on or before asOf that was ever a receivable. Orders
    // fully settled by asOf are dropped further down - they can't be dropped
    // here, because an invoice settled LAST week was still outstanding as of a
    // report date two weeks ago.
    const rows = await Order.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      status: 'Completed',
      paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true },
      createdAt: { $lte: asOf },
    }, {
      orderNumber: 1, customerName: 1, total: 1, paymentMethod: 1, createdAt: 1,
      arDueDate: 1, arTermsDays: 1, arPaidAmount: 1, arPayments: 1,
      clientAccountId: 1, clientId: 1,
    }).sort({ createdAt: 1 }).lean();

    const clients = await ClientAccount.find({}, { name: 1, clientCode: 1, creditLimit: 1 }).lean();
    const { keyOf } = resolveClientKey(clients);
    const codeByName = new Map(clients.map(c => [c.name, c.clientCode || '']));

    const invoices = [];
    for (const o of rows) {
      // Only collections DEPOSITED on or before asOf count toward the
      // as-of balance - that is what makes the report reproducible.
      const paidAsOf = (o.arPayments || [])
        .filter(p => new Date(p.depositDate || p.collectionDate || p.createdAt) <= asOf)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const face = Number(o.total) || 0;
      const balance = Math.round((face - paidAsOf) * 100) / 100;
      if (balance <= 0.01) continue;                       // settled as of the report date

      const ageDays = Math.floor((asOf - new Date(o.createdAt)) / 86400000);
      invoices.push({
        _id: o._id,
        orderNumber: o.orderNumber,
        client: keyOf(o),
        clientCode: codeByName.get(keyOf(o)) || '',
        paymentMethod: o.paymentMethod,
        invoiceDate: o.createdAt,
        dueDate: o.arDueDate || null,
        termsDays: o.arTermsDays ?? null,
        faceTotal: Math.round(face * 100) / 100,
        paid: Math.round(paidAsOf * 100) / 100,
        balance,
        ageDays,
        bucket: bucketFor(ageDays),
        overdue: o.arDueDate ? new Date(o.arDueDate) < asOf : false,
        lastCollection: (o.arPayments || []).length
          ? (o.arPayments || []).reduce((a, b) =>
              new Date(a.collectionDate || a.createdAt) > new Date(b.collectionDate || b.createdAt) ? a : b).collectionDate || null
          : null,
      });
    }

    const blank = () => ({ current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, count: 0 });
    const totals = blank();
    const byClientMap = new Map();
    for (const inv of invoices) {
      totals[inv.bucket] += inv.balance; totals.total += inv.balance; totals.count += 1;
      if (!byClientMap.has(inv.client)) byClientMap.set(inv.client, { client: inv.client, clientCode: inv.clientCode, ...blank() });
      const c = byClientMap.get(inv.client);
      c[inv.bucket] += inv.balance; c.total += inv.balance; c.count += 1;
    }
    const round = (o) => { for (const k of ['current', 'd31_60', 'd61_90', 'd90_plus', 'total']) o[k] = Math.round(o[k] * 100) / 100; return o; };

    res.json({
      success: true,
      asOf,
      invoices: invoices.sort((a, b) => b.ageDays - a.ageDays),
      byClient: [...byClientMap.values()].map(round).sort((a, b) => b.total - a.total),
      totals: round(totals),
      overdueTotal: Math.round(invoices.filter(i => i.overdue).reduce((s, i) => s + i.balance, 0) * 100) / 100,
    });
  } catch (err) {
    log.error({ err }, 'A/R report failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// COLLECTION REPORT - money actually collected against A/R in a date range.
//
// The A/R report answers "what is still owed"; this answers "what came in".
// Every collection posted through settle-ar is one line, and the range can be
// read on either date, because the two answer different questions:
//   basis=collection (default) - what the collectors brought in that week
//   basis=deposit              - what actually hit the bank that week, which
//                                is the figure that ties to a bank statement
// Undeposited collections (collected in range, deposited after it, or not yet)
// are called out separately - that gap is exactly where cash goes missing.
// ============================================================
app.get('/api/reports/collections', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const basis = req.query.basis === 'deposit' ? 'deposit' : 'collection';
    const from = start ? dayStart(start) : dayStart(new Date(Date.now() - 30 * 86400000));
    const to = end ? dayEnd(end) : dayEnd(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
      return res.status(400).json({ success: false, error: 'Invalid date range.' });
    if (from > to) return res.status(400).json({ success: false, error: 'Start date must be on or before the end date.' });

    // Any order carrying at least one collection - the date filter is applied
    // per payment below, since one invoice can be collected across months.
    const orders = await Order.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      'arPayments.0': { $exists: true },
    }, {
      orderNumber: 1, customerName: 1, total: 1, paymentMethod: 1, createdAt: 1,
      arPaidAmount: 1, arPayments: 1, arSettled: 1, clientAccountId: 1, clientId: 1,
    }).lean();

    const clients = await ClientAccount.find({}, { name: 1, clientCode: 1 }).lean();
    const { keyOf } = resolveClientKey(clients);

    const rows = [];
    let undepositedTotal = 0;
    for (const o of orders) {
      for (const p of (o.arPayments || [])) {
        const collectedOn = p.collectionDate ? new Date(p.collectionDate) : new Date(p.createdAt);
        const depositedOn = p.depositDate ? new Date(p.depositDate) : null;
        const basisDate = basis === 'deposit' ? depositedOn : collectedOn;
        if (!basisDate || basisDate < from || basisDate > to) continue;
        const amt = Math.round((Number(p.amount) || 0) * 100) / 100;
        // "In transit": collected inside the window but not yet banked, or
        // banked only after the window closed.
        const inTransit = !depositedOn || depositedOn > to;
        if (basis === 'collection' && inTransit) undepositedTotal += amt;
        rows.push({
          orderId: o._id,
          orderNumber: o.orderNumber,
          client: keyOf(o),
          invoiceTotal: Math.round((Number(o.total) || 0) * 100) / 100,
          amount: amt,
          collectionDate: collectedOn,
          depositDate: depositedOn,
          // Days the money sat with the collector before it was banked.
          floatDays: depositedOn ? Math.max(0, Math.floor((dayStart(depositedOn) - dayStart(collectedOn)) / 86400000)) : null,
          depositedTo: p.paymentMethod || '',
          referenceNumber: p.referenceNumber || '',
          note: p.note || '',
          collectedBy: p.collectedBy || '',
          recordedBy: p.recordedBy || '',
          journalRef: p.journalRef || '',
          settledInvoice: !!o.arSettled,
        });
      }
    }

    const sum = (list) => Math.round(list.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const groupBy = (key, label) => {
      const m = new Map();
      for (const r of rows) {
        const k = r[key] || '(none)';
        if (!m.has(k)) m.set(k, { [label]: k, amount: 0, count: 0 });
        const g = m.get(k); g.amount += r.amount; g.count += 1;
      }
      return [...m.values()].map(g => ({ ...g, amount: Math.round(g.amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
    };

    // Daily series on whichever date basis was asked for - the shape the UI
    // charts and the one that ties to a bank statement when basis=deposit.
    const dailyMap = new Map();
    for (const r of rows) {
      const d = (basis === 'deposit' ? r.depositDate : r.collectionDate);
      const k = new Date(d).toISOString().slice(0, 10);
      dailyMap.set(k, Math.round(((dailyMap.get(k) || 0) + r.amount) * 100) / 100);
    }

    res.json({
      success: true,
      period: { start: from, end: to, basis },
      collections: rows.sort((a, b) => new Date(b[basis === 'deposit' ? 'depositDate' : 'collectionDate']) - new Date(a[basis === 'deposit' ? 'depositDate' : 'collectionDate'])),
      totalCollected: sum(rows),
      count: rows.length,
      // Only meaningful on the collection basis - on a deposit basis every row
      // is by definition already banked.
      undepositedTotal: Math.round(undepositedTotal * 100) / 100,
      byClient: groupBy('client', 'client'),
      byMethod: groupBy('depositedTo', 'method'),
      byCollector: groupBy('collectedBy', 'collector'),
      daily: [...dailyMap.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    log.error({ err }, 'Collection report failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// PRICE CHANGE LOG - every price and cost change across the whole catalogue,
// in one place.
//
// The per-product history (GET /api/products/:id/price-history) answers "what
// has this item cost over time". This answers the other question an owner
// actually asks: "what did anyone change last month, and who signed it off" -
// without opening products one at a time. Reads the same AuditLog trail, so a
// change made directly and one that went through the approval queue both
// appear, distinguishable by `viaApproval`.
// ============================================================
app.get('/api/reports/price-changes', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const filter = {
      action: { $in: ['PRODUCT_PRICE_CHANGED', 'PRODUCT_RECIPE_COST_CHANGED'] },
    };
    if (start || end) {
      filter.timestamp = {};
      if (start) filter.timestamp.$gte = dayStart(start);
      if (end) filter.timestamp.$lte = dayEnd(end);
    }
    if (req.query.changedBy) filter.userId = String(req.query.changedBy).trim();

    const rows = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(1000).lean();

    // Resolve each row back to a live product so the log can link through and
    // show the current price next to what it was changed to. targetReference is
    // a productCode when the product has one, else the raw _id - both are
    // looked up, the same way the per-product history does it.
    const refs = [...new Set(rows.map(r => r.targetReference).filter(Boolean))];
    const ids = refs.filter(r => mongoose.Types.ObjectId.isValid(r));
    const products = await Product.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      $or: [{ productCode: { $in: refs } }, ...(ids.length ? [{ _id: { $in: ids } }] : [])],
    }, { name: 1, productCode: 1, basePrice: 1, costOverride: 1 }).lean();

    const byRef = new Map();
    for (const p of products) {
      if (p.productCode) byRef.set(p.productCode, p);
      byRef.set(String(p._id), p);
    }

    const changes = rows.map(r => {
      const isPrice = r.action === 'PRODUCT_PRICE_CHANGED';
      const product = byRef.get(r.targetReference) || null;
      const oldValue = isPrice ? r.details?.oldPrice : r.details?.oldCost;
      const newValue = isPrice ? r.details?.newPrice : r.details?.newCost;
      const from = Number(oldValue) || 0;
      const to = Number(newValue) || 0;
      return {
        date: r.timestamp,
        type: isPrice ? 'price' : 'cost',
        productId: product ? String(product._id) : null,
        productName: r.details?.name || product?.name || r.targetReference,
        productCode: product?.productCode || '',
        oldValue, newValue,
        delta: Math.round((to - from) * 100) / 100,
        // Percent move is what makes an outlier jump off the page; guarded so a
        // change from zero doesn't render as Infinity.
        percent: from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : null,
        reason: r.details?.reason || '',
        changedBy: r.userId || '',
        viaApproval: !!r.details?.viaApproval,
        requestedBy: r.details?.requestedBy || '',
        approvedBy: r.details?.approvedBy || '',
        currentValue: product ? (isPrice ? product.basePrice : product.costOverride) : null,
      };
    });

    // Still-open requests, so the log shows what is about to change as well as
    // what already has.
    const pending = await ChangeRequest.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      entity: 'Product', status: 'Pending',
    }).sort({ createdAt: -1 }).limit(200).lean();

    const increases = changes.filter(c => c.type === 'price' && c.delta > 0);
    const decreases = changes.filter(c => c.type === 'price' && c.delta < 0);

    res.json({
      success: true,
      period: { start: start || null, end: end || null },
      changes,
      pending: pending.map(r => ({
        _id: r._id, date: r.createdAt, productName: r.entityName,
        changes: r.changes, reason: r.reason, requestedBy: r.requestedBy,
      })),
      summary: {
        total: changes.length,
        priceChanges: changes.filter(c => c.type === 'price').length,
        costChanges: changes.filter(c => c.type === 'cost').length,
        increases: increases.length,
        decreases: decreases.length,
        // The biggest single move in the window - the one worth a second look.
        largestIncrease: increases.length ? increases.reduce((a, b) => (b.percent ?? 0) > (a.percent ?? 0) ? b : a) : null,
        largestDecrease: decreases.length ? decreases.reduce((a, b) => (b.percent ?? 0) < (a.percent ?? 0) ? b : a) : null,
        pendingCount: pending.length,
        // How many changes went through review rather than straight in.
        viaApproval: changes.filter(c => c.viaApproval).length,
      },
    });
  } catch (err) {
    log.error({ err }, 'Price change log failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// A/P REPORT - every unpaid bill as of a date, aged, per supplier.
//
// The mirror of /api/reports/ar-aging: that one answers "who owes me and how
// old is it", this answers "who do I owe and when is it due". The two are
// deliberately aged on DIFFERENT dates, because the questions differ:
//
//   A/R ages on invoice date - how long a debt has been outstanding is what
//        tells you whether you will ever collect it.
//   A/P ages on DUE date     - nobody cares how long ago a bill was raised;
//        what matters is how far past its payment date it is, because that is
//        what damages a supplier relationship or triggers a penalty.
//
// A bill with no due date has nothing to be late against, so it is reported
// as "undated" rather than silently bucketed as current (which would understate
// what is overdue) or as 90+ (which would invent a crisis).
//
// `asOf` re-runs a past position: bills raised after that date are excluded,
// and bills paid after it are counted as still open, so last month's report
// still reproduces last month's numbers.
// ============================================================
app.get('/api/reports/ap-aging', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const asOf = req.query.asOf ? dayEnd(req.query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) return res.status(400).json({ success: false, error: 'Invalid asOf date.' });

    // Approved and Pending bills are both real obligations - an unapproved bill
    // is money the supplier is already owed, it just hasn't been authorised for
    // payment yet. Rejected bills are not debts. Paid ones are filtered by date
    // below rather than by status, so an as-of report sees them as still open.
    const bills = await Bill.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      status: { $in: ['Pending', 'Approved', 'Paid'] },
      createdAt: { $lte: asOf },
    }, {
      billNumber: 1, supplierId: 1, supplierName: 1, source: 1, poNumber: 1,
      description: 1, amount: 1, status: 1, dueDate: 1, scheduledPaymentDate: 1,
      createdAt: 1, paidAt: 1, approvedAt: 1,
    }).sort({ dueDate: 1 }).lean();

    const open = [];
    for (const b of bills) {
      // Paid ON OR BEFORE the report date is settled as of then; paid after it
      // was still outstanding at the time.
      if (b.status === 'Paid' && b.paidAt && new Date(b.paidAt) <= asOf) continue;

      const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
      if (amount <= 0.01) continue;

      const due = b.dueDate ? new Date(b.dueDate) : null;
      // Days PAST DUE - negative means it isn't due yet.
      const daysPastDue = due ? Math.floor((asOf - due) / 86400000) : null;
      const bucket = due === null ? 'undated' : bucketFor(Math.max(0, daysPastDue));

      open.push({
        _id: b._id,
        billNumber: b.billNumber,
        supplierId: b.supplierId ? String(b.supplierId) : null,
        supplier: b.supplierName || 'Unattributed',
        source: b.source,
        poNumber: b.poNumber || '',
        description: b.description || '',
        amount,
        status: b.status,
        billDate: b.createdAt,
        dueDate: due,
        scheduledPaymentDate: b.scheduledPaymentDate || null,
        daysPastDue,
        overdue: daysPastDue !== null && daysPastDue > 0,
        bucket,
        // Waiting on someone before it can even be scheduled - a Pending bill
        // that is already overdue is an approval problem, not a cash one.
        awaitingApproval: b.status === 'Pending',
      });
    }

    const blank = () => ({ current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, undated: 0, total: 0, count: 0 });
    const totals = blank();
    const bySupplierMap = new Map();
    for (const b of open) {
      totals[b.bucket] += b.amount; totals.total += b.amount; totals.count += 1;
      const key = b.supplier;
      if (!bySupplierMap.has(key)) bySupplierMap.set(key, { supplier: key, supplierId: b.supplierId, ...blank() });
      const g = bySupplierMap.get(key);
      g[b.bucket] += b.amount; g.total += b.amount; g.count += 1;
    }
    const round = (o) => {
      for (const k of ['current', 'd31_60', 'd61_90', 'd90_plus', 'undated', 'total']) o[k] = Math.round(o[k] * 100) / 100;
      return o;
    };

    const sum = (list) => Math.round(list.reduce((s, b) => s + b.amount, 0) * 100) / 100;
    // What falls due in the next week - the number that drives "do we have the
    // cash", which an aged bucket alone never answers.
    const weekAhead = new Date(asOf.getTime() + 7 * 86400000);
    const dueSoon = open.filter(b => b.dueDate && !b.overdue && new Date(b.dueDate) <= weekAhead);

    res.json({
      success: true,
      asOf,
      bills: open.sort((a, b) => {
        // Most overdue first; undated bills sink to the bottom.
        if (a.daysPastDue === null) return 1;
        if (b.daysPastDue === null) return -1;
        return b.daysPastDue - a.daysPastDue;
      }),
      bySupplier: [...bySupplierMap.values()].map(round).sort((a, b) => b.total - a.total),
      totals: round(totals),
      overdueTotal: sum(open.filter(b => b.overdue)),
      overdueCount: open.filter(b => b.overdue).length,
      dueSoonTotal: sum(dueSoon),
      dueSoonCount: dueSoon.length,
      awaitingApprovalTotal: sum(open.filter(b => b.awaitingApproval)),
      awaitingApprovalCount: open.filter(b => b.awaitingApproval).length,
    });
  } catch (err) {
    log.error({ err }, 'A/P report failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// PAYMENTS REPORT - money actually paid OUT to suppliers in a date range.
//
// The exact counterpart of the collection report: that one is what came in,
// this is what went out. Reads the A/P journal debits rather than Bill rows,
// so a direct supplier payment that never had a bill raised against it still
// appears - otherwise the report would quietly understate what left the bank.
// ============================================================
app.get('/api/reports/supplier-payments', verifyToken, ...canViewReports, async (req, res) => {
  try {
    const { start, end } = req.query;
    const from = start ? dayStart(start) : dayStart(new Date(Date.now() - 30 * 86400000));
    const to = end ? dayEnd(end) : dayEnd(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
      return res.status(400).json({ success: false, error: 'Invalid date range.' });
    if (from > to) return res.status(400).json({ success: false, error: 'Start date must be on or before the end date.' });

    // A DEBIT to 220000 is A/P going down - i.e. a supplier being paid.
    const rows = await JournalEntry.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000', 'lines.debit': { $gt: 0 } } },
      { $group: {
        _id: '$_id',
        date:         { $first: '$date' },
        reference:    { $first: '$reference' },
        description:  { $first: '$description' },
        supplierName: { $first: '$supplierName' },
        supplierId:   { $first: '$supplierId' },
        lines:        { $first: '$lines' },
        amount:       { $sum: '$lines.debit' },
      }},
      { $sort: { date: -1 } },
      { $limit: 1000 },
    ]);

    // Which account the money actually left. The A/P line is the debit; the
    // credit side of the same entry is the cash/bank account that funded it.
    const entryIds = rows.map(r => r._id);
    const fullEntries = await JournalEntry.find({ _id: { $in: entryIds } }, { lines: 1 }).lean();
    const paidFromById = new Map(fullEntries.map(e => {
      const credit = (e.lines || []).find(l => (l.credit || 0) > 0);
      return [String(e._id), credit ? { code: credit.accountCode, name: credit.accountName } : null];
    }));

    const payments = rows.map(r => ({
      date: r.date,
      reference: r.reference || '',
      description: r.description || '',
      supplier: r.supplierName || 'Unattributed',
      supplierId: r.supplierId ? String(r.supplierId) : null,
      amount: Math.round((Number(r.amount) || 0) * 100) / 100,
      paidFrom: paidFromById.get(String(r._id))?.name || '',
      paidFromCode: paidFromById.get(String(r._id))?.code || '',
    }));

    const groupBy = (key, label) => {
      const m = new Map();
      for (const p of payments) {
        const k = p[key] || '(none)';
        if (!m.has(k)) m.set(k, { [label]: k, amount: 0, count: 0 });
        const g = m.get(k); g.amount += p.amount; g.count += 1;
      }
      return [...m.values()].map(g => ({ ...g, amount: Math.round(g.amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
    };

    const dailyMap = new Map();
    for (const p of payments) {
      const k = new Date(p.date).toISOString().slice(0, 10);
      dailyMap.set(k, Math.round(((dailyMap.get(k) || 0) + p.amount) * 100) / 100);
    }

    res.json({
      success: true,
      period: { start: from, end: to },
      payments,
      totalPaid: Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      count: payments.length,
      bySupplier: groupBy('supplier', 'supplier'),
      byAccount: groupBy('paidFrom', 'account'),
      daily: [...dailyMap.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    log.error({ err }, 'Supplier payments report failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
