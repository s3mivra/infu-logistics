// admin-tools routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';

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
    BackdateQueueItemSchema,
    BackdateQueueItem,
    TenantStats,
    STATS_SHARDS,
    ProductStats,
    StockTransfer,
    PurchaseOrder,
    Bill,
    PriceTier,
    RequisitionSlip,
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
// ── STORAGE OVERVIEW ─────────────────────────────────────────────────────────
// What this deployment is actually holding, and which collections are growing.
//
// The two that matter are StockCard and JournalEntry: both gain rows from
// ordinary trading and neither is ever pruned, so they outgrow everything else
// by an order of magnitude. Showing bytes alone hides that - a collection at
// 40MB is unremarkable until you know it was 4MB a month ago. So this reports
// per-collection size AND the growth-per-day implied by the documents written
// in the last 30 days, which is what tells an owner when to plan an archive.
app.get('/api/admin/storage-overview', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const dbStats = await db.stats();

    // Collections worth naming, with the date field their growth is measured on.
    // Anything not listed still counts toward the database total below.
    const TRACKED = [
      { model: 'JournalEntry', label: 'Journal Entries', dateField: 'date', note: 'Grows with every posting. Never pruned.' },
      { model: 'StockCard', label: 'Stock Movements', dateField: 'date', note: 'A row per ingredient per sale. Fastest-growing.' },
      { model: 'Order', label: 'Orders', dateField: 'createdAt', note: 'Archiving moves these out of the active board.' },
      { model: 'InventoryMovement', label: 'Inventory Movements', dateField: 'date', note: '' },
      { model: 'AuditLog', label: 'Audit Log', dateField: 'timestamp', note: '' },
      { model: 'Inventory', label: 'Inventory Items', dateField: 'createdAt', note: '' },
      { model: 'Product', label: 'Products', dateField: 'createdAt', note: '' },
      { model: 'Expense', label: 'Expenses', dateField: 'date', note: '' },
      { model: 'Bill', label: 'Bills', dateField: 'createdAt', note: '' },
      { model: 'CheckVoucher', label: 'Check Vouchers', dateField: 'date', note: '' },
      { model: 'Advance', label: 'Advances', dateField: 'date', note: '' },
      { model: 'ClientAccount', label: 'Clients', dateField: 'createdAt', note: '' },
      { model: 'Supplier', label: 'Suppliers', dateField: 'createdAt', note: '' },
    ];

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const collections = [];

    for (const t of TRACKED) {
      let model;
      try { model = mongoose.model(t.model); } catch { continue; }
      try {
        const [docs, recent, stats] = await Promise.all([
          model.estimatedDocumentCount(),
          model.countDocuments({ [t.dateField]: { $gte: since } }).catch(() => 0),
          db.command({ collStats: model.collection.collectionName }).catch(() => ({})),
        ]);
        const bytes = stats.storageSize || 0;
        const avg = stats.avgObjSize || 0;
        const perDay = recent / 30;
        collections.push({
          key: t.model, label: t.label, note: t.note,
          docs, bytes,
          avgDocBytes: Math.round(avg),
          indexBytes: stats.totalIndexSize || 0,
          docsLast30d: recent,
          docsPerDay: +perDay.toFixed(1),
          // Projected from the last 30 days, which is the only honest basis -
          // a brand-new deployment has no trend to extrapolate from.
          bytesPerDay: Math.round(perDay * avg),
          projectedBytesPerYear: Math.round(perDay * avg * 365),
        });
      } catch { /* collection not created yet */ }
    }

    collections.sort((a, b) => b.bytes - a.bytes);
    const totalProjectedPerYear = collections.reduce((s, c) => s + c.projectedBytesPerYear, 0);

    res.json({
      success: true,
      database: {
        dataBytes: dbStats.dataSize || 0,
        storageBytes: dbStats.storageSize || 0,
        indexBytes: dbStats.indexSize || 0,
        totalBytes: (dbStats.storageSize || 0) + (dbStats.indexSize || 0),
        collections: dbStats.collections || 0,
        objects: dbStats.objects || 0,
      },
      collections,
      growth: {
        windowDays: 30,
        projectedBytesPerYear: totalProjectedPerYear,
        // Named so the UI does not have to guess which one to warn about.
        fastestGrowing: [...collections].sort((a, b) => b.bytesPerDay - a.bytesPerDay)[0]?.label || null,
      },
      generatedAt: new Date(),
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

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
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Manual re-run of the stamping migration. Idempotent - only touches docs missing the field.
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
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
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
      // Only update the default if the target code now exists in COA - keeps the
      // routing table honest when a code was skipped (e.g. Metrobank holding 112001).
      if (acctMeta(c)) DEFAULT_PAYMENT_ACCOUNT_MAP[m] = c;
    }
    await refreshPaymentMap();
    await logAudit(req, { action: 'seed', entity: 'PaymentSubAccounts', entityId: 'bulk', after: { created: created.length, skipped: skipped.length } });
    res.json({ success: true, created, skipped, effectiveMap: { ...ctx.PAYMENT_MAP_CACHE } });
  } catch (err) {
    log?.error?.({ err }, 'POST /api/admin/seed-payment-subaccounts failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Mirrors orders.js's maybePromoteWalkInClient (repeat walk-in name → its own
// ClientAccount after 3 Completed orders) for the backdate path, which never
// goes through /api/orders and so never triggered that promotion - hundreds
// of named backdated sales otherwise stay invisible on the Clients page.
// Fire-and-forget: never let a Clients-page nicety fail or delay the sale.
async function maybePromoteBackdateClient(customerName) {
  try {
    const name = (customerName || '').trim();
    if (!name || name.toLowerCase() === 'guest' || name.toLowerCase().startsWith('walk-in')) return;
    const nameRegex = new RegExp(`^${escapeRegex(name)}$`, 'i');

    let account = await ClientAccount.findOne({ name: nameRegex, source: 'pos' });
    if (!account) {
      const count = await Order.countDocuments({
        businessType: BUSINESS_TYPE,
        customerName: nameRegex,
        status: 'Completed',
        clientAccountId: { $in: [null, ''] },
      });
      if (count < 3) return;

      const clientCode = await generateNextSequence(ClientAccount, 'CUS-1000', 'clientCode');
      const placeholderUsername = `_pos_${clientCode.toLowerCase()}`;
      const placeholderPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
      account = await ClientAccount.create({
        clientCode, name, username: placeholderUsername, password: placeholderPassword,
        isActive: true, source: 'pos',
      });
      await Order.updateMany(
        { businessType: BUSINESS_TYPE, customerName: nameRegex, clientAccountId: { $in: [null, ''] } },
        { $set: { clientAccountId: String(account._id) } }
      );
    } else {
      await Order.updateMany(
        { businessType: BUSINESS_TYPE, customerName: nameRegex, clientAccountId: { $in: [null, ''] } },
        { $set: { clientAccountId: String(account._id) } }
      );
    }
  } catch (err) {
    log.error({ err }, 'Backdated-sale client auto-promotion failed');
  }
}

// ── BACKDATED SALE (superadmin only) ─────────────────────────────────────────
// Records a Completed order for a chosen historical date so analytics / P&L
// include sales made before the POS was in place. Two shapes accepted:
//   • Itemized (preferred) - `items: [{ name, price, quantity, productId?,
//     productCode? }]`, like a normal sale. Set `affectInventory: true` to also
//     deduct current stock + book COGS; DEFAULT false, so old sales don't eat
//     today's inventory (a pure revenue tally).
//   • Lump - a single `amount` (legacy). Always revenue-only.
// The revenue journal entry is DATED TO THE CHOSEN DAY, so that period's books
// are right. Respects period locks. Always audited. (Non-VAT posting, matching
// the live completion path for these businesses.)
// Core creation logic, shared by the direct route below and by the queue's
// "Save" action once the missing piece (payment method, today) is supplied.
// Throws an Error with `.httpStatus` set for anything that should reach the
// client as a 400/423 rather than a 500.
async function createBackdatedSale(payload, actorName) {
  const { date, customerName, amount, paymentMethod, notes, items, affectInventory = false, discountPercent = 0, isComplimentary = false, importRef = '', deliveryFee = 0 } = payload;
  const comp = !!isComplimentary;
  const fail = (httpStatus, message) => Object.assign(new Error(message), { httpStatus });

  const dt = new Date(date);
  if (!date || isNaN(dt.getTime())) throw fail(400, 'A valid date is required.');
  if (dt.getTime() > Date.now()) throw fail(400, 'A backdated sale must be in the past, not the future.');

  // A bulk Excel import carries the sheet's own transaction/invoice reference
  // as importRef - re-importing the same (or an overlapping) file must skip
  // rows already posted under that reference rather than double-recording the
  // sale. Manual single-entry backdates never set this, so they're never
  // deduped against each other (nothing to dedupe on).
  const cleanImportRef = String(importRef || '').trim();
  if (cleanImportRef) {
    const dupe = await Order.findOne({ businessType: BUSINESS_TYPE, importRef: cleanImportRef, isBackdated: true }).lean();
    if (dupe) throw fail(409, `Already imported as ${dupe.orderNumber} (ref: ${cleanImportRef}) - skipped duplicate.`);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Build the line items - itemized when provided, else a single lump line.
    const itemized = Array.isArray(items) && items.length > 0;
    let orderItems = [];
    if (itemized) {
      for (const it of items) {
        const price = Number(it.price), qty = Number(it.quantity);
        if (!it.name || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
          throw fail(400, 'Each item needs a name, a non-negative price, and a positive quantity.');
        }
        orderItems.push({ name: String(it.name), price, quantity: qty, productId: it.productId || undefined, productCode: it.productCode || undefined, productDiscountPercent: 0, itemStatus: 'Served' });
      }
    } else {
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0) throw fail(400, 'Provide either items[] or a positive amount.');
      orderItems = [{ name: 'Historical Sale', price: amt, quantity: 1, productDiscountPercent: 0 }];
    }

    const gross = +orderItems.reduce((s, it) => s + it.price * it.quantity, 0).toFixed(2);
    // A complimentary sale is free: no discount line, nothing collected. Its cost
    // is booked as Complimentary Expense against revenue (keeps gross visible).
    const pct = comp ? 0 : Math.max(0, Math.min(100, Number(discountPercent) || 0));
    const discount = +(gross * pct / 100).toFixed(2);
    // Same gap as the live POS path had (see orders.js): a delivery fee is a
    // flat pass-through add-on, not part of what's discounted/comped, added
    // after. Bulk Excel imports of a delivery business's historical sales
    // (see LedgerTab.jsx's backdate importer) carry this from the sheet's own
    // total, which already includes it - computing gross from item lines
    // alone and calling that the total is exactly what didn't tally.
    const delivery = comp ? 0 : Math.max(0, Number(deliveryFee) || 0);
    const total = comp ? 0 : +(gross - discount + delivery).toFixed(2);

    // Period-lock guard.
    const lock = await periodLockFor(dt);
    if (lock) throw fail(423, `Period ${lock.year}-${String(lock.month).padStart(2,'0')} is closed.`);

    const method = paymentMethod || 'Cash';
    const acct = accountForPaymentMethod(method);

    const year = dt.getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${year}`, 'orderNumber');

    // Optional stock deduction + COGS - only when explicitly asked.
    let totalCogs = 0;
    const stockCards = [];
    if (itemized && affectInventory) {
      for (const item of orderItems) {
        const product = item.productId ? await Product.findById(item.productId).session(session) : null;
        if (!product) continue;
        const linkInv = await resolveLinkedInventory(product, item.productCode, session);
        if (!linkInv) continue;
        const deductQty = item.quantity * baseUnitsPerSale(product, linkInv);
        const updated = await Inventory.findOneAndUpdate(
          { _id: linkInv._id, stockQty: { $gte: deductQty } },
          { $inc: { stockQty: -deductQty } },
          { session, returnDocument: 'after' }
        );
        if (!updated) throw fail(400, `Not enough stock of "${linkInv.itemName}" to reduce for this backdated sale. Turn off "reduce inventory" or receive stock first.`);
        stockCards.push({ inventoryId: updated._id, itemName: updated.itemName, type: 'Sale', reference: mkRef('BACK', orderNumber), qtyChange: -deductQty, balanceAfter: updated.stockQty, remarks: `Backdated sale (${item.name})` });
        totalCogs += linkInv.unitCost * deductQty;
      }
      if (stockCards.length) await StockCard.insertMany(stockCards, { session });
    }
    totalCogs = +totalCogs.toFixed(2);

    const [order] = await Order.create([{
      orderNumber,
      table: 'Backdated',
      status: 'Completed',
      createdAt: dt,
      cashier: actorName || 'Backdated Entry',
      customerName: customerName || 'Walk-in (backdated)',
      paymentMethod: method,
      items: orderItems,
      subtotal: gross,
      discount,
      discountPercent: pct,
      vatAmount: 0, vatRate: 0,
      total,
      deliveryFee: delivery,
      isVatExempt: true,
      isComplimentary: comp,
      discountType: comp ? 'Complimentary' : (pct > 0 ? 'Promo' : 'None'),
      transactionType: 'NORMAL',
      orderNotes: (notes || '').trim().slice(0, 300),
      isBackdated: true,
      importRef: cleanImportRef,
      // A backdated sale is never "today's" register - default isArchived:false
      // was leaving these permanently mixed into the live Active Register
      // totals (GET /api/orders' isArchived:false query has no date scoping)
      // while simultaneously never showing up in Sales History (isArchived:true).
      isArchived: true,
    }], { session });

    // Balanced revenue entry, DATED to the backdate. Same transaction as the
    // order write - a sale must never appear in reports without its ledger entry.
    const reference = await mkSeqRef('BACKDATE');
    const lines = [];
    if (comp) {
      // Complimentary: DR Complimentary Expense / CR Sales Revenue at selling
      // price (nothing collected, so no cash/A-R line).
      lines.push({ accountCode: '540000', accountName: 'Complimentary Expense', debit: gross, credit: 0 });
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: gross });
    } else {
      lines.push({ accountCode: acct.code, accountName: acct.name, debit: total, credit: 0 });
      if (discount > 0) lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: discount, credit: 0 });
      // Delivery fee folds into the same Sales Revenue credit as the rest of
      // the sale (no separate COA account for it) - it must land on the
      // credit side too, or this entry stops balancing the moment `total`
      // includes it but `gross` alone doesn't.
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: gross + delivery });
    }
    if (totalCogs > 0) {
      lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
      lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
    }
    assertBalanced(lines, reference); // redundant with the schema guard, but fails fast + clearer
    await JournalEntry.create([{
      date: dt,
      reference,
      description: `Backdated sale: ${order.orderNumber}${notes ? ` (${notes})` : ''}`,
      lines,
    }], { session });

    // Analytics' "all-time" KPIs and per-product top-sellers read from these
    // running counters (see reports.js), not a live scan of Order - a
    // backdated sale skipped the normal /api/orders completion path that
    // keeps them in sync, so without this it posts a real journal entry yet
    // never shows up in Net Revenue (All-Time) or Top Sellers.
    const tenantShard = Math.floor(Math.random() * STATS_SHARDS);
    await TenantStats.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, shard: tenantShard },
      { $inc: {
          cumulativeRevenue: comp ? 0 : total,
          cumulativeComp: comp ? gross : 0,
          cumulativeOrderCount: 1,
          cumulativeNonCompCount: comp ? 0 : 1,
        } },
      { session, upsert: true }
    );
    if (!comp && orderItems.length) {
      const byName = new Map();
      for (const it of orderItems) {
        const prev = byName.get(it.name) || { qty: 0, rev: 0 };
        byName.set(it.name, { qty: prev.qty + it.quantity, rev: prev.rev + it.price * it.quantity });
      }
      const ops = [...byName].map(([name, { qty, rev }]) => ({
        updateOne: {
          filter: { businessType: BUSINESS_TYPE, productName: name, shard: Math.floor(Math.random() * STATS_SHARDS) },
          update: { $inc: { cumulativeQty: qty, cumulativeRevenue: rev } },
          upsert: true,
        },
      }));
      await ProductStats.bulkWrite(ops, { session });
    }

    await session.commitTransaction();
    session.endSession();
    maybePromoteBackdateClient(customerName); // fire-and-forget, outside the transaction
    return { order, journalReference: reference, itemized, affectInventory: !!(itemized && affectInventory), method, total, dt };
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    throw err;
  }
}

app.post('/api/admin/backdate-sale', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await createBackdatedSale(req.body, req.user?.name);
    await logAudit(req, { action: 'backdate-sale', entity: 'Order', entityId: result.order._id, after: { orderNumber: result.order.orderNumber, date: result.dt, total: result.total, paymentMethod: result.method, itemized: result.itemized, affectInventory: result.affectInventory } });
    emitToMgr('erpUpdated');
    res.json({ success: true, order: result.order, journalReference: result.journalReference });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
    log.error?.({ err }, 'POST /api/admin/backdate-sale failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// History of every sale entered through the backdate tool (manual entries and
// bulk Excel imports alike - both hit the route above), newest-posted first so
// an operator can confirm a batch went through without hunting the main Orders
// list. Paginated; `page`/`limit` optional.
app.get('/api/admin/backdate-sale/history', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const filter = { isBackdated: true };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ success: true, orders, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    log.error?.({ err }, 'GET /api/admin/backdate-sale/history failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── BACKDATE SALE QUEUE ───────────────────────────────────────────────────────
// Rows from a bulk Excel import that are missing something the sale needs -
// today, a blank "Terms of Payment" (no payment method) - land here instead
// of being silently defaulted to Cash or dropped. `/queue/:id/save` supplies
// the missing piece and posts it through the exact same path as a direct
// backdated sale.
app.post('/api/admin/backdate-sale/queue', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'No rows to queue.' });

    // Re-queuing the same (or an overlapping) file must not pile up duplicate
    // pending entries for a transaction that's already sitting in the queue,
    // or was already posted as a real sale (createBackdatedSale's own dedupe
    // only catches it at Save time - by then it's a confusing "already
    // imported" error on a queue row the user is trying to resolve; better to
    // never queue the duplicate in the first place).
    const refs = [...new Set(rows.map(r => String(r.transNo || '').trim()).filter(Boolean))];
    const [pendingRefs, postedRefs] = refs.length ? await Promise.all([
      BackdateQueueItem.find({ businessType: BUSINESS_TYPE, status: 'pending', transNo: { $in: refs } }).distinct('transNo'),
      Order.find({ businessType: BUSINESS_TYPE, isBackdated: true, importRef: { $in: refs } }).distinct('importRef'),
    ]) : [[], []];
    const dupeRefs = new Set([...pendingRefs, ...postedRefs]);

    const skipped = [];
    const docs = [];
    for (const r of rows) {
      const transNo = String(r.transNo || '').trim();
      if (transNo && dupeRefs.has(transNo)) { skipped.push(transNo); continue; }
      docs.push({
        transNo: String(r.transNo || ''), client: String(r.client || ''), date: String(r.date || ''), sheet: String(r.sheet || ''),
        items: (Array.isArray(r.items) ? r.items : []).map(it => ({ code: it.code || '', name: it.name, quantity: it.quantity, price: it.price, productId: it.productId || null, productCode: it.productCode || null })),
        missingFields: Array.isArray(r.missingFields) ? r.missingFields : ['paymentMethod'],
        status: 'pending',
      });
    }

    const created = docs.length ? await BackdateQueueItem.insertMany(docs) : [];
    await logAudit(req, { action: 'backdate-sale-queue', entity: 'BackdateQueueItem', entityId: 'bulk', after: { queued: created.length, skippedDuplicates: skipped.length } });
    res.json({ success: true, queued: created.length, skippedDuplicates: skipped.length });
  } catch (err) {
    log.error?.({ err }, 'POST /api/admin/backdate-sale/queue failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.get('/api/admin/backdate-sale/queue', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const filter = { status: 'pending' };
    const [rows, total] = await Promise.all([
      BackdateQueueItem.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      BackdateQueueItem.countDocuments(filter),
    ]);
    res.json({ success: true, rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    log.error?.({ err }, 'GET /api/admin/backdate-sale/queue failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/admin/backdate-sale/queue/:id/save', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const q = await BackdateQueueItem.findById(req.params.id);
    if (!q || q.status !== 'pending') return res.status(404).json({ success: false, error: 'Queue item not found or already resolved.' });
    const { paymentMethod, affectInventory = false, discountPercent = 0, isComplimentary = false, notes } = req.body;
    if (!paymentMethod) return res.status(400).json({ success: false, error: 'A payment method is required to resolve this queue item.' });
    const result = await createBackdatedSale({
      date: q.date, customerName: q.client, paymentMethod, affectInventory, discountPercent, isComplimentary,
      notes: notes || (q.transNo ? `Imported (queued) - ${q.transNo}` : 'Imported from Excel (queued)'),
      items: q.items,
    }, req.user?.name);
    q.status = 'resolved';
    q.resolvedOrderId = result.order._id;
    await q.save();
    await logAudit(req, { action: 'backdate-sale-queue-resolve', entity: 'Order', entityId: result.order._id, after: { queueId: q._id, orderNumber: result.order.orderNumber, paymentMethod: result.method } });
    emitToMgr('erpUpdated');
    res.json({ success: true, order: result.order, journalReference: result.journalReference });
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
    log.error?.({ err }, 'POST /api/admin/backdate-sale/queue/:id/save failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/admin/backdate-sale/queue/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const q = await BackdateQueueItem.findById(req.params.id);
    if (!q || q.status !== 'pending') return res.status(404).json({ success: false, error: 'Queue item not found or already resolved.' });
    q.status = 'discarded';
    await q.save();
    res.json({ success: true });
  } catch (err) {
    log.error?.({ err }, 'DELETE /api/admin/backdate-sale/queue/:id failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// One-off repair for orders created by the old (pre-transaction) backdate-sale
// route: the Order write could succeed while the JournalEntry write failed or
// was never reached, leaving a sale that shows in reports but has no ledger
// entry. Finds every isBackdated order lacking its "Backdated sale: <orderNumber>"
// journal entry and posts the missing one, using the order's own snapshot
// (paymentMethod/total/createdAt) so the entry matches what would have been
// posted at the time. Safe to re-run - already-linked orders are skipped.
app.post('/api/admin/backdate-sale/backfill-ledger', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const orphans = await Order.find({ isBackdated: true }).lean();
    const results = { scanned: orphans.length, alreadyLinked: 0, created: [], failed: [] };

    for (const order of orphans) {
      const rx = new RegExp(`^Backdated sale: ${escapeRegex(order.orderNumber)}(\\s|$|\\()`);
      const existing = await JournalEntry.findOne({ description: rx }).lean();
      if (existing) { results.alreadyLinked++; continue; }

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const amt = order.total;
        const method = order.paymentMethod || 'Cash';
        const acct = accountForPaymentMethod(method);
        const reference = await mkSeqRef('BACKDATE');
        await JournalEntry.create([{
          date: order.createdAt,
          reference,
          description: `Backdated sale: ${order.orderNumber} (ledger backfill)`,
          lines: [
            { accountCode: acct.code, accountName: acct.name, debit: amt, credit: 0 },
            { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: amt },
          ],
          totalDebit: amt,
          totalCredit: amt,
        }], { session });
        await session.commitTransaction();
        session.endSession();
        results.created.push({ orderNumber: order.orderNumber, amount: amt, journalReference: reference });
      } catch (err) {
        await session.abortTransaction(); session.endSession();
        results.failed.push({ orderNumber: order.orderNumber, error: err.message });
      }
    }

    await logAudit(req, { action: 'backdate-sale-backfill-ledger', entity: 'JournalEntry', entityId: 'bulk', after: results });
    if (results.created.length) emitToMgr('erpUpdated');
    res.json({ success: true, ...results });
  } catch (err) {
    log.error?.({ err }, 'POST /api/admin/backdate-sale/backfill-ledger failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── PURGE DATA (superadmin only) ─────────────────────────────────────────────
// Wipes every transactional record for this deployment - sales/orders, the
// general ledger, inventory + its stock history, shifts/time clock, revolving
// funds, and procurement (POs/bills) - while leaving staff accounts, roles,
// client (customer) accounts, the menu (products/combos/categories/add-ons),
// pricing, the Chart of Accounts, and Settings untouched, exactly as scoped
// with the user. Irreversible; gated on an exact-match confirmation phrase
// checked server-side (never trust a client-side-only confirm for this).
//
// NOTE ON "PER TENANT": this codebase's multi-tenancy is Phase 1 - `tenantId`
// is backfilled on some collections (Order, Inventory, PurchaseOrder, Bill,
// StockTransfer...) but core ledger collections like JournalEntry, Shift,
// ClockEntry, RevolvingFund(Tx), ClosedPeriod and BankDeposit carry NO
// tenantId at all, and no query in the app actually enforces tenant scoping
// yet (`tenantScope()` is a no-op). There is therefore no way to honestly
// purge "just one tenant's ledger" today - this purges everything for the
// current BUSINESS_TYPE deployment, which is the only scope boundary that
// actually exists end-to-end right now.
const PURGE_CONFIRM_PHRASE = 'PURGE';
// Every purgeable slice, as an explicit opt-in checklist - the client sends
// exactly which categories to wipe. `menu` defaults OFF everywhere it's
// pre-filled (products/categories/etc. used to be permanently protected;
// now it's just another checkbox, off by default so nothing changes for
// anyone who doesn't touch it). Every other category defaults ON, matching
// the original always-delete-everything-except-menu behavior.
const PURGE_CATEGORIES = {
  orders:          { label: 'Sales & Orders', defaultOn: true },
  ledger:          { label: 'Ledger / Journal Entries', defaultOn: true },
  inventory:       { label: 'Inventory & Stock History', defaultOn: true },
  // Split out from `inventory` (used to be bundled in silently) - explicit
  // now so it's obvious this is being purged, and choosable independently.
  transfers:       { label: 'Transfer History', defaultOn: true },
  shifts:          { label: 'Shifts & Time Clock', defaultOn: true },
  revolvingFunds:  { label: 'Revolving Funds', defaultOn: true },
  procurement:     { label: 'Procurement (POs & Bills)', defaultOn: true },
  requisitions:    { label: 'Requisition Slips', defaultOn: true },
  eod:             { label: 'End-of-Day Records', defaultOn: true },
  auditLog:        { label: 'Audit Log', defaultOn: true },
  menu:            { label: 'Menu Setup (Products, Categories, Combos, Add-ons, Modifiers, Price Tiers)', defaultOn: false },
};
app.get('/api/admin/purge-data/categories', verifyToken, requireSuperAdmin, async (req, res) => {
  res.json({ success: true, categories: Object.entries(PURGE_CATEGORIES).map(([key, v]) => ({ key, ...v })) });
});

app.post('/api/admin/purge-data', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const phrase = String(req.body.confirmPhrase || '').trim();
    if (phrase !== PURGE_CONFIRM_PHRASE) {
      return res.status(400).json({ success: false, error: `Type ${PURGE_CONFIRM_PHRASE} exactly (all caps) to confirm.` });
    }
    // Explicit selection wins; omitting `categories` entirely falls back to
    // "everything except menu" (the original behavior) rather than nothing,
    // so an older client that never sends the field still purges as before.
    const requested = Array.isArray(req.body.categories) ? req.body.categories : null;
    const selected = new Set(
      requested
        ? requested.filter(k => PURGE_CATEGORIES[k])
        : Object.keys(PURGE_CATEGORIES).filter(k => PURGE_CATEGORIES[k].defaultOn)
    );
    if (selected.size === 0) return res.status(400).json({ success: false, error: 'Select at least one category to purge.' });

    const bizScope = { businessType: BUSINESS_TYPE };
    const deleted = {};
    // hasBizField=false means the model has NO businessType field at all - a
    // deleteMany(bizScope) against one of those silently matches nothing,
    // which is exactly why the first version of this route left the ledger,
    // shifts, revolving funds, bank deposits, closed periods, and POs
    // completely untouched. Those get an unscoped deleteMany({}) instead -
    // safe because a whole deployment IS one business right now (see the note
    // above on why real per-tenant scoping doesn't exist yet).
    const del = async (label, Model, hasBizField = true) => {
      deleted[label] = (await Model.deleteMany(hasBizField ? bizScope : {})).deletedCount;
    };

    if (selected.has('orders')) await del('orders', Order);
    // Ledger (journal entries, period locks, bank deposits, expenses - expenses
    // are just JournalEntry rows with an expense account code, no separate model)
    if (selected.has('ledger')) {
      await del('journalEntries', JournalEntry, false);
      await del('closedPeriods', ClosedPeriod, false);
      await del('bankDeposits', BankDeposit, false);
    }
    if (selected.has('inventory')) {
      await del('inventory', Inventory);
      await del('stockCards', StockCard, false);
      await del('inventoryMovements', InventoryMovement, false);
      await del('backdateQueue', BackdateQueueItem);
    }
    if (selected.has('transfers')) await del('stockTransfers', StockTransfer);
    if (selected.has('shifts')) {
      await del('shifts', Shift, false);
      await del('clockEntries', ClockEntry);
    }
    if (selected.has('revolvingFunds')) {
      await del('revolvingFunds', RevolvingFund, false);
      await del('revolvingFundTx', RevolvingFundTx, false);
    }
    if (selected.has('procurement')) {
      await del('purchaseOrders', PurchaseOrder, false);
      await del('bills', Bill);
    }
    if (selected.has('requisitions')) await del('requisitionSlips', RequisitionSlip);
    if (selected.has('eod')) await del('eodRecords', EODRecord, false);
    if (selected.has('auditLog')) await del('auditLog', AuditLog, false);

    if (selected.has('menu')) {
      // No businessType field on these (see hasBizField note above).
      await del('products', Product, false);
      await del('categories', Category, false);
      await del('combos', Combo, false);
      await del('addOns', AddOn, false);
      await del('modifierGroups', ModifierGroup, false);
      await del('priceTiers', PriceTier);
    } else {
      // Products are KEPT, but "Out of Stock" is a manual per-product flag
      // independent of Inventory (see products.js) - it isn't deleted or
      // derived, so it silently survives a purge and keeps showing stale
      // "OUT OF STOCK" badges on a menu that's otherwise fresh. Reset it
      // without touching anything else about the product.
      deleted.productsMarkedBackInStock = (await Product.updateMany({ ...bizScope, isOutOfStock: true }, { $set: { isOutOfStock: false } })).modifiedCount;
    }

    // Cached analytics counters - MUST reset alongside Order/Product,
    // whatever fed them, or Analytics keeps showing pre-purge totals forever
    // (they're not derived live, see reports.js).
    if (selected.has('orders') || selected.has('menu')) {
      await del('tenantStats', TenantStats);
      await del('productStats', ProductStats);
    }

    // Always untouched regardless of selection: User, Role, ClientAccount
    // (staff + client logins), Account/Settings/PaymentMethodMap (Chart of
    // Accounts + config), Discount/DiscountRule (promo definitions),
    // StorageLocation/StockCategory (inventory taxonomy), Supplier (vendor
    // master data), ScheduledShift (future planning), Tenant, Counter
    // (sequence numbers - left as-is so new records don't reuse old
    // reference/order numbers).

    await logAudit(req, { action: 'purge-data', entity: 'Tenant', entityId: BUSINESS_TYPE, after: { categories: [...selected], ...deleted } });
    emitToMgr('erpUpdated');
    if (selected.has('menu')) emitToAll('menuUpdated');
    res.json({ success: true, categories: [...selected], deleted });
  } catch (err) {
    log.error?.({ err }, 'POST /api/admin/purge-data failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── REWIRE RECIPE LINKS (superadmin only) ────────────────────────────────────
// Every order-processing route already resolves a dangling recipe invId at
// deduction time (see resolveIngInvId in orders.js), so a stale link no
// longer breaks a sale - but it never gets fixed IN the stored recipe either,
// so every single completion pays for another lookup-by-name forever, and any
// tool that reads baseRecipe directly (reports, exports, future features)
// still sees the dead id. This does the same name-match repair, once, and
// actually writes the corrected invId back onto the product/modifier-group,
// covering Product.baseRecipe, Product.sizes[].recipe, Product.addOns[].recipe,
// and ModifierGroup.options[].recipe. Safe to run anytime, including with
// nothing to fix - matches only ingredients whose invId is dead AND whose
// saved name matches a current inventory item; anything unresolvable is left
// alone and reported back instead of guessed at.
app.post('/api/admin/rewire-recipes', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const invItems = await Inventory.find({ businessType: BUSINESS_TYPE }, { itemName: 1 }).lean();
    const liveIds = new Set(invItems.map(i => String(i._id)));
    const byName = new Map(invItems.map(i => [i.itemName, String(i._id)]));

    let ingredientsFixed = 0;
    const unresolved = [];
    const fixList = (list) => {
      let changed = false;
      for (const ing of (list || [])) {
        if (!ing.invId) continue;
        if (liveIds.has(String(ing.invId))) continue; // still valid - leave it
        const match = ing.name && byName.get(ing.name);
        if (match) { ing.invId = match; changed = true; ingredientsFixed++; }
        else unresolved.push(ing.name || '(unnamed ingredient)');
      }
      return changed;
    };

    const products = await Product.find({ businessType: BUSINESS_TYPE });
    let productsFixed = 0;
    for (const p of products) {
      let changed = fixList(p.baseRecipe);
      for (const sz of (p.sizes || [])) { if (fixList(sz.recipe)) changed = true; }
      for (const ao of (p.addOns || [])) { if (fixList(ao.recipe)) changed = true; }
      if (changed) {
        p.markModified('baseRecipe'); p.markModified('sizes'); p.markModified('addOns');
        await p.save();
        productsFixed++;
      }
    }

    const groups = await ModifierGroup.find({});
    let groupsFixed = 0;
    for (const g of groups) {
      let changed = false;
      for (const opt of (g.options || [])) { if (fixList(opt.recipe)) changed = true; }
      if (changed) { g.markModified('options'); await g.save(); groupsFixed++; }
    }

    const result = { productsChecked: products.length, productsFixed, groupsFixed, ingredientsFixed, unresolved: [...new Set(unresolved)].slice(0, 50) };
    await logAudit(req, { action: 'rewire-recipes', entity: 'Product', entityId: 'bulk', after: result });
    if (productsFixed || groupsFixed) emitToAll('menuUpdated');
    res.json({ success: true, ...result });
  } catch (err) {
    log.error?.({ err }, 'POST /api/admin/rewire-recipes failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
