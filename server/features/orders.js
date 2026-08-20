// orders routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { resolveCreditLimit, checkCreditAvailable } from '../lib/credit.js';
import { title } from '../lib/normalize.js';
import { withOptionalTransaction } from '../lib/txn.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { captureError } from '../lib/errorLog.js';
import { loadTierContext, resolveEffectiveDiscountPercent } from '../lib/discounts.js';

export default function registerOrders(ctx) {
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
    computeOrderVat,
    normaliseVatRate,
    DEFAULT_VAT_RATE,
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
    TenantStatsSchema,
    TenantStats,
    STATS_SHARDS,
    ProductStatsSchema,
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
    PriceTier,
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

// Small randomized backoff between WriteConflict retries on the completion/
// void/refund/partial-fulfill/drop-remaining transactions. Every one of them
// now writes the same singleton TenantStats doc (see applyStatsDelta below),
// so a burst of truly-simultaneous requests retrying with zero delay tends to
// re-collide with each other on the very next attempt - a short jittered
// pause spaces the retries out and lets one of them land.
const STATS_RETRY_ATTEMPTS = 6;
const statsRetryDelayMs = (attempt) => (15 + Math.floor(Math.random() * 55)) * attempt;
const statsRetryDelay = (attempt) => new Promise((r) => setTimeout(r, statsRetryDelayMs(attempt)));

// Shared by every route whose handler writes to the hot sharded TenantStats/
// ProductStats documents (complete/void/partial-fulfill/drop-remaining/refund).
// `onceFn(req, res, mayRetry)` returns `true` to ask for another attempt (a
// transient WriteConflict with nothing sent yet) or falsy once it has either
// succeeded or already written a response - see each *Once function's own
// catch block for the transient-error check that produces this signal.
async function runWithStatsRetry(onceFn, req, res) {
  for (let attempt = 1; attempt <= STATS_RETRY_ATTEMPTS; attempt++) {
    const retry = await onceFn(req, res, attempt < STATS_RETRY_ATTEMPTS);
    if (retry !== true) return;
    await statsRetryDelay(attempt);
  }
}

// Is this a MongoDB transaction error worth retrying (another writer collided
// with us on the same document) rather than a real failure? Shared by every
// *Once function's catch block above so the classification can't drift
// between the 5 stats-writing routes.
function isTransientTxnError(err) {
  const msg = String(err?.errorLabels || err?.message || '');
  return (err?.errorLabels || []).includes('TransientTransactionError') || /WriteConflict|Write conflict/i.test(msg);
}

// Mirrors exactly what the old unbounded Order.aggregate() dashboard queries
// computed (see reports.js), but as an O(1) running total kept in TenantStats/
// ProductStats and updated atomically, in the SAME transaction, wherever an
// order's status flips to/from 'Completed'. sign=+1 when an order newly becomes
// Completed (main completion, unvoid, partial-fulfill's final round, drop-
// remaining); sign=-1 when a Completed order stops being Completed (void,
// refund - both full and partial refunds move status off 'Completed', so both
// fully reverse the counters, same as the old aggregation would simply stop
// counting them). Complimentary orders never contribute to ProductStats,
// mirroring reports.js's `isComplimentary: { $ne: true }` filter on that query.
async function applyStatsDelta(order, sign, session) {
  const orderRevenue = order.isComplimentary ? 0 : (order.total || 0);
  const orderComp = order.isComplimentary ? (order.subtotal || 0) : 0;

  // Random shard: spreads concurrent writers across STATS_SHARDS documents
  // instead of all colliding on one (see the schema comment in server.js for
  // why these are sharded rather than true singletons).
  const tenantShard = Math.floor(Math.random() * STATS_SHARDS);
  await TenantStats.findOneAndUpdate(
    { businessType: BUSINESS_TYPE, shard: tenantShard },
    { $inc: {
        cumulativeRevenue: sign * orderRevenue,
        cumulativeComp: sign * orderComp,
        cumulativeOrderCount: sign * 1,
        cumulativeNonCompCount: sign * (order.isComplimentary ? 0 : 1),
      } },
    { session, upsert: true }
  );

  if (order.isComplimentary) return;

  const byName = new Map();
  for (const item of (order.items || [])) {
    const qty = item.quantity || 0;
    const rev = (item.price || 0) * qty;
    const prev = byName.get(item.name) || { qty: 0, rev: 0 };
    byName.set(item.name, { qty: prev.qty + qty, rev: prev.rev + rev });
  }
  // One round trip for every distinct product on the order, instead of one
  // findOneAndUpdate per product awaited sequentially inside this transaction.
  const ops = [];
  for (const [name, { qty, rev }] of byName) {
    const productShard = Math.floor(Math.random() * STATS_SHARDS);
    ops.push({
      updateOne: {
        filter: { businessType: BUSINESS_TYPE, productName: name, shard: productShard },
        update: { $inc: { cumulativeQty: sign * qty, cumulativeRevenue: sign * rev } },
        upsert: true,
      },
    });
  }
  if (ops.length) await ProductStats.bulkWrite(ops, { session });
}

// The business's VAT registration, read fresh per order. Deliberately not cached:
// flipping the toggle must take effect on the very next sale, and one extra
// indexed lookup is nothing next to the writes an order already performs.
//
// Absent settings mean a non-VAT business, which is how every install behaved
// before VAT existed - so an untouched system keeps its current totals exactly.
async function loadVatConfig() {
  const [enabledRow, rateRow, orderRow, inclusiveRow] = await Promise.all([
    Settings.findOne({ key: 'vatEnabled' }).lean(),
    Settings.findOne({ key: 'vatRate' }).lean(),
    Settings.findOne({ key: 'scPwdOrder' }).lean(),
    Settings.findOne({ key: 'vatInclusive' }).lean(),
  ]);
  return {
    enabled: enabledRow?.value === true || enabledRow?.value === 'true',
    rate: normaliseVatRate(rateRow?.value, DEFAULT_VAT_RATE),
    scPwdOrder: orderRow?.value === 'discount-first' ? 'discount-first' : 'vat-first',
    // Default true: absent setting means the Philippine retail default, which is
    // also how every order booked before this option existed was priced.
    inclusive: inclusiveRow ? inclusiveRow.value !== false && inclusiveRow.value !== 'false' : true,
  };
}

// Repeat-walk-in auto-promotion: a POS sale with a real (non-"Guest") customerName
// that isn't already tied to a ClientAccount. Once the same name has 3 Completed
// orders, they're "our client" - get their own CUS-1000-Axxxx code instead of
// sharing WALK_IN_CUSTOMER_CODE. The promoted account has no usable login (staff
// can add one later via /api/client-accounts if the client wants portal access).
// Fire-and-forget after the triggering request has already responded - never let
// this delay or fail an order completion.
async function maybePromoteWalkInClient(order) {
  try {
    if (order.clientAccountId || order.placedByClient) return;
    const name = (order.customerName || '').trim();
    if (!name || name.toLowerCase() === 'guest') return;

    const nameRegex = new RegExp(`^${escapeRegex(name)}$`, 'i');

    let account = await ClientAccount.findOne({ name: nameRegex, source: 'pos' });
    if (!account) {
      const count = await Order.countDocuments({
        businessType: BUSINESS_TYPE,
        customerName: nameRegex,
        status: 'Completed',
        clientAccountId: { $in: [null, ''] },
      });
      if (count < 3) return; // "bought more than 2" == promote on the 3rd

      const clientCode = await generateNextSequence(ClientAccount, 'CUS-1000', 'clientCode');
      const placeholderUsername = `_pos_${clientCode.toLowerCase()}`;
      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
      account = await ClientAccount.create({
        clientCode, name, username: placeholderUsername, password: placeholderPassword,
        isActive: true, source: 'pos',
      });
      log.info({ clientCode, name }, 'Auto-promoted repeat walk-in to client');

      // Backfill this customer's past walk-in orders so ledger/reports roll up under one code.
      await Order.updateMany(
        { businessType: BUSINESS_TYPE, customerName: nameRegex, clientAccountId: { $in: [null, ''] } },
        { $set: { clientAccountId: String(account._id) } }
      );
    } else {
      await Order.updateOne({ _id: order._id }, { $set: { clientAccountId: String(account._id) } });
    }
  } catch (err) {
    log.error({ err }, 'Walk-in client auto-promotion failed');
  }
}

// Orders
app.get('/api/orders', verifyToken, requireStaff, async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    // Tenancy filter - businessType: undefined still matches via $in so that any
    // unbackfilled docs (shouldn't exist after startup migration) still show up.
    const baseFilter = { isArchived: false, isParked: { $ne: true }, businessType: BUSINESS_TYPE, ...tenantScope(req) };
    if (search && search.trim()) {
      const rx = { $regex: escapeRegex(search.trim()), $options: 'i' };
      baseFilter.$or = [{ customerName: rx }, { orderNumber: rx }, { table: rx }];
    }
    const query = Order.find(baseFilter).sort({ createdAt: -1 }).lean();
    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
      query.skip((pageNum - 1) * limitNum).limit(limitNum);
      const [orders, total] = await Promise.all([query, Order.countDocuments(baseFilter)]);
      return res.json({ success: true, orders, total, page: pageNum, limit: limitNum });
    }
    const orders = await query;
    res.json({ success: true, orders });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/orders/archives', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { search, start, end, page = 1, limit: lim = 200 } = req.query;
    const filter = { isArchived: true, businessType: BUSINESS_TYPE, ...tenantScope(req) };
    if (search?.trim()) {
      const rx = { $regex: escapeRegex(search.trim()), $options: 'i' };
      filter.$or = [{ customerName: rx }, { orderNumber: rx }, { cashier: rx }, { table: rx }];
    }
    if (start || end) {
      filter.createdAt = {};
      if (start) filter.createdAt.$gte = dayStart(start);
      if (end) { filter.createdAt.$lte = dayEnd(end); }
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, parseInt(lim) || 200);
    const [archives, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      Order.countDocuments(filter)
    ]);
    res.json({ success: true, archives, total, page: pageNum });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── PARKED ORDERS / OPEN TABS ────────────────────────────────────────────────
