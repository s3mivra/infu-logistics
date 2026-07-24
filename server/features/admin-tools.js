// admin-tools routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
export default function registerAdminTools(ctx) {
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
  } = ctx;

// ── TENANCY BACKFILL VERIFICATION ─────────────────────────────────────────────
// Returns per-collection counts of docs missing or having a non-matching
// businessType. A healthy system shows zeros across all rows.
app.get('/api/admin/tenancy-report', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const missing = { $or: [{ businessType: { $exists: false } }, { businessType: null }, { businessType: '' }] };
    const wrong = { businessType: { $exists: true, $nin: [null, '', BUSINESS_TYPE] } };
    const [oMiss, oWrong, pMiss, pWrong, iMiss, iWrong, cMiss, cWrong] = await Promise.all([
      Order.countDocuments(missing),     Order.countDocuments(wrong),
      Product.countDocuments(missing),   Product.countDocuments(wrong),
      Inventory.countDocuments(missing), Inventory.countDocuments(wrong),
      Category.countDocuments(missing),  Category.countDocuments(wrong),
    ]);
    const rows = [
      { collection: 'Order',     missingBusinessType: oMiss, otherBusinessType: oWrong },
      { collection: 'Product',   missingBusinessType: pMiss, otherBusinessType: pWrong },
      { collection: 'Inventory', missingBusinessType: iMiss, otherBusinessType: iWrong },
      { collection: 'Category',  missingBusinessType: cMiss, otherBusinessType: cWrong },
    ];
    const isClean = rows.every(r => r.missingBusinessType === 0 && r.otherBusinessType === 0);
    res.json({ success: true, currentBusinessType: BUSINESS_TYPE, rows, isClean });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Manual re-run of the stamping migration. Idempotent — only touches docs missing the field.
app.post('/api/admin/tenancy-rebackfill', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const flt = { $or: [{ businessType: { $exists: false } }, { businessType: null }, { businessType: '' }] };
    const [bO, bP, bI, bC] = await Promise.all([
      Order.updateMany(flt, { $set: { businessType: BUSINESS_TYPE } }),
      Product.updateMany(flt, { $set: { businessType: BUSINESS_TYPE } }),
      Inventory.updateMany(flt, { $set: { businessType: BUSINESS_TYPE } }),
      Category.updateMany(flt, { $set: { businessType: BUSINESS_TYPE } }),
    ]);
    const stamped = { Order: bO.modifiedCount, Product: bP.modifiedCount, Inventory: bI.modifiedCount, Category: bC.modifiedCount };
    await logAudit(req, { action: 'rebackfill', entity: 'Tenancy', entityId: BUSINESS_TYPE, after: stamped });
    res.json({ success: true, stamped });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── PAYMENT-METHOD SUB-ACCOUNT RE-SEED (superadmin) ──────────────────────────
// Idempotent. Use when the boot-time seed didn't fire (legacy install) or
// after wiping the Account collection. Returns what got created and what
// already existed, so the UI can show a quick diagnostic.
app.post('/api/admin/seed-payment-subaccounts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const SEED = [
      { code: '113001', name: 'GCash',           parent: '113000' },
      { code: '113002', name: 'Maya',            parent: '113000' },
      { code: '113003', name: 'Maribank',        parent: '113000' },
      { code: '113004', name: 'Other E-Wallet',  parent: '113000' },
      { code: '112001', name: 'Bank Transfer',   parent: '112000' },
      { code: '120001', name: 'Foodpanda',       parent: '120000' },
      { code: '120002', name: 'Grab Delivery',   parent: '120000' },
      { code: '111001', name: 'Lalamove',        parent: '111000' },
      { code: '111002', name: 'Manual Delivery', parent: '111000' },
      { code: '111003', name: 'Pickup',          parent: '111000' },
    ];
    const created = [], skipped = [];
    for (const s of SEED) {
      // Skip if the CODE is already taken (e.g. user already added a sub-account
      // there, like Metrobank at 112001). Also skip if the NAME already exists
      // under the same parent (any code) to avoid duplicate-name children.
      const existsByCode = await Account.findOne({ code: s.code }).lean();
      if (existsByCode) { skipped.push({ code: s.code, name: s.name, reason: `code taken by "${existsByCode.name}"` }); continue; }
      const existsByName = await Account.findOne({ parent: s.parent, name: s.name }).lean();
      if (existsByName) { skipped.push({ code: s.code, name: s.name, reason: `same name exists at ${existsByName.code}` }); continue; }
      const parentMeta = ACCOUNTS[s.parent];
      if (!parentMeta) { skipped.push({ code: s.code, name: s.name, reason: 'parent missing' }); continue; }
      const acct = await Account.create({
        code: s.code, name: s.name, type: parentMeta.type, parent: s.parent,
        custom: true, normalBalance: /^[15679]/.test(s.code) ? 'Debit' : 'Credit',
      });
      created.push({ code: acct.code, name: acct.name, parent: acct.parent });
    }
    await refreshCustomMeta();
    // Update routing defaults too so the seed has an immediate effect.
    const PM_DEFAULTS = {
      'GCash': '113001', 'Maya': '113002', 'Maribank': '113003', 'Other E-Wallet': '113004',
      'Bank Transfer': '112001',
      'Foodpanda': '120001', 'Grab Delivery': '120002',
      'Lalamove': '111001', 'Manual Delivery': '111002', 'Pickup': '111003',
    };
    for (const [m, c] of Object.entries(PM_DEFAULTS)) {
      // Only update the default if the target code now exists in COA — keeps the
      // routing table honest when a code was skipped (e.g. Metrobank holding 112001).
      if (acctMeta(c)) DEFAULT_PAYMENT_ACCOUNT_MAP[m] = c;
    }
    await refreshPaymentMap();
    await logAudit(req, { action: 'seed', entity: 'PaymentSubAccounts', entityId: 'bulk', after: { created: created.length, skipped: skipped.length } });
    res.json({ success: true, created, skipped, effectiveMap: { ...ctx.PAYMENT_MAP_CACHE } });
  } catch (err) {
    log?.error?.({ err }, 'POST /api/admin/seed-payment-subaccounts failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── BACKDATED SALES TALLY (superadmin only) ──────────────────────────────────
// Adds a Completed order with a chosen historical date so analytics / P&L
// include sales done before the POS was in place (or paper receipts that need
// to be tallied). Skips inventory deduction and recipe COGS — this is a tally,
// not a real transaction. Respects period locks. Always audited.
app.post('/api/admin/backdate-sale', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { date, customerName, amount, paymentMethod, notes } = req.body;
    const amt = Number(amount);
    if (!date || isNaN(amt) || amt <= 0) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'date and a positive amount are required.' });
    }
    const dt = new Date(date);
    if (isNaN(dt.getTime())) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'Invalid date.' });
    }

    // Period-lock guard.
    const lock = await periodLockFor(dt);
    if (lock) {
      await session.abortTransaction(); session.endSession();
      return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2,'0')} is closed.` });
    }

    const method = paymentMethod || 'Cash';
    const acct = accountForPaymentMethod(method);

    const year = dt.getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${year}`, 'orderNumber');
    const [order] = await Order.create([{
      orderNumber,
      table: 'Backdated',
      status: 'Completed',
      createdAt: dt,
      cashier: req.user?.name || 'Backdated Entry',
      customerName: customerName || 'Walk-in (backdated)',
      paymentMethod: method,
      items: [{ name: 'Historical Sale', price: amt, quantity: 1, productDiscountPercent: 0 }],
      subtotal: amt,
      discount: 0,
      vatAmount: 0,
      vatRate: 0,
      total: amt,
      isVatExempt: true,
      transactionType: 'NORMAL',
      orderNotes: (notes || '').trim().slice(0, 300),
      isBackdated: true,
    }], { session });

    // Journal entry: DR <payment account>, CR Sales Revenue (410000)
    // Same transaction as the Order write above — if this fails, the order
    // must not survive either, or the sale would show up in reports with no
    // corresponding ledger entry.
    const reference = await mkSeqRef('BACKDATE');
    await JournalEntry.create([{
      date: dt,
      reference,
      description: `Backdated sale: ${order.orderNumber}${notes ? ` (${notes})` : ''}`,
      lines: [
        { accountCode: acct.code, accountName: acct.name, debit: amt, credit: 0 },
        { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: amt },
      ],
      totalDebit: amt,
      totalCredit: amt,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    await logAudit(req, { action: 'backdate-sale', entity: 'Order', entityId: order._id, after: { orderNumber, date: dt, amount: amt, paymentMethod: method } });
    emitToMgr('erpUpdated');
    res.json({ success: true, order, journalReference: reference });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    log.error?.({ err }, 'POST /api/admin/backdate-sale failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});
}
