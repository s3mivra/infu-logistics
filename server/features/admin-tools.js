// admin-tools routes — moved verbatim from server.js (feature-driven restructure).
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
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
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
      // Only update the default if the target code now exists in COA — keeps the
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

// ── BACKDATED SALE (superadmin only) ─────────────────────────────────────────
// Records a Completed order for a chosen historical date so analytics / P&L
// include sales made before the POS was in place. Two shapes accepted:
//   • Itemized (preferred) — `items: [{ name, price, quantity, productId?,
//     productCode? }]`, like a normal sale. Set `affectInventory: true` to also
//     deduct current stock + book COGS; DEFAULT false, so old sales don't eat
//     today's inventory (a pure revenue tally).
//   • Lump — a single `amount` (legacy). Always revenue-only.
// The revenue journal entry is DATED TO THE CHOSEN DAY, so that period's books
// are right. Respects period locks. Always audited. (Non-VAT posting, matching
// the live completion path for these businesses.)
app.post('/api/admin/backdate-sale', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { date, customerName, amount, paymentMethod, notes, items, affectInventory = false, discountPercent = 0, isComplimentary = false } = req.body;
    const comp = !!isComplimentary;

    const dt = new Date(date);
    if (!date || isNaN(dt.getTime())) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'A valid date is required.' });
    }
    if (dt.getTime() > Date.now()) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'A backdated sale must be in the past, not the future.' });
    }

    // Build the line items — itemized when provided, else a single lump line.
    const itemized = Array.isArray(items) && items.length > 0;
    let orderItems = [];
    if (itemized) {
      for (const it of items) {
        const price = Number(it.price), qty = Number(it.quantity);
        if (!it.name || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
          await session.abortTransaction(); session.endSession();
          return res.status(400).json({ success: false, error: 'Each item needs a name, a non-negative price, and a positive quantity.' });
        }
        orderItems.push({ name: String(it.name), price, quantity: qty, productId: it.productId || undefined, productCode: it.productCode || undefined, productDiscountPercent: 0, itemStatus: 'Served' });
      }
    } else {
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: 'Provide either items[] or a positive amount.' });
      }
      orderItems = [{ name: 'Historical Sale', price: amt, quantity: 1, productDiscountPercent: 0 }];
    }

    const gross = +orderItems.reduce((s, it) => s + it.price * it.quantity, 0).toFixed(2);
    // A complimentary sale is free: no discount line, nothing collected. Its cost
    // is booked as Complimentary Expense against revenue (keeps gross visible).
    const pct = comp ? 0 : Math.max(0, Math.min(100, Number(discountPercent) || 0));
    const discount = +(gross * pct / 100).toFixed(2);
    const total = comp ? 0 : +(gross - discount).toFixed(2);

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

    // Optional stock deduction + COGS — only when explicitly asked.
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
        if (!updated) {
          await session.abortTransaction(); session.endSession();
          return res.status(400).json({ success: false, error: `Not enough stock of "${linkInv.itemName}" to reduce for this backdated sale. Turn off "reduce inventory" or receive stock first.` });
        }
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
      cashier: req.user?.name || 'Backdated Entry',
      customerName: customerName || 'Walk-in (backdated)',
      paymentMethod: method,
      items: orderItems,
      subtotal: gross,
      discount,
      discountPercent: pct,
      vatAmount: 0, vatRate: 0,
      total,
      isVatExempt: true,
      isComplimentary: comp,
      discountType: comp ? 'Complimentary' : (pct > 0 ? 'Promo' : 'None'),
      transactionType: 'NORMAL',
      orderNotes: (notes || '').trim().slice(0, 300),
      isBackdated: true,
    }], { session });

    // Balanced revenue entry, DATED to the backdate. Same transaction as the
    // order write — a sale must never appear in reports without its ledger entry.
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
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: gross });
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

    await session.commitTransaction();
    session.endSession();

    await logAudit(req, { action: 'backdate-sale', entity: 'Order', entityId: order._id, after: { orderNumber, date: dt, total, paymentMethod: method, itemized, affectInventory: !!(itemized && affectInventory) } });
    emitToMgr('erpUpdated');
    res.json({ success: true, order, journalReference: reference });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    log.error?.({ err }, 'POST /api/admin/backdate-sale failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// One-off repair for orders created by the old (pre-transaction) backdate-sale
// route: the Order write could succeed while the JournalEntry write failed or
// was never reached, leaving a sale that shows in reports but has no ledger
// entry. Finds every isBackdated order lacking its "Backdated sale: <orderNumber>"
// journal entry and posts the missing one, using the order's own snapshot
// (paymentMethod/total/createdAt) so the entry matches what would have been
// posted at the time. Safe to re-run — already-linked orders are skipped.
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
}
