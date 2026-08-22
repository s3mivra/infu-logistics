// finance routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { ageingBuckets, ageingByClient, resolveCreditLimit, resolveClientKey, DEFAULT_CREDIT_MODE } from '../lib/credit.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { captureError } from '../lib/errorLog.js';

export default function registerFinance(ctx) {
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
    Supplier,
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

  // Accounting domain gates (superadmin bypasses inside requirePermission).
  // requireStaff is the floor (client-hostile + role allowlist), then the
  // granular permission. Viewing the books ≠ posting to them.
  const canViewAcct = [requireStaff, requirePermission('accounting.view')];
  const canPostAcct = [requireStaff, requirePermission('accounting.manage')];

// Accounting Ledger / Journal Entries - requires accounting.view (superadmin/finance/admin)
// Sorted by transaction `date` (chronological ledger, not entry-order) - so a
// BACKDATED entry sorts below every more-recent one and can fall off the
// default page entirely once there are more entries than the page size. The
// UI's initial load has no way to reach it without either raising the limit
// or searching - `search` (reference/description, case-insensitive) lets any
// entry be found regardless of how far back its date sorts it.
app.get('/api/journal', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(500, parseInt(req.query.limit) || 50);
    const q = {};
    const search = String(req.query.search || '').trim();
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' };
      q.$or = [{ reference: rx }, { description: rx }];
    }
    const [entries, total] = await Promise.all([
      JournalEntry.find(q).sort({ date: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      JournalEntry.countDocuments(q)
    ]);
    res.json({ success: true, entries, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/journal', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { description, lines, date: requestedDate } = req.body;

    // Calculate totals to ensure it balances
    const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ success: false, error: 'Debits must equal Credits' });
    }

    // Period-lock guard: block back-dated entries into a closed period.
    const lock = await periodLockFor(requestedDate || new Date());
    if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2,'0')} is closed. Reopen the period first.` });

    const reference = await mkSeqRef('JRN');
    const payload = { reference, description, lines, totalDebit, totalCredit };
    if (requestedDate) payload.date = new Date(requestedDate);
    const newEntry = await JournalEntry.create(payload);
    await logAudit(req, { action: 'create', entity: 'JournalEntry', entityId: newEntry._id, after: { reference, description, totalDebit } });

    emitToMgr('erpUpdated');
    res.json({ success: true, entry: newEntry });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/finance/balances', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    // Aggregate at MongoDB level - no full collection load, OOM-safe at scale
    const agg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '111000' } },
      { $group: {
          _id: null,
          totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
          totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } }
      }}
    ]);
    const row = agg[0] || { totalDebit: 0, totalCredit: 0 };
    const cashOnHand = (row.totalDebit || 0) - (row.totalCredit || 0);
    res.json({ success: true, cashOnHand });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── TRIAL BALANCE ─────────────────────────────────────────────────────────────
// Every account with its net debit/credit balance; total debits must equal total
// credits when the books are balanced. Optional ?start&end date range.
app.get('/api/reports/trial-balance', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = {};
    if (start || end) {
      match.date = {};
      if (start) match.date.$gte = dayStart(start);
      if (end) { match.date.$lte = dayEnd(end); }
    }
    const agg = await JournalEntry.aggregate([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $unwind: '$lines' },
      { $group: {
          _id: '$lines.accountCode',
          name:   { $first: '$lines.accountName' },
          debit:  { $sum: { $ifNull: ['$lines.debit', 0] } },
          credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      } },
      { $sort: { _id: 1 } },
    ]);
    const rows = agg.map((a) => {
      const meta = acctMeta(a._id);
      const net = (a.debit || 0) - (a.credit || 0);
      return {
        code: a._id,
        name: meta?.name || a.name || a._id,
        debit:  net > 0 ? +net.toFixed(2) : 0,
        credit: net < 0 ? +(-net).toFixed(2) : 0,
      };
    }).filter((r) => r.debit || r.credit);
    const totalDebit  = +rows.reduce((s, r) => s + r.debit, 0).toFixed(2);
    const totalCredit = +rows.reduce((s, r) => s + r.credit, 0).toFixed(2);
    res.json({ success: true, rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// EXPENSE ENTRY - operator-facing expense bookkeeping
// Categories defined in lib/chartOfAccounts.js
// ============================================================
app.get('/api/expenses/categories', verifyToken, ...canViewAcct, async (req, res) => {
  res.json({ success: true, categories: EXPENSE_CATEGORIES });
});

// Recent expenses + a per-category summary for the range.
// Expenses aren't their own collection - they're journal entries whose debit
// side is an expense account. Reading them back that way keeps one source of
// truth (the ledger) rather than a parallel list that could drift from it.
app.get('/api/expenses', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const codes = EXPENSE_CATEGORIES.map(c => c.code);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

    // Optional range; defaults to the current month, which is what an operator
    // checking "what have we spent" almost always means.
    const now = new Date();
    const start = req.query.start ? dayStart(req.query.start) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = req.query.end ? dayEnd(req.query.end) : now;
    if (!req.query.end) end.setHours(23, 59, 59, 999);

    const rows = await JournalEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': { $in: codes }, 'lines.debit': { $gt: 0 } } },
      { $group: {
        _id: '$_id',
        date:        { $first: '$date'        },
        reference:   { $first: '$reference'   },
        description: { $first: '$description' },
        categoryCode: { $first: '$lines.accountCode' },
        categoryName: { $first: '$lines.accountName' },
        amount:      { $sum: '$lines.debit'   },
      }},
      { $sort: { date: -1, _id: -1 } },
      { $limit: limit },
    ]);

    // Category totals span the whole range, not just the page of rows above -
    // a truncated list must not silently understate the totals.
    const byCategoryAgg = await JournalEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': { $in: codes }, 'lines.debit': { $gt: 0 } } },
      { $group: { _id: '$lines.accountCode', name: { $first: '$lines.accountName' }, total: { $sum: '$lines.debit' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    const byCategory = byCategoryAgg.map(c => ({
      code: c._id, name: c.name, total: +(c.total || 0).toFixed(2), count: c.count,
    }));
    const total = +byCategory.reduce((s, c) => s + c.total, 0).toFixed(2);

    res.json({
      success: true, expenses: rows, byCategory, total,
      range: { start: start.toISOString(), end: end.toISOString() },
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/expenses', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { amount, categoryCode, paymentMethod, description, vendor, date } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be > 0.' });
    if (!EXPENSE_CATEGORIES.find(c => c.code === categoryCode))
      return res.status(400).json({ success: false, error: 'Invalid expense category.' });
    if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description required.' });

    // Pick the credit-side account via the configurable payment-method map.
    // Manager can route "GCash" to a custom sub-account (e.g. BPI E-Wallet 113001) via Ledger UI.
    const credAcct = accountForPaymentMethod(paymentMethod);
    if (credAcct.fallback) {
      emitToMgr('mgrAlert', { kind: 'unmappedTender', method: paymentMethod || '(none)', account: credAcct.code, message: `Expense payment method "${paymentMethod || '(none)'}" has no account route - booked against Unassigned Receipts. Configure it in Payment Routing.` });
      try { await logAudit(req, { action: 'unmappedTender', entity: 'PaymentMethodMap', entityId: paymentMethod || '(none)', after: { account: credAcct.code, context: 'expense' } }); } catch { /* non-fatal */ }
    }

    const cat = EXPENSE_CATEGORIES.find(c => c.code === categoryCode);
    const acct = ACCOUNTS[categoryCode];

    const reference = await mkSeqRef('EXP');
    const entryDate = date ? new Date(date) : new Date();

    const lines = [
      { accountCode: categoryCode, accountName: acct.name, debit: amt, credit: 0 },
      { accountCode: credAcct.code, accountName: credAcct.name, debit: 0, credit: amt },
    ];
    assertBalanced(lines, reference);

    const je = await JournalEntry.create({
      reference,
      description: `${cat.label}: ${description.trim()}${vendor ? ` (${vendor.trim()})` : ''}`,
      lines,
      totalDebit: amt,
      totalCredit: amt,
      date: entryDate,
    });

    emitToMgr('erpUpdated');
    res.json({ success: true, entry: je });
  } catch (err) {
    log.error({ err }, 'POST /api/expenses failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Outstanding A/R list (delivery orders, Completed, not yet settled)
app.get('/api/finance/ar-outstanding', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const rows = await Order.find({
      businessType: BUSINESS_TYPE,
      status: 'Completed',
      paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true }, // comps collect no money - never an A/R
      arSettled: { $ne: true }
    }, { orderNumber: 1, customerName: 1, table: 1, total: 1, paymentMethod: 1, createdAt: 1, arTermsDays: 1, arDueDate: 1 })
      .sort({ createdAt: -1 }).limit(500).lean();
    // Flag each receivable overdue when its snapshotted terms date has passed.
    // Orders booked before terms existed carry no arDueDate and are never overdue.
    const now = Date.now();
    let overdueTotal = 0, overdueCount = 0;
    const orders = rows.map((r) => {
      const overdue = r.arDueDate ? new Date(r.arDueDate).getTime() < now : false;
      if (overdue) { overdueTotal += r.total || 0; overdueCount += 1; }
      return { ...r, overdue };
    });
    const totalOutstanding = orders.reduce((s, r) => s + (r.total || 0), 0);
    res.json({ success: true, orders, totalOutstanding, overdueTotal, overdueCount });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// A/R AGEING - the same receivables as ar-outstanding, split into 30/60/90 buckets
// and grouped per client, plus each client's credit limit and headroom.
// "How much does this client owe me, and how old is it?" is a three-tab question
// today; this answers it in one call.
app.get('/api/finance/ar-ageing', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const rows = await Order.find({
      businessType: BUSINESS_TYPE,
      status: 'Completed',
      paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true },
      arSettled: { $ne: true },
    }, { customerName: 1, total: 1, createdAt: 1, clientAccountId: 1, clientId: 1 }).lean();

    const [modeRow, globalRow, clients] = await Promise.all([
      Settings.findOne({ key: 'creditLimitMode' }).lean(),
      Settings.findOne({ key: 'globalCreditLimit' }).lean(),
      ClientAccount.find({}, { name: 1, creditLimit: 1 }).lean(),
    ]);
    const mode = modeRow?.value || DEFAULT_CREDIT_MODE;
    const globalLimit = globalRow?.value ?? null;
    // Shared with collections.js's resolveClientKeys() - the same grouping key
    // both A/R views must agree on, or they'd disagree about who owes what.
    const { keyOf } = resolveClientKey(clients);

    // Committed exposure - everything on account that isn't cancelled/void, INCLUDING
    // orders still in flight. This is what the credit gate spends, and it differs
    // from the aged A/R above (which counts only Completed = a real book
    // receivable). Reporting only the accounting figure would leave an owner
    // asking why a client showing ₱0 owing can't place an order.
    const committed = await Order.find({
      businessType: BUSINESS_TYPE,
      status: { $nin: ['Cancelled', 'Voided', 'Refunded', 'Parked'] },
      isParked: { $ne: true },
      paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true },
      arSettled: { $ne: true },
    }, { customerName: 1, total: 1, clientAccountId: 1, clientId: 1 }).lean();

    const exposureByClient = new Map();
    for (const r of committed) {
      const k = keyOf(r);
      exposureByClient.set(k, (exposureByClient.get(k) || 0) + (Number(r.total) || 0));
    }

    const totals = ageingBuckets(rows);
    const seen = new Set();
    const perClient = ageingByClient(rows, keyOf).map((row) => {
      seen.add(row.client);
      const match = clients.find(c => c.name === row.client);
      const limit = resolveCreditLimit({ mode, globalLimit, clientLimit: match?.creditLimit });
      const exposure = Math.round((exposureByClient.get(row.client) || 0) * 100) / 100;
      return {
        ...row,
        exposure,
        creditLimit: limit,
        available: limit === null ? null : Math.max(0, Math.round((limit - exposure) * 100) / 100),
        overLimit: limit !== null && exposure > limit,
      };
    });

    // Clients with committed orders but no aged receivable yet would otherwise be
    // invisible here - exactly the ones consuming credit right now.
    for (const [client, exposure] of exposureByClient) {
      if (seen.has(client)) continue;
      const match = clients.find(c => c.name === client);
      const limit = resolveCreditLimit({ mode, globalLimit, clientLimit: match?.creditLimit });
      perClient.push({
        client, current: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, count: 0,
        exposure: Math.round(exposure * 100) / 100,
        creditLimit: limit,
        available: limit === null ? null : Math.max(0, Math.round((limit - exposure) * 100) / 100),
        overLimit: limit !== null && exposure > limit,
      });
    }
    perClient.sort((a, b) => (b.total || b.exposure) - (a.total || a.exposure));

    res.json({ success: true, mode, globalLimit, totals, clients: perClient, asOf: new Date().toISOString() });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ACCOUNTS PAYABLE - outstanding balance + recent entries + payment
// Payables are journal lines with accountCode '220000':
//   DR 1500 Inventory / CR 2000 AP  → when goods received on credit
//   DR 2000 AP / CR 1000 Cash       → when supplier is paid
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/finance/ap-outstanding', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const agg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000' } },
      { $group: {
        _id: null,
        totalCredit: { $sum: '$lines.credit' }, // AP incurred
        totalDebit:  { $sum: '$lines.debit'  }, // AP paid
      }}
    ]);
    const bal = agg[0] || { totalCredit: 0, totalDebit: 0 };
    const outstandingBalance = +(bal.totalCredit - bal.totalDebit).toFixed(2);

    // Recent AP journal entries (both directions), now carrying the supplier so
    // the history reads "who" rather than only "how much".
    const recent = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000' } },
      { $group: {
        _id: '$_id',
        date:         { $first: '$date'         },
        reference:    { $first: '$reference'    },
        description:  { $first: '$description'  },
        supplierId:   { $first: '$supplierId'   },
        supplierName: { $first: '$supplierName' },
        credit:      { $sum: { $cond: [{ $gt: ['$lines.credit', 0] }, '$lines.credit', 0] } },
        debit:       { $sum: { $cond: [{ $gt: ['$lines.debit',  0] }, '$lines.debit',  0] } },
      }},
      { $sort: { date: -1 } },
      { $limit: 50 }
    ]);

    // Per-supplier balance: credits (goods received on account) minus debits
    // (payments made). Entries written before supplier attribution existed have
    // no supplierId and group under "Unattributed" rather than being dropped -
    // silently hiding real debt would be worse than showing it unlabelled.
    const bySupplierAgg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000' } },
      { $group: {
        _id: { $ifNull: ['$supplierId', null] },
        name:    { $first: '$supplierName' },
        credit:  { $sum: '$lines.credit' },
        debit:   { $sum: '$lines.debit'  },
        entries: { $sum: 1 },
      }},
    ]);
    const bySupplier = bySupplierAgg
      .map(s => ({
        supplierId: s._id ? String(s._id) : null,
        // The null group must NEVER borrow a name - $first there returns whichever
        // unattributed entry happened to sort first, which would print another
        // supplier's name over debt that isn't theirs.
        supplier: s._id ? (s.name || 'Unknown supplier') : 'Unattributed',
        incurred: +(s.credit || 0).toFixed(2),
        paid:     +(s.debit  || 0).toFixed(2),
        balance:  +((s.credit || 0) - (s.debit || 0)).toFixed(2),
        entries:  s.entries,
      }))
      // A fully-settled supplier isn't a payable any more; keep the list to who
      // is actually owed (or overpaid, which is worth seeing).
      .filter(s => Math.abs(s.balance) >= 0.01)
      .sort((a, b) => b.balance - a.balance);

    res.json({ success: true, outstandingBalance, recent, bySupplier, totalCredit: bal.totalCredit, totalDebit: bal.totalDebit });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// VENDOR STATEMENT - one supplier's A/P activity over a date range: opening
// balance carried in from before the range, every invoice/payment inside it,
// and the resulting closing balance. Same 220000-AP lines ap-outstanding reads,
// just scoped to one supplierId and split into a running balance instead of a
// single aggregate total.
app.get('/api/finance/vendor-statement/:supplierId', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ _id: req.params.supplierId, ...tenantScope(req) }).lean();
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = req.query.start || monthStart.toISOString().slice(0, 10);
    const end = req.query.end || new Date().toISOString().slice(0, 10);
    const range = validateDateRange(start, end);
    if (!range.ok) return res.status(400).json({ success: false, error: range.error });
    const { startDate, endDate } = range;

    const supplierIdStr = String(req.params.supplierId);

    const openingAgg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000', supplierId: supplierIdStr, date: { $lt: startDate } } },
      { $group: { _id: null, credit: { $sum: '$lines.credit' }, debit: { $sum: '$lines.debit' } } },
    ]);
    const openingBalance = +(((openingAgg[0]?.credit || 0) - (openingAgg[0]?.debit || 0)).toFixed(2));

    const entriesAgg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000', supplierId: supplierIdStr, date: { $gte: startDate, $lte: endDate } } },
      { $group: {
        _id: '$_id',
        date:        { $first: '$date' },
        reference:   { $first: '$reference' },
        description: { $first: '$description' },
        credit:      { $sum: { $cond: [{ $gt: ['$lines.credit', 0] }, '$lines.credit', 0] } },
        debit:       { $sum: { $cond: [{ $gt: ['$lines.debit',  0] }, '$lines.debit',  0] } },
      }},
      { $sort: { date: 1 } },
    ]);

    let running = openingBalance;
    const entries = entriesAgg.map(e => {
      running = +((running + (e.credit || 0) - (e.debit || 0)).toFixed(2));
      return {
        date: e.date, reference: e.reference || '', description: e.description || '',
        invoiceAmount: +(e.credit || 0).toFixed(2), paymentAmount: +(e.debit || 0).toFixed(2),
        runningBalance: running,
      };
    });
    const closingBalance = entries.length ? entries[entries.length - 1].runningBalance : openingBalance;

    res.json({
      success: true,
      vendor: { id: String(supplier._id), name: supplier.name },
      period: { start: startDate.toISOString(), end: endDate.toISOString() },
      openingBalance, entries, closingBalance,
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// POST /api/finance/ap-payment - record a supplier payment (DR 2000 AP / CR cash account)
app.post('/api/finance/ap-payment', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { amount, payFromAccount, description, vendorName, supplierId } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });

    // Resolve the supplier server-side so the stored name is the canonical record,
    // not whatever the client typed. vendorName remains accepted for ad-hoc payees
    // that have no supplier record.
    let supplier = null;
    if (supplierId && mongoose.Types.ObjectId.isValid(String(supplierId))) {
      supplier = await Supplier.findById(supplierId).lean();
      if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    }
    const payeeName = supplier?.name || vendorName || '';

    // Accept any cash/bank/e-wallet account (canonical or custom sub-account).
    const isCashLike = (c) => /^(111|112|113)/.test(String(c || ''));
    const srcMeta = acctMeta(payFromAccount);
    const srcCode = (srcMeta && isCashLike(payFromAccount)) ? payFromAccount : '111000';
    const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';

    const desc = description?.trim() || `AP payment${payeeName ? ` to ${payeeName}` : ''}`;
    const reference = await mkSeqRef('AP-PAY');

    const lines = [
      { accountCode: '220000', accountName: 'Accounts Payable', debit: amt, credit: 0 },
      { accountCode: srcCode, accountName: srcName,           debit: 0,   credit: amt },
    ];
    assertBalanced(lines, reference);
    const je = await JournalEntry.create({
      date: new Date(), reference, description: desc, lines,
      totalDebit: amt, totalCredit: amt,
      supplierId: supplier ? String(supplier._id) : null,
      supplierName: payeeName,
    });

    await AuditLog.create({
      userId: req.user?.name || 'System',
      action: 'AP_PAYMENT',
      targetReference: reference,
      details: { amount: amt, payFromAccount: srcCode, vendorName: payeeName, supplierId: supplier ? String(supplier._id) : null, recordedBy: req.user?.name }
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger
    res.json({ success: true, journalEntry: je });
  } catch (err) {
    log.error({ err }, 'POST /api/finance/ap-payment failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// JOURNAL CSV EXPORT
// ============================================================
app.get('/api/journal/export', verifyToken, ...canViewAcct, async (req, res) => {
  // Bounded + streamed: a date range is required and capped at one quarter, and rows
  // are streamed straight from a DB cursor so we never build the whole ledger as one
  // in-memory string. Validation runs before any header/byte is written.
  const { start, end } = req.query;
  const range = validateDateRange(start, end); // default cap: 92 days (one quarter)
  if (!range.ok) {
    return res.status(400).json({ success: false, error: range.error });
  }

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const fileName = `journal_${start}_to_${end}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.write('Date,Reference,Description,AccountCode,AccountName,Debit,Credit\n');

  try {
    const cursor = JournalEntry
      .find({ date: { $gte: range.startDate, $lte: range.endDate } })
      .sort({ date: 1, reference: 1 })
      .lean()
      .cursor();
    for await (const e of cursor) {
      const dateStr = new Date(e.date).toISOString().slice(0, 10);
      for (const line of e.lines) {
        res.write([
          esc(dateStr), esc(e.reference), esc(e.description),
          esc(line.accountCode), esc(line.accountName),
          (line.debit || 0).toFixed(2), (line.credit || 0).toFixed(2)
        ].join(',') + '\n');
      }
    }
    res.end();
  } catch (err) {
    log.error({ err }, 'Journal export failed');
    // Headers/body already streaming - can't switch to a JSON error; just end the stream.
    if (!res.headersSent) (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    else res.end();
  }
});

