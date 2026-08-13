// audit routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { captureError } from '../lib/errorLog.js';

export default function registerAudit(ctx) {
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

  const canViewAudit = [requireStaff, requirePermission('audit.view')];

// ── AUDIT LOG read ────────────────────────────────────────────────────────────
// Filterable by action prefix (e.g. 'ORDER', 'INVENTORY', 'PRODUCT'), exact
// action, actor name, and date range. Sorted newest-first, paginated.
app.get('/api/audit-log', verifyToken, ...canViewAudit, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 25);
    const filter = {};
    // String() coercion + escapeRegex(): req.query values can arrive as nested
    // objects (e.g. ?actor[$ne]=x, parsed by express's extended query parser)
    // or, for `entity`, as an unescaped regex-metacharacter string — either
    // reaches these String-typed fields unguarded otherwise (Mongoose only
    // CastErrors operator objects against typed fields like ObjectId/Number,
    // not against String).
    if (req.query.entity)      filter.action = { $regex: `^${escapeRegex(String(req.query.entity))}_`, $options: 'i' };
    if (req.query.action)      filter.action = String(req.query.action);
    if (req.query.actor)       filter.userId = String(req.query.actor);
    if (req.query.from || req.query.to) {
      filter.timestamp = {};
      if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
      if (req.query.to)   filter.timestamp.$lte = new Date(req.query.to);
    }
    const [total, entries] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ timestamp: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    ]);
    res.json({ success: true, entries, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── ANALYTICS DASHBOARD ENDPOINT ─────────────────────────────────────────────
// Moves heavy computations off the browser so the dashboard stays fast
// even with 12+ months of order history.
// GET /api/audit-logs — superadmin only, paginated, filterable by action + date range
app.get('/api/audit-logs', verifyToken, ...canViewAudit, async (req, res) => {
  try {
    const { page = 1, limit: lim = 30, action, actor, start, end } = req.query;
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 30);

    const filter = {};
    if (action && action !== 'all') filter.action = String(action);
    if (actor)  filter.userId = String(actor);
    if (start || end) {
      filter.timestamp = {};
      if (start) filter.timestamp.$gte = dayStart(start);
      if (end)   { filter.timestamp.$lte = dayEnd(end); }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      AuditLog.countDocuments(filter)
    ]);
    res.json({ success: true, logs, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── AUDIT LOG CSV EXPORT ─────────────────────────────────────────────────────
// Bounded + streamed, same convention as /api/journal/export (finance.js): a
// date range is required and capped at 92 days, rows stream straight from a
// DB cursor so a wide export never builds the whole result set in memory.
app.get('/api/audit-logs/export', verifyToken, ...canViewAudit, async (req, res) => {
  const { start, end, action, actor } = req.query;
  const range = validateDateRange(start, end);
  if (!range.ok) return res.status(400).json({ success: false, error: range.error });

  const filter = { timestamp: { $gte: range.startDate, $lte: range.endDate } };
  if (action && action !== 'all') filter.action = String(action);
  if (actor) filter.userId = String(actor);

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const fileName = `audit_log_${start}_to_${end}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.write('Timestamp,User,Action,Target,Notes\n');

  try {
    const cursor = AuditLog.find(filter).sort({ timestamp: 1 }).lean().cursor();
    for await (const e of cursor) {
      res.write([
        esc(new Date(e.timestamp).toISOString()), esc(e.userId), esc(e.action),
        esc(e.targetReference), esc(e.details?.notes || ''),
      ].join(',') + '\n');
    }
    res.end();
  } catch (err) {
    log.error({ err }, 'Audit log export failed');
    if (!res.headersSent) (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    else res.end();
  }
});
}
