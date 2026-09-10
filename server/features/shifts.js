// shifts routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';
import { hasPermission } from '../lib/authz.js';

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

// ── CASH DRAWER SESSIONS ─────────────────────────────────────────────────────
// See the ShiftSchema comment in server.js for why a shared drawer cannot use
// per-cashier shifts. These three settings control the behaviour; all default
// to the historical behaviour so an existing deployment is unchanged until
// someone deliberately turns them on.
//
//   sharedDrawer       one session for the shop's single drawer (default off)
//   blindClose         hide the expected figure from whoever is counting
//   varianceThreshold  peso amount past which a close is flagged for review
const drawerSettings = async () => {
  const [shared, blind, thresh, maxRow] = await Promise.all([
    Settings.findOne({ key: 'sharedDrawer' }).lean(),
    Settings.findOne({ key: 'blindClose' }).lean(),
    Settings.findOne({ key: 'varianceThreshold' }).lean(),
    Settings.findOne({ key: 'drawerMaxHours' }).lean(),
  ]);
  return {
    sharedDrawer: shared?.value === true,
    // Maximum hours a drawer session may stay open. 0 disables the boundary.
    //
    // Deliberately a DURATION, not a clock time. A midnight cut-off assumes the
    // shop is shut at midnight; a 24/7 bar is at its busiest then, and closing
    // the till mid-service is worse than leaving it open. A duration bounds the
    // session for everyone - a 9-to-5 cafe and a round-the-clock counter alike
    // - without pretending to know when the day ends.
    maxOpenHours: Number.isFinite(Number(maxRow?.value)) ? Math.max(0, Number(maxRow.value)) : 0,
    // Blind counting is the whole point of a variance: if the person counting
    // can see the number they are supposed to reach, a short drawer quietly
    // becomes an exact one and the control measures nothing. On by default
    // wherever a shared drawer is in use, since that is the case with several
    // people's hands in the till.
    blindClose: blind?.value !== false,
    varianceThreshold: Number.isFinite(Number(thresh?.value)) ? Math.abs(Number(thresh.value)) : 50,
  };
};

// Close any session that has outrun its maximum length. Run lazily off shift
// interactions rather than a background timer: a timer that fires while nobody
// is working achieves nothing a drawer cannot wait for, and a lazy sweep is
// testable without one.
//
// The session is bounded and flagged, never counted. See ShiftSchema's
// systemClosed note for why inventing a count would be worse than leaving it
// open: it would post a flawless reconciliation for a till nobody opened.
const sweepOverdueSessions = async (maxOpenHours) => {
  if (!(maxOpenHours > 0)) return;
  const cutoff = new Date(Date.now() - maxOpenHours * 3600000);
  const overdue = await Shift.find({ status: 'Open', shiftStart: { $lt: cutoff } });
  for (const shift of overdue) {
    const filter = shiftCashFilter(shift.scope === 'drawer' ? null : shift.cashierName, shift.shiftStart);
    const orders = await Order.find(filter, { total: 1 }).lean();
    shift.salesTotal   = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    shift.payInsTotal  = (shift.movements || []).filter(m => m.type === 'in').reduce((t, m) => t + (m.amount || 0), 0);
    shift.payOutsTotal = (shift.movements || []).filter(m => m.type === 'out').reduce((t, m) => t + (m.amount || 0), 0);
    shift.expectedCash = (shift.startingCash || 0) + shift.salesTotal + shift.payInsTotal - shift.payOutsTotal;
    // No actualCash, no variance, and no Cash Short & Over entry: nobody
    // counted, so there is nothing true to record and nothing to post.
    shift.actualCash   = undefined;
    shift.variance     = undefined;
    shift.systemClosed = true;
    shift.needsReview  = true;
    shift.closedBy     = 'System (session limit reached)';
    shift.shiftEnd     = new Date();
    shift.status       = 'Closed';
    await shift.save();
    emitToMgr('mgrAlert', {
      kind: 'shiftVariance',
      ref: shift.openedBy || shift.cashierName,
      message: `A drawer session ran past ${maxOpenHours}h and was closed uncounted. Expected P${(shift.expectedCash || 0).toFixed(2)} - count the till and reconcile it.`,
    });
  }
};

