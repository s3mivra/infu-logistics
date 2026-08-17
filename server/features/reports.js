// reports routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { captureError } from '../lib/errorLog.js';

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
    DiscountSchema,
    Discount,
    SupplierSchema,
    Supplier,
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

    const revenue = [], cogs = [], opex = [];
    let totalRevenue = 0, totalCogs = 0, totalOpex = 0, totalContraRevenue = 0;

    for (const r of agg) {
      const code = r._id;
      const meta = acctMeta(code);
      const balance = (r.totalCredit || 0) - (r.totalDebit || 0); // revenue = credit-balance
      const expBalance = (r.totalDebit || 0) - (r.totalCredit || 0); // expense = debit-balance

      if (!meta) continue;
      if (meta.type === 'revenue' || meta.type === 'other-income') {
        revenue.push({ code, name: meta.name, amount: +balance.toFixed(2) });
        totalRevenue += balance;
      } else if (meta.type === 'contra-revenue') {
        revenue.push({ code, name: meta.name, amount: -(+expBalance.toFixed(2)) });
        totalContraRevenue += expBalance;
      } else if (meta.type === 'expense' && meta.cogs) {
        cogs.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalCogs += expBalance;
      } else if (meta.type === 'expense') {
        opex.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalOpex += expBalance;
      }
    }

    const netRevenue = totalRevenue - totalContraRevenue;
    const grossProfit = netRevenue - totalCogs;
    const netIncome = grossProfit - totalOpex;

    res.json({
      success: true,
      period: { start: startDate, end: endDate },
      revenue, cogs, opex,
      totals: {
        revenue: +totalRevenue.toFixed(2),
        contraRevenue: +totalContraRevenue.toFixed(2),
        netRevenue: +netRevenue.toFixed(2),
        cogs: +totalCogs.toFixed(2),
        grossProfit: +grossProfit.toFixed(2),
        grossMargin: netRevenue > 0 ? +((grossProfit / netRevenue) * 100).toFixed(2) : 0,
        opex: +totalOpex.toFixed(2),
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

    res.json({
      success: true,
      asOf,
      assets, liabilities, equity,
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
      Inventory.find(bizScope, { itemCode: 1, itemName: 1, stockQty: 1, unitCost: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, lowStockThreshold: 1, createdAt: 1 }).lean(),
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
          dailyAvg: burn,
          daysLeft: burn > 0 ? Math.floor(i.currentStock / burn) : Infinity,
          weeklyNeed: Math.ceil(burn * 7),
          monthlyNeed: Math.ceil(burn * 30),
          // Dynamic reorder point = cover the lead time + a safety buffer of demand.
          reorderPoint: Math.ceil(burn * (LEAD_TIME_DAYS + SAFETY_DAYS)),
          isNewSku,
          trendPct: i.adu30 > 0 ? (i.adu7 / i.adu30 - 1) * 100 : null, // null = no baseline (NEW)
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
      Inventory.find(bizScope, { itemCode: 1, itemName: 1, stockQty: 1, unit: 1, unitCost: 1, lowStockThreshold: 1, displayUnit: 1, unitMultiplier: 1 }).lean(),
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
      const target = adu * days;
      // Display in kg/L/pcs - auto-promote g/ml so the PO never shows base units.
      const { displayUnit, mult } = effectiveDisplay(i);
      const needBase = Math.max(0, target - i.stockQty);
      const lowFlag = i.lowStockThreshold > 0 && i.stockQty <= i.lowStockThreshold;
      const best = bestSupplierByInv[i._id.toString()] || null;
      return {
        invId: i._id, itemCode: i.itemCode || '', unit: i.unit || '', unitCost: i.unitCost || 0,
        itemName: i.itemName, currentStock: +(i.stockQty / mult).toFixed(2), displayUnit,
        avgDailyUse: +(adu / mult).toFixed(3), suggestedOrder: +(needBase / mult).toFixed(2),
        estCost: +((needBase) * (i.unitCost || 0)).toFixed(2), lowStock: lowFlag,
        supplierId: best?.supplierId || null, supplierName: best?.supplierName || null,
      };
    }).filter(l => l.lowStock).sort((a, b) => (b.suggestedOrder - a.suggestedOrder));
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
}
