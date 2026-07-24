// finance routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
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

// Accounting Ledger / Journal Entries — requires accounting.view (superadmin/finance/admin)
app.get('/api/journal', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.limit) || 50);
    const [entries, total] = await Promise.all([
      JournalEntry.find().sort({ date: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      JournalEntry.countDocuments()
    ]);
    res.json({ success: true, entries, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/finance/balances', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    // Aggregate at MongoDB level — no full collection load, OOM-safe at scale
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
      if (start) match.date.$gte = new Date(start);
      if (end) { const e = new Date(end); e.setHours(23, 59, 59, 999); match.date.$lte = e; }
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// EXPENSE ENTRY — operator-facing expense bookkeeping
// Categories defined in lib/chartOfAccounts.js
// ============================================================
app.get('/api/expenses/categories', verifyToken, ...canViewAcct, async (req, res) => {
  res.json({ success: true, categories: EXPENSE_CATEGORIES });
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
      emitToMgr('mgrAlert', { kind: 'unmappedTender', method: paymentMethod || '(none)', account: credAcct.code, message: `Expense payment method "${paymentMethod || '(none)'}" has no account route — booked against Unassigned Receipts. Configure it in Payment Routing.` });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Outstanding A/R list (delivery orders, Completed, not yet settled)
app.get('/api/finance/ar-outstanding', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const rows = await Order.find({
      businessType: BUSINESS_TYPE,
      status: 'Completed',
      paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true }, // comps collect no money — never an A/R
      arSettled: { $ne: true }
    }, { orderNumber: 1, customerName: 1, table: 1, total: 1, paymentMethod: 1, createdAt: 1 })
      .sort({ createdAt: -1 }).limit(500).lean();
    const totalOutstanding = rows.reduce((s, r) => s + (r.total || 0), 0);
    res.json({ success: true, orders: rows, totalOutstanding });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ACCOUNTS PAYABLE — outstanding balance + recent entries + payment
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

    // Recent AP journal entries (both directions)
    const recent = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000' } },
      { $group: {
        _id: '$_id',
        date:        { $first: '$date'        },
        reference:   { $first: '$reference'   },
        description: { $first: '$description' },
        credit:      { $sum: { $cond: [{ $gt: ['$lines.credit', 0] }, '$lines.credit', 0] } },
        debit:       { $sum: { $cond: [{ $gt: ['$lines.debit',  0] }, '$lines.debit',  0] } },
      }},
      { $sort: { date: -1 } },
      { $limit: 50 }
    ]);

    res.json({ success: true, outstandingBalance, recent, totalCredit: bal.totalCredit, totalDebit: bal.totalDebit });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST /api/finance/ap-payment — record a supplier payment (DR 2000 AP / CR cash account)
app.post('/api/finance/ap-payment', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { amount, payFromAccount, description, vendorName } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });

    // Accept any cash/bank/e-wallet account (canonical or custom sub-account).
    const isCashLike = (c) => /^(111|112|113)/.test(String(c || ''));
    const srcMeta = acctMeta(payFromAccount);
    const srcCode = (srcMeta && isCashLike(payFromAccount)) ? payFromAccount : '111000';
    const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';

    const desc = description?.trim() || `AP payment${vendorName ? ` to ${vendorName}` : ''}`;
    const reference = await mkSeqRef('AP-PAY');

    const lines = [
      { accountCode: '220000', accountName: 'Accounts Payable', debit: amt, credit: 0 },
      { accountCode: srcCode, accountName: srcName,           debit: 0,   credit: amt },
    ];
    assertBalanced(lines, reference);
    const je = await JournalEntry.create({ date: new Date(), reference, description: desc, lines, totalDebit: amt, totalCredit: amt });

    await AuditLog.create({
      userId: req.user?.name || 'System',
      action: 'AP_PAYMENT',
      targetReference: reference,
      details: { amount: amt, payFromAccount: srcCode, vendorName, recordedBy: req.user?.name }
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger
    res.json({ success: true, journalEntry: je });
  } catch (err) {
    log.error({ err }, 'POST /api/finance/ap-payment failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    // Headers/body already streaming — can't switch to a JSON error; just end the stream.
    if (!res.headersSent) res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
    else res.end();
  }
});

// --- BANK DEPOSIT ROUTES ---
app.post('/api/bank-deposits', verifyToken, requireStaff, async (req, res) => {
  try {
    const { shiftId, amount, reference, sourceAccount: rawSrc, destAccount: rawDest } = req.body;
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0)
      return res.status(400).json({ success: false, error: 'Invalid deposit amount.' });

    const shift = await Shift.findById(shiftId);
    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found.' });
    if (shift.status === 'Open')
      return res.status(400).json({ success: false, error: 'Close the shift before posting a deposit.' });

    const cashOnHand = (shift.actualCash || 0) - (shift.depositedAmount || 0);
    const maxDeposit = cashOnHand - shift.startingCash;

    if (depositAmount > cashOnHand + 0.01)
      return res.status(400).json({ success: false, error: `Amount exceeds Cash on Hand (₱${cashOnHand.toFixed(2)}).` });
    if (depositAmount > maxDeposit + 0.01)
      return res.status(400).json({ success: false, error: `Cannot reduce drawer below starting fund (₱${shift.startingCash.toFixed(2)}).` });

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

    shift.depositedAmount = (shift.depositedAmount || 0) + depositAmount;
    const drawerBalanceAfter = (shift.actualCash || 0) - shift.depositedAmount;
    const isReconciled = Math.abs(drawerBalanceAfter - shift.startingCash) < 0.01;
    if (isReconciled) { shift.isReconciled = true; shift.status = 'Reconciled'; }
    await shift.save();

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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/bank-deposits', verifyToken, requireStaff, async (req, res) => {
  try {
    const filter = req.query.shiftId ? { shiftId: req.query.shiftId } : {};
    const deposits = await BankDeposit.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/accounts', verifyToken, requireStaff, async (req, res) => {
  try {
    const accounts = await Account.find().sort({ code: 1 });
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Delete a custom child account — blocked if any journal entry already posted to it.
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── CLOSED PERIODS — list, close, reopen ──────────────────────────────────────
app.get('/api/periods', verifyToken, requireStaff, async (req, res) => {
  try {
    const periods = await ClosedPeriod.find().sort({ year: -1, month: -1 }).lean();
    res.json({ success: true, periods });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// GET all funds (superadmin only)
app.get('/api/revolving-funds', verifyToken, ...canViewAcct, async (req, res) => {
  try {
    const funds = await RevolvingFund.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, funds });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST create a new fund (superadmin only)
app.post('/api/revolving-funds', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const { name, initialAmount, description, sourceAccount } = req.body;
    if (!name || !initialAmount || Number(initialAmount) <= 0)
      return res.status(400).json({ success: false, error: 'Fund name and a positive initial amount are required.' });

    // "Paid from" — any cash/bank/e-wallet account (canonical or custom sub-account).
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST disburse from a fund (any staff — they need to log what they spend)
app.post('/api/revolving-funds/:id/disburse', verifyToken, requireStaff, async (req, res) => {
  try {
    const fund = await RevolvingFund.findById(req.params.id);
    if (!fund || !fund.isActive) return res.status(404).json({ success: false, error: 'Fund not found.' });

    const { amount, description, categoryCode } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be a positive number.' });
    if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description is required.' });
    if (amt > fund.currentBalance)
      return res.status(400).json({ success: false, error: `Insufficient fund balance. Available: ₱${fund.currentBalance.toFixed(2)}` });

    const expCode = categoryCode || '760000';
    const { ACCOUNTS } = await import('../lib/chartOfAccounts.js');
    const expName  = ACCOUNTS[expCode]?.name || 'Other Operating Expenses';

    fund.currentBalance = +(fund.currentBalance - amt).toFixed(2);
    await fund.save();

    // DR expense / CR 1050 Petty Cash
    const je = await JournalEntry.create({
      date: new Date(), description: `Revolving Fund disbursement (${fund.name}): ${description}`,
      lines: [
        { accountCode: expCode, accountName: expName,                    debit: amt, credit: 0 },
        { accountCode: '114000',  accountName: 'Petty Cash / Revolving Fund', debit: 0, credit: amt },
      ],
      totalDebit: amt, totalCredit: amt,
      reference: await mkSeqRef('RF-OUT'),
    });

    const tx = await RevolvingFundTx.create({
      fundId: fund._id, type: 'disbursement', amount: amt,
      description, categoryCode: expCode,
      performedBy: req.user?.name,
      balanceAfter: fund.currentBalance,
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund disbursement)
    res.json({ success: true, fund, tx });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
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
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// PATCH deactivate a fund (superadmin only)
app.patch('/api/revolving-funds/:id/close', verifyToken, ...canPostAcct, async (req, res) => {
  try {
    const fund = await RevolvingFund.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' });
    if (!fund) return res.status(404).json({ success: false, error: 'Fund not found.' });
    res.json({ success: true, fund });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});
}