// IMPORTANT: these literal paths MUST be registered before '/api/orders/:id',
// otherwise Express matches ':id' first and treats "parked"/"park" as an order id.
app.post('/api/orders/park', verifyToken, requireStaff, async (req, res) => {
  try {
    const { items, customerName, table, orderNotes, guestCount } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: 'Cannot park an empty cart.' });
    const subtotal = items.reduce((s, i) => s + ((i.price || 0) + (i.selectedAddOns || []).reduce((a, x) => a + Number(x.price || 0), 0)) * (i.quantity || 1), 0);
    const year = new Date().getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${year}`, 'orderNumber');
    const parked = await Order.create({
      orderNumber, items, customerName: customerName || 'Guest', table: table || 'Dine-In',
      orderNotes: (orderNotes || '').trim().slice(0, 300), guestCount: Math.max(1, parseInt(guestCount) || 1),
      subtotal, total: subtotal, status: 'Parked', isParked: true, cashier: req.user?.name || 'System',
    });
    res.json({ success: true, order: parked });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.get('/api/orders/parked', verifyToken, requireStaff, async (req, res) => {
  try {
    const parked = await Order.find({ isParked: true, isArchived: false, businessType: BUSINESS_TYPE, ...tenantScope(req) }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, parked });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.delete('/api/orders/parked/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, isParked: true });
    if (!order) return res.status(404).json({ success: false, error: 'Parked order not found.' });
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, order });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Fetch a single order by ID (Used for Customer Status Lock)
app.get('/api/orders/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "Order not found" });
    // Access control: staff/admin and authenticated clients get the full document.
    // Anonymous callers (QR status polling) get a PII-SAFE projection so order ids
    // can't be enumerated to harvest customer phone / delivery address.
    let isPrivileged = false;
    try {
      const raw = req.headers.authorization?.replace(/^Bearer /, '') || '';
      if (raw) { const d = jwt.verify(raw, process.env.JWT_SECRET); if (d?.role) isPrivileged = true; }
    } catch { /* invalid/expired token → treat as anonymous */ }
    const safeProjection = {
      orderNumber: 1, status: 1, dispatchStatus: 1, isParked: 1, table: 1,
      total: 1, customerName: 1, createdAt: 1, scheduledTime: 1,
      'items.name': 1, 'items.quantity': 1, 'items.itemStatus': 1, 'items.department': 1,
    };
    const order = await Order.findById(req.params.id, isPrivileged ? undefined : safeProjection);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json(order); // sent as the raw order object so the frontend can read it directly
  } catch (error) {
    captureError(req, error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post('/api/orders', orderLimiter, verifyOrderAuth, async (req, res) => {
  // Declared outside the try block on purpose: the E11000 handler in catch{}
  // below needs it, and a try{}-scoped const is NOT visible inside its own
  // catch{} block (separate lexical scope) - referencing it there throws a
  // ReferenceError, which as an uncaught rejection in an async handler hangs
  // the request with no response instead of erroring cleanly.
  const idempotencyKey = req.headers['idempotency-key'];
  try {
    // 1. IDEMPOTENCY CHECK
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ idempotencyKey });
      if (existingOrder) return res.status(200).json({ success: true, order: existingOrder, message: "Duplicate prevented." });
    }

    let { items, discountPercent = 0, discountFlat = 0, table, customerName, sessionId, isComplimentary = false, employeeName = '', orderNotes = '', guestCount = 1, payments: paymentsInput, paymentMethod: bodyPaymentMethod, termsOfPayment, reserveOnly = false } = req.body;

    // Canonicalize the buyer's name. It is printed on receipts, billing
    // statements and delivery receipts, and it is the key that repeat walk-ins
    // are matched on - so "acme trading corp" and "ACME Trading Corp" must not
    // become two different customers, nor go onto a printed DR in lower case.
    if (typeof customerName === 'string' && customerName.trim()) customerName = title(customerName);

    // Block QR-originated orders when kitchen has toggled off (staff POS unaffected)
    if (req.qrSession) {
      const qrSetting = await Settings.findOne({ key: 'isAcceptingQROrders' }).lean();
      const isOpen = qrSetting ? qrSetting.value !== false : true;
      if (!isOpen) return res.status(403).json({ success: false, error: 'Kitchen is currently closed. Please see staff at the counter.' });
    }

    // Client account ordering (logistics mode): extract pre-set payment method and identity
    const isClientOrder = req.user?.role === 'client';
    const clientPresetPayment = isClientOrder ? req.user.paymentMethod : null;
    const cashier = isClientOrder ? (req.user.username || req.user.name || 'Client') : (req.user?.name || 'System');

    // Admin POS on-behalf: an admin/staff can attach a client account to an
    // order they're placing in person (`clientAccountId` in the body). When set,
    // we resolve per-product per-client discount overrides as if that client
    // bought it themselves. Ignored when the caller IS already a client (the
    // JWT identity is canonical and can't be overridden client-side).
    let onBehalfClientId = '';
    let onBehalfSegments = [];
    if (!isClientOrder && req.body.clientAccountId) {
      try {
        const cli = await ClientAccount.findById(req.body.clientAccountId).lean();
        if (cli && cli.isActive) { onBehalfClientId = String(cli._id); onBehalfSegments = cli.segments || []; }
      } catch { /* invalid id - ignore, fall back to default discount */ }
    }

    // SC/PWD is a property of the SALE, not of the business's VAT registration -
    // the cashier marks it per order and the POS already sends the flag. A non-VAT
    // business still labels the discount SC/PWD; it simply has no VAT to strip.
    const isVatExempt = req.body.isVatExempt === true;
    // FIX 1: Safely default to Takeout if the table is null or empty
    if (!table) table = 'Takeout';

    // Kill QR session - already validated by verifyOrderAuth; burn it before processing to prevent replay
    if (req.qrSession) {
      req.qrSession.isActive = false;
      await req.qrSession.save();
    }

    if (!items || items.length === 0) {
      throw new Error("Cart is empty");
    }

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        throw new Error(`Invalid quantity for item: ${item.name || item.productId}`);
      }
      if (item.price === undefined || item.price < 0) {
        throw new Error(`Invalid price for item: ${item.name || item.productId}`);
      }
    }

    // Authoritative department stamping - look up each product's category and resolve to Kitchen/Bar.
    // Combos resolve from their component products: all-Bar → Bar, otherwise Kitchen.
    {
      const directIds = items.map(i => i.productId).filter(Boolean);
      const comboCompIds = items.filter(i => i.isCombo).flatMap(i => (i.comboItems || []).map(c => c.productId)).filter(Boolean);
      const allIds = [...new Set([...directIds, ...comboCompIds])];
      const [prods, cats] = await Promise.all([
        allIds.length ? Product.find({ _id: { $in: allIds } }, { _id: 1, category: 1, productCode: 1 }).lean() : [],
        Category.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }, { name: 1, department: 1 }).lean()
      ]);
      const catDeptMap = Object.fromEntries(cats.map(c => [c.name, c.department || 'Kitchen']));
      const prodCatMap = Object.fromEntries(prods.map(p => [p._id.toString(), p.category]));
      const prodCodeMap = Object.fromEntries(prods.map(p => [p._id.toString(), p.productCode]));
      const defaultDept = BUSINESS_TYPE === 'log' ? 'Logistics' : 'Kitchen';
      const deptOf = (pid) => { const cat = prodCatMap[pid]; return cat ? (catDeptMap[cat] || defaultDept) : null; };
      for (const item of items) {
        if (item.productId && prodCodeMap[item.productId]) {
          item.productCode = prodCodeMap[item.productId];
        }
        if (item.isCombo && (item.comboItems || []).length) {
          const depts = item.comboItems.map(c => deptOf(c.productId)).filter(Boolean);
          item.department = (depts.length > 0 && depts.every(d => d === 'Bar')) ? 'Bar' : defaultDept;
        } else {
          const d = deptOf(item.productId);
          item.department = d || (item.department || defaultDept);
        }
      }
    }

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    let totalGross = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    
    const flatDiscount = Math.max(0, parseFloat(discountFlat) || 0);
    let discountType = 'None';
    if (isComplimentary) discountType = 'Complimentary';
    else if (isVatExempt && discountPercent > 0) discountType = 'SC/PWD';
    else if (discountPercent > 0) discountType = 'Promo';
    else if (flatDiscount > 0) discountType = 'Promo';

    // Per-product (and optional per-client) discount lookup. Server-authoritative -
    // never trust a client-side discount field. If the buyer is a logged-in client
    // and the product has a matching clientDiscounts entry, that override wins.
    const _prodIds = items.map(i => i.productId).filter(Boolean);
    const _prodNames = items.map(i => i.name).filter(Boolean);
    const _discProds = await Product.find(
      { $or: [{ _id: { $in: _prodIds } }, { name: { $in: _prodNames } }] },
      { _id: 1, name: 1, basePrice: 1, discountPercent: 1, clientDiscounts: 1, segmentDiscounts: 1, bulkBreaks: 1, vatExempt: 1 }
    ).lean();
    const _discById = new Map(_discProds.map(p => [String(p._id), p]));
    const _discByName = new Map(_discProds.map(p => [p.name, p]));
    // Buyer identity for per-client discount resolution. Authenticated client
    // wins; otherwise we fall back to the admin-on-behalf clientAccountId.
    const _buyerClientId = isClientOrder
      ? String(req.user.clientId || req.user._id || '')
      : (onBehalfClientId || '');
    // Buyer's segment tags, for segmentDiscounts resolution. The on-behalf path
    // already loaded them above; an authenticated client's JWT only carries
    // identity fields (see client-portal.js login), not segments, so that path
    // needs its own lookup.
    let _buyerSegments = onBehalfSegments;
    if (isClientOrder && _buyerClientId) {
      try {
        const buyerAcct = await ClientAccount.findById(_buyerClientId, { segments: 1 }).lean();
        _buyerSegments = buyerAcct?.segments || [];
      } catch { /* ignore - no segment discount applies */ }
    }
    // The buyer's price-tier context, and the per-product discount decision
    // itself, both come from the shared resolver (lib/discounts.js) - the
    // SAME function the pre-checkout price display (products.js) uses, so a
    // buyer is never shown one price and charged a different one.
    const { tierDefaultPct: _tierDefaultPct, perProductTiers: _perProductTiers } = await loadTierContext({
      PriceTier, businessType: BUSINESS_TYPE, tenantScope, req, buyerSegments: _buyerSegments,
    });
    const productDiscPct = (item) => {
      const p = item.productId ? _discById.get(String(item.productId)) : _discByName.get(item.name);
      return resolveEffectiveDiscountPercent(p, {
        buyerClientId: _buyerClientId, buyerSegments: _buyerSegments,
        tierDefaultPct: _tierDefaultPct, perProductTiers: _perProductTiers,
      });
    };
    // Quantity-break bulk pricing, independent of clientDiscounts/segmentDiscounts
    // above - combined via Math.max where it's applied, never stacked.
    const bulkQtyDiscPct = (item) => {
      const p = item.productId ? _discById.get(String(item.productId)) : _discByName.get(item.name);
      const breaks = p?.bulkBreaks || [];
      if (!breaks.length) return 0;
      const qty = Number(item.quantity || 0);
      const qualifying = breaks.filter(b => qty >= Number(b.minQty || 0));
      if (!qualifying.length) return 0;
      return Math.max(0, Math.min(100, Math.max(...qualifying.map(b => Number(b.percent || 0)))));
    };

    // Per-item pass resolves only the PRODUCT-level discounts. Order-level
    // discount and VAT are settled afterwards in one place, because with
    // VAT-inclusive pricing the split depends on the final collected amount and
    // cannot be accumulated line by line without rounding drift.
    let totalProductDisc = 0;
    let baseAfterProductDisc = 0;
    let exemptAfterProductDisc = 0;
    // Server-authoritative VAT classification, same rule as the discount lookup:
    // never trust a client-supplied flag, resolve it from the product record.
    const productIsExempt = (item) => {
      const p = item.productId ? _discById.get(String(item.productId)) : _discByName.get(item.name);
      return p?.vatExempt === true;
    };
    const validatedItems = items.map(item => {
      item.hasDiscount = true;
      // Calculate Add-Ons Total
      const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
      const itemBase = ((item.price || 0) + addOnTotal) * (item.quantity || 1);
      totalGross += itemBase;

      // Per-product discount applies to THIS line only - combine the resolved
      // client/segment/default rate with any qualifying bulk-quantity break,
      // taking whichever is higher (never stacked).
      const prodPct = Math.max(productDiscPct(item), bulkQtyDiscPct(item));
      const prodDisc = +(itemBase * prodPct / 100).toFixed(2);
      item.productDiscountPercent = prodPct;
      totalProductDisc += prodDisc;
      baseAfterProductDisc += itemBase - prodDisc;   // base the order-level discount works on

      item.vatExempt = productIsExempt(item);
      if (item.vatExempt) exemptAfterProductDisc += itemBase - prodDisc;
      return item;
    });

    const vatCfg = await loadVatConfig();
    // Prices are VAT-INCLUSIVE, so enabling VAT does not change what the customer
    // pays - it only splits the collected amount into net sales and output VAT.
    const vatResult = isComplimentary
      ? { total: 0, vatAmount: 0, vatableSales: 0, vatExemptSales: 0,
          discount: +baseAfterProductDisc.toFixed(2), rate: vatCfg.rate }
      : computeOrderVat({
          grossInclusive: baseAfterProductDisc,
          exemptGross: exemptAfterProductDisc,
          discountPercent,
          flatDiscount,
          vatEnabled: vatCfg.enabled,
          vatRate: vatCfg.rate,
          isVatExempt,
          scPwdOrder: vatCfg.scPwdOrder,
          vatInclusive: vatCfg.inclusive,
        });

    totalDiscount = +(totalProductDisc + vatResult.discount).toFixed(2);
    totalVat = vatResult.vatAmount;
    const vatRate = vatResult.rate;
    const finalTotal = vatResult.total;

    const currentYear = new Date().getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${currentYear}`, 'orderNumber');

    // Generate a billing number (monthly-reset: YYYY-MM-XXXX) for every order, both
    // business types.
    let billingNumber = '';
    {
      const now = new Date();
      const billingPrefix = `BIL-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const billingCounter = await Counter.findOneAndUpdate(
        { _id: billingPrefix },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      billingNumber = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${billingCounter.seq.toString().padStart(4, '0')}`;
    }

    // Resolve payment method: client pre-set → body override → default Cash
    const resolvedPaymentMethod = paymentsInput?.length > 0
      ? (paymentsInput.length === 1 ? paymentsInput[0].method : 'Split')
      : (bodyPaymentMethod || clientPresetPayment || 'Cash');

    // ── CREDIT LIMIT GATE ──────────────────────────────────────────────────
    // Only on-account (non-cash) buying consumes credit - a cash sale settles
    // immediately and can never grow the receivable. Checked here, after the
    // total is server-authoritative and before anything is written, so a
    // rejected order leaves no partial state behind.
    const creditClientId = _buyerClientId;
    if (creditClientId && resolvedPaymentMethod !== 'Cash' && !isComplimentary && finalTotal > 0) {
      const [modeRow, globalRow, client] = await Promise.all([
        Settings.findOne({ key: 'creditLimitMode' }).lean(),
        Settings.findOne({ key: 'globalCreditLimit' }).lean(),
        ClientAccount.findById(creditClientId).lean(),
      ]);
      const limit = resolveCreditLimit({
        mode: modeRow?.value,
        globalLimit: globalRow?.value,
        clientLimit: client?.creditLimit,
      });
      if (limit !== null) {
        // Outstanding = everything already sold to them on account and not yet
        // settled. Mirrors the A/R report's definition exactly.
        // Match BOTH identity fields: a portal order carries `clientId`, while an
        // order a cashier placed on the client's behalf carries `clientAccountId`.
        // Checking only one lets a client run up unlimited debt via the other route.
        //
        // Statuses: exposure is everything COMMITTED, not just what has already
        // become a book receivable. Orders sit at Pending/Preparing for a while,
        // and counting only 'Completed' would let a client place ten orders in a
        // row before any of them lands - trivially defeating the limit. Only
        // terminal non-debts (Cancelled/Voided/Refunded) and parked drafts are
        // excluded.
        const openRows = await Order.find({
          businessType: BUSINESS_TYPE,
          $or: [
            { clientAccountId: String(creditClientId) },
            { clientId: String(creditClientId) },
          ],
          status: { $nin: ['Cancelled', 'Voided', 'Refunded', 'Parked'] },
          isParked: { $ne: true },
          paymentMethod: { $ne: 'Cash' },
          isComplimentary: { $ne: true },
          arSettled: { $ne: true },
        }, { total: 1 }).lean();
        const outstanding = openRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const check = checkCreditAvailable({ limit, outstanding, orderTotal: finalTotal });
        if (!check.allowed) {
          return res.status(409).json({
            success: false,
            error: `Credit limit reached. Limit ₱${check.limit.toFixed(2)}, already owing ₱${check.outstanding.toFixed(2)}, available ₱${check.available.toFixed(2)}.`,
            creditLimit: check,
          });
        }
      }
    }

    const newOrder = await Order.create({
      orderNumber, table, items: validatedItems,
      subtotal: totalGross,
      vatRate: vatRate,
      vatAmount: totalVat,
      vatableSales: vatResult.vatableSales,
      vatExemptSales: vatResult.vatExemptSales,
      // Stamped so this receipt can always be re-derived, even after the setting changes.
      scPwdOrder: vatCfg.scPwdOrder,
      isVatInclusive: vatCfg.inclusive,
      discountPercent: isComplimentary ? 0 : discountPercent,
      discount: totalDiscount,
      total: finalTotal,
      isVatExempt, discountType, customerName,
      isComplimentary, employeeName, cashier,
      placedByClient: isClientOrder,
      ...(onBehalfClientId ? { clientAccountId: onBehalfClientId } : {}),
      // Reserve mode: items committed, no payment yet, status = Reserved.
      // Cashier later promotes Reserved → Pending (pay later) or Preparing (pay now)
      // via the existing PUT /api/orders/:id status transition.
      ...(reserveOnly && !isComplimentary ? { status: 'Reserved' } : {}),
      transactionType: isComplimentary ? 'COMPLIMENTARY' : 'NORMAL',
      orderNotes: (orderNotes || '').trim().slice(0, 300),
      guestCount: Math.max(1, parseInt(guestCount) || 1),
      paymentMethod: resolvedPaymentMethod,
      ...(termsOfPayment && { termsOfPayment }),
      ...(billingNumber && { billingNumber }),
      ...(isClientOrder && { clientId: req.user._id || req.user.clientId || '', clientUsername: req.user.username || '' }),
      ...(idempotencyKey && { idempotencyKey }),
      ...(paymentsInput?.length > 0 && { payments: paymentsInput }),
    });

    emitToOps('newOrder', newOrder);
    res.json({ success: true, order: newOrder });
  } catch (error) {
    // The findOne check above has a TOCTOU window - two truly concurrent
    // requests carrying the same Idempotency-Key can both pass it before
    // either create() finishes. idempotencyKey's unique index (see server.js)
    // turns the loser into an E11000 here instead of a duplicate order;
    // resolve it the same way the findOne check would have.
    if (error?.code === 11000 && error?.keyPattern?.idempotencyKey && idempotencyKey) {
      const existingOrder = await Order.findOne({ idempotencyKey });
      if (existingOrder) return res.status(200).json({ success: true, order: existingOrder, message: "Duplicate prevented." });
    }
    console.error("Order Creation Error:", error);
    captureError(req, error);
    res.status(500).json({ success: false, error: 'Order failed' });
  }
});

