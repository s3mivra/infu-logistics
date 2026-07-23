// shifts routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
export default function registerShifts(ctx) {
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

// Open a new shift (called on login, records starting cash)
app.post('/api/shifts/start', verifyToken, requireStaff, async (req, res) => {
  try {
    const { startingCash } = req.body;
    // Mandatory starting cash — reject missing/invalid/negative. No silent default-to-0:
    // a zero opening float must be entered explicitly so EOS variance is meaningful.
    const opening = Number(startingCash);
    if (startingCash === undefined || startingCash === null || startingCash === '' ||
        !Number.isFinite(opening) || opening < 0) {
      return res.status(400).json({ success: false, error: 'A valid starting cash amount is required.' });
    }
    // Close any dangling open shifts for this cashier
    await Shift.updateMany(
      { cashierId: String(req.user._id), status: 'Open' },
      { status: 'Closed', shiftEnd: new Date() }
    );
    const shift = await Shift.create({
      cashierId:    String(req.user._id),
      cashierName:  req.user.name,
      startingCash: opening,
    });
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Close shift — records actual cash count and calculates variance
app.post('/api/shifts/end', verifyToken, requireStaff, async (req, res) => {
  try {
    const { actualCash } = req.body;
    const shift = await Shift.findOne({ cashierId: String(req.user._id), status: 'Open' });
    if (!shift) return res.status(404).json({ success: false, error: 'No open shift found.' });

    // Cash sales only (GCash/Card stay with the POS partner, not the register).
    const cashOrders = await Order.find(shiftCashFilter(req.user.name, shift.shiftStart));
    const salesTotal   = cashOrders.reduce((sum, o) => sum + o.total, 0);
    const expectedCash = shift.startingCash + salesTotal;
    const actual       = parseFloat(actualCash) || 0;

    shift.shiftEnd     = new Date();
    shift.salesTotal   = salesTotal;
    shift.expectedCash = expectedCash;
    shift.actualCash   = actual;
    shift.variance     = actual - expectedCash;
    shift.status       = 'Closed';
    await shift.save();

    // Variance journal entry (Cash Short & Over)
    const variance = shift.variance;
    if (Math.abs(variance) > 0.001) {
      const varLines = variance < 0
        ? [ // Short: cashier is missing money
            { accountCode: '930000', accountName: 'Cash Short & Over Expense', debit: Math.abs(variance), credit: 0 },
            { accountCode: '111000', accountName: 'Cash on Hand', debit: 0, credit: Math.abs(variance) },
          ]
        : [ // Over: cashier has extra money
            { accountCode: '111000', accountName: 'Cash on Hand', debit: variance, credit: 0 },
            { accountCode: '830000', accountName: 'Cash Short & Over Income', debit: 0, credit: variance },
          ];
      await JournalEntry.create({
        reference: await mkSeqRef('SHIFT-VAR'),
        description: `Variance adjustment: ${shift.cashierName} (${variance >= 0 ? 'Over' : 'Short'} ₱${Math.abs(variance).toFixed(2)})`,
        lines: varLines,
        totalDebit: Math.abs(variance),
        totalCredit: Math.abs(variance),
      });
    }

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (variance entry)
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Get active shift for the logged-in cashier
app.get('/api/shifts/current', verifyToken, requireStaff, async (req, res) => {
  try {
    const shift = await Shift.findOne({ cashierId: String(req.user._id), status: 'Open' });
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- SHIFT HISTORY ---
app.get('/api/shifts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 20, cashier } = req.query;
    const owner = await ownerIdentity();
    // Hide the owner's shifts — by _id and by name (catches orphaned superadmin ids).
    const filter = { cashierId: { $nin: owner.ids }, cashierName: { $nin: owner.names } };
    if (cashier) filter.cashierName = { $regex: cashier, $options: 'i', $nin: owner.names };
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 20);
    const [shifts, total] = await Promise.all([
      Shift.find(filter).sort({ shiftStart: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      Shift.countDocuments(filter)
    ]);

    // For OPEN shifts, salesTotal hasn't been finalised yet (that happens at end).
    // Compute live cash sales so the cashier sees their running total in history.
    for (const s of shifts) {
      if (s.status === 'Open') {
        const cashOrders = await Order.find(shiftCashFilter(s.cashierName, s.shiftStart), { total: 1 }).lean();
        s.salesTotal = cashOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        s.expectedCash = (s.startingCash || 0) + s.salesTotal;
        s.isLive = true; // flag for the UI
      }
    }

    res.json({ success: true, shifts, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.post('/api/clock/in', verifyToken, requireStaff, async (req, res) => {
  try {
    const existing = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (existing) return res.status(400).json({ success: false, error: 'Already clocked in.' });
    const at = parseClockAt(req.body?.at);
    const manilaDate = (at || new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const doc = { staffId: req.user._id.toString(), staffName: req.user.name, date: manilaDate };
    if (at) doc.clockIn = at;
    const entry = await ClockEntry.create(doc);
    res.json({ success: true, entry });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

app.post('/api/clock/out', verifyToken, requireStaff, async (req, res) => {
  try {
    const { notes } = req.body;
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.status(400).json({ success: false, error: 'Not clocked in.' });
    // Honor an offline timestamp, but never let clock-out precede clock-in.
    const at = parseClockAt(req.body?.at);
    const now = (at && at.getTime() >= new Date(entry.clockIn).getTime()) ? at : new Date();
    // If still on break, close it out first.
    const ob = openBreak(entry);
    if (ob) { ob.end = now; ob.minutes = Math.round((now - ob.start) / 60000); entry.markModified('breaks'); }
    entry.clockOut = now;
    entry.durationMinutes = Math.round((now - entry.clockIn) / 60000);
    entry.breakMinutes = completedBreakMinutes(entry);
    entry.workedMinutes = Math.max(0, entry.durationMinutes - entry.breakMinutes);
    if (notes) entry.notes = notes;
    await entry.save();
    res.json({ success: true, entry });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// Start a break. Blocked if not clocked in, already on break, or the 1-hour cap is used up.
app.post('/api/clock/break/start', verifyToken, requireStaff, async (req, res) => {
  try {
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.status(400).json({ success: false, error: 'Not clocked in.' });
    if (openBreak(entry)) return res.status(400).json({ success: false, error: 'Already on break.' });
    const used = completedBreakMinutes(entry);
    if (used >= BREAK_CAP_MIN) return res.status(400).json({ success: false, error: 'Your 1-hour break is already used up. You can only end your shift.' });
    entry.breaks.push({ start: new Date() });
    entry.markModified('breaks');
    await entry.save();
    res.json({ success: true, entry, breakRemainingMinutes: BREAK_CAP_MIN - used });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// End the current break (resume work).
app.post('/api/clock/break/end', verifyToken, requireStaff, async (req, res) => {
  try {
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.status(400).json({ success: false, error: 'Not clocked in.' });
    const ob = openBreak(entry);
    if (!ob) return res.status(400).json({ success: false, error: 'Not currently on break.' });
    const now = new Date();
    ob.end = now;
    ob.minutes = Math.round((now - ob.start) / 60000);
    entry.markModified('breaks');
    await entry.save();
    res.json({ success: true, entry, breakUsedMinutes: completedBreakMinutes(entry) });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

app.get('/api/clock/status', verifyToken, requireStaff, async (req, res) => {
  try {
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.json({ success: true, isClockedIn: false, entry: null });
    const ob = openBreak(entry);
    const breakUsedMinutes = completedBreakMinutes(entry);
    res.json({
      success: true, isClockedIn: true, entry,
      onBreak: !!ob,
      breakStartedAt: ob ? ob.start : null,
      breakUsedMinutes,
      breakRemainingMinutes: Math.max(0, BREAK_CAP_MIN - breakUsedMinutes),
      breakCapMinutes: BREAK_CAP_MIN,
    });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

app.get('/api/clock/entries', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 30, date, staff } = req.query;
    const owner = await ownerIdentity();
    // Hide the owner — by _id and by name (catches orphaned superadmin ids).
    const filter = { staffId: { $nin: owner.ids }, staffName: { $nin: owner.names } };
    if (date) filter.date = date;
    if (staff) filter.staffName = { $regex: staff, $options: 'i', $nin: owner.names };
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 30);
    const [entries, total] = await Promise.all([
      ClockEntry.find(filter).sort({ clockIn: -1 }).skip((pageNum-1)*pageSize).limit(pageSize).lean(),
      ClockEntry.countDocuments(filter)
    ]);
    res.json({ success: true, entries, total, page: pageNum });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
}