// --- BANK DEPOSIT ROUTES ---
app.post('/api/bank-deposits', verifyToken, requireStaff, requirePermission('accounting.manage'), async (req, res) => {
  try {
    const { shiftId, amount, reference, sourceAccount: rawSrc, destAccount: rawDest } = req.body;
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0)
      return res.status(400).json({ success: false, error: 'Invalid deposit amount.' });

    // Atomic compare-and-swap: the "doesn't exceed cash on hand" / "doesn't dip
    // below the starting fund" guards are encoded in the filter itself, so two
    // concurrent deposit requests against the same shift can't both read the same
    // pre-deposit balance and both pass - only one $inc can land per guard window.
    const shift = await Shift.findOneAndUpdate(
      {
        _id: shiftId,
        status: { $ne: 'Open' },
        $expr: {
          $and: [
            { $lte: [{ $add: [{ $ifNull: ['$depositedAmount', 0] }, depositAmount] }, { $add: [{ $ifNull: ['$actualCash', 0] }, 0.01] }] },
            { $lte: [{ $add: [{ $ifNull: ['$depositedAmount', 0] }, depositAmount, { $ifNull: ['$startingCash', 0] }] }, { $add: [{ $ifNull: ['$actualCash', 0] }, 0.01] }] },
          ],
        },
      },
      { $inc: { depositedAmount: depositAmount } },
      { new: true }
    );
    if (!shift) {
      // Guard failed or shift doesn't exist - re-read to report a specific reason.
      const existing = await Shift.findById(shiftId);
      if (!existing) return res.status(404).json({ success: false, error: 'Shift not found.' });
      if (existing.status === 'Open') return res.status(400).json({ success: false, error: 'Close the shift before posting a deposit.' });
      const cashOnHand = (existing.actualCash || 0) - (existing.depositedAmount || 0);
      const maxDeposit = cashOnHand - existing.startingCash;
      if (depositAmount > cashOnHand + 0.01)
        return res.status(400).json({ success: false, error: `Amount exceeds Cash on Hand (₱${cashOnHand.toFixed(2)}).` });
      return res.status(400).json({ success: false, error: `Cannot reduce drawer below starting fund (₱${existing.startingCash.toFixed(2)}).` });
    }

    // Resolve source (cash) and destination (bank) accounts from COA.
    // Source MUST be a cash account (111xxx); dest MUST be a bank account (112xxx).
    const isCashSrc  = (c) => /^111/.test(String(c || ''));
    const isBankDest = (c) => /^112/.test(String(c || ''));
    const srcMeta  = acctMeta(rawSrc);
    const destMeta = acctMeta(rawDest);
    const srcCode  = (srcMeta  && isCashSrc(rawSrc))   ? rawSrc  : '111000';
    const destCode = (destMeta && isBankDest(rawDest)) ? rawDest : '112000';
    const srcName  = acctMeta(srcCode)?.name  || 'Cash on Hand';
    const destName = acctMeta(destCode)?.name || 'Cash in Bank';

    const depRef = reference ? reference : await mkSeqRef('DEP');
    const je = await JournalEntry.create({
      reference: depRef,
      description: `Bank deposit: ${shift.cashierName}${reference ? ` (${reference})` : ''}`,
      lines: [
        { accountCode: destCode, accountName: destName, debit: depositAmount, credit: 0 },
        { accountCode: srcCode,  accountName: srcName,  debit: 0, credit: depositAmount },
      ],
      totalDebit: depositAmount,
      totalCredit: depositAmount,
    });

    const drawerBalanceAfter = (shift.actualCash || 0) - shift.depositedAmount;
    const isReconciled = Math.abs(drawerBalanceAfter - shift.startingCash) < 0.01;
    if (isReconciled) { shift.isReconciled = true; shift.status = 'Reconciled'; await shift.save(); }

    const deposit = await BankDeposit.create({
      shiftId: shift._id,
      amount: depositAmount,
      depositedBy: req.user.name,
      reference: depRef,
      journalEntryId: je._id,
      drawerBalanceAfter,
      isDrawerReconciled: isReconciled,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (bank deposit)
    res.json({ success: true, deposit, shift, drawerBalanceAfter, isReconciled });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/bank-deposits', verifyToken, requireStaff, async (req, res) => {
  try {
    // String() coercion: req.query.shiftId can arrive as a nested object
    // (e.g. ?shiftId[$exists]=true, parsed by express's extended query
    // parser) - without this, an operator object reaches the filter unscoped.
    const filter = req.query.shiftId ? { shiftId: String(req.query.shiftId) } : {};
    const deposits = await BankDeposit.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, deposits });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/accounts', verifyToken, requireStaff, async (req, res) => {
  try {
    const accounts = await Account.find().sort({ code: 1 });
    res.json({ success: true, accounts });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Full chart: canonical headers/leaves merged with user-created custom children.
app.get('/api/coa', verifyToken, requireStaff, async (req, res) => {
  try {
    const custom = await Account.find({ custom: true }).sort({ code: 1 }).lean();
    const canonical = Object.entries(ACCOUNTS).map(([code, a]) => ({
      code, name: a.name, type: a.type, parent: a.parent || null,
      isParent: !!a.isParent, custom: false,
    }));
    const customMapped = custom.map(a => ({
      _id: a._id, code: a.code, name: a.name, type: a.type,
      parent: a.parent || null, isParent: false, custom: true,
    }));
    res.json({ success: true, accounts: [...canonical, ...customMapped] });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Create a custom child account under a chosen parent (superadmin only).
app.post('/api/accounts', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { parentCode, name } = req.body;
    const parent = ACCOUNTS[parentCode];
    if (!parent) return res.status(400).json({ success: false, error: 'Choose a valid parent account.' });
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Account name is required.' });

    // Generate a unique child code: parent's first 3 digits + 3-digit sequence
    // (e.g. parent 640000 → 640001, 640002 …). Sorts directly under the parent.
    const base = String(parentCode).slice(0, 3);
    const taken = new Set([
      ...Object.keys(ACCOUNTS),
      ...(await Account.find({ code: { $regex: `^${base}` } }, { code: 1 }).lean()).map(a => a.code),
    ]);
    let code = null;
    for (let i = 1; i <= 999; i++) {
      const cand = base + String(i).padStart(3, '0');
      if (!taken.has(cand)) { code = cand; break; }
    }
    if (!code) return res.status(400).json({ success: false, error: 'No free code under this parent.' });

    const account = await Account.create({
      code, name: name.trim(), type: parent.type, parent: parentCode,
      custom: true, normalBalance: normalBalanceForCode(code),
    });
    await refreshCustomMeta();
    res.json({ success: true, account });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Rename a custom child account (canonical accounts are immutable).
app.put('/api/accounts/:id', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Account name is required.' });
    const acct = await Account.findById(req.params.id);
    if (!acct || !acct.custom) return res.status(404).json({ success: false, error: 'Custom account not found.' });
    acct.name = name.trim();
    await acct.save();
    await refreshCustomMeta();
    res.json({ success: true, account: acct });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Delete a custom child account - blocked if any journal entry already posted to it.
app.delete('/api/accounts/:id', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const acct = await Account.findById(req.params.id);
    if (!acct || !acct.custom) return res.status(404).json({ success: false, error: 'Custom account not found.' });
    const used = await JournalEntry.exists({ 'lines.accountCode': acct.code });
    if (used) return res.status(409).json({ success: false, error: 'Account has posted journal entries; cannot delete. It can be left unused.' });
    const before = acct.toObject();
    await Account.deleteOne({ _id: acct._id });
    await refreshCustomMeta();
    await logAudit(req, { action: 'delete', entity: 'Account', entityId: acct._id, before });
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── CLOSED PERIODS - list, close, reopen ──────────────────────────────────────
app.get('/api/periods', verifyToken, requireStaff, async (req, res) => {
  try {
    const periods = await ClosedPeriod.find().sort({ year: -1, month: -1 }).lean();
    res.json({ success: true, periods });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/periods/close', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const year = parseInt(req.body.year, 10);
    const month = parseInt(req.body.month, 10);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ success: false, error: 'year (YYYY) and month (1-12) required.' });
    }
    const notes = (req.body.notes || '').slice(0, 500);
    // Refuse if a future month or current month before EOM
    const now = new Date();
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    if (lastDay > now) return res.status(400).json({ success: false, error: 'Cannot close a period that has not ended yet.' });

    const upsert = await ClosedPeriod.findOneAndUpdate(
      { year, month },
      { year, month, isOpen: false, closedBy: req.user?.name || 'system', closedAt: new Date(), notes },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    await logAudit(req, { action: 'close', entity: 'Period', entityId: `${year}-${String(month).padStart(2,'0')}`, after: { year, month }, notes });
    res.json({ success: true, period: upsert });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/periods/:id/reopen', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const p = await ClosedPeriod.findById(req.params.id);
    if (!p) return res.status(404).json({ success: false, error: 'Period not found.' });
    if (p.isOpen) return res.json({ success: true, period: p });
    p.isOpen = true;
    p.reopenedBy = req.user?.name || 'system';
    p.reopenedAt = new Date();
    await p.save();
    await logAudit(req, { action: 'reopen', entity: 'Period', entityId: p._id, after: { year: p.year, month: p.month } });
    res.json({ success: true, period: p });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── PAYMENT METHOD → ACCOUNT MAP CRUD ────────────────────────────────────────
// GET returns the live effective map (defaults + overrides).
app.get('/api/payment-method-map', verifyToken, requireStaff, async (req, res) => {
  try {
    const overrides = await PaymentMethodMap.find().lean();
    res.json({
      success: true,
      defaults: DEFAULT_PAYMENT_ACCOUNT_MAP,
      overrides: Object.fromEntries(overrides.map(o => [o.method, o.accountCode])),
      effective: { ...ctx.PAYMENT_MAP_CACHE },
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Upsert a single mapping. Validates the code resolves against the COA.
app.put('/api/payment-method-map', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { method, accountCode } = req.body;
    if (!method || !accountCode) return res.status(400).json({ success: false, error: 'method and accountCode are required.' });
    if (!acctMeta(accountCode)) return res.status(400).json({ success: false, error: `Unknown account code ${accountCode}.` });
    const before = await PaymentMethodMap.findOne({ method }).lean();
    const doc = await PaymentMethodMap.findOneAndUpdate(
      { method },
      { method, accountCode, updatedBy: req.user?.name || 'system' },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    await refreshPaymentMap();
    await logAudit(req, { action: 'update', entity: 'PaymentMethodMap', entityId: method, before, after: doc });
    res.json({ success: true, mapping: doc, effective: { ...ctx.PAYMENT_MAP_CACHE } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Reset a single mapping back to its default.
app.delete('/api/payment-method-map/:method', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const before = await PaymentMethodMap.findOneAndDelete({ method: req.params.method }).lean();
    await refreshPaymentMap();
    await logAudit(req, { action: 'delete', entity: 'PaymentMethodMap', entityId: req.params.method, before });
    res.json({ success: true, effective: { ...ctx.PAYMENT_MAP_CACHE } });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// GET all funds (superadmin only)
app.get('/api/revolving-funds', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const funds = await RevolvingFund.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, funds });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// POST create a new fund (superadmin only)
app.post('/api/revolving-funds', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { name, initialAmount, description, sourceAccount } = req.body;
    if (!name || !initialAmount || Number(initialAmount) <= 0)
      return res.status(400).json({ success: false, error: 'Fund name and a positive initial amount are required.' });

    // "Paid from" - any cash/bank/e-wallet account (canonical or custom sub-account).
    const isCashLike = (c) => /^(111|112|113)/.test(String(c || ''));
    const srcMeta = acctMeta(sourceAccount);
    const srcCode = (srcMeta && isCashLike(sourceAccount)) ? sourceAccount : '111000';
    const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';
    const amt = Number(initialAmount);

    const fund = await RevolvingFund.create({
      name, initialAmount: amt,
      currentBalance: amt,
      description: description || '',
      createdBy: req.user?.name,
    });

    // Opening journal entry: DR 1050 Petty Cash / CR <chosen source account>
    const je = await JournalEntry.create({
      date: new Date(), description: `Revolving Fund established: ${name} (from ${srcName})`,
      lines: [
        { accountCode: '114000', accountName: 'Petty Cash / Revolving Fund', debit: amt, credit: 0 },
        { accountCode: srcCode, accountName: srcName,                      debit: 0, credit: amt },
      ],
      totalDebit: amt, totalCredit: amt,
      reference: await mkSeqRef('RF-OPEN'),
    });

    // Record opening tx
    await RevolvingFundTx.create({
      fundId: fund._id, type: 'replenishment',
      amount: Number(initialAmount),
      description: 'Fund opened: initial amount',
      performedBy: req.user?.name, balanceAfter: Number(initialAmount),
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund opened)
    res.json({ success: true, fund });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// POST disburse from a fund (any staff - they need to log what they spend)
app.post('/api/revolving-funds/:id/disburse', verifyToken, requireStaff, async (req, res) => {
  try {
    const preCheck = await RevolvingFund.findById(req.params.id);
    if (!preCheck || !preCheck.isActive) return res.status(404).json({ success: false, error: 'Fund not found.' });

    const { amount, description, categoryCode } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be a positive number.' });
    if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description is required.' });

    const expCode = categoryCode || '760000';
    const { ACCOUNTS } = await import('../lib/chartOfAccounts.js');
    const expName  = ACCOUNTS[expCode]?.name || 'Other Operating Expenses';

    // Atomic compare-and-swap: the "sufficient balance" guard is in the filter
    // itself (via $expr), so two concurrent disbursements against the same fund
    // can't both read the same pre-disbursement balance and both pass. amt is
    // rounded to cents first so the $inc doesn't accumulate float dust.
    const roundedAmt = Math.round(amt * 100) / 100;
    const fund = await RevolvingFund.findOneAndUpdate(
      { _id: req.params.id, isActive: true, $expr: { $gte: [{ $ifNull: ['$currentBalance', 0] }, roundedAmt] } },
      { $inc: { currentBalance: -roundedAmt } },
      { new: true }
    );
    if (!fund) {
      const existing = await RevolvingFund.findById(req.params.id);
      const bal = existing?.currentBalance || 0;
      return res.status(400).json({ success: false, error: `Insufficient fund balance. Available: ₱${bal.toFixed(2)}` });
    }

    // DR expense / CR 1050 Petty Cash
    const je = await JournalEntry.create({
      date: new Date(), description: `Revolving Fund disbursement (${fund.name}): ${description}`,
      lines: [
        { accountCode: expCode, accountName: expName,                    debit: roundedAmt, credit: 0 },
        { accountCode: '114000',  accountName: 'Petty Cash / Revolving Fund', debit: 0, credit: roundedAmt },
      ],
      totalDebit: roundedAmt, totalCredit: roundedAmt,
      reference: await mkSeqRef('RF-OUT'),
    });

    const tx = await RevolvingFundTx.create({
      fundId: fund._id, type: 'disbursement', amount: roundedAmt,
      description, categoryCode: expCode,
      performedBy: req.user?.name,
      balanceAfter: fund.currentBalance,
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund disbursement)
    res.json({ success: true, fund, tx });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// POST replenish a fund back to its initial amount (superadmin only)
app.post('/api/revolving-funds/:id/replenish', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const fund = await RevolvingFund.findById(req.params.id);
    if (!fund || !fund.isActive) return res.status(404).json({ success: false, error: 'Fund not found.' });

    const { amount, note, sourceAccount } = req.body;
    // sourceAccount: any cash/bank/e-wallet account (canonical or custom sub-account).
    const isCashLike = (c) => /^(111|112|113)/.test(String(c || ''));
    const srcMeta = acctMeta(sourceAccount);
    const srcCode = (srcMeta && isCashLike(sourceAccount)) ? sourceAccount : '111000';
    const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';

    // If amount not specified, replenish back to full initialAmount
    const shortfall = +(fund.initialAmount - fund.currentBalance).toFixed(2);
    const amt = amount ? Number(amount) : shortfall;

    if (amt <= 0) return res.status(400).json({ success: false, error: 'Fund is already full; nothing to replenish.' });

    fund.currentBalance = +(fund.currentBalance + amt).toFixed(2);
    await fund.save();

    // DR 1050 Petty Cash / CR sourceAccount
    const je = await JournalEntry.create({
      date: new Date(),
      description: `Revolving Fund replenishment: ${fund.name} (from ${srcName})${note ? ': ' + note : ''}`,
      lines: [
        { accountCode: '114000', accountName: 'Petty Cash / Revolving Fund', debit: amt, credit: 0 },
        { accountCode: srcCode,  accountName: srcName,                      debit: 0, credit: amt },
      ],
      totalDebit: amt, totalCredit: amt,
      reference: await mkSeqRef('RF-IN'),
    });

    const tx = await RevolvingFundTx.create({
      fundId: fund._id, type: 'replenishment', amount: amt,
      description: note || `Replenished ₱${amt.toFixed(2)}; balance restored`,
      performedBy: req.user?.name,
      balanceAfter: fund.currentBalance,
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund replenishment)
    res.json({ success: true, fund, tx });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// GET transaction history for a fund
app.get('/api/revolving-funds/:id/transactions', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const total = await RevolvingFundTx.countDocuments({ fundId: req.params.id });
    const txs   = await RevolvingFundTx.find({ fundId: req.params.id })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, txs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// PATCH deactivate a fund (superadmin only)
app.patch('/api/revolving-funds/:id/close', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const fund = await RevolvingFund.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' });
    if (!fund) return res.status(404).json({ success: false, error: 'Fund not found.' });
    res.json({ success: true, fund });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