// --- COMPLIMENTARY: APPLY ---
app.put('/api/orders/:id/complimentary', verifyToken, requireStaff, async (req, res) => {
  try {
    const { reasonType, reasonNote, approvedBy, forEmployee } = req.body;
    if (!reasonType) return res.status(400).json({ success: false, error: 'reasonType is required' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'Completed') return res.status(400).json({ success: false, error: 'Completed orders cannot be marked complimentary' });

    const year = new Date().getFullYear();
    const compCount = await Order.countDocuments({ isComplimentary: true, businessType: BUSINESS_TYPE, ...tenantScope(req) });
    const refNum = `COMP-${year}-${(compCount + 1).toString().padStart(4, '0')}`;

    order.isComplimentary = true;
    order.transactionType = 'COMPLIMENTARY';
    order.complimentaryReasonType = reasonType;
    order.complimentaryReasonNote = reasonNote || '';
    order.complimentaryApprovedBy = approvedBy || 'Manager';
    order.complimentaryApprovedAt = new Date();
    order.complimentaryAmount = order.subtotal;
    order.complimentaryReferenceNumber = refNum;
    order.employeeName = forEmployee || approvedBy || '';
    order.discountPercent = 0;
    order.discount = order.subtotal;
    order.total = 0;
    order.discountType = 'Complimentary';
    order.paymentMethod = 'Complimentary';

    await order.save();
    emitToOps('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- COMPLIMENTARY: REMOVE ---
app.delete('/api/orders/:id/complimentary', verifyToken, requireStaff, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'Completed') return res.status(400).json({ success: false, error: 'Cannot reverse a completed complimentary order; void it instead' });

    order.isComplimentary = false;
    order.transactionType = 'NORMAL';
    order.complimentaryReasonType = null;
    order.complimentaryReasonNote = '';
    order.complimentaryApprovedBy = '';
    order.complimentaryApprovedAt = null;
    order.complimentaryAmount = 0;
    order.complimentaryReferenceNumber = '';
    order.employeeName = '';
    order.discountPercent = 0;
    order.discount = 0;
    order.total = order.subtotal;
    order.paymentMethod = 'Cash';

    await order.save();
    emitToOps('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.put('/api/orders/:id', verifyToken, requireStaff, async (req, res) => {
  await runWithStatsRetry(completeOrderOnce, req, res);
});

// Retry wrapper (mirrors the void engine's own retry, below): the ERP block in
// here writes TenantStats/ProductStats - a singleton counter doc every
// concurrent completion touches - inside the same transaction as the stock
// decrement + journal entry. Two completions landing at the same instant can
// collide on that doc with a WriteConflict; retrying the whole transaction is
// the correct fix, the same trade void/refund already make elsewhere in this
// file. Validation paths `return res.status(...)`, a truthy Response object -
// only the explicit `true` retry signal from the catch block counts.
const completeOrderOnce = async (req, res, mayRetry) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { status, discountPercent, isVatExempt, paymentMethod, discountType, discountedIndices, items, amountTendered } = req.body;
    
    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false });
    }

    // Freeze previousStatus to prevent the 500 Internal Server Crash
    const previousStatus = order.status;
    const wasNotCompleted = previousStatus !== 'Completed';

    // Immutability guard: completed orders are locked; use the void workflow
    if (previousStatus === 'Completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, error: 'Completed orders are immutable. Use the void workflow for cancellations.' });
    }

    if (status) {
      order.status = status;
      // Attribution: when an order moves to Cancelled, stamp who did it from
      // the verified JWT so reports don't blame the original cashier (which
      // for a client-portal order is the client's username).
      if (status === 'Cancelled' && previousStatus !== 'Cancelled') {
        order.cancelledBy = req.user?.name || 'system';
        order.cancelledAt = new Date();
        await logAudit(req, { action: 'cancel', entity: 'Order', entityId: order._id, after: { orderNumber: order.orderNumber, cancelledBy: order.cancelledBy } });
      }
    }
    if (paymentMethod && !order.isComplimentary) order.paymentMethod = paymentMethod;

    // Allow the Kitchen/Bar to update specific item statuses safely
    // Allow the Kitchen/Bar to update specific item statuses safely
    if (items) {
      items.forEach((incomingItem, index) => {
        if (order.items[index]) {
          if (incomingItem.itemStatus !== undefined) order.items[index].itemStatus = incomingItem.itemStatus;
          if (incomingItem.selectedAddOns !== undefined) order.items[index].selectedAddOns = incomingItem.selectedAddOns; 
          // NEW: Listen for the isolated discount from the frontend!
          if (incomingItem.discountPercent !== undefined) order.items[index].discountPercent = incomingItem.discountPercent; 
        }
      });
      order.markModified('items');
    }

    if (discountPercent !== undefined) order.discountPercent = discountPercent;
    if (isVatExempt !== undefined) order.isVatExempt = isVatExempt;
    if (discountType !== undefined) order.discountType = discountType;

    // Stamp WHO applied the discount with the logged-in user (not the order's
    // original cashier, which may be 'System' for QR/customer-created orders).
    if ((discountPercent !== undefined && discountPercent > 0) ||
        (Array.isArray(discountedIndices) && discountedIndices.length > 0)) {
      if (req.user?.name) order.discountBy = req.user.name;
    }

    if (order.isComplimentary) {
        order.discountType = 'Complimentary';
    } else if (order.discountPercent > 0 && (!order.discountType || order.discountType === 'None')) {
        order.discountType = order.isVatExempt ? 'SC/PWD' : 'Promo';
    } else if (order.discountPercent === 0) {
        order.discountType = 'None';
    }

    if (discountedIndices !== undefined) {
      order.items.forEach((item, idx) => {
        item.hasDiscount = discountedIndices.includes(idx);
      });
      order.markModified('items'); 
    }

    // --- BULLETPROOF MATH RECALCULATION ---
    let totalGross = 0;
    let lineDiscTotal = 0;
    let baseAfterLineDisc = 0;
    let discountableBase = 0;
    let exemptBase = 0;

    order.items.forEach(item => {
      const price = item.price || 0;
      const qty = item.quantity || 1;
      const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
      const itemBase = (price + addOnTotal) * qty;

      totalGross += itemBase;
      const getsDiscount = item.hasDiscount !== false;
      // Effective per-line discount: MAX of the server-resolved per-product /
      // per-client discount (productDiscountPercent, set at order create) and
      // the cashier per-item override (discountPercent). The MAX guarantees a
      // status change can never silently strip a buyer's negotiated rate.
      const prodPct = Number(item.productDiscountPercent || 0);
      const cashierPct = Number(item.discountPercent || 0);
      const linePct = Math.max(prodPct, cashierPct);
      const lineDisc = +(itemBase * linePct / 100).toFixed(2);

      lineDiscTotal += lineDisc;
      baseAfterLineDisc += itemBase - lineDisc;
      if (item.vatExempt === true) exemptBase += itemBase - lineDisc;
      // A line already carrying its own discount, or one the cashier excluded,
      // is not eligible for the order-wide percentage on top.
      if (linePct === 0 && getsDiscount) discountableBase += itemBase;
    });

    // Rate and SC/PWD basis come from the ORDER, not from current settings -
    // editing a historical order must not re-price it under a rule that was
    // adopted afterwards.
    const editVat = order.isComplimentary
      ? { total: 0, vatAmount: 0, vatableSales: 0, vatExemptSales: 0,
          discount: +baseAfterLineDisc.toFixed(2), rate: Number(order.vatRate || 0) }
      : computeOrderVat({
          grossInclusive: baseAfterLineDisc,
          discountableGross: discountableBase,
          exemptGross: exemptBase,
          discountPercent: Number(order.discountPercent || 0),
          vatEnabled: Number(order.vatRate || 0) > 0,
          vatRate: Number(order.vatRate || 0),
          isVatExempt: !!order.isVatExempt,
          scPwdOrder: order.scPwdOrder === 'discount-first' ? 'discount-first' : 'vat-first',
          vatInclusive: order.isVatInclusive !== false,
        });

    order.subtotal = Number(totalGross.toFixed(2));
    order.discount = Number((lineDiscTotal + editVat.discount).toFixed(2));
    order.vatAmount = Number(editVat.vatAmount.toFixed(2));
    order.vatableSales = Number(editVat.vatableSales.toFixed(2));
    order.vatExemptSales = Number(editVat.vatExemptSales.toFixed(2));
    order.total = Number(editVat.total.toFixed(2));

    // Cash tendered - only for cash orders transitioning to Preparing
    if (status === 'Preparing' && amountTendered !== undefined && (order.paymentMethod === 'Cash' || paymentMethod === 'Cash')) {
      const tendered = Number(amountTendered);
      if (tendered < order.total) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: `Insufficient cash: tendered ₱${tendered.toFixed(2)} but total is ₱${order.total.toFixed(2)}` });
      }
      order.amountTendered = tendered;
      order.changeDue = Number((tendered - order.total).toFixed(2));
    }

    const validation = validateOrderMath(order);
    if (!validation.valid) {
      await session.abortTransaction();
      session.endSession();
      console.error(`[VALIDATION FAILED] Order ${order.orderNumber}: ${validation.error}`);
      return res.status(400).json({ success: false, error: `SYSTEM AUDIT REJECTED: ${validation.error}` });
    }

    // --- POS GUARDRAIL: CHECK IF EOD IS LOCKED ---
    if (status === 'Completed' && wasNotCompleted) {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const currentEOD = await EODRecord.findOne({ dateString: todayStr }).session(session);
      
      if (currentEOD && currentEOD.status === 'LOCKED') {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ success: false, error: 'REGISTER CLOSED: EOD is locked.' });
      }
    }

    // Orders fulfilled in batches are posted by the partial-fulfill endpoint
    // (inventory, COGS and revenue per round). Skip the standard engine so the
    // sale isn't double-counted if such an order is completed via this route.
    const wasPartiallyFulfilled = (order.items || []).some(it => (it.fulfilledQty || 0) > 0);

    // --- THE STRICT ERP ENGINE ---
    if (status === 'Completed' && wasNotCompleted && !wasPartiallyFulfilled) {
      log.info(`\n[ERP ENGINE] Processing Order: ${order.orderNumber}...`);
      let totalCogs = 0;
      const stockCardBatch = [];
      const depletedInvIds = new Set(); // track inventory items that hit 0 for auto-unavailable

      // BULK PRE-FETCH all products for this order in 2 queries (fix N+1)
      const itemProductIds = order.items.map(i => i.productId).filter(Boolean);
      const itemBaseNames  = order.items.filter(i => !i.productId).map(i => i.name.replace(/\s*\(.*?\)\s*/g, '').trim());
      const [productsById, productsByName] = await Promise.all([
        itemProductIds.length ? Product.find({ _id:  { $in: itemProductIds } }).populate('modifierGroups').session(session) : [],
        itemBaseNames.length  ? Product.find({ name: { $in: itemBaseNames  } }).populate('modifierGroups').session(session) : []
      ]);
      const productMap = new Map();
      productsById.forEach(p => productMap.set(String(p._id), p));
      productsByName.forEach(p => productMap.set(`name:${p.name}`, p));

      for (const item of order.items) {
        if (item.price === undefined || item.quantity === undefined) return { valid: false, error: "Line item missing price or quantity." };

        // COMBO / BUNDLE: deduct each component product's recipe.
        if (item.isCombo && Array.isArray(item.comboItems) && item.comboItems.length) {
          for (const comp of item.comboItems) {
            const compProduct = await Product.findById(comp.productId).session(session);
            if (!compProduct) continue;
            let compRecipe = compProduct.baseRecipe || [];
            if (comp.sizeName) {
              const sz = compProduct.sizes?.find(s => s.name === comp.sizeName);
              if (sz?.recipe?.length) compRecipe = sz.recipe;
            }
            // LOGISTICS 1:1 FALLBACK for combo components: a component product with
            // no recipe is a stocked good linked by code/name. Without this, combos
            // of logistics products deduct nothing and post zero COGS.
            if (!compRecipe.some(r => r.invId)) {
              const linkInv = await resolveLinkedInventory(compProduct, compProduct.productCode, session);
              if (linkInv) {
                const deductQty = (comp.quantity || 1) * item.quantity * baseUnitsPerSale(compProduct, linkInv);
                const updated = await Inventory.findOneAndUpdate(
                  { _id: linkInv._id, stockQty: { $gte: deductQty } },
                  { $inc: { stockQty: -deductQty } },
                  { session, returnDocument: 'after' }
                );
                if (!updated) {
                  await session.abortTransaction(); session.endSession();
                  return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK for combo "${item.name}": [${linkInv.itemName}] would drop below zero.` });
                }
                stockCardBatch.push({
                  inventoryId: updated._id, itemName: updated.itemName, type: 'Sale',
                  reference: mkRef('', order.orderNumber), qtyChange: -deductQty, balanceAfter: updated.stockQty,
                  remarks: `Sold via Combo (${item.name} → ${comp.name})`
                });
                totalCogs += (linkInv.unitCost * deductQty);
                if (updated.stockQty <= 0) depletedInvIds.add(String(linkInv._id));
              }
              continue; // component handled via 1:1 fallback
            }
            for (const ing of compRecipe) {
              if (!ing.invId) continue;
              const deductQty = (ing.qty * (comp.quantity || 1) * item.quantity);
              const invItem = await Inventory.findOneAndUpdate(
                { _id: ing.invId, stockQty: { $gte: deductQty } },
                { $inc: { stockQty: -deductQty } },
                { session, returnDocument: 'after' }
              );
              if (!invItem) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK for combo "${item.name}": [${ing.name || ing.invId}] would drop below zero.` });
              }
              if (invItem.expiryBatches?.length > 0) {
                const r = consumeBatches(invItem.expiryBatches, deductQty);
                invItem.expiryBatches = r.batches; invItem.expiryDate = soonestExpiry(r.batches);
                await invItem.save({ session });
              }
              stockCardBatch.push({
                inventoryId: invItem._id, itemName: invItem.itemName, type: 'Sale',
                reference: mkRef('', order.orderNumber), qtyChange: -deductQty, balanceAfter: invItem.stockQty,
                remarks: `Sold via Combo (${item.name} → ${comp.name})`
              });
              totalCogs += (invItem.unitCost * deductQty);
              if (invItem.stockQty <= 0) depletedInvIds.add(String(ing.invId));
            }
          }
          continue; // combo fully handled
        }

        let product = null;
        if (item.productId) {
          product = productMap.get(String(item.productId));
        } else {
          const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim();
          product = productMap.get(`name:${baseName}`);
        }

        if (!product) continue;

        let recipeToUse = product.baseRecipe || [];
        const sizeMatch = item.name.match(/\(([^)]+)\)$/);
        if (sizeMatch) {
          const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
          if (sizeObj && sizeObj.recipe?.length > 0) recipeToUse = sizeObj.recipe;
        }

        // LOGISTICS 1:1 FALLBACK - product has no recipe: treat it as a stocked
        // good linked by code/name. Deduct (qty × unitMultiplier) base units and
        // book COGS at unitCost. Skips cleanly if no matching inventory exists.
        if (!recipeToUse.some(r => r.invId)) {
          const linkInv = await resolveLinkedInventory(product, item.productCode, session);
          if (linkInv) {
            const deductQty = item.quantity * baseUnitsPerSale(product, linkInv);
            const updated = await Inventory.findOneAndUpdate(
              { _id: linkInv._id, stockQty: { $gte: deductQty } },
              { $inc: { stockQty: -deductQty } },
              { session, returnDocument: 'after' }
            );
            if (!updated) {
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Cannot fulfill order. [${linkInv.itemName}] would drop below zero. Please receive stock in the Procurement tab first.` });
            }
            stockCardBatch.push({
              inventoryId: updated._id, itemName: updated.itemName, type: 'Sale',
              reference: mkRef('', order.orderNumber), qtyChange: -deductQty, balanceAfter: updated.stockQty,
              remarks: `Sold (${item.name})`
            });
            totalCogs += (linkInv.unitCost * deductQty);
            if (updated.stockQty <= 0) depletedInvIds.add(String(updated._id));
          }
        }

        for (const ing of recipeToUse) {
          if (!ing.invId) continue;
          const deductQty = (ing.qty * item.quantity);
          const invItem = await Inventory.findOneAndUpdate(
            { _id: ing.invId, stockQty: { $gte: deductQty } },
            { $inc: { stockQty: -deductQty } },
            { session, returnDocument: 'after' }
          );
          if (invItem && invItem.expiryBatches && invItem.expiryBatches.length > 0) {
            // FEFO-consume from batches (audit info; stockQty is source of truth)
            const r = consumeBatches(invItem.expiryBatches, deductQty);
            invItem.expiryBatches = r.batches;
            invItem.expiryDate = soonestExpiry(r.batches);
            await invItem.save({ session });
          }
          if (!invItem) {
            const missing = await Inventory.findById(ing.invId).lean();
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Cannot fulfill order. [${missing?.itemName || ing.name}] would drop below zero. Please receive stock in the Procurement tab first.` });
          }
          stockCardBatch.push({
            inventoryId: invItem._id,
            itemName: invItem.itemName,
            type: 'Sale',
            reference: mkRef('', order.orderNumber),
            qtyChange: -deductQty,
            balanceAfter: invItem.stockQty,
            remarks: `Sold via ${item.name}`
          });
          totalCogs += (invItem.unitCost * deductQty);
          if (invItem.stockQty <= 0) depletedInvIds.add(String(ing.invId));
        }
        // DEDUCT ADD-ONS + MODIFIER-OPTION INVENTORY
        for (const selectedAddOn of (item.selectedAddOns || [])) {
          // Resolve the recipe from either a product add-on OR a modifier-group option.
          // Modifier selections are stored as "Group name: Option name".
          let resolvedRecipe = product.addOns?.find(a => a.name === selectedAddOn.name)?.recipe;
          if (!resolvedRecipe && selectedAddOn.name.includes(': ')) {
            const [grpName, optName] = selectedAddOn.name.split(': ');
            const grp = (product.modifierGroups || []).find(g => g && g.name === grpName);
            resolvedRecipe = grp?.options?.find(o => o.name === optName)?.recipe;
          }
          if (resolvedRecipe && resolvedRecipe.length) {
            for (const ing of resolvedRecipe) {
              if (!ing.invId) continue;
              const deductQty = (ing.qty * item.quantity);
              const invItem = await Inventory.findOneAndUpdate(
                { _id: ing.invId, stockQty: { $gte: deductQty } },
                { $inc: { stockQty: -deductQty } },
                { session, returnDocument: 'after' }
              );
              if (invItem && invItem.expiryBatches && invItem.expiryBatches.length > 0) {
                const r = consumeBatches(invItem.expiryBatches, deductQty);
                invItem.expiryBatches = r.batches;
                invItem.expiryDate = soonestExpiry(r.batches);
                await invItem.save({ session });
              }
              if (!invItem) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Add-on [${ing.name || ing.invId}] drops below zero.` });
              }
              stockCardBatch.push({
                inventoryId: invItem._id, itemName: invItem.itemName, type: 'Sale',
                reference: mkRef('', order.orderNumber), qtyChange: -deductQty, balanceAfter: invItem.stockQty,
                remarks: `Sold via Add-on (${selectedAddOn.name})`
              });
              totalCogs += (invItem.unitCost * deductQty);
              if (invItem.stockQty <= 0) depletedInvIds.add(String(ing.invId));
            }
          }
        }
      }

      // Auto-mark products unavailable when a required ingredient hits zero stock
      if (depletedInvIds.size > 0) {
        const ids = [...depletedInvIds];
        await Product.updateMany(
          {
            isAvailable: true,
            $or: [
              { 'baseRecipe.invId': { $in: ids } },
              { 'sizes.recipe.invId': { $in: ids } },
              { 'addOns.recipe.invId': { $in: ids } },
            ],
          },
          { $set: { isAvailable: false } }
        );
        emitToAll('menuUpdated');
        log.info({ depletedInvIds: ids }, 'Auto-marked products unavailable due to depleted stock');
      }

      // Batch-insert all stock card entries in one round-trip
      if (stockCardBatch.length > 0) {
        await StockCard.insertMany(stockCardBatch, { session });
      }

      const reference = mkRef('', order.orderNumber);
      const lines = [];

      if (order.isComplimentary) {
        // DR 5300 Complimentary Expense / CR 4000 Sales Revenue at selling price (keeps gross visible)
        const sellingPrice = order.subtotal || 0;
        if (sellingPrice > 0) {
          lines.push({ accountCode: '540000', accountName: 'Complimentary Expense', debit: sellingPrice, credit: 0 });
          lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: sellingPrice });
        }
        // DR 5000 COGS / CR 1500 Inventory at cost
        if (totalCogs > 0) {
          lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
        }
        order.complimentaryCost = totalCogs;
      } else {
        // Split-payment: one debit line per payment; single-payment: one line as before
        const payRows = (order.payments?.length > 0)
          ? order.payments
          : [{ method: order.paymentMethod || 'Cash', amount: order.total }];
        for (const p of payRows) {
          const acct = debitAccountFor(p.method);
          lines.push({ accountCode: acct.code, accountName: acct.name, debit: p.amount, credit: 0 });
        }
        lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: order.discount || 0, credit: 0 });

        // Non-VAT: gross receipts = net collected + discount (no VAT separation)
        const grossSalesAmount = order.total + (order.discount || 0);
        lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: grossSalesAmount });

        if (totalCogs > 0) {
          lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
        }
      }

      const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Journal imbalance on ${reference}: DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)}`);
      }

      await JournalEntry.create([{
        reference,
        description: order.isComplimentary
          ? `COMP [${order.complimentaryReasonType || 'UNKNOWN'}] For: ${order.employeeName || '-'} | By: ${order.complimentaryApprovedBy || '-'} | Ref: ${order.complimentaryReferenceNumber || order.orderNumber}`
          : `Sales & COGS for Order ${order.orderNumber}`,
        lines, 
        totalDebit, 
        totalCredit 
      }], { session });

      log.info(`[ERP LEDGER] Single AUTO Entry ${reference} created.`);
      emitToMgr('erpUpdated');

      await applyStatsDelta(order, 1, session);

      // Snapshot the client's payment terms onto this receivable at the moment it
      // Completes, so a later change to the client's default terms never moves an
      // existing A/R's due date. Cash and complimentary orders carry no receivable.
      if (!order.isComplimentary && order.paymentMethod !== 'Cash' && order.arDueDate == null) {
        let termsDays = order.arTermsDays;
        if (termsDays == null && order.clientAccountId) {
          const cli = await ClientAccount.findById(order.clientAccountId).select('creditTermsDays').session(session).lean();
          if (cli && cli.creditTermsDays != null) termsDays = cli.creditTermsDays;
        }
        if (termsDays != null) {
          order.arTermsDays = termsDays;
          order.arDueDate = new Date(Date.now() + termsDays * 86400000);
        }
      }
    }

    // FIX: Removed the array brackets and {session} to prevent Mongoose crash
    if (status && status !== previousStatus) {
      await AuditLog.create({
        userId: req.user ? req.user.name : 'System',
        action: `ORDER_${status.toUpperCase()}`,
        targetReference: order.orderNumber,
        details: { previousStatus, newStatus: status, total: order.total, method: paymentMethod }
      });
    }

    await order.save({ session }); 
    await session.commitTransaction();
    session.endSession();

    emitToOps('orderUpdated', order);
    // Push menuUpdated so CustomerMenu instantly re-fetches products and recomputes
    // stockAvailable - catches the moment an ingredient hits zero during service.
    if (status === 'Completed') emitToAll('menuUpdated');
    res.json({ success: true, order });
    if (status === 'Completed' && wasNotCompleted) maybePromoteWalkInClient(order);

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (isTransientTxnError(error) && mayRetry && !res.headersSent) return true; // ask the caller to retry
    console.error("[ERP CRITICAL ERROR] Failed to process order:", error);
    captureError(req, error);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
  return false;
};