// The one open session, whatever its scope. In drawer mode this is shop-wide;
// in cashier mode it is this user's own.
const findOpenShift = async (user, sharedDrawer) =>
  (sharedDrawer
    ? Shift.findOne({ scope: 'drawer', status: 'Open' })
    : Shift.findOne({ cashierId: String(user._id), status: 'Open' }));

// Expected cash, in one place so the close, the live view and the tests can
// never drift apart: float + cash taken + cash put in - cash taken out.
const expectedFor = (shift, salesTotal) =>
  (shift.startingCash || 0) + salesTotal
    + (shift.movements || []).filter(m => m.type === 'in').reduce((s, m) => s + (m.amount || 0), 0)
    - (shift.movements || []).filter(m => m.type === 'out').reduce((s, m) => s + (m.amount || 0), 0);

const liveSalesFor = async (shift) => {
  // A drawer session takes every cash sale in its window regardless of who rang
  // it; a cashier session takes only that cashier's.
  const filter = shiftCashFilter(shift.scope === 'drawer' ? null : shift.cashierName, shift.shiftStart);
  const orders = await Order.find(filter, { total: 1 }).lean();
  return orders.reduce((sum, o) => sum + (o.total || 0), 0);
};

// Open a new shift (called on login, records starting cash)
app.post('/api/shifts/start', verifyToken, requireStaff, async (req, res) => {
  try {
    const { startingCash } = req.body;
    const { sharedDrawer, maxOpenHours } = await drawerSettings();
    // Retire an overdue session before deciding whether to join one - otherwise
    // the first login of a new day would join yesterday's till.
    await sweepOverdueSessions(maxOpenHours);

    // On a shared drawer a second person logging in JOINS the open session
    // rather than opening a competing one. Refusing them would stop a barista
    // ringing sales; opening a second session would double the float on the
    // books. Joining is the only answer that is both usable and true.
    if (sharedDrawer) {
      const open = await Shift.findOne({ scope: 'drawer', status: 'Open' });
      if (open) return res.json({ success: true, shift: open, joined: true });
    }

    // A shop that never runs a cash drawer (e.g. cashless-only, or a logistics
    // business where nobody physically tenders cash) can turn this off in
    // Settings so login stops asking for a float nobody is counting. Off:
    // missing/blank is silently 0, same treatment every login already gives a
    // superadmin. On (default): unchanged from the historical behaviour below
    // - explicit, non-negative, or the login flow refuses to proceed. Kept as
    // a hard requirement is the whole reason EOS variance means anything.
    const cashShiftRow = await Settings.findOne({ key: 'requireCashShift' }).lean();
    const cashShiftRequired = cashShiftRow?.value !== false;

    const opening = Number(startingCash);
    if (cashShiftRequired && (startingCash === undefined || startingCash === null || startingCash === '' ||
        !Number.isFinite(opening) || opening < 0)) {
      return res.status(400).json({ success: false, error: 'A valid starting cash amount is required.' });
    }
    const safeOpening = Number.isFinite(opening) && opening >= 0 ? opening : 0;

    // Close any dangling open shifts for this cashier. Only ever this cashier's
    // OWN cashier-scoped ones - never the shared drawer, which belongs to the
    // shop and may legitimately have been opened by somebody else.
    await Shift.updateMany(
      { cashierId: String(req.user._id), status: 'Open', scope: { $ne: 'drawer' } },
      { status: 'Closed', shiftEnd: new Date() }
    );
    try {
      const shift = await Shift.create({
        scope:        sharedDrawer ? 'drawer' : 'cashier',
        cashierId:    String(req.user._id),
        cashierName:  req.user.name,
        openedBy:     req.user.name,
        startingCash: safeOpening,
      });
      return res.json({ success: true, shift, joined: false });
    } catch (err) {
      // Someone else opened the drawer in the moment between the check above
      // and this write - three baristas arriving together really do log in
      // within the same instant. The partial unique index (see ShiftSchema)
      // lets exactly one of them win; the rest join what won, which is the same
      // answer they would have got a millisecond earlier.
      if (err?.code === 11000 && sharedDrawer) {
        const winner = await Shift.findOne({ scope: 'drawer', status: 'Open' });
        if (winner) return res.json({ success: true, shift: winner, joined: true });
      }
      throw err;
    }
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Cash in or out of the drawer that is not a sale: breaking a note for change,
// buying milk from the till, dropping takings to the safe.
//
// Records the movement ONLY - no journal entry. The milk becomes an expense
// when the expense is filed and the safe drop becomes a deposit when the
// deposit is recorded; both already write their own entry, so posting here as
// well would credit the same cash twice.
app.post('/api/shifts/movement', verifyToken, requireStaff, async (req, res) => {
  try {
    const { type, amount, reason } = req.body || {};
    if (!['in', 'out'].includes(String(type))) {
      return res.status(400).json({ success: false, error: 'Movement type must be "in" or "out".' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, error: 'Enter a positive amount.' });
    }
    // A reason is required, not optional. An unexplained movement is
    // indistinguishable from a missing-money variance, which defeats the point
    // of recording it at all.
    const why = String(reason || '').trim().slice(0, 200);
    if (!why) return res.status(400).json({ success: false, error: 'Say what this cash was for.' });

    const { sharedDrawer } = await drawerSettings();
    const shift = await findOpenShift(req.user, sharedDrawer);
    if (!shift) return res.status(404).json({ success: false, error: 'No open shift found.' });

    shift.movements.push({ type, amount: amt, reason: why, by: req.user.name, at: new Date() });
    await shift.save();
    await logAudit(req, {
      action: 'cashMovement', entity: 'Shift', entityId: String(shift._id),
      after: { type, amount: amt, reason: why },
    });
    res.json({ success: true, shift });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/shifts/end', verifyToken, requireStaff, async (req, res) => {
  try {
    const { actualCash, handover } = req.body;
    const { sharedDrawer, varianceThreshold } = await drawerSettings();
    const shift = await findOpenShift(req.user, sharedDrawer);
    if (!shift) return res.status(404).json({ success: false, error: 'No open shift found.' });

    // Cash sales only (GCash/Card stay with the POS partner, not the register).
    const salesTotal   = await liveSalesFor(shift);
    const expectedCash = expectedFor(shift, salesTotal);
    const actual       = parseFloat(actualCash) || 0;

    shift.shiftEnd     = new Date();
    shift.salesTotal   = salesTotal;
    shift.payInsTotal  = (shift.movements || []).filter(m => m.type === 'in').reduce((s, m) => s + (m.amount || 0), 0);
    shift.payOutsTotal = (shift.movements || []).filter(m => m.type === 'out').reduce((s, m) => s + (m.amount || 0), 0);
    shift.expectedCash = expectedCash;
    shift.actualCash   = actual;
    shift.variance     = actual - expectedCash;
    shift.closedBy     = req.user.name;
    shift.needsReview  = Math.abs(shift.variance) > varianceThreshold;
    shift.status       = 'Closed';
    await shift.save();

    // Variance journal entry (Cash Short & Over)
    const variance = shift.variance;
    if (Math.abs(variance) > 0.001) {
      const varLines = variance < 0
        ? [ // Short: money is missing from the drawer
            { accountCode: '930000', accountName: 'Cash Short & Over Expense', debit: Math.abs(variance), credit: 0 },
            { accountCode: '111000', accountName: 'Cash on Hand', debit: 0, credit: Math.abs(variance) },
          ]
        : [ // Over: the drawer holds more than it should
            { accountCode: '111000', accountName: 'Cash on Hand', debit: variance, credit: 0 },
            { accountCode: '830000', accountName: 'Cash Short & Over Income', debit: 0, credit: variance },
          ];
      const who = shift.scope === 'drawer'
        ? `drawer, counted by ${shift.closedBy}`
        : shift.cashierName;
      await JournalEntry.create({
        reference: await mkSeqRef('SHIFT-VAR'),
        description: `Variance adjustment: ${who} (${variance >= 0 ? 'Over' : 'Short'} P${Math.abs(variance).toFixed(2)})`,
        lines: varLines,
        totalDebit: Math.abs(variance),
        totalCredit: Math.abs(variance),
      });
    }

    if (shift.needsReview) {
      emitToMgr('mgrAlert', {
        kind: 'shiftVariance',
        ref: shift.closedBy || shift.cashierName,
        message: `Drawer closed ${variance >= 0 ? 'over' : 'short'} by P${Math.abs(variance).toFixed(2)} (threshold P${varianceThreshold.toFixed(2)}).`,
      });
    }

    // Closing a till is a money event and had no audit trail of its own. On a
    // shared drawer it is also an action taken on everyone else's behalf, so
    // who did it, and what they counted, needs to be recoverable later.
    await logAudit(req, {
      action: 'closeDrawer', entity: 'Shift', entityId: String(shift._id),
      after: {
        scope: shift.scope, openedBy: shift.openedBy, closedBy: shift.closedBy,
        expectedCash: shift.expectedCash, actualCash: shift.actualCash,
        variance: shift.variance, needsReview: shift.needsReview,
      },
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (variance entry)

    // HANDOVER: close, then immediately reopen with the counted cash as the new
    // float. The money never left the till - somebody counted it and it is
    // still sitting there - so making the next person retype the figure they
    // just watched being counted is friction that invites a typo into the one
    // number the next reconciliation is measured against. Carrying it forward
    // is the same act the shop performs physically.
    if (handover && shift.scope === 'drawer') {
      try {
        const next = await Shift.create({
          scope:        'drawer',
          cashierId:    String(req.user._id),
          cashierName:  req.user.name,
          openedBy:     req.user.name,
          startingCash: actual,
        });
        return res.json({ success: true, shift, handedOver: true, nextShift: next });
      } catch (err) {
        // Somebody else opened the drawer in the gap. Their session stands -
        // the close above is what mattered, and it is already recorded.
        if (err?.code === 11000) {
          const winner = await Shift.findOne({ scope: 'drawer', status: 'Open' });
          return res.json({ success: true, shift, handedOver: Boolean(winner), nextShift: winner || null });
        }
        throw err;
      }
    }

    res.json({ success: true, shift, handedOver: false });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// The open session for whoever is asking - shop-wide on a shared drawer.
app.get('/api/shifts/current', verifyToken, requireStaff, async (req, res) => {
  try {
    const { sharedDrawer, blindClose, varianceThreshold, maxOpenHours } = await drawerSettings();
    await sweepOverdueSessions(maxOpenHours);
    const shift = await findOpenShift(req.user, sharedDrawer);
    if (!shift) return res.json({ success: true, shift: null, sharedDrawer, blindClose, varianceThreshold, maxOpenHours });

    const salesTotal = await liveSalesFor(shift);
    const out = shift.toObject();
    // How long this session has been open. Logging out no longer closes a
    // shared drawer - correctly, since the money is still in it and other
    // people are still selling - but that makes a forgotten close far more
    // likely, and nothing closes a cash session automatically. A session left
    // open overnight quietly sweeps the next day's sales into yesterday's
    // count, so the age is reported and the panel says so loudly.
    out.openHours = (Date.now() - new Date(shift.shiftStart).getTime()) / 3600000;
    // How many OTHER people are still clocked in. "Whoever is last out counts
    // the till" is the natural rule, but the system cannot know who is last -
    // somebody logging out may be back in five minutes. Who is still clocked in
    // is the closest honest signal it has, so the closing prompt is offered
    // only when nobody else is on duty. When nobody clocks in at all this is
    // zero and the prompt simply appears on every logout, which is no worse
    // than the explicit Close button people would otherwise use.
    out.othersOnDuty = await ClockEntry.countDocuments({
      clockOut: { $exists: false },
      staffId: { $ne: String(req.user._id) },
    });
    out.payInsTotal  = (out.movements || []).filter(m => m.type === 'in').reduce((s, m) => s + (m.amount || 0), 0);
    out.payOutsTotal = (out.movements || []).filter(m => m.type === 'out').reduce((s, m) => s + (m.amount || 0), 0);

    // Under a blind close the running total and the expected figure are
    // withheld from ordinary staff - being able to read the target before
    // counting is exactly what makes a variance meaningless. Managers keep
    // full sight, because somebody has to be able to supervise the float.
    const canSeeTotals = !blindClose || hasPermission(req.user, 'accounting.view');
    if (canSeeTotals) {
      out.salesTotal = salesTotal;
      out.expectedCash = expectedFor(shift, salesTotal);
    } else {
      delete out.salesTotal;
      delete out.expectedCash;
    }
    res.json({ success: true, shift: out, blind: !canSeeTotals, sharedDrawer, blindClose, varianceThreshold, maxOpenHours });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- SHIFT HISTORY ---
app.get('/api/shifts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 20, cashier } = req.query;
    const owner = await ownerIdentity();
    // Hide the owner's shifts - by _id and by name (catches orphaned superadmin ids).
    // The owner's own shifts are hidden from this list, but a DRAWER session
    // belongs to the shop rather than to whoever happened to open it - hiding
    // it because the owner unlocked the till that morning would leave the day's
    // only cash reconciliation invisible.
    const notOwner = { cashierId: { $nin: owner.ids }, cashierName: { $nin: owner.names } };
    const filter = { $or: [{ scope: 'drawer' }, notOwner] };
    if (cashier) filter.cashierName = { $regex: cashier, $options: 'i' };
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
        // Same rule as the live view: a drawer session counts every cash sale
        // in its window, a cashier session only that cashier's.
        const cashOrders = await Order.find(shiftCashFilter(s.scope === 'drawer' ? null : s.cashierName, s.shiftStart), { total: 1 }).lean();
        s.salesTotal = cashOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        const ins  = (s.movements || []).filter(m => m.type === 'in').reduce((t, m) => t + (m.amount || 0), 0);
        const outs = (s.movements || []).filter(m => m.type === 'out').reduce((t, m) => t + (m.amount || 0), 0);
        s.payInsTotal = ins;
        s.payOutsTotal = outs;
        s.expectedCash = (s.startingCash || 0) + s.salesTotal + ins - outs;
        s.isLive = true; // flag for the UI
      }
    }

    res.json({ success: true, shifts, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
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
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
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
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
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
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
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
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
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
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.get('/api/clock/entries', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 30, date, staff } = req.query;
    const owner = await ownerIdentity();
    // Hide the owner - by _id and by name (catches orphaned superadmin ids).
    const filter = { staffId: { $nin: owner.ids }, staffName: { $nin: owner.names } };
    if (date) filter.date = date;
    if (staff) filter.staffName = { $regex: staff, $options: 'i', $nin: owner.names };
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 30);
    const [entries, total] = await Promise.all([
      ClockEntry.find(filter).sort({ clockIn: -1 }).skip((pageNum-1)*pageSize).limit(pageSize).lean(),
      ClockEntry.countDocuments(filter)
    ]);
    // Join each entry to the staff member's current role (clock entries don't store
    // it). Look up by the recorded staffId; fall back to a name match for legacy ids.
    const ids = [...new Set(entries.map(e => e.staffId).filter(Boolean))];
    const names = [...new Set(entries.map(e => e.staffName).filter(Boolean))];
    const users = await User.find(
      { $or: [{ _id: { $in: ids.filter(id => mongoose.isValidObjectId(id)) } }, { name: { $in: names } }] },
      { name: 1, role: 1 }
    ).lean();
    const roleById = {}, roleByName = {};
    for (const u of users) { roleById[String(u._id)] = u.role; roleByName[u.name] = u.role; }
    const withRole = entries.map(e => ({ ...e, staffRole: roleById[e.staffId] || roleByName[e.staffName] || '' }));
    res.json({ success: true, entries: withRole, total, page: pageNum });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});
}