// --- UNVOID (reverse a void) ---
// A void is never erased - it is REVERSED, which is also the correct accounting
// treatment: the original void entry stays in the ledger and a mirrored entry
// cancels it, so the audit trail shows both events.
//
// Rather than recompute recipes (which could drift if a product's BOM changed
// since the void), this mirrors the void's OWN trail: its journal entry is
// re-posted with debits and credits swapped, and each stock-card row it wrote is
// inverted. That guarantees the reversal is exactly equal and opposite.
app.post('/api/orders/:id/unvoid', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const adminName = req.user.name;
    const out = await withOptionalTransaction(mongoose, async (session) => {
      const order = await Order.findById(req.params.id).session(session ?? null);
      if (!order) throw Object.assign(new Error('Order not found'), { httpStatus: 404 });
      if (order.status !== 'Voided') {
        throw Object.assign(new Error('Only a voided order can be un-voided.'), { httpStatus: 400 });
      }
      // Refunds use the same status but a different flow; reversing one here
      // would leave the refund's cash movement stranded.
      if (String(order.voidReason || '').startsWith('REFUND:')) {
        throw Object.assign(new Error('Refunds cannot be un-voided. Re-enter the sale instead.'), { httpStatus: 400 });
      }

      // Same day-close and period guards the void itself respects.
      const orderDateStr = new Date(order.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const eodRecord = await EODRecord.findOne({ dateString: orderDateStr }).session(session ?? null);
      if (eodRecord?.status === 'LOCKED') {
        throw Object.assign(new Error(`EOD locked for ${orderDateStr}. Cannot un-void after the day is closed.`), { httpStatus: 403 });
      }
      const lock = await periodLockFor(order.createdAt);
      if (lock) {
        throw Object.assign(new Error(`Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed. Reopen it first.`), { httpStatus: 423 });
      }

      const voidRef = mkRef('VOID', order.orderNumber);
      const unvoidRef = mkRef('UNVOID', order.orderNumber);

      // Guard against a double un-void producing a second reversal.
      const already = await JournalEntry.findOne({ reference: unvoidRef }).session(session ?? null);
      if (already) throw Object.assign(new Error('This void has already been reversed.'), { httpStatus: 409 });

      // 1. Mirror the void's journal entry (swap debit/credit).
      const voidEntry = await JournalEntry.findOne({ reference: voidRef }).session(session ?? null);
      if (voidEntry) {
        const lines = voidEntry.lines.map(l => ({
          accountCode: l.accountCode, accountName: l.accountName,
          debit: l.credit || 0, credit: l.debit || 0,
        }));
        assertBalanced(lines, unvoidRef);
        await JournalEntry.create([{
          reference: unvoidRef,
          description: `UNVOID of ${voidRef} by ${adminName}`,
          lines,
          totalDebit: voidEntry.totalCredit,
          totalCredit: voidEntry.totalDebit,
        }], { session });
      }

      // 2. Re-deduct the stock the void restored, inverting each card it wrote.
      const voidCards = await StockCard.find({ reference: voidRef }).session(session ?? null);
      for (const card of voidCards) {
        const inv = await Inventory.findById(card.inventoryId).session(session ?? null);
        if (!inv) continue;
        const qty = Number(card.qtyChange) || 0;   // positive when the void restored stock
        if (qty === 0) continue;
        inv.stockQty = +(inv.stockQty - qty).toFixed(6);
        await inv.save({ session });
        await StockCard.create([{
          inventoryId: inv._id, itemName: inv.itemName, type: 'Adjustment',
          reference: unvoidRef, qtyChange: -qty, balanceAfter: inv.stockQty,
          unitCost: inv.unitCost, remarks: `Un-voided order ${order.orderNumber}`,
        }], { session });
      }

      // 3. Restore the order.
      order.status = 'Completed';
      order.voidReason = '';
      order.voidedBy = '';
      order.voidedAt = null;
      // Mirror image of the void's own -1 delta - the order is back to counting
      // toward dashboard totals.
      await applyStatsDelta(order, 1, session);
      await order.save({ session });
      return order;
    // Same retry budget/backoff as the other 5 applyStatsDelta call sites
    // (complete/void/partial-fulfill/drop-remaining/refund) - unvoid writes to
    // the same hot sharded TenantStats/ProductStats documents and was seeing
    // it exhaust withOptionalTransaction's default 3-immediate-retry budget
    // under the same contention the others were hardened against.
    }, { log, retries: STATS_RETRY_ATTEMPTS, retryDelayMs: statsRetryDelayMs });

    await logAudit(req, { action: 'unvoid', entity: 'Order', entityId: out._id, after: { orderNumber: out.orderNumber, by: adminName } });
    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', out);
    res.json({ success: true, order: out });
  } catch (err) {
    if (err?.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- 🚨 SAFE VOID & REFUND ENGINE 🚨 ---
// Retry wrapper: two transactions touching the same order/inventory documents can
// collide with a WriteConflict, which previously surfaced to the operator as a
// bare 500 on a VOID - a money action they then had to guess about. Mirrors the
// retry the restock route already does. Only retried when nothing has been sent
// yet, so a validation response is never re-sent.
app.post('/api/orders/:id/void', verifyToken, requireSuperAdmin, async (req, res) => {
  await runWithStatsRetry(voidOrderOnce, req, res);
});

const voidOrderOnce = async (req, res, mayRetry) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reason } = req.body; // 'Restock' or 'Spoilage'
    // Extract admin name securely from the JWT token, NOT the request body
    const adminName = req.user.name; 
    
    const order = await Order.findById(req.params.id).session(session);
    
    if (!order) {
        await session.abortTransaction(); session.endSession();
        return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (order.status !== 'Completed') {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: 'Only completed orders can be voided.' });
    }

    const orderDateStr = new Date(order.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const eodRecord = await EODRecord.findOne({ dateString: orderDateStr }).session(session);
    if (eodRecord?.status === 'LOCKED') {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({ success: false, error: `EOD locked for ${orderDateStr}. Cannot void after day is closed.` });
    }

    // Reject voids on already-settled A/R orders - would orphan a paired entry.
    // Operator must reverse the settlement manually first (or use full refund flow).
    if (order.arSettled) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, error: 'Cannot void an A/R-settled order. Reverse the settlement first or contact superadmin.' });
    }

    // Route the credit to the same cash/AR account the original entry debited.
    const _cashAcct = debitAccountFor(order.paymentMethod);
    const cashAccount = _cashAcct.code;
    const cashAccountName = _cashAcct.name;

    const lines = [];
    // Non-VAT: gross receipts = net collected + discount (no VAT separation)
    const grossSalesAmount = order.total + (order.discount || 0);

    if (!order.isComplimentary) {
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: grossSalesAmount, credit: 0 });
      lines.push({ accountCode: cashAccount, accountName: cashAccountName, debit: 0, credit: order.total });
      if (order.discount > 0) lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: 0, credit: order.discount });
    } else {
      // Reverse the complimentary revenue recognition: DR 4000 / CR 5300 at selling price
      const sellingPrice = order.subtotal || 0;
      if (sellingPrice > 0) {
        lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: sellingPrice, credit: 0 });
        lines.push({ accountCode: '540000', accountName: 'Complimentary Expense', debit: 0, credit: sellingPrice });
      }
    }

    let totalCogs = 0;
    for (const item of order.items) {
      let product = await Product.findById(item.productId).populate('modifierGroups').session(session);
      if (!product) continue;

      let recipeToUse = product.baseRecipe || [];
      const sizeMatch = item.name.match(/\(([^)]+)\)$/);
      if (sizeMatch) {
        const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
        if (sizeObj && sizeObj.recipe?.length > 0) recipeToUse = sizeObj.recipe;
      }

      // LOGISTICS 1:1 FALLBACK - mirror the sale: reverse the linked stocked good.
      if (!recipeToUse.some(r => r.invId)) {
        const linkInv = await resolveLinkedInventory(product, item.productCode, session);
        if (linkInv) {
          const qtyUsed = item.quantity * baseUnitsPerSale(product, linkInv);
          if (reason === 'Restock') {
            const restored = await Inventory.findOneAndUpdate(
              { _id: linkInv._id }, { $inc: { stockQty: qtyUsed } }, { session, returnDocument: 'after' }
            );
            if (restored) {
              totalCogs += (restored.unitCost * qtyUsed);
              await StockCard.create([{
                inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
                reference: mkRef('VOID', order.orderNumber), qtyChange: qtyUsed, balanceAfter: restored.stockQty, remarks: `Voided (${reason})`
              }], { session });
            }
          } else {
            totalCogs += (linkInv.unitCost * qtyUsed);
          }
        }
      }

      for (const ing of recipeToUse) {
        if (!ing.invId) continue;
        const qtyUsed = ing.qty * item.quantity;

        if (reason === 'Restock') {
          const restored = await Inventory.findOneAndUpdate(
            { _id: ing.invId },
            { $inc: { stockQty: qtyUsed } },
            { session, returnDocument: 'after' }
          );
          if (!restored) continue;
          totalCogs += (restored.unitCost * qtyUsed);
          await StockCard.create([{
            inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
            reference: mkRef('VOID', order.orderNumber), qtyChange: qtyUsed, balanceAfter: restored.stockQty, remarks: `Voided (${reason})`
          }], { session });
        } else {
          const invItem = await Inventory.findById(ing.invId).session(session);
          if (invItem) totalCogs += (invItem.unitCost * qtyUsed);
        }
      }

      for (const selectedAddOn of (item.selectedAddOns || [])) {
        // Resolve recipe from product add-on OR modifier-group option (symmetric with sale deduction)
        let resolvedRecipe = product.addOns?.find(a => a.name === selectedAddOn.name)?.recipe;
        if (!resolvedRecipe && selectedAddOn.name.includes(': ')) {
          const [grpName, optName] = selectedAddOn.name.split(': ');
          const grp = (product.modifierGroups || []).find(g => g && g.name === grpName);
          resolvedRecipe = grp?.options?.find(o => o.name === optName)?.recipe;
        }
        if (!resolvedRecipe?.length) continue;
        for (const ing of resolvedRecipe) {
          if (!ing.invId) continue;
          const qtyUsed = ing.qty * item.quantity;
          if (reason === 'Restock') {
            const restored = await Inventory.findOneAndUpdate(
              { _id: ing.invId },
              { $inc: { stockQty: qtyUsed } },
              { session, returnDocument: 'after' }
            );
            if (!restored) continue;
            totalCogs += (restored.unitCost * qtyUsed);
            await StockCard.create([{
              inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
              reference: mkRef('VOID', order.orderNumber), qtyChange: qtyUsed, balanceAfter: restored.stockQty,
              remarks: `Voided Add-on (${selectedAddOn.name}) (${reason})`
            }], { session });
          } else {
            const invItem = await Inventory.findById(ing.invId).session(session);
            if (invItem) totalCogs += (invItem.unitCost * qtyUsed);
          }
        }
      }
    }

    if (totalCogs > 0) {
      if (reason === 'Restock') {
        lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: totalCogs, credit: 0 });
        lines.push({
          accountCode: '510000',
          accountName: 'Cost of Goods Sold',
          debit: 0, credit: totalCogs
        });
      } else if (reason === 'Spoilage' && !order.isComplimentary) {
        lines.push({ accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: totalCogs, credit: 0 });
        lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
      }
      // Complimentary + Spoilage: cost already expensed at completion, inventory gone, no reversal
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit > 0 && Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal imbalance on ${mkRef('VOID', order.orderNumber)}: DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)}`);
    }

    // If totalDebit/Credit is 0, it means the item had no BOM and wasn't complimentary. We still log the order status change.
    if (totalDebit > 0) {
        await JournalEntry.create([{ 
        reference: mkRef('VOID', order.orderNumber), 
        description: `VOID (${reason}) by ${adminName}`, 
        lines, totalDebit, totalCredit 
        }], { session });
    }

    // The order stops counting toward dashboard totals the moment it stops
    // being 'Completed' - reverse it with the order's pre-void snapshot
    // (total/subtotal/items are untouched by voiding).
    await applyStatsDelta(order, -1, session);

    order.status = 'Voided';
    order.voidReason = reason;
    // Attribution: stamp who actually voided the order - NOT the original cashier
    // (which for a client-portal order is the client's username, misleading on
    // audit reports). Captured from the verified JWT, not request body.
    order.voidedBy = adminName;
    order.voidedAt = new Date();
    await order.save({ session });
    await logAudit(req, { action: 'void', entity: 'Order', entityId: order._id, after: { orderNumber: order.orderNumber, reason, voidedBy: adminName } });
    
    await session.commitTransaction();
    session.endSession();

    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (isTransientTxnError(error) && mayRetry && !res.headersSent) return true;   // ask the caller to retry
    console.error("Void Error:", error);
    captureError(req, error);
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
  return false;
};

app.post('/api/orders/archive', verifyToken, requireStaff, async (req, res) => {
  try {
    // 1. Force any hanging order to Cancelled - includes Ready (made but never
    //    handed over) and Parked (held unpaid tabs). Parked orders also lose the
    //    isParked flag so they don't linger in the parked list.
    await Order.updateMany(
      { status: { $in: ['Pending', 'Preparing', 'Ready', 'Parked'] }, isArchived: false },
      { $set: { status: 'Cancelled', isParked: false, cancelledBy: req.user?.name || 'EOD Sweep', cancelledAt: new Date() } }
    );

    // 2. Sweep completed/cancelled/voided orders into the archive.
    //    Reserved and Partially Fulfilled stay open - they carry over to the next day.
    await Order.updateMany(
      { isArchived: false, status: { $nin: ['Reserved', 'Partially Fulfilled'] } },
      { $set: { isArchived: true, isParked: false } }
    );

    emitToAll('ordersArchived');
    res.json({ success: true });
  } catch (error) {
    console.error("Archive Error:", error);
    captureError(req, error);
    res.status(500).json({ success: false });
  }
});

// ============================================================
// A/R SETTLEMENT - record delivery-partner payout received
// Used when Grab / Foodpanda / Manual Delivery payouts arrive
// ============================================================
app.post('/api/orders/:id/settle-ar', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { amount, paymentMethod, note } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.paymentMethod === 'Cash')
      return res.status(400).json({ success: false, error: 'Cash sales do not require A/R settlement (already booked to Cash on Hand).' });
    if (order.arSettled) return res.status(400).json({ success: false, error: 'Order already settled.' });
    if (order.status !== 'Completed') return res.status(400).json({ success: false, error: 'Order must be Completed before settlement.' });

    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Settlement amount must be > 0.' });
    if (amt > order.total + 0.01)
      return res.status(400).json({ success: false, error: `Settlement amount exceeds outstanding A/R (₱${order.total.toFixed(2)}).` });

    // Debit-side account from configurable payment-method map.
    const debitAcct = accountForPaymentMethod(paymentMethod);
    if (debitAcct.fallback) {
      // Tender has no COA route - parked in Unassigned Receipts. Alert managers
      // to configure a route in Payment Routing so it lands in the right account.
      emitToMgr('mgrAlert', { kind: 'unmappedTender', method: paymentMethod || '(none)', account: debitAcct.code, ref: order.orderNumber, message: `Payment method "${paymentMethod || '(none)'}" has no account route - settled into Unassigned Receipts. Configure it in Payment Routing.` });
      try { await logAudit(req, { action: 'unmappedTender', entity: 'PaymentMethodMap', entityId: paymentMethod || '(none)', after: { account: debitAcct.code, order: order.orderNumber } }); } catch { /* non-fatal */ }
    }

    const reference = mkRef('ARS', order.orderNumber);

    const lines = [
      { accountCode: debitAcct.code, accountName: debitAcct.name, debit: amt, credit: 0 },
      { accountCode: '120000', accountName: 'Accounts Receivable', debit: 0, credit: amt },
    ];
    assertBalanced(lines, reference);

    await JournalEntry.create({
      reference,
      description: `A/R settlement: ${order.orderNumber} via ${order.paymentMethod}${note ? ` (${note})` : ''}`,
      lines, totalDebit: amt, totalCredit: amt,
    });

    order.arSettled = true;
    order.arSettledAt = new Date();
    order.arSettledAmount = amt;
    order.arSettledMethod = paymentMethod || 'Cash on Hand';
    order.arSettledNote = note || '';
    await order.save();

    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    log.error({ err }, 'A/R settlement failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- PARTIAL DELIVERY ROUTE ---
// Sets status to 'Partially Delivered' without triggering ERP (inventory deduction deferred to Completed)
app.post('/api/orders/:id/partial-delivery', verifyToken, requireStaff, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!['Ready', 'Preparing'].includes(order.status)) {
      return res.status(400).json({ success: false, error: 'Order must be Ready or Preparing to partially deliver.' });
    }
    order.status = 'Partially Delivered';
    await order.save();
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- PARTIAL FULFILLMENT (logistics) - ONE order, fulfilled in batches --------
// Fulfill some units now; the order stays a single sale and moves to
// 'Partially Fulfilled' until every unit is delivered, then 'Completed'.
// `fulfill` = [{ index, qty }] where qty is the units to fulfill THIS round.
// Payment modes (chosen per round):
//   • 'partial' - collect only for the units fulfilled now.
//   • 'full'    - collect the whole remaining goods value now; the not-yet-fulfilled
//                 portion is held as Customer Deposits and recognized as revenue on
//                 later rounds (no new charge then).
app.post('/api/orders/:id/partial-fulfill', verifyToken, requireStaff, async (req, res) => {
  await runWithStatsRetry(partialFulfillOnce, req, res);
});

// Retry wrapper - same reasoning as completeOrderOnce above: the final round
// that fully completes an order writes the singleton TenantStats/ProductStats
// counters inside this transaction, which can collide with another concurrent
// completion on a WriteConflict.
const partialFulfillOnce = async (req, res, mayRetry) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { fulfill, paymentMode, paymentMethod } = req.body;
    const mode = paymentMode === 'full' ? 'full' : 'partial';
    const order = await Order.findById(req.params.id).session(session);
    if (!order) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ success: false, error: 'Order not found.' }); }
    if (order.isComplimentary) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ success: false, error: 'Complimentary orders cannot be partially fulfilled.' }); }
    if (!['Pending', 'Preparing', 'Ready', 'Partially Fulfilled'].includes(order.status)) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ success: false, error: 'Only open orders can be partially fulfilled.' }); }

    // Per-unit gross / discount / net - mirrors the full-completion per-line rules
    // so a partial batch books exactly like the same slice of a normal sale:
    // a per-item promo/client rate or cashier override wins for that line,
    // otherwise the order-level SC/PWD or Promo applies. Net drives cash, gross
    // drives revenue, and the difference posts to Sales Discounts.
    const lineUnit = (it) => {
      const addOnPer = (it.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
      const gross = (it.price || 0) + addOnPer;
      const linePct = Math.max(Number(it.productDiscountPercent || 0), Number(it.discountPercent || 0));
      let disc = 0;
      if (linePct > 0) disc = gross * (linePct / 100);
      else if (it.hasDiscount !== false && (order.discountPercent || 0) > 0) disc = gross * (order.discountPercent / 100);
      return { gross: +gross.toFixed(4), disc: +disc.toFixed(4), net: +(gross - disc).toFixed(4) };
    };

    // Units to fulfill this round per line, clamped to what's still outstanding.
    const wantMap = new Map((fulfill || []).map(f => [Number(f.index), Math.max(0, Number(f.qty) || 0)]));
    const deltas = [];
    let grossValue = 0, discountValue = 0, netValue = 0;
    order.items.forEach((it, i) => {
      const remaining = (it.quantity || 0) - (it.fulfilledQty || 0);
      const want = Math.min(remaining, wantMap.has(i) ? wantMap.get(i) : remaining);
      if (want > 0) {
        const u = lineUnit(it);
        deltas.push({ i, want });
        grossValue += u.gross * want; discountValue += u.disc * want; netValue += u.net * want;
      }
    });
    grossValue = +grossValue.toFixed(2); discountValue = +discountValue.toFixed(2); netValue = +netValue.toFixed(2);
    const deltaValue = netValue; // net cash collectible for this round
    if (deltas.length === 0 || deltaValue <= 0) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ success: false, error: 'Nothing to fulfill this round.' }); }

    // Deduct inventory + COGS for the units fulfilled now. Handles combos (deduct
    // each component's stock) and normal logistics 1:1 lines.
    let totalCogs = 0; const stockCardBatch = [];
    const deductInv = async (invId, qty, label) => {
      const upd = await Inventory.findOneAndUpdate(
        { _id: invId, stockQty: { $gte: qty } },
        { $inc: { stockQty: -qty } },
        { session, returnDocument: 'after' }
      );
      if (!upd) { await session.abortTransaction(); session.endSession(); res.status(400).json({ success: false, error: `INSUFFICIENT STOCK for ${label}.` }); return null; }
      totalCogs += (upd.unitCost || 0) * qty;
      stockCardBatch.push({ inventoryId: upd._id, itemName: upd.itemName, type: 'Sale', reference: mkRef('', order.orderNumber), qtyChange: -qty, balanceAfter: upd.stockQty, remarks: label });
      return upd;
    };
    for (const { i, want } of deltas) {
      const it = order.items[i];
      // COMBO line: deduct each component's stock, scaled by the units fulfilled now.
      if (it.isCombo && Array.isArray(it.comboItems) && it.comboItems.length) {
        for (const comp of it.comboItems) {
          const compProduct = await Product.findById(comp.productId).session(session);
          if (!compProduct) continue;
          let compRecipe = compProduct.baseRecipe || [];
          if (comp.sizeName) { const sz = compProduct.sizes?.find(s => s.name === comp.sizeName); if (sz?.recipe?.length) compRecipe = sz.recipe; }
          if (!compRecipe.some(r => r.invId)) {
            const linkInv = await resolveLinkedInventory(compProduct, compProduct.productCode, session);
            if (linkInv) {
              const deduct = (comp.quantity || 1) * want * baseUnitsPerSale(compProduct, linkInv);
              if (!(await deductInv(linkInv._id, deduct, `Partial fulfillment combo (${it.name} → ${comp.name})`))) return;
            }
            continue;
          }
          for (const ing of compRecipe) {
            if (!ing.invId) continue;
            const deduct = ing.qty * (comp.quantity || 1) * want;
            if (!(await deductInv(ing.invId, deduct, `Partial fulfillment combo (${it.name} → ${comp.name})`))) return;
          }
        }
        continue;
      }
      // NORMAL line: logistics 1:1 link.
      const product = it.productId
        ? await Product.findById(it.productId).session(session)
        : await Product.findOne({ name: it.name }).session(session);
      const linkInv = await resolveLinkedInventory(product, it.productCode, session);
      if (!linkInv) continue;
      const deduct = want * baseUnitsPerSale(product, linkInv);
      if (!(await deductInv(linkInv._id, deduct, `Partial fulfillment (${it.name})`))) return;
    }
    if (stockCardBatch.length) await StockCard.insertMany(stockCardBatch, { session });

    const goodsTotal = +order.items.reduce((s, it) => s + lineUnit(it).net * (it.quantity || 0), 0).toFixed(2);
    const cash = debitAccountFor(paymentMethod || order.paymentMethod || 'Cash');
    const lines = [];

    // 1) Recognize revenue already prepaid (from the deposit) first.
    const fromDeposit = +Math.min(order.depositRemaining || 0, deltaValue).toFixed(2);
    if (fromDeposit > 0) {
      lines.push({ accountCode: '260000', accountName: 'Customer Deposits', debit: fromDeposit, credit: 0 });
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: fromDeposit });
      order.depositRemaining = +(order.depositRemaining - fromDeposit).toFixed(2);
    }

    // 2) Collect cash for the rest. In 'full' mode, take the entire remaining
    //    unpaid goods value now and park the not-yet-earned part as a deposit.
    const needRevenue = +(deltaValue - fromDeposit).toFixed(2);
    if (needRevenue > 0.005) {
      const remainingUnpaid = +(goodsTotal - (order.amountPaid || 0)).toFixed(2);
      const collectNow = mode === 'full' ? remainingUnpaid : needRevenue;
      lines.push({ accountCode: cash.code, accountName: cash.name, debit: collectNow, credit: 0 });
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: needRevenue });
      const toDeposit = +(collectNow - needRevenue).toFixed(2);
      if (toDeposit > 0.005) {
        lines.push({ accountCode: '260000', accountName: 'Customer Deposits', debit: 0, credit: toDeposit });
        order.depositRemaining = +((order.depositRemaining || 0) + toDeposit).toFixed(2);
      }
      order.amountPaid = +((order.amountPaid || 0) + collectNow).toFixed(2);
    }

    // 3) COGS for the units fulfilled now.
    if (totalCogs > 0) {
      lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: +totalCogs.toFixed(2), credit: 0 });
      lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: +totalCogs.toFixed(2) });
    }

    // 4) Discount (promo / SC-PWD / per-item) for the units fulfilled now - gross
    //    up revenue so it reflects list price and post the reduction to Sales
    //    Discounts, exactly like a normal completed sale. Cash already reflects net.
    if (discountValue > 0.005) {
      lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: discountValue, credit: 0 });
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: discountValue });
    }

    // Uniform reference: every posting for an order shares the order number (the
    // source-document reference), exactly like a normal completed sale. The round
    // number and pay-mode live in the description, so the ledger groups all of an
    // order's entries together instead of scattering them under -PF{hash} refs.
    const reference = order.orderNumber;
    const priorRounds = await JournalEntry.countDocuments({ reference, description: { $regex: '^Partial fulfillment' } }).session(session);
    const totalDebit = +lines.reduce((s, l) => s + l.debit, 0).toFixed(2);
    const totalCredit = +lines.reduce((s, l) => s + l.credit, 0).toFixed(2);
    assertBalanced(lines, reference);
    await JournalEntry.create([{ reference, description: `Partial fulfillment round ${priorRounds + 1} (${mode === 'full' ? 'pay full' : 'pay partial'}): ${order.orderNumber}`, lines, totalDebit, totalCredit }], { session });

    // Apply fulfilled units and advance status on the SAME order.
    for (const { i, want } of deltas) order.items[i].fulfilledQty = (order.items[i].fulfilledQty || 0) + want;
    order.markModified('items');
    const allFulfilled = order.items.every(it => (it.fulfilledQty || 0) >= (it.quantity || 0));
    order.status = allFulfilled ? 'Completed' : 'Partially Fulfilled';
    if (paymentMethod) order.paymentMethod = paymentMethod;
    // This order never passed through the main completion handler's ERP gate
    // (partial-fulfilled orders are deliberately skipped there to avoid double-
    // posting - see the wasPartiallyFulfilled check above). The final round that
    // completes it is this order's one and only transition into 'Completed', so
    // count it here.
    if (allFulfilled) await applyStatsDelta(order, 1, session);
    await order.save({ session });

    await session.commitTransaction();
    session.endSession();
    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });
    if (allFulfilled) maybePromoteWalkInClient(order);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (isTransientTxnError(err) && mayRetry && !res.headersSent) return true;
    log.error({ err }, 'POST /api/orders/:id/partial-fulfill failed');
    if (!res.headersSent) (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
  return false;
};

// --- DROP REMAINING (logistics) - finalize a partially-fulfilled order ---------
// The units already fulfilled are DONE and posted to the ledger; only the
// not-yet-fulfilled units are dropped. The order finalizes as Completed at the
// fulfilled quantity - the fulfilled revenue/COGS stay exactly as posted, and
// the dropped units carry NO ledger entries because they were never fulfilled.
// The one money movement is refunding any prepaid-but-undelivered deposit
// (only possible when an earlier batch was paid in 'full' mode).
app.post('/api/orders/:id/drop-remaining', verifyToken, requireStaff, async (req, res) => {
  await runWithStatsRetry(dropRemainingOnce, req, res);
});

// Retry wrapper - same reasoning as completeOrderOnce: this route also writes
// the singleton TenantStats/ProductStats counters inside its transaction.
const dropRemainingOnce = async (req, res, mayRetry) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(req.params.id).session(session);
    if (!order) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ success: false, error: 'Order not found.' }); }
    if (order.status !== 'Partially Fulfilled') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ success: false, error: 'Only a partially-fulfilled order can have its remaining dropped.' }); }

    const netUnit = (it) => +((it.price || 0) * (1 - (it.productDiscountPercent || 0) / 100)).toFixed(4);

    // Record the dropped units, then shrink each line to what was fulfilled.
    const droppedItems = [];
    for (const it of order.items) {
      const dropped = Math.max(0, (it.quantity || 0) - (it.fulfilledQty || 0));
      if (dropped > 0) droppedItems.push({ name: it.name, productCode: it.productCode || '', droppedQty: dropped, price: it.price || 0 });
      it.quantity = it.fulfilledQty || 0;
    }
    // Lines that delivered nothing drop off the completed order entirely.
    order.items = order.items.filter(it => (it.quantity || 0) > 0);
    order.markModified('items');

    // Refund any prepaid-but-undelivered value (deposit) back to cash.
    if ((order.depositRemaining || 0) > 0.005) {
      const cash = debitAccountFor(order.paymentMethod || 'Cash');
      const refund = +order.depositRemaining.toFixed(2);
      const lines = [
        { accountCode: '260000', accountName: 'Customer Deposits', debit: refund, credit: 0 },
        { accountCode: cash.code, accountName: cash.name, debit: 0, credit: refund },
      ];
      const reference = order.orderNumber;
      assertBalanced(lines, reference);
      await JournalEntry.create([{ reference, description: `Deposit refund on dropped remainder: ${order.orderNumber}`, lines, totalDebit: refund, totalCredit: refund }], { session });
      order.amountPaid = +Math.max(0, (order.amountPaid || 0) - refund).toFixed(2);
      order.depositRemaining = 0;
    }

    // Recompute the header to the fulfilled goods value so it matches the revenue
    // already recognised (logistics = Non-VAT, so total == fulfilled goods value).
    const fulfilledValue = +order.items.reduce((s, it) => s + netUnit(it) * (it.quantity || 0), 0).toFixed(2);
    order.subtotal = fulfilledValue;
    order.total = fulfilledValue;

    order.droppedItems = droppedItems;
    order.droppedBy = req.user?.name || 'system';
    order.droppedAt = new Date();
    order.status = 'Completed';
    // Same reasoning as partial-fulfill's final round: this is this order's one
    // and only transition into 'Completed', counted against the now-shrunk
    // (fulfilled-only) items/total computed just above.
    await applyStatsDelta(order, 1, session);
    await order.save({ session });

    await logAudit(req, { action: 'drop-remaining', entity: 'Order', entityId: order._id, after: { orderNumber: order.orderNumber, droppedItems, droppedBy: order.droppedBy } });

    await session.commitTransaction();
    session.endSession();
    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (isTransientTxnError(err) && mayRetry && !res.headersSent) return true;
    log.error({ err }, 'POST /api/orders/:id/drop-remaining failed');
    if (!res.headersSent) (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
  return false;
};

// ── REFUND FLOW ───────────────────────────────────────────────────────────────
app.post('/api/orders/:id/refund', verifyToken, requireSuperOrAdmin, async (req, res) => {
  await runWithStatsRetry(refundOnce, req, res);
});

// Retry wrapper - same reasoning as completeOrderOnce: this route also writes
// the singleton TenantStats/ProductStats counters inside its transaction.
const refundOnce = async (req, res, mayRetry) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { reason, refundAmount, inventoryAction } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, error: 'Reason required.' });
    const order = await Order.findById(req.params.id).session(session);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.status !== 'Completed') return res.status(400).json({ success: false, error: 'Can only refund Completed orders.' });
    if (order.transactionType === 'REFUND') return res.status(400).json({ success: false, error: 'Already refunded.' });
    const amt = parseFloat(refundAmount) || order.total;
    if (amt <= 0 || amt > order.total + 0.01) return res.status(400).json({ success: false, error: `Refund amount must be between ₱0.01 and ₱${order.total.toFixed(2)}.` });
    const reference = mkRef('REFUND', order.orderNumber);
    const creditAcct = debitAccountFor(order.paymentMethod);
    const lines = [
      { accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: amt,  credit: 0   },
      { accountCode: creditAcct.code, accountName: creditAcct.name,  debit: 0,    credit: amt },
    ];

    // --- INVENTORY / COGS REVERSAL ---
    // Only a FULL refund touches inventory & COGS (partial refunds adjust cash/revenue only).
    // Operator chooses per refund: 'Restock' (goods returned, put stock back & reverse COGS)
    // or 'Spoilage' (goods unusable, move COGS → waste expense). Complimentary orders carry
    // no COGS reversal here (cost was already expensed at completion).
    const isFullRefund = Math.abs(amt - order.total) <= 0.01;
    const invAction = inventoryAction === 'Restock' || inventoryAction === 'Spoilage' ? inventoryAction : 'None';
    if (isFullRefund && invAction !== 'None' && !order.isComplimentary) {
      let totalCogs = 0;
      for (const item of order.items) {
        const product = await Product.findById(item.productId).populate('modifierGroups').session(session);
        if (!product) continue;

        let recipeToUse = product.baseRecipe || [];
        const sizeMatch = item.name.match(/\(([^)]+)\)$/);
        if (sizeMatch) {
          const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
          if (sizeObj && sizeObj.recipe?.length > 0) recipeToUse = sizeObj.recipe;
        }

        // LOGISTICS 1:1 FALLBACK - product has no recipe: reverse the linked stocked good.
        if (!recipeToUse.some(r => r.invId)) {
          const linkInv = await resolveLinkedInventory(product, item.productCode, session);
          if (linkInv) {
            const qtyUsed = item.quantity * baseUnitsPerSale(product, linkInv);
            if (invAction === 'Restock') {
              const restored = await Inventory.findOneAndUpdate(
                { _id: linkInv._id }, { $inc: { stockQty: qtyUsed } }, { session, returnDocument: 'after' }
              );
              if (restored) {
                totalCogs += (restored.unitCost * qtyUsed);
                await StockCard.create([{
                  inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
                  reference, qtyChange: qtyUsed, balanceAfter: restored.stockQty,
                  remarks: `Refunded (Restock): ${item.name}`
                }], { session });
              }
            } else {
              totalCogs += (linkInv.unitCost * qtyUsed);
            }
          }
        }

        // Collect every ingredient line: base recipe + add-on / modifier-option recipes.
        const recipes = [{ recipe: recipeToUse, label: item.name }];
        for (const selectedAddOn of (item.selectedAddOns || [])) {
          let resolvedRecipe = product.addOns?.find(a => a.name === selectedAddOn.name)?.recipe;
          if (!resolvedRecipe && selectedAddOn.name.includes(': ')) {
            const [grpName, optName] = selectedAddOn.name.split(': ');
            const grp = (product.modifierGroups || []).find(g => g && g.name === grpName);
            resolvedRecipe = grp?.options?.find(o => o.name === optName)?.recipe;
          }
          if (resolvedRecipe?.length) recipes.push({ recipe: resolvedRecipe, label: `Add-on (${selectedAddOn.name})` });
        }

        for (const { recipe, label } of recipes) {
          for (const ing of recipe) {
            if (!ing.invId) continue;
            const qtyUsed = ing.qty * item.quantity;
            if (invAction === 'Restock') {
              const restored = await Inventory.findOneAndUpdate(
                { _id: ing.invId },
                { $inc: { stockQty: qtyUsed } },
                { session, returnDocument: 'after' }
              );
              if (!restored) continue;
              totalCogs += (restored.unitCost * qtyUsed);
              await StockCard.create([{
                inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
                reference, qtyChange: qtyUsed, balanceAfter: restored.stockQty,
                remarks: `Refunded (Restock): ${label}`
              }], { session });
            } else {
              const invItem = await Inventory.findById(ing.invId).session(session);
              if (invItem) totalCogs += (invItem.unitCost * qtyUsed);
            }
          }
        }
      }

      if (totalCogs > 0) {
        if (invAction === 'Restock') {
          // Goods back on the shelf: DR Inventory / CR COGS
          lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
        } else {
          // Goods unusable: reclass COGS → Spoilage (inventory stays gone)
          lines.push({ accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
        }
      }
    }

    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    assertBalanced(lines, reference);
    await JournalEntry.create([{ date: new Date(), reference, description: `Refund for order ${order.orderNumber}: ${reason}`, lines, totalDebit, totalCredit }], { session });
    // Status moves off 'Completed' on ANY refund (partial or full) - the old
    // aggregation only ever counted status:'Completed' docs, so reverse the
    // full order here too, not just the refunded amount.
    await applyStatsDelta(order, -1, session);
    order.transactionType = 'REFUND';
    order.status = 'Refunded';
    order.voidReason = `REFUND: ${reason}`;
    await order.save({ session });
    await AuditLog.create({ userId: req.user?.name, action: 'ORDER_REFUNDED', targetReference: order.orderNumber, details: { reason, refundAmount: amt, inventoryAction: isFullRefund ? invAction : 'None (partial)', refundedBy: req.user?.name } });
    await session.commitTransaction(); session.endSession();
    emitToOps('orderUpdated', order); emitToMgr('erpUpdated');
    res.json({ success: true, order });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    if (isTransientTxnError(err) && mayRetry && !res.headersSent) return true;
    log.error({ err }, 'POST /api/orders/:id/refund failed');
    if (!res.headersSent) (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
  return false;
};

// --- DISPATCH STATUS UPDATE ---
app.patch('/api/orders/:id/dispatch', verifyToken, requireStaff, async (req, res) => {
  try {
    const { dispatchStatus } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { dispatchStatus }, { returnDocument: 'after' });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
