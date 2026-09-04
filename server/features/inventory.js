// inventory routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { title, upper } from '../lib/normalize.js';
import { withOptionalTransaction } from '../lib/txn.js';
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';

export default function registerInventory(ctx) {
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
    consumeSpecificBatch,
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
    StorageLocation,
    StockCategory,
    StockTransfer,
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

// --- 1. FETCH EOD STATUS & REAL MOVEMENTS ---
app.get('/api/inventory/eod-data', verifyToken, requireStaff, async (req, res) => {
  try {
    // Get local date string (e.g., "2026-04-29")
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    let eod = await EODRecord.findOne({ dateString: todayStr });
    if (!eod) eod = { status: 'OPEN', lockedAt: null };

    // Calculate real movements for today using StockCard
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const movements = await StockCard.aggregate([
      { $match: { date: { $gte: startOfDay } } },
      { $group: {
          _id: "$inventoryId",
          // 'In' includes Restocks, 'Out' includes Sales (which are negative, so we abs() them later)
          in: { $sum: { $cond: [{ $gt: ["$qtyChange", 0] }, "$qtyChange", 0] } },
          out: { $sum: { $cond: [{ $lt: ["$qtyChange", 0] }, "$qtyChange", 0] } }
      }}
    ]);

    const movementMap = {};
    movements.forEach(m => {
      movementMap[m._id] = { in: m.in, out: Math.abs(m.out) };
    });

    res.json({ success: true, status: eod.status, lockedAt: eod.lockedAt, movement: movementMap });
  } catch(err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- 2. SUBMIT & LOCK EOD ---
app.post('/api/inventory/count', verifyToken, requireStaff, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    // STRICT CHECK: Is it already locked?
    const existingEOD = await EODRecord.findOne({ dateString: todayStr }).session(session);
    if (existingEOD && existingEOD.status === 'LOCKED') {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({ success: false, error: 'ALREADY_CLOSED: You cannot submit another EOD for today.' });
    }

    const { counts, reasons, adminName } = req.body;
    const items = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).session(session);

    for (const item of items) {
      if (counts[item._id] === undefined || counts[item._id] === '') continue; 
      
      const actualCount = Number(counts[item._id]);
      const variance = actualCount - item.stockQty;

      if (variance !== 0) {
        const specificReason = reasons && reasons[item._id] ? reasons[item._id] : 'Unaccounted Variance';
        
        const eodAdjRef = await mkSeqRef('EOD-ADJ');

        await StockCard.create([{
          inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
          reference: eodAdjRef, qtyChange: variance, balanceAfter: actualCount,
          unitCost: item.unitCost || 0,
          remarks: `EOD Audit: ${specificReason}`
        }], { session });

        const valueAbs = Math.abs(variance) * item.unitCost;

        if (valueAbs > 0) {
          const reference = eodAdjRef;

          if (variance < 0) {
            await JournalEntry.create([{
              reference, description: `Shrinkage (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: valueAbs, credit: 0 },
                { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            }], { session });
          } else {
            await JournalEntry.create([{
              reference, description: `Gain (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '130000', accountName: 'Inventory Asset', debit: valueAbs, credit: 0 },
                { accountCode: '530000', accountName: 'Inventory Adjustment Gain', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            }], { session });
          }
        }
      }

      item.stockQty = actualCount;
      await item.save({ session });
    }

    // LOCK THE DAY
    await EODRecord.findOneAndUpdate(
      { dateString: todayStr },
      { status: 'LOCKED', lockedAt: new Date(), lockedBy: adminName || 'Admin' },
      { upsert: true, returnDocument: 'after', session }
    );

    await session.commitTransaction();
    session.endSession();

    emitToMgr('erpUpdated');
    res.json({ success: true, message: "End of day locked." });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    captureError(req, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- UNLOCK / REOPEN EOD (ADMIN ONLY) ---
app.post('/api/inventory/eod/reopen', verifyToken, requireStaff, async (req, res) => {
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    // Find today's lock
    const eod = await EODRecord.findOne({ dateString: todayStr });
    if (!eod || eod.status === 'OPEN') return res.status(400).json({ success: false, error: 'Day is not locked.' });

    // Reopen it
    eod.status = 'OPEN';
    await eod.save();

    emitToMgr('erpUpdated'); // Tell all iPads the register is open again!
    res.json({ success: true, message: 'Day reopened successfully.' });
  } catch(err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// List every locked day, newest first - the export report picker reads this.
app.get('/api/inventory/eod-history', verifyToken, requireStaff, async (req, res) => {
  try {
    const records = await EODRecord.find({ status: 'LOCKED' }).sort({ dateString: -1 }).limit(365).lean();
    res.json({ success: true, records });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Reconstructs one locked day's variance report. EODRecord itself only ever
// stored the lock flag, never the variance detail - but every item that had a
// variance on lock got a StockCard 'Adjustment' entry tagged "EOD Audit: …"
// (see POST /api/inventory/count above), with its own unitCost snapshot, so
// the report is fully recoverable from that instead of needing a schema change.
app.get('/api/inventory/eod-history/:dateString/variance', verifyToken, requireStaff, async (req, res) => {
  try {
    const { dateString } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return res.status(400).json({ success: false, error: 'Invalid date.' });
    // dateString is a Manila calendar day (see toLocaleDateString(...,
    // {timeZone:'Asia/Manila'}) in POST /api/inventory/count above) - an
    // explicit +08:00 offset here keeps the boundary correct regardless of
    // what timezone the server process itself runs in (naive T00:00:00
    // parsing used the SERVER's local zone, which silently missed every
    // entry whenever that didn't happen to be Manila).
    const dayStart = new Date(`${dateString}T00:00:00+08:00`);
    const dayEnd = new Date(`${dateString}T23:59:59.999+08:00`);
    const cards = await StockCard.find({
      type: 'Adjustment', remarks: /^EOD Audit:/, date: { $gte: dayStart, $lte: dayEnd },
    }).sort({ itemName: 1 }).lean();
    const rows = cards.map(c => ({
      itemName: c.itemName, qtyChange: c.qtyChange, balanceAfter: c.balanceAfter,
      unitCost: c.unitCost || 0, valueImpact: +((c.qtyChange || 0) * (c.unitCost || 0)).toFixed(2),
      reason: (c.remarks || '').replace(/^EOD Audit:\s*/, ''), reference: c.reference,
    }));
    const totalValueImpact = +rows.reduce((s, r) => s + r.valueImpact, 0).toFixed(2);
    res.json({ success: true, dateString, rows, totalValueImpact });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.get('/api/inventory/history/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    // Capped and lean: a busy item accumulates a row per sale, and hydrating
    // the whole lifetime of one ingredient to show a history panel is what
    // eventually takes the process down.
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 200));
    const history = await StockCard.find({ inventoryId: req.params.id })
      .sort({ date: -1 }).limit(limit).lean();
    res.json({ success: true, history, limit, truncated: history.length === limit });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Stock card history for the master report.
//
// This used to fetch the ENTIRE collection, unfiltered and hydrated, so the
// client could filter it down to a single day in the browser. StockCard gains a
// row per stock movement and never shrinks, so that transferred (and held in
// memory) the whole trading history of the business to print one day of it.
// The range is now applied here, and the result is capped rather than
// unbounded - a report is a window, not a dump.
app.get('/api/inventory/history', verifyToken, requireStaff, async (req, res) => {
  try {
    const q = {};
    if (req.query.start || req.query.end) {
      q.date = {};
      // dayStart/dayEnd, not new Date(): a bare YYYY-MM-DD parses as UTC
      // midnight while setHours() is local, so mixing them drops every
      // movement recorded before 8am in UTC+8.
      if (req.query.start) q.date.$gte = dayStart(req.query.start);
      if (req.query.end) q.date.$lte = dayEnd(req.query.end);
    }
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 2000));
    const history = await StockCard.find(q).sort({ date: -1 }).limit(limit).lean();
    // Told plainly, so a report built on a clipped set is never mistaken for a
    // complete one.
    res.json({ success: true, history, limit, truncated: history.length === limit });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Inventory CRUD
// 30-day usage (base units) per inventory id, resolved through recipes (fb) or the
// 1:1 product↔stock link (log). Same resolution as the PO-suggestion report so the
// auto-threshold and the suggested PO agree on how fast each item moves.
async function computeUsage30d(bizScope) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [inv, orders, products] = await Promise.all([
    Inventory.find(bizScope, { itemCode: 1, itemName: 1, unitMultiplier: 1, unit: 1, displayUnit: 1 }).lean(),
    Order.find({ ...bizScope, status: 'Completed', createdAt: { $gte: since } }, { items: 1 }).lean(),
    Product.find(bizScope, { _id: 1, name: 1, productCode: 1, baseRecipe: 1, sizes: 1 }).lean(),
  ]);
  const prodMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));
  const invByCode = {}, invByName = {};
  inv.forEach(i => { if (i.itemCode) invByCode[i.itemCode] = i; if (i.itemName) invByName[i.itemName] = i; });
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
        const linked = invByCode[prod.productCode] || invByName[prod.name];
        if (linked) usage[linked._id.toString()] = (usage[linked._id.toString()] || 0) + (it.quantity || 0) * baseUnitsPerSale(prod, linked);
      }
    }
  }
  return usage;
}

// Auto low-stock threshold: when an item has no explicit threshold, derive one from
// velocity so fast-moving stock gets flagged before it runs out. threshold ≈ ADU ×
// cover-days buffer (base units), rounded up. Never overwrites a manual threshold.
const AUTO_THRESHOLD_COVER_DAYS = 4;
function enrichThresholds(items, usage) {
  return items.map(i => {
    const adu = (usage[i._id.toString()] || 0) / 30;
    const manual = Number(i.lowStockThreshold) || 0;
    const autoThreshold = adu > 0 ? Math.ceil(adu * AUTO_THRESHOLD_COVER_DAYS) : 0;
    const thresholdIsAuto = manual <= 0 && autoThreshold > 0;
    return { ...i, avgDailyUse: +adu.toFixed(3), autoThreshold, thresholdIsAuto, effectiveThreshold: manual > 0 ? manual : autoThreshold };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// #7 STORAGE PLACES & STOCK CATEGORIES - small managed reference collections.
// Places = where stock physically sits (used by the transfer workflow #8);
// Categories carry the item-code prefix that drives auto-numbering (#9).
// ─────────────────────────────────────────────────────────────────────────────

// Next item code under a category prefix: PREFIX + zero-padded running number,
// e.g. prefix "P1" → P10001, P10002. Scans existing codes with that exact prefix
// so gaps from deletes don't reuse a number.
async function nextCategoryCode(prefix) {
  const p = String(prefix || '').toUpperCase().trim();
  if (!p) return null;
  const rx = new RegExp(`^${escapeRegex(p)}(\\d+)$`);
  const rows = await Inventory.find(
    { itemCode: { $regex: `^${escapeRegex(p)}\\d+$` }, businessType: BUSINESS_TYPE },
    { itemCode: 1 }
  ).lean();
  let max = 0;
  for (const r of rows) { const m = rx.exec(r.itemCode || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${p}${String(max + 1).padStart(4, '0')}`;
}

// --- Storage locations ---
app.get('/api/stock-locations', verifyToken, requireStaff, async (req, res) => {
  try {
    const rows = await StorageLocation.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).sort({ name: 1 }).lean();
    res.json({ success: true, locations: rows });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.post('/api/stock-locations', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const name = title(String(req.body.name || '').trim());
    if (!name) return res.status(400).json({ success: false, error: 'Location name required.' });
    const dup = await StorageLocation.findOne({ businessType: BUSINESS_TYPE, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    if (dup) return res.status(400).json({ success: false, error: 'Location already exists.' });
    const loc = await StorageLocation.create({ name, note: String(req.body.note || '').trim().slice(0, 500) });
    res.json({ success: true, location: loc });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.put('/api/stock-locations/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const loc = await StorageLocation.findById(req.params.id);
    if (!loc) return res.status(404).json({ success: false, error: 'Location not found.' });
    const oldName = loc.name;
    if (req.body.name !== undefined) {
      const name = title(String(req.body.name || '').trim());
      if (!name) return res.status(400).json({ success: false, error: 'Location name required.' });
      loc.name = name;
    }
    if (req.body.note !== undefined) loc.note = String(req.body.note || '').trim().slice(0, 500);
    if (typeof req.body.isActive === 'boolean') loc.isActive = req.body.isActive;
    await loc.save();
    // Rename cascades to inventory rows so the tag stays valid.
    if (loc.name !== oldName) await Inventory.updateMany({ businessType: BUSINESS_TYPE, stockLocation: oldName }, { $set: { stockLocation: loc.name } });
    res.json({ success: true, location: loc });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.delete('/api/stock-locations/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const loc = await StorageLocation.findById(req.params.id);
    if (!loc) return res.status(404).json({ success: false, error: 'Location not found.' });
    const inUse = await Inventory.countDocuments({ businessType: BUSINESS_TYPE, stockLocation: loc.name });
    if (inUse > 0) return res.status(400).json({ success: false, error: `Cannot delete - ${inUse} item(s) still assigned to this location. Reassign them first, or deactivate instead.` });
    await loc.deleteOne();
    res.json({ success: true });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// --- Stock categories ---
app.get('/api/stock-categories', verifyToken, requireStaff, async (req, res) => {
  try {
    const rows = await StockCategory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).sort({ name: 1 }).lean();
    res.json({ success: true, categories: rows });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.post('/api/stock-categories', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const name = title(String(req.body.name || '').trim());
    if (!name) return res.status(400).json({ success: false, error: 'Category name required.' });
    const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const dup = await StockCategory.findOne({ businessType: BUSINESS_TYPE, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    if (dup) return res.status(400).json({ success: false, error: 'Category already exists.' });
    if (prefix) {
      const pdup = await StockCategory.findOne({ businessType: BUSINESS_TYPE, prefix });
      if (pdup) return res.status(400).json({ success: false, error: `Prefix "${prefix}" already used by "${pdup.name}". Pick a unique prefix.` });
    }
    const cat = await StockCategory.create({ name, prefix, note: String(req.body.note || '').trim().slice(0, 500) });
    res.json({ success: true, category: cat });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.put('/api/stock-categories/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const cat = await StockCategory.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found.' });
    const oldName = cat.name;
    if (req.body.name !== undefined) {
      const name = title(String(req.body.name || '').trim());
      if (!name) return res.status(400).json({ success: false, error: 'Category name required.' });
      cat.name = name;
    }
    if (req.body.prefix !== undefined) {
      const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (prefix && prefix !== cat.prefix) {
        const pdup = await StockCategory.findOne({ businessType: BUSINESS_TYPE, prefix, _id: { $ne: cat._id } });
        if (pdup) return res.status(400).json({ success: false, error: `Prefix "${prefix}" already used by "${pdup.name}".` });
      }
      cat.prefix = prefix;
    }
    if (req.body.note !== undefined) cat.note = String(req.body.note || '').trim().slice(0, 500);
    if (typeof req.body.isActive === 'boolean') cat.isActive = req.body.isActive;
    await cat.save();
    if (cat.name !== oldName) await Inventory.updateMany({ businessType: BUSINESS_TYPE, stockCategory: oldName }, { $set: { stockCategory: cat.name } });
    res.json({ success: true, category: cat });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// One-time repair for categories that predate the import's auto-derive-prefix
// logic (#9 extension) - those got created with a blank prefix and never
// retroactively got one, since the derive-on-import path only fires for rows
// in a NEW import, not for categories that already existed. Scans every
// blank-prefix category's items (falling back through the linked Product's
// category for older rows that predate `Inventory.stockCategory` existing at
// all, and backfilling that field while we're at it), derives a prefix from
// the most common code pattern, and fills it in - same one-shot semantics as
// the per-row derive (never overwrites a prefix that's already set, and skips
// a category whose derived prefix would collide with another category's).
// Purely additive/non-destructive: never touches any item's own itemCode.
app.post('/api/stock-categories/backfill-prefixes', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const cats = await StockCategory.find({ businessType: BUSINESS_TYPE, $or: [{ prefix: '' }, { prefix: { $exists: false } }] });
    const results = { checked: cats.length, filled: [], skipped: [] };
    for (const cat of cats) {
      let items = await Inventory.find({ businessType: BUSINESS_TYPE, stockCategory: cat.name }, { itemCode: 1 }).lean();
      if (items.length === 0) {
        // Older rows never got Inventory.stockCategory set (before that field
        // was populated on import) - fall back to the linked Product's category.
        const prods = await Product.find({ businessType: BUSINESS_TYPE, category: cat.name }, { productCode: 1 }).lean();
        const codes = prods.map(p => p.productCode).filter(Boolean);
        if (codes.length) {
          items = await Inventory.find({ businessType: BUSINESS_TYPE, itemCode: { $in: codes } }, { itemCode: 1 }).lean();
          // Backfill the field itself so this fallback isn't needed again next time.
          if (items.length) await Inventory.updateMany({ _id: { $in: items.map(i => i._id) } }, { $set: { stockCategory: cat.name } });
        }
      }
      if (items.length === 0) { results.skipped.push({ name: cat.name, reason: 'no items found' }); continue; }

      const counts = {};
      for (const it of items) {
        const code = String(it.itemCode || '').toUpperCase().trim();
        const p = code.length > 4 && /^\d{4}$/.test(code.slice(-4)) ? code.slice(0, -4) : '';
        if (p) counts[p] = (counts[p] || 0) + 1;
      }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (ranked.length === 0) { results.skipped.push({ name: cat.name, reason: 'no derivable code pattern' }); continue; }
      const [prefix] = ranked[0];

      const conflict = await StockCategory.findOne({ businessType: BUSINESS_TYPE, prefix, _id: { $ne: cat._id } });
      if (conflict) { results.skipped.push({ name: cat.name, reason: `prefix "${prefix}" already used by "${conflict.name}"` }); continue; }

      cat.prefix = prefix;
      await cat.save();
      results.filled.push({ name: cat.name, prefix });
    }
    res.json({ success: true, ...results });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Explicit, opt-in bulk renumber - every item currently in this category gets
// a fresh sequential code under the category's CURRENT prefix (P90001,
// P90002, ...), ordered by their existing code. This is a separate action
// from saving the prefix itself (which never touches existing codes - see the
// PUT route above) precisely because renumbering is the disruptive one:
// mirrors that same single-item cascade (rename the Inventory item, then the
// linked resale Product's productCode) but for every item in the category at
// once. Historical Orders/StockCards/JournalEntries are untouched by design -
// StockCards key off inventoryId (unaffected) and a past order line is a
// booked record of what was sold under the code THAT DAY, which must stay
// exactly as it was for the books to still reconcile.
app.post('/api/stock-categories/:id/renumber', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const cat = await StockCategory.findById(req.params.id).session(session);
    if (!cat) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ success: false, error: 'Category not found.' }); }
    if (!cat.prefix) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ success: false, error: 'Set a prefix for this category first.' }); }

    let items = await Inventory.find({ businessType: BUSINESS_TYPE, stockCategory: cat.name })
      .sort({ itemCode: 1 }).session(session);
    if (items.length === 0) {
      // Same fallback as the prefix backfill above: older items never got
      // Inventory.stockCategory populated at all (it didn't exist as a field
      // yet when they were imported) - the category only shows on their
      // linked Product. Find them that way instead, and backfill the field
      // while we're here so this fallback isn't needed again next time.
      const prods = await Product.find({ businessType: BUSINESS_TYPE, category: cat.name }, { productCode: 1 }).session(session).lean();
      const codes = prods.map(p => p.productCode).filter(Boolean);
      if (codes.length) {
        items = await Inventory.find({ businessType: BUSINESS_TYPE, itemCode: { $in: codes } }).sort({ itemCode: 1 }).session(session);
        if (items.length) {
          await Inventory.updateMany({ _id: { $in: items.map(i => i._id) } }, { $set: { stockCategory: cat.name } }, { session });
        }
      }
    }
    if (items.length === 0) { await session.abortTransaction(); session.endSession(); return res.json({ success: true, renamed: [], unchanged: 0 }); }
    if (items.length > 9999) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'Too many items for a 4-digit sequence (max 9999).' });
    }

    // Two-phase: if the prefix is unchanged (this is a "close the gaps"
    // renumber, not a prefix switch), a straight in-place reassignment can
    // collide mid-loop with another item in this same batch that hasn't been
    // renamed yet (itemCode has a uniqueness constraint). Stage everything
    // through a scratch code first so no intermediate state can ever collide
    // with either an old or a final code.
    const plan = items.map((item, i) => ({
      item, oldCode: item.itemCode, newCode: `${cat.prefix}${String(i + 1).padStart(4, '0')}`,
    })).filter(p => p.newCode !== p.oldCode);
    const unchanged = items.length - plan.length;

    for (const p of plan) {
      p.item.itemCode = `__RENUM__${p.item._id}`;
      await p.item.save({ session });
    }
    const renamed = [];
    for (const p of plan) {
      p.item.itemCode = p.newCode;
      await p.item.save({ session });
      await Product.updateMany(
        { productCode: p.oldCode, businessType: BUSINESS_TYPE },
        { $set: { productCode: p.newCode } },
        { session },
      );
      renamed.push({ itemName: p.item.itemName, from: p.oldCode, to: p.newCode });
    }

    await logAudit(req, { action: 'stock-category-renumber', entity: 'StockCategory', entityId: cat._id, after: { category: cat.name, prefix: cat.prefix, renamed: renamed.length, unchanged } });
    await session.commitTransaction();
    session.endSession();
    emitToMgr('erpUpdated');
    res.json({ success: true, renamed, unchanged });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    log.error({ err }, 'POST /api/stock-categories/:id/renumber failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/stock-categories/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const cat = await StockCategory.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found.' });
    const inUse = await Inventory.countDocuments({ businessType: BUSINESS_TYPE, stockCategory: cat.name });
    if (inUse > 0) return res.status(400).json({ success: false, error: `Cannot delete - ${inUse} item(s) still in this category. Reassign them first, or deactivate instead.` });
    await cat.deleteOne();
    res.json({ success: true });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ─────────────────────────────────────────────────────────────────────────────
// #8 STOCK TRANSFERS - request → approve → release between two per-location items.
// Internal asset move: no journal entry; StockCard audit rows written on release.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/stock-transfers', verifyToken, requireStaff, async (req, res) => {
  try {
    const filter = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    if (req.query.status) filter.status = String(req.query.status);
    const rows = await StockTransfer.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, transfers: rows });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Cross-location analytics: on-hand qty & value grouped by storage location.
app.get('/api/stock-analytics/by-location', verifyToken, requireStaff, async (req, res) => {
  try {
    const items = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) },
      { itemName: 1, stockQty: 1, unitCost: 1, stockLocation: 1, unit: 1, lowStockThreshold: 1 }).lean();
    const byLoc = {};
    for (const i of items) {
      const key = i.stockLocation || '(Unassigned)';
      const b = byLoc[key] || (byLoc[key] = { location: key, itemCount: 0, totalValue: 0, lowStockCount: 0 });
      b.itemCount += 1;
      b.totalValue += (i.stockQty || 0) * (i.unitCost || 0);
      if ((i.lowStockThreshold || 0) > 0 && (i.stockQty || 0) <= i.lowStockThreshold) b.lowStockCount += 1;
    }
    const locations = Object.values(byLoc).map(b => ({ ...b, totalValue: +b.totalValue.toFixed(2) })).sort((a, b) => b.totalValue - a.totalValue);
    res.json({ success: true, locations });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Request a transfer (staff). Validates both items exist and qty > 0.
// Optional expiryDate pins the transfer to one specific lot on the source item
// (an ISO date matching one of its expiryBatches' rotation date - the batch's
// expiryDate, or its productionDate for goods with no real expiry, e.g. beans);
// omitted/null = FEFO/FPFO (oldest first) at release time - the default and
// recommended choice.
app.post('/api/stock-transfers', verifyToken, requireStaff, async (req, res) => {
  try {
    const { fromItemId, toItemId, qtyBase, note, expiryDate } = req.body || {};
    if (!fromItemId || !toItemId) return res.status(400).json({ success: false, error: 'Source and destination items are required.' });
    if (String(fromItemId) === String(toItemId)) return res.status(400).json({ success: false, error: 'Source and destination must be different items.' });
    const qty = Number(qtyBase);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, error: 'Transfer quantity must be greater than zero.' });
    const [from, to] = await Promise.all([Inventory.findById(fromItemId), Inventory.findById(toItemId)]);
    if (!from || !to) return res.status(404).json({ success: false, error: 'Source or destination item not found.' });
    if (qty > (from.stockQty || 0) + 1e-6) return res.status(400).json({ success: false, error: `Only ${from.stockQty} ${from.unit || ''} on hand at source.` });
    // Early feedback only - release() re-validates against stock as of that moment,
    // which is authoritative (this item's batches can change between request and release).
    let pinnedExpiry = null;
    if (expiryDate) {
      const targetTime = new Date(expiryDate).getTime();
      const batch = (from.expiryBatches || []).find(b => {
        const d = b.expiryDate ?? b.productionDate;
        return d && new Date(d).getTime() === targetTime;
      });
      if (!batch) return res.status(400).json({ success: false, error: 'Selected batch not found on the source item.' });
      if (qty > (batch.qty || 0) + 1e-6) return res.status(400).json({ success: false, error: `Only ${batch.qty} ${from.unit || ''} in the selected batch.` });
      pinnedExpiry = batch.expiryDate ?? batch.productionDate;
    }
    const reference = await mkSeqRef('XFER');
    const transfer = await StockTransfer.create({
      reference, fromItemId, toItemId, itemName: from.itemName,
      fromLocation: from.stockLocation || '', toLocation: to.stockLocation || '',
      qtyBase: qty, unit: from.unit || '', status: 'Requested', expiryDate: pinnedExpiry,
      note: String(note || '').trim().slice(0, 500), requestedBy: req.user?.name || '',
    });
    await logAudit(req, { action: 'create', entity: 'StockTransfer', entityId: transfer._id, after: { reference, itemName: transfer.itemName, qtyBase: qty, fromLocation: transfer.fromLocation, toLocation: transfer.toLocation } });
    emitToMgr('erpUpdated');
    res.json({ success: true, transfer });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Approve (superadmin). Requested → Approved.
app.post('/api/stock-transfers/:id/approve', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const t = await StockTransfer.findById(req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'Transfer not found.' });
    if (t.status !== 'Requested') return res.status(400).json({ success: false, error: `Only a Requested transfer can be approved (currently ${t.status}).` });
    t.status = 'Approved'; t.approvedBy = req.user?.name || ''; t.approvedAt = new Date();
    await t.save();
    await logAudit(req, { action: 'approve', entity: 'StockTransfer', entityId: t._id, after: { reference: t.reference, itemName: t.itemName, qtyBase: t.qtyBase } });
    emitToMgr('erpUpdated');
    res.json({ success: true, transfer: t });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Reject (superadmin) or cancel (staff, own request while still Requested).
app.post('/api/stock-transfers/:id/reject', verifyToken, requireStaff, async (req, res) => {
  try {
    const t = await StockTransfer.findById(req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'Transfer not found.' });
    if (t.status === 'Released') return res.status(400).json({ success: false, error: 'A released transfer cannot be cancelled - reverse it with a new transfer.' });
    if (['Rejected', 'Cancelled'].includes(t.status)) return res.status(400).json({ success: false, error: `Transfer already ${t.status}.` });
    const isSuper = req.user?.role === 'superadmin';
    t.status = isSuper ? 'Rejected' : 'Cancelled';
    await t.save();
    await logAudit(req, { action: isSuper ? 'reject' : 'cancel', entity: 'StockTransfer', entityId: t._id, after: { reference: t.reference, itemName: t.itemName, qtyBase: t.qtyBase } });
    emitToMgr('erpUpdated');
    res.json({ success: true, transfer: t });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Release (staff): Approved → Released. Moves the quantity between the two items
// inside a transaction and writes a StockCard row on each side.
app.post('/api/stock-transfers/:id/release', verifyToken, requireStaff, async (req, res) => {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      let released = null;
      await session.withTransaction(async () => {
        const t = await StockTransfer.findById(req.params.id).session(session);
        if (!t) throw Object.assign(new Error('Transfer not found.'), { httpStatus: 404 });
        if (t.status !== 'Approved') throw Object.assign(new Error(`Only an Approved transfer can be released (currently ${t.status}).`), { httpStatus: 400 });
        const from = await Inventory.findById(t.fromItemId).session(session);
        const to = await Inventory.findById(t.toItemId).session(session);
        if (!from || !to) throw Object.assign(new Error('Source or destination item no longer exists.'), { httpStatus: 404 });
        if (t.qtyBase > (from.stockQty || 0) + 1e-6) throw Object.assign(new Error(`Only ${from.stockQty} ${from.unit || ''} on hand at source now.`), { httpStatus: 400 });

        from.stockQty = +(from.stockQty - t.qtyBase).toFixed(6);
        to.stockQty = +(to.stockQty + t.qtyBase).toFixed(6);

        // FEFO by default, or drawn from the one batch the requester pinned.
        // Items with no batches at all (non-perishables) are untouched here -
        // the stockQty move above is the whole story for them, same as before.
        if ((from.expiryBatches || []).length > 0) {
          const r = t.expiryDate
            ? consumeSpecificBatch(from.expiryBatches, t.expiryDate, t.qtyBase)
            : consumeBatches(from.expiryBatches, t.qtyBase);
          if (r.leftover > 1e-6) {
            const msg = t.expiryDate
              ? `Only ${r.consumed} ${from.unit || ''} left in the selected batch (exp ${new Date(t.expiryDate).toLocaleDateString()}).`
              : `Only ${r.consumed} ${from.unit || ''} left across the source item's batches.`;
            throw Object.assign(new Error(msg), { httpStatus: 400 });
          }
          from.expiryBatches = r.batches;
          from.expiryDate = soonestExpiry(from.expiryBatches);
          for (const c of r.consumedDetail) {
            to.expiryBatches = addBatch(to.expiryBatches || [], {
              qty: c.qty, expiryDate: c.expiryDate, productionDate: c.productionDate, receivedAt: new Date(),
              reference: t.reference, unitCost: from.unitCost,
            });
          }
          to.expiryDate = soonestExpiry(to.expiryBatches);
        }

        await from.save({ session });
        await to.save({ session });

        await StockCard.create([{
          inventoryId: from._id, itemName: from.itemName, type: 'Transfer Out',
          reference: t.reference, qtyChange: -t.qtyBase, balanceAfter: from.stockQty,
          unitCost: from.unitCost, remarks: `Transfer to ${t.toLocation || to.itemName} (${t.reference})`,
        }, {
          inventoryId: to._id, itemName: to.itemName, type: 'Transfer In',
          reference: t.reference, qtyChange: t.qtyBase, balanceAfter: to.stockQty,
          unitCost: to.unitCost, remarks: `Transfer from ${t.fromLocation || from.itemName} (${t.reference})`,
        }], { session, ordered: true });

        t.status = 'Released'; t.releasedBy = req.user?.name || ''; t.releasedAt = new Date();
        await t.save({ session });
        released = t;
      });
      await session.endSession();
      await logAudit(req, { action: 'release', entity: 'StockTransfer', entityId: released._id, after: { reference: released.reference, itemName: released.itemName, qtyBase: released.qtyBase, fromLocation: released.fromLocation, toLocation: released.toLocation } });
      emitToMgr('erpUpdated');
      return res.json({ success: true, transfer: released });
    } catch (err) {
      await session.endSession();
      if (err?.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
      const transient = err?.errorLabels?.includes?.('TransientTransactionError') || /WriteConflict/i.test(err?.message || '');
      if (transient && attempt < MAX_ATTEMPTS) continue;
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
      return;
    }
  }
});

app.get('/api/inventory', verifyToken, requireStaff, async (req, res) => {
  try {
  const { page, limit: lim, search } = req.query;
  // Tenancy: stamp businessType on the filter so each instance only sees its own.
  // Escape the user-supplied search string to neutralise ReDoS / regex injection.
  const filter = search ? { itemName: { $regex: escapeRegex(search), $options: 'i' }, businessType: BUSINESS_TYPE } : { businessType: BUSINESS_TYPE };
  Object.assign(filter, tenantScope(req)); // per-tenant scoping (no-op when token has no tenantId)
  const usage = await computeUsage30d({ businessType: BUSINESS_TYPE, ...tenantScope(req) });
  if (page) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 50);
    const [items, total] = await Promise.all([
      Inventory.find(filter).sort({ itemName: 1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      Inventory.countDocuments(filter)
    ]);
    return res.json({ success: true, items: enrichThresholds(items, usage), total, page: pageNum, pages: Math.ceil(total / pageSize) });
  }
  const items = await Inventory.find(filter).sort({ itemName: 1 }).lean();
  res.json({ success: true, items: enrichThresholds(items, usage) });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/inventory', verifyToken, requireStaff, async (req, res) => {
  try {
    // Canonicalize first so the stored name is stable ("test milk" → "TEST MILK")
    // and the existing case-insensitive dup check compares like with like. Stock
    // item names are always ALL CAPS, matching the billing statement convention.
    req.body.itemName = upper(req.body.itemName);
    if (!req.body.itemName) return res.status(400).json({ success: false, error: 'Item name required.' });
    const existing = await Inventory.findOne({ itemName: { $regex: new RegExp(`^${escapeRegex(req.body.itemName)}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'Item already exists.' });

    // Item code (#9): if the chosen stock category carries a prefix, auto-number
    // under it (Beans "P1" → P10001, P10002); otherwise fall back to global RML codes.
    // A manually supplied itemCode always wins.
    if (!String(req.body.itemCode || '').trim()) {
      let code = null;
      if (String(req.body.stockCategory || '').trim()) {
        const cat = await StockCategory.findOne({ businessType: BUSINESS_TYPE, name: req.body.stockCategory });
        if (cat?.prefix) code = await nextCategoryCode(cat.prefix);
      }
      req.body.itemCode = code || await generateNextSequence(Inventory, 'RML', 'itemCode');
    }
    // Seed expiryBatches with the initial batch if an expiry OR production date is
    // provided - goods with no real expiry (roasted beans, etc.) date freshness by
    // production date instead.
    const purchRef = await mkSeqRef('INV-PURCH');
    if ((req.body.expiryDate || req.body.productionDate) && req.body.stockQty > 0) {
      req.body.expiryBatches = [{
        qty: req.body.stockQty,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        productionDate: req.body.productionDate ? new Date(req.body.productionDate) : null,
        receivedAt: new Date(),
        reference: purchRef,
        unitCost: req.body.unitCost || 0
      }];
    }
    // Resolve creditAccount against the full COA (canonical + custom). Allowed
    // parents: 111 (Cash), 112 (Bank), 113 (E-Wallet), 220 (AP). Any sub-account
    // under those parents works too - so users can route to specific cash drawers,
    // bank accounts, or supplier-specific AP sub-ledgers added in the COA UI.
    const { creditAccount: rawCreditCode, supplierId, supplierName, revolvingFundId } = req.body;
    const isAllowedParent = (c) => /^(111|112|113|220)/.test(String(c || ''));
    const resolved = acctMeta(rawCreditCode);
    let creditCode = (resolved && isAllowedParent(rawCreditCode)) ? rawCreditCode : '111000';
    let creditName = acctMeta(creditCode)?.name || 'Cash on Hand';
    const isOnCredit = String(creditCode).startsWith('220');

    // Cost has to be known before the item is created, because a fund-funded
    // receipt must reserve the money first - creating stock we then can't pay
    // for would leave the two books disagreeing.
    const plannedCost = (Number(req.body.stockQty) || 0) * (Number(req.body.unitCost) || 0);

    // Revolving-fund funding: the fund is a real pot of money with its own
    // running balance, so crediting 114000 alone would let the ledger and the
    // fund's own book drift apart. Reserve conditionally so two simultaneous
    // receipts can't both spend the same last peso.
    let fund = null;
    if (revolvingFundId) {
      if (!mongoose.Types.ObjectId.isValid(revolvingFundId))
        return res.status(400).json({ success: false, error: 'Invalid revolving fund.' });
      fund = await RevolvingFund.findOne({ _id: revolvingFundId, isActive: true });
      if (!fund) return res.status(404).json({ success: false, error: 'Revolving fund not found or closed.' });
      if (plannedCost > fund.currentBalance)
        return res.status(400).json({ success: false, error: `Insufficient fund balance in ${fund.name}. Available: PHP ${fund.currentBalance.toFixed(2)}, needed: PHP ${plannedCost.toFixed(2)}.` });
      if (plannedCost > 0) {
        const reserved = await RevolvingFund.updateOne(
          { _id: fund._id, isActive: true, currentBalance: { $gte: plannedCost } },
          { $inc: { currentBalance: -plannedCost } },
        );
        if (!reserved.modifiedCount)
          return res.status(409).json({ success: false, error: `Fund balance changed while receiving - ${fund.name} no longer covers PHP ${plannedCost.toFixed(2)}. Try again.` });
      }
      creditCode = '114000';
      creditName = 'Petty Cash / Revolving Fund';
    }

    const supplierAttr = isOnCredit
      ? { supplierId: supplierId ? String(supplierId) : null, supplierName: String(supplierName || '').trim() }
      : {};

    let newItem;
    try {
      newItem = await Inventory.create(req.body);
    } catch (createErr) {
      // Hand the reserved money back - no stock was created, so no money left.
      if (fund && plannedCost > 0) {
        try { await RevolvingFund.updateOne({ _id: fund._id }, { $inc: { currentBalance: plannedCost } }); }
        catch (e) { log?.error?.({ err: e, fundId: String(fund._id) }, 'Failed to release revolving-fund hold after item creation failed'); }
      }
      throw createErr;
    }

    // --- AUTO-JOURNAL FOR PURCHASING INVENTORY ---
    const totalCost = newItem.stockQty * newItem.unitCost;
    if (totalCost > 0) {
      const reference = purchRef;
      const lines = [
        { accountCode: '130000', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: creditCode, accountName: creditName,   debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({
        reference,
        description: `Purchased ${newItem.stockQty}${newItem.unit} of ${newItem.itemName}${isOnCredit ? ` on credit${supplierAttr.supplierName ? ` from ${supplierAttr.supplierName}` : ''}` : ''}${fund ? ` from ${fund.name}` : ''}`,
        lines, totalDebit: totalCost, totalCredit: totalCost, ...supplierAttr,
      });
    }

    // Record the draw on the fund's own ledger. Non-fatal: stock and money have
    // both already moved, and failing here would report nothing happened.
    if (fund && plannedCost > 0) {
      try {
        const after = await RevolvingFund.findById(fund._id, { currentBalance: 1 }).lean();
        await RevolvingFundTx.create({
          fundId: fund._id, type: 'disbursement', amount: plannedCost,
          description: `Inventory received: ${newItem.itemName} (${purchRef})`,
          // Debit side is Inventory Asset, not an expense - stock bought from
          // the fund is capitalised and expensed as COGS when it sells.
          categoryCode: '130000',
          performedBy: req.user?.name || '',
          balanceAfter: after?.currentBalance ?? fund.currentBalance,
        });
      } catch (e) { log?.error?.({ err: e }, 'Revolving-fund receipt tx log failed'); }
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item: newItem, fundedBy: fund ? { fundId: String(fund._id), name: fund.name } : null, onCredit: isOnCredit });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- INVENTORY REVALUATION: set book Inventory (130000) = actual on-hand value ---
// Resolves negative/incorrect inventory caused by missing opening balance / purchases.
// Offset defaults to Owner's Capital (opening contribution; no P&L impact); '530000'
// books it as an Inventory Adjustment instead.
app.post('/api/inventory/revalue', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const VALID = { '310000': "Owner's Capital", '530000': 'Inventory Adjustments' };
    const offCode = VALID[req.body.offsetAccount] ? req.body.offsetAccount : '310000';
    const offName = VALID[offCode];

    const items = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }, { stockQty: 1, unitCost: 1 }).lean();
    const onHand = +items.reduce((s, i) => s + (i.stockQty || 0) * (i.unitCost || 0), 0).toFixed(2);

    const agg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '130000' } },
      { $group: { _id: null, debit: { $sum: { $ifNull: ['$lines.debit', 0] } }, credit: { $sum: { $ifNull: ['$lines.credit', 0] } } } },
    ]);
    const book = +(((agg[0]?.debit || 0) - (agg[0]?.credit || 0))).toFixed(2);
    const diff = +(onHand - book).toFixed(2);
    if (Math.abs(diff) < 0.01) return res.json({ success: true, onHand, book, diff: 0, message: 'Inventory already matches on-hand value.' });

    const reference = await mkSeqRef('INV-REVAL');
    const lines = diff > 0
      ? [ { accountCode: '130000', accountName: 'Inventory Asset', debit: diff, credit: 0 }, { accountCode: offCode, accountName: offName, debit: 0, credit: diff } ]
      : [ { accountCode: offCode, accountName: offName, debit: -diff, credit: 0 }, { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: -diff } ];
    assertBalanced(lines, reference);
    await JournalEntry.create({ date: new Date(), reference, description: `Inventory revaluation to on-hand value (offset: ${offName})`, lines, totalDebit: Math.abs(diff), totalCredit: Math.abs(diff) });
    emitToMgr('erpUpdated');
    res.json({ success: true, onHand, book, diff, offset: offCode, reference });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// --- RESTOCK EXISTING INVENTORY (Weighted Average Cost, transactional) ---
// The whole flow - read stockQty/unitCost, compute WAC, save the item, write
// the StockCard row, post the journal entry - runs inside a single Mongo
// transaction. Two simultaneous restocks of the same SKU now serialise on the
// inventory document instead of racing the WAC math. Retries on transient
// transient errors (WriteConflict / TransientTransactionError).
app.post('/api/inventory/restock/:id', verifyToken, requireStaff, async (req, res) => {
  const {
    addedStock, totalCost, expiryDate, productionDate,
    creditAccount: rawCreditCode,
    // Funding source extras:
    //   supplierId/supplierName - attribution when receiving on credit (A/P),
    //     so "how much do we owe this supplier" stays answerable without
    //     reading journal descriptions.
    //   revolvingFundId         - receive out of a petty-cash/revolving fund;
    //     the fund's balance is actually drawn down, not just the COA account.
    supplierId, supplierName, revolvingFundId,
  } = req.body;
  const isAllowedParent = (c) => /^(111|112|113|220)/.test(String(c || ''));
  const resolved = acctMeta(rawCreditCode);
  let creditCode = (resolved && isAllowedParent(rawCreditCode)) ? rawCreditCode : '111000';
  let creditName = acctMeta(creditCode)?.name || 'Cash on Hand';

  const cost = Number(totalCost) || 0;
  const isOnCredit = String(creditCode).startsWith('220');

  // ── Revolving-fund funding ────────────────────────────────────────────────
  // The fund is a real pot of money with its own running balance, so a receipt
  // paid out of it has to move that balance - crediting 114000 alone would let
  // the ledger and the fund's own book drift apart. The balance is reserved
  // BEFORE any stock posts, with a conditional update so two simultaneous
  // receipts can't both spend the same last peso; if the restock then fails,
  // the reservation is handed back below.
  let fund = null;
  if (revolvingFundId) {
    if (!mongoose.Types.ObjectId.isValid(revolvingFundId))
      return res.status(400).json({ success: false, error: 'Invalid revolving fund.' });
    fund = await RevolvingFund.findOne({ _id: revolvingFundId, isActive: true });
    if (!fund) return res.status(404).json({ success: false, error: 'Revolving fund not found or closed.' });
    if (cost > fund.currentBalance)
      return res.status(400).json({ success: false, error: `Insufficient fund balance in ${fund.name}. Available: PHP ${fund.currentBalance.toFixed(2)}, needed: PHP ${cost.toFixed(2)}.` });
    if (cost > 0) {
      const reserved = await RevolvingFund.updateOne(
        { _id: fund._id, isActive: true, currentBalance: { $gte: cost } },
        { $inc: { currentBalance: -cost } },
      );
      if (!reserved.modifiedCount)
        return res.status(409).json({ success: false, error: `Fund balance changed while receiving - ${fund.name} no longer covers PHP ${cost.toFixed(2)}. Try again.` });
    }
    // Petty Cash / Revolving Fund is the asset the money leaves, whatever the
    // caller passed as creditAccount.
    creditCode = '114000';
    creditName = 'Petty Cash / Revolving Fund';
  }

  // Hand the reserved money back when the receipt itself never posted, so a
  // failed restock doesn't quietly shrink the fund.
  const releaseFundHold = async () => {
    if (fund && cost > 0) {
      try { await RevolvingFund.updateOne({ _id: fund._id }, { $inc: { currentBalance: cost } }); }
      catch (e) { log?.error?.({ err: e, fundId: String(fund._id) }, 'Failed to release revolving-fund hold after restock failure'); }
    }
  };

  // Record the draw on the fund's own ledger once the stock has actually
  // posted. Non-fatal: the money and the stock have both already moved, and
  // failing the request here would tell the user nothing happened when it did.
  const recordFundDraw = async (item, reference) => {
    if (!fund || cost <= 0) return;
    try {
      const after = await RevolvingFund.findById(fund._id, { currentBalance: 1 }).lean();
      await RevolvingFundTx.create({
        fundId: fund._id, type: 'disbursement', amount: cost,
        description: `Inventory received: ${addedStock} x ${item.itemName}${reference ? ` (${reference})` : ''}`,
        // The debit side is Inventory Asset, not an expense - stock bought from
        // the fund is capitalised, and expensed later as COGS when it sells.
        categoryCode: '130000',
        performedBy: req.user?.name || '',
        balanceAfter: after?.currentBalance ?? fund.currentBalance,
      });
    } catch (e) { log?.error?.({ err: e }, 'Revolving-fund receipt tx log failed'); }
  };

  // Supplier attribution only means anything on the A/P side.
  const supplierAttr = isOnCredit
    ? { supplierId: supplierId ? String(supplierId) : null, supplierName: String(supplierName || '').trim() }
    : {};

  const MAX_TXN_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_TXN_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      let savedItem = null;
      let savedRef = null;
      await session.withTransaction(async () => {
        const item = await Inventory.findById(req.params.id).session(session);
        if (!item) throw Object.assign(new Error('Item not found'), { httpStatus: 404 });

        // WAC (GAAP/IFRS). All values read inside the transaction - concurrent
        // restocks block on this document until commit.
        const currentTotalValue = item.stockQty * item.unitCost;
        const newTotalValue = currentTotalValue + totalCost;
        const newStockQty = item.stockQty + addedStock;
        const newUnitCost = newStockQty > 0 ? newTotalValue / newStockQty : 0;

        item.stockQty = newStockQty;
        item.unitCost = newUnitCost;

        const rstRef = await mkSeqRef('INV-RST');
        savedRef = rstRef;

        if ((expiryDate || productionDate) && addedStock > 0) {
          item.expiryBatches = addBatch(item.expiryBatches || [], {
            qty: addedStock,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            productionDate: productionDate ? new Date(productionDate) : null,
            receivedAt: new Date(),
            reference: rstRef,
            unitCost: newUnitCost
          });
          item.expiryDate = soonestExpiry(item.expiryBatches);
        }

        await item.save({ session });
        savedItem = item;

        const batchUnitCost = addedStock > 0 ? totalCost / addedStock : 0;
        await StockCard.create([{
          inventoryId: item._id,
          itemName: item.itemName,
          type: 'Restock',
          reference: rstRef,
          qtyChange: addedStock,
          unitCost: batchUnitCost,
          balanceAfter: item.stockQty,
          remarks: 'Restocked inventory'
        }], { session });

        if (totalCost > 0) {
          const lines = [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
            { accountCode: creditCode, accountName: creditName,      debit: 0, credit: totalCost }
          ];
          await JournalEntry.create([{
            reference: rstRef,
            description: `Restocked ${addedStock}${item.unit} of ${item.itemName}${isOnCredit ? ` on credit${supplierAttr.supplierName ? ` from ${supplierAttr.supplierName}` : ''}` : ''}${fund ? ` from ${fund.name}` : ''}`,
            lines, totalDebit: totalCost, totalCredit: totalCost,
            ...supplierAttr,
          }], { session });
        }
      });

      await recordFundDraw(savedItem, savedRef);
      emitToMgr('erpUpdated');
      await logAudit(req, { action: 'restock', entity: 'Inventory', entityId: req.params.id, after: { addedStock, totalCost, creditCode, fund: fund?.name || null, supplier: supplierAttr.supplierName || null } });
      return res.json({ success: true, item: savedItem, fundedBy: fund ? { fundId: String(fund._id), name: fund.name } : null, onCredit: isOnCredit });
    } catch (error) {
      // Standalone MongoDB without a replica set throws this - fall through to
      // the legacy non-transactional path so dev environments still work.
      const msg = String(error?.errorLabels || error?.message || '');
      const isTransient = (error?.errorLabels || []).includes('TransientTransactionError') || /WriteConflict/i.test(msg);
      if (isTransient && attempt < MAX_TXN_ATTEMPTS) {
        continue; // retry
      }
      if (error?.httpStatus === 404) {
        await releaseFundHold();
        return res.status(404).json({ success: false, error: 'Item not found' });
      }
      const isUnsupported = /Transaction numbers are only allowed|Transactions are not supported/i.test(msg);
      if (isUnsupported && attempt === 1) {
        // Dev mode (no replica set) - fall back to non-transactional path.
        log?.warn?.('Restock txn unsupported, falling back to non-transactional path.');
        try {
          const item = await Inventory.findById(req.params.id);
          if (!item) { await releaseFundHold(); return res.status(404).json({ success: false, error: 'Item not found' }); }
          const currentTotalValue = item.stockQty * item.unitCost;
          const newTotalValue = currentTotalValue + totalCost;
          const newStockQty = item.stockQty + addedStock;
          const newUnitCost = newStockQty > 0 ? newTotalValue / newStockQty : 0;
          item.stockQty = newStockQty;
          item.unitCost = newUnitCost;
          const rstRef = await mkSeqRef('INV-RST');
          if ((expiryDate || productionDate) && addedStock > 0) {
            item.expiryBatches = addBatch(item.expiryBatches || [], { qty: addedStock, expiryDate: expiryDate ? new Date(expiryDate) : null, productionDate: productionDate ? new Date(productionDate) : null, receivedAt: new Date(), reference: rstRef, unitCost: newUnitCost });
            item.expiryDate = soonestExpiry(item.expiryBatches);
          }
          await item.save();
          const batchUnitCost = addedStock > 0 ? totalCost / addedStock : 0;
          await StockCard.create({ inventoryId: item._id, itemName: item.itemName, type: 'Restock', reference: rstRef, qtyChange: addedStock, unitCost: batchUnitCost, balanceAfter: item.stockQty, remarks: 'Restocked inventory' });
          if (totalCost > 0) {
            const lines = [
              { accountCode: '130000', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
              { accountCode: creditCode, accountName: creditName, debit: 0, credit: totalCost },
            ];
            await JournalEntry.create({ reference: rstRef, description: `Restocked ${addedStock}${item.unit} of ${item.itemName}${isOnCredit ? ` on credit${supplierAttr.supplierName ? ` from ${supplierAttr.supplierName}` : ''}` : ''}${fund ? ` from ${fund.name}` : ''}`, lines, totalDebit: totalCost, totalCredit: totalCost, ...supplierAttr });
          }
          await recordFundDraw(item, rstRef);
          emitToMgr('erpUpdated');
          await logAudit(req, { action: 'restock', entity: 'Inventory', entityId: req.params.id, after: { addedStock, totalCost, fallback: true, creditCode, fund: fund?.name || null, supplier: supplierAttr.supplierName || null } });
          return res.json({ success: true, item, fundedBy: fund ? { fundId: String(fund._id), name: fund.name } : null, onCredit: isOnCredit });
        } catch (fallbackErr) {
          await releaseFundHold();
          captureError(req, fallbackErr);
          return res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : fallbackErr.message });
        }
      }
      await releaseFundHold();
      captureError(req, error);
      return res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : error.message });
    } finally {
      session.endSession();
    }
  }
});

app.put('/api/inventory/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    // Whitelist editable fields - stockQty must NEVER be edited here
    // (would bypass StockCard audit trail and double-entry accounting).
    // Stock changes go through restock / spoilage / order-completion flows.
    const allowed = ['itemName', 'unit', 'unitCost', 'lowStockThreshold', 'expiryDate', 'expiryWarnDays', 'displayUnit', 'unitMultiplier', 'srp', 'packSize', 'stockLocation', 'stockCategory'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    // itemCode is a business key: in log mode the resale Product's productCode
    // equals it, so a rename must cascade or the two silently desync. Handled
    // separately from the plain whitelist because of that cascade and the
    // uniqueness check. StockCards key off inventoryId, so history is unaffected.
    let codeRename = null;
    if ('itemCode' in req.body) {
      const raw = String(req.body.itemCode || '').trim().toUpperCase();
      if (!raw) return res.status(400).json({ success: false, error: 'Item code cannot be blank.' });
      const current = await Inventory.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ success: false, error: 'Item not found.' });
      if (raw !== current.itemCode) {
        const clash = await Inventory.findOne({
          _id: { $ne: req.params.id }, itemCode: raw,
          businessType: BUSINESS_TYPE, ...tenantScope(req),
        }).lean();
        if (clash) return res.status(400).json({ success: false, error: `Another item already uses code "${raw}".` });
        update.itemCode = raw;
        codeRename = { from: current.itemCode, to: raw };
      }
    }

    if ('itemName' in update) {
      if (typeof update.itemName !== 'string' || !update.itemName.trim()) {
        return res.status(400).json({ success: false, error: 'Item name required.' });
      }
      // Same canonical form as create, so an edit can't reintroduce a variant
      // spelling that the create path would have collapsed.
      update.itemName = upper(update.itemName);
      // Prevent duplicate-name collisions (case-insensitive)
      const dupe = await Inventory.findOne({
        _id: { $ne: req.params.id },
        itemName: { $regex: new RegExp(`^${update.itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      });
      if (dupe) return res.status(400).json({ success: false, error: `Another item already named "${update.itemName}".` });
    }
    if ('unitCost' in update) {
      const n = parseFloat(update.unitCost);
      if (Number.isNaN(n) || n < 0) return res.status(400).json({ success: false, error: 'Unit cost must be ≥ 0.' });
      update.unitCost = n;
    }
    if ('lowStockThreshold' in update) update.lowStockThreshold = Math.max(0, parseFloat(update.lowStockThreshold) || 0);
    if ('packSize' in update) {
      const n = parseFloat(update.packSize);
      update.packSize = (update.packSize === null || update.packSize === '' || Number.isNaN(n) || n <= 0) ? null : n;
    }
    if ('expiryWarnDays' in update)    update.expiryWarnDays    = Math.max(1, parseInt(update.expiryWarnDays) || 7);
    if ('expiryDate' in update) {
      if (update.expiryDate === null || update.expiryDate === '') update.expiryDate = null;
      else update.expiryDate = new Date(update.expiryDate);
    }

    const updatedItem = await Inventory.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
    if (!updatedItem) return res.status(404).json({ success: false, error: 'Item not found.' });

    // Cascade the code rename to the linked resale product (log mode). Scoped by
    // the old code so only the matching product moves; historical order lines keep
    // the code they were sold under, which is correct - those are booked records.
    if (codeRename) {
      await Product.updateMany(
        { productCode: codeRename.from, businessType: BUSINESS_TYPE, ...tenantScope(req) },
        { $set: { productCode: codeRename.to } },
      );
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item: updatedItem });
  } catch (err) {
    log.error({ err }, 'PUT /api/inventory/:id failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- EXPIRY WATCH: items expiring within N days (default 30), plus already-expired ---
app.get('/api/inventory/expiring', verifyToken, requireStaff, async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 30);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
    cutoff.setHours(23, 59, 59, 999);

    const items = await Inventory.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      expiryDate: { $ne: null, $lte: cutoff },
      stockQty: { $gt: 0 } // ignore depleted items even if expiry date lingers
    }).sort({ expiryDate: 1 }).lean();

    const now = new Date();
    const expired = items.filter(i => new Date(i.expiryDate) < now);
    const expiringSoon = items.filter(i => {
      const d = new Date(i.expiryDate);
      const warnDays = i.expiryWarnDays || 7;
      const warnCutoff = new Date(); warnCutoff.setDate(warnCutoff.getDate() + warnDays);
      return d >= now && d <= warnCutoff;
    });
    const expiringLater = items.filter(i => {
      const d = new Date(i.expiryDate);
      const warnDays = i.expiryWarnDays || 7;
      const warnCutoff = new Date(); warnCutoff.setDate(warnCutoff.getDate() + warnDays);
      return d > warnCutoff;
    });

    res.json({
      success: true,
      total: items.length,
      expired,
      expiringSoon,
      expiringLater,
      cutoffDays: days
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- BATCH MANAGEMENT: add a new expiry (or production-date) batch manually ---
app.post('/api/inventory/:id/batches', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { qty, expiryDate, productionDate, reference } = req.body;
    const n = parseFloat(qty);
    if (!n || n <= 0) return res.status(400).json({ success: false, error: 'qty must be > 0' });
    // At least one date is required - goods with no real expiry (roasted beans,
    // etc.) date freshness by production date instead.
    if (!expiryDate && !productionDate) return res.status(400).json({ success: false, error: 'expiryDate or productionDate required' });
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const batchRef = await mkSeqRef('INV-BATCH');
    const unitCost = item.unitCost || 0;
    item.expiryBatches = addBatch(item.expiryBatches || [], {
      qty: n,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      productionDate: productionDate ? new Date(productionDate) : null,
      receivedAt: new Date(),
      reference: batchRef,
      unitCost
    });
    item.expiryDate = soonestExpiry(item.expiryBatches);
    // A manually added batch is real stock arriving - keep stockQty in sync with
    // the batch total so they never drift, and book it like a found-stock adjustment.
    item.stockQty = +(Number(item.stockQty || 0) + n);
    await item.save();

    await StockCard.create({
      inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
      reference: batchRef, qtyChange: n, balanceAfter: item.stockQty, unitCost,
      remarks: `Manual batch added (${reference || 'no ref'})`,
    });

    const value = +(n * unitCost).toFixed(2);
    if (value > 0) {
      await JournalEntry.create({
        reference: batchRef, description: `Manual batch added: ${n}${item.unit} of ${item.itemName}`,
        lines: [
          { accountCode: '130000', accountName: 'Inventory Asset',            debit: value, credit: 0 },
          { accountCode: '530000', accountName: 'Inventory Adjustment Gain',  debit: 0, credit: value },
        ],
        totalDebit: value, totalCredit: value,
      });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- BATCH MANAGEMENT: correct a batch's expiry/production date by index
// (use when an import or manual entry recorded the wrong date - e.g. a
// misparsed Excel serial number). Pure metadata fix: no stock/ledger impact,
// since the physical quantity and cost aren't changing, only which date it's
// tagged with. Setting expiryDate clears productionDate and vice versa - a
// batch is dated one way or the other, never both (mirrors every other
// expiry/production entry point in the app).
app.patch('/api/inventory/:id/batches/:batchIdx', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const idx = parseInt(req.params.batchIdx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= (item.expiryBatches || []).length) {
      return res.status(400).json({ success: false, error: 'Invalid batch index.' });
    }
    const { expiryDate, productionDate } = req.body || {};
    if (!expiryDate && !productionDate) {
      return res.status(400).json({ success: false, error: 'Provide an expiryDate or productionDate.' });
    }
    if (expiryDate) {
      const d = new Date(expiryDate);
      if (isNaN(d.getTime())) return res.status(400).json({ success: false, error: 'Invalid expiry date.' });
      item.expiryBatches[idx].expiryDate = d;
      item.expiryBatches[idx].productionDate = null;
    } else {
      const d = new Date(productionDate);
      if (isNaN(d.getTime())) return res.status(400).json({ success: false, error: 'Invalid production date.' });
      item.expiryBatches[idx].productionDate = d;
      item.expiryBatches[idx].expiryDate = null;
    }
    item.expiryDate = soonestExpiry(item.expiryBatches);
    await item.save();
    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- BATCH MANAGEMENT: delete a specific batch by index (use when physical stock no longer matches) ---
app.delete('/api/inventory/:id/batches/:batchIdx', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const idx = parseInt(req.params.batchIdx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= (item.expiryBatches || []).length) {
      return res.status(400).json({ success: false, error: 'Invalid batch index.' });
    }
    const [removed] = item.expiryBatches.splice(idx, 1);
    const removedQty = Number(removed?.qty || 0);
    const unitCost   = Number(removed?.unitCost || item.unitCost || 0);
    item.expiryDate = soonestExpiry(item.expiryBatches);
    // Removing a batch means that stock is physically gone - decrement stockQty and
    // book it as a variance/write-off so the ledger and stock card stay truthful.
    item.stockQty = +Math.max(0, Number(item.stockQty || 0) - removedQty).toFixed(4);
    await item.save();

    const delRef = await mkSeqRef('INV-BATCHDEL');
    await StockCard.create({
      inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
      reference: delRef, qtyChange: -removedQty, balanceAfter: item.stockQty, unitCost,
      remarks: 'Manual batch removed (physically depleted)',
    });

    const value = +(removedQty * unitCost).toFixed(2);
    if (value > 0) {
      await JournalEntry.create({
        reference: delRef, description: `Manual batch removed: ${removedQty}${item.unit} of ${item.itemName}`,
        lines: [
          { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: value, credit: 0 },
          { accountCode: '130000', accountName: 'Inventory Asset',                     debit: 0, credit: value },
        ],
        totalDebit: value, totalCredit: value,
      });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- PATCH expiry only (after a partial spoilage clears the expired batch) ---
app.patch('/api/inventory/:id/expiry', verifyToken, requireStaff, async (req, res) => {
  try {
    const { expiryDate, expiryWarnDays } = req.body;
    const update = {};
    if (expiryDate === null || expiryDate === '') update.expiryDate = null;
    else if (expiryDate) update.expiryDate = new Date(expiryDate);
    if (expiryWarnDays !== undefined) update.expiryWarnDays = Math.max(1, parseInt(expiryWarnDays) || 7);

    const item = await Inventory.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/inventory/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found.' });
    await logAudit(req, {
      action: 'delete', entity: 'Inventory', entityId: req.params.id,
      before: { itemName: item.itemName, stockQty: item.stockQty, unit: item.unit, unitCost: item.unitCost },
    });
    emitToMgr('erpUpdated');
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ============================================================
// INVENTORY IMPORT - Stock-take semantics (new file REPLACES current qty)
// Body: { items: [{ itemName, displayUnit, qty, unitCost? }] }
// - Existing items: stockQty replaced; diff booked as Inventory Adjustment Gain (4200) or Spoilage/Variance (5100)
// - New items: created + booked as Inventory Adjustment Gain (4200)
// Every row produces a StockCard entry + a balanced journal entry.
// ============================================================
app.post('/api/inventory/import', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'No rows in import payload.' });
    }
    if (items.length > 2000) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'Too many rows (max 2000 per import).' });
    }

    const summary = { created: 0, updated: 0, increased: 0, decreased: 0, gainValue: 0, lossValue: 0, errors: [] };
    // Tracks item keys already processed within THIS import call. A code/name
    // appearing more than once in one file is a second expiry lot to ADD, not a
    // corrected recount to replace the first row with - see the additive branch
    // below. Scoped to this one request, so re-importing the same single-row
    // sheet on a later day still does a plain stock-take replace, unaffected.
    const seenThisImport = new Set();
    // A sheet's section headers ("BEANS", "TEA", ...) already imply a code
    // prefix (P10001, P20001, ...) - StockCategory.prefix (#9) is what drives
    // BOTH the "next code" auto-numbering on the manual Add form AND what shows
    // pre-filled when a category is opened for editing, but nothing populated
    // it for a category the import itself creates. Cache resolved
    // category-name -> StockCategory doc for this run so repeated rows in the
    // same section don't re-query it every time.
    const stockCategoryCache = new Map();
    const resolveStockCategory = async (name, itemCode) => {
      if (!name) return;
      if (stockCategoryCache.has(name)) return stockCategoryCache.get(name);
      // Strip the trailing 4-digit sequence to get the prefix, e.g.
      // "P10001" -> "P1", "G10001" -> "G1" - the exact convention
      // nextCategoryCode (above) itself uses to generate the NEXT code, so a
      // prefix derived here keeps future manually-added items numbered right
      // behind whatever this import just brought in.
      const code = String(itemCode || '').toUpperCase().trim();
      const derivedPrefix = code.length > 4 && /^\d{4}$/.test(code.slice(-4)) ? code.slice(0, -4) : '';
      let cat = await StockCategory.findOne({ businessType: BUSINESS_TYPE, name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } }).session(session);
      if (!cat) {
        cat = derivedPrefix
          ? await StockCategory.create([{ businessType: BUSINESS_TYPE, name, prefix: derivedPrefix }], { session }).then(r => r[0])
          : null;
      } else if (!cat.prefix && derivedPrefix) {
        // Never overwrite a prefix someone already set on this category by
        // hand - only fill it in when it was genuinely blank.
        cat.prefix = derivedPrefix;
        await cat.save({ session });
      }
      stockCategoryCache.set(name, cat);
      return cat;
    };

    for (let i = 0; i < items.length; i++) {
      const row = items[i] || {};
      const itemCode = String(row.itemCode || row.code || '').trim();
      // Stock item names are always ALL CAPS, matching the billing statement
      // convention - normalize here so a mixed-case sheet still comes in consistent.
      const itemName = upper(row.itemName || row.product || row.name || '');
      // Category (and the linked Product/menu-setup sync it triggers below) is a
      // logistics-only concept - an fb import brings in raw inventory data (stock,
      // cost, expiry) only, and never touches menu setup even if the sheet has one.
      const categoryName = BUSINESS_TYPE === 'log' ? String(row.category || '').trim() : '';
      if (categoryName) await resolveStockCategory(categoryName, itemCode);
      const srp = row.srp !== undefined && row.srp !== '' ? parseFloat(row.srp) : null;
      // In log mode the product IS the stocked good, so EVERY imported item gets a
      // linked Product (menu entry), with or without a category on the sheet - a
      // missing category falls back to a general bucket. fb never syncs products
      // from an import (categoryName is forced empty above), so this stays log-only.
      const syncProduct = BUSINESS_TYPE === 'log';
      const productCategory = categoryName || 'General';
      // FORCED RULE: only kg / L / pcs displayed. Auto-promote g→kg, ml→L.
      let displayUnit = String(row.displayUnit || row.unit || '').trim();
      if (displayUnit.toLowerCase() === 'g')  displayUnit = 'kg';
      else if (displayUnit.toLowerCase() === 'ml') displayUnit = 'L';
      else if (displayUnit.toLowerCase() === 'l') displayUnit = 'L';
      else if (['piece','pc'].includes(displayUnit.toLowerCase())) displayUnit = 'pcs';

      const qty = parseFloat(row.qty);
      const unitCostFromExcel = row.unitCost !== undefined && row.unitCost !== '' ? parseFloat(row.unitCost) : null;
      // The client already normalizes date text to unambiguous ISO before
      // sending, but this route is called directly by other callers (tests,
      // future clients) too - guard it here rather than trusting every caller
      // to pre-normalize. Two things a raw "M/D/YY(YY)" string needs fixing:
      //  - 2-digit year ("9/21/27") is read by `new Date(...)` as 1927, not 2027
      //  - every date column in these sheets is MM/DD/YYYY (not DD/MM) - once
      //    converted to explicit ISO here, nothing downstream (`new Date(...)`
      //    on this same string, elsewhere in this route) can re-parse it under
      //    a different day/month order and silently flip it.
      const normalizeDateStr = (s) => {
        if (typeof s !== 'string') return s;
        let str = s.trim();
        const m2 = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
        if (m2) {
          const yy = parseInt(m2[3], 10);
          str = `${m2[1]}/${m2[2]}/${yy < 50 ? 2000 + yy : 1900 + yy}`;
        }
        const m3 = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (m3) {
          const mo = parseInt(m3[1], 10), da = parseInt(m3[2], 10), yr = parseInt(m3[3], 10);
          if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
            str = `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
          }
        }
        return str;
      };
      const expiryFromExcel = normalizeDateStr(row.expiryDate || row.expiry || null);
      // Goods with no real expiry (roasted beans, etc.) date freshness by
      // production date instead - only meaningful when there's no expiry on the row.
      const productionFromExcel = !expiryFromExcel ? normalizeDateStr(row.productionDate || row.production || null) : null;
      // Per-qty (pack) size in displayUnit, e.g. "Milk 1L" → itemName "Milk", unit L,
      // packSize 1. The client pre-parses the size out of the product name and sends
      // it here; if a caller sends the raw unparsed name instead, fall back to
      // parsing it here so the size is never silently dropped.
      let packSizeFromExcel = row.packSize !== undefined && row.packSize !== '' ? parseFloat(row.packSize) : null;
      if (packSizeFromExcel == null || Number.isNaN(packSizeFromExcel)) {
        const m = itemName.match(/\s+([0-9]+(?:\.[0-9]+)?)\s*(kg|g|l|ml|pcs|pc)\s*$/i);
        if (m) {
          const raw = parseFloat(m[1]);
          const u = m[2].toLowerCase();
          packSizeFromExcel = (u === 'g' || u === 'ml') ? raw / 1000 : raw; // → kg / L
        }
      }
      if (packSizeFromExcel != null && (Number.isNaN(packSizeFromExcel) || packSizeFromExcel <= 0)) packSizeFromExcel = null;

      if (!itemName) { summary.errors.push(`Row ${i+1}: missing Product name`); continue; }
      if (!displayUnit) { summary.errors.push(`Row ${i+1} (${itemName}): missing Unit`); continue; }
      if (Number.isNaN(qty) || qty < 0) { summary.errors.push(`Row ${i+1} (${itemName}): invalid Qty`); continue; }

      const { base: baseUnit, mult } = resolveUnit(displayUnit);
      const newBaseQty = qty * mult;                         // storage qty in base units
      const newCostPerBase = (unitCostFromExcel != null && unitCostFromExcel >= 0)
        ? unitCostFromExcel / mult                            // convert ₱/displayUnit → ₱/baseUnit
        : null;

      // Look up by itemCode when the row provides one; only fall back to a
      // case-insensitive name match when it DOESN'T. Falling back to name-matching
      // even after an itemCode miss is what caused two genuinely different SKUs
      // that share a base name - e.g. "DK Blueberry 3kg" (code DKB-3) and
      // "DK Blueberry 2.5kg" (code DKB-25) - to collide into a single item once
      // the size suffix is stripped from both names down to "DK Blueberry". An
      // itemCode on the row is an unambiguous identity claim: if nothing has that
      // code yet, it's a NEW item, never a name-matched update of a different SKU.
      // MUST be scoped to this instance's businessType - otherwise a log import
      // matches (and overwrites) an fb-owned row of the same code/name, leaving the
      // stock stamped 'fb' (invisible to log, wrongly visible to fb) and vice-versa.
      let existing = null;
      if (itemCode) {
        existing = await Inventory.findOne({ itemCode, businessType: BUSINESS_TYPE }).session(session);
      } else {
        existing = await Inventory.findOne({
          itemName: { $regex: new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          businessType: BUSINESS_TYPE,
        }).session(session);
      }

      // Pre-generate one reference for this import row (shared by StockCard + JournalEntry)
      const impRef = await mkSeqRef('INV-IMP');

      const importKey = itemCode || itemName.toLowerCase();
      const isRepeatBatchRow = existing && seenThisImport.has(importKey);
      seenThisImport.add(importKey);

      if (existing && isRepeatBatchRow) {
        // Same item code/name seen again in this same file - a second expiry lot
        // arriving alongside the first row, not a corrected recount. ADD the qty
        // (never replace), and always record it as its own batch so it doesn't
        // silently merge into whatever the first row already set up.
        const unitCostForThisLot = newCostPerBase != null ? newCostPerBase : (existing.unitCost || 0);
        const valueImpact = newBaseQty * unitCostForThisLot;

        const currentValue = (existing.stockQty || 0) * (existing.unitCost || 0);
        existing.stockQty = (existing.stockQty || 0) + newBaseQty;
        existing.unitCost = existing.stockQty > 0 ? (currentValue + valueImpact) / existing.stockQty : unitCostForThisLot;
        existing.displayUnit = displayUnit;
        existing.unitMultiplier = mult;
        if (baseUnit) existing.unit = baseUnit;
        if (packSizeFromExcel != null) existing.packSize = packSizeFromExcel;
        if (categoryName && !existing.stockCategory) existing.stockCategory = categoryName;

        existing.expiryBatches = addBatch(existing.expiryBatches || [], {
          qty: newBaseQty,
          expiryDate: expiryFromExcel ? new Date(expiryFromExcel) : null,
          productionDate: productionFromExcel ? new Date(productionFromExcel) : null,
          receivedAt: new Date(),
          reference: impRef,
          unitCost: unitCostForThisLot,
        });
        existing.expiryDate = soonestExpiry(existing.expiryBatches);
        await existing.save({ session });

        await StockCard.create([{
          inventoryId: existing._id,
          itemName: existing.itemName,
          type: 'Stock Take Import',
          reference: impRef,
          qtyChange: newBaseQty,
          balanceAfter: existing.stockQty,
          unitCost: existing.unitCost,
          remarks: `Bulk import: +${newBaseQty} ${baseUnit} (new batch${expiryFromExcel ? `, exp ${expiryFromExcel}` : (productionFromExcel ? `, prod ${productionFromExcel}` : '')})`
        }], { session });

        if (Math.abs(valueImpact) > 0.001) {
          const lines = [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: valueImpact, credit: 0 },
            { accountCode: '310000', accountName: "Owner's Capital", debit: 0, credit: valueImpact }
          ];
          assertBalanced(lines, `IMPORT-BATCH-${existing.itemName}`);
          await JournalEntry.create([{
            reference: impRef,
            description: `Stock take import (new batch): ${existing.itemName} (+${newBaseQty.toFixed(2)} ${baseUnit} @ P${unitCostForThisLot.toFixed(4)})`,
            lines, totalDebit: valueImpact, totalCredit: valueImpact
          }], { session });
        }

        summary.updated++;
        summary.increased++;
        summary.gainValue += valueImpact;

        if (syncProduct) {
          await Product.findOneAndUpdate(
            { productCode: existing.itemCode, businessType: BUSINESS_TYPE },
            { $set: { isAvailable: existing.stockQty > 0 } },
            { session }
          );
        }
      } else if (existing) {
        const oldQty = existing.stockQty || 0;
        const diff = +(newBaseQty - oldQty).toFixed(6);
        // Gain/loss is a QUANTITY VARIANCE (physical count vs. book), so it must be
        // valued at the cost those units are CURRENTLY carried at on the books -
        // never at a new cost typed into the same row. Using the new cost here
        // previously made the loss/gain figure wrong whenever a row updated price
        // and quantity together (e.g. existing 100 @ ₱10, row says 50 @ ₱20 → the
        // 50-unit shortfall is a ₱10-cost loss of ₱500, not a ₱20-cost loss of
        // ₱1000). The new cost still gets applied to the item going forward
        // (existing.unitCost below) - it just doesn't retroactively value this
        // variance. Only fall back to the new/import cost when the item has no
        // existing cost basis at all, so a first-time cost import isn't valued at ₱0.
        const unitCostForValuation = (existing.unitCost || 0) > 0
          ? existing.unitCost
          : (newCostPerBase != null ? newCostPerBase : 0);
        const valueImpact = Math.abs(diff) * unitCostForValuation;

        // Update item: replace stockQty + (optionally) update unitCost + sync display unit
        existing.stockQty = newBaseQty;
        if (newCostPerBase != null) existing.unitCost = newCostPerBase;
        existing.displayUnit = displayUnit;
        existing.unitMultiplier = mult;
        if (baseUnit) existing.unit = baseUnit;
        if (packSizeFromExcel != null) existing.packSize = packSizeFromExcel;
        if (categoryName && !existing.stockCategory) existing.stockCategory = categoryName;

        // Expiry batches:
        //  - If Excel row carries an expiry OR production date: append it as a new
        //    batch with the +diff qty (only if diff > 0).
        //  - If diff < 0: FEFO/FPFO-consume the absolute diff from existing batches.
        //  - If diff > 0 and no date on Excel row: leave batches untouched (caller assumes existing batch still applies).
        if (diff < 0) {
          const r = consumeBatches(existing.expiryBatches || [], Math.abs(diff));
          existing.expiryBatches = r.batches;
        } else if (diff > 0 && (expiryFromExcel || productionFromExcel)) {
          existing.expiryBatches = addBatch(existing.expiryBatches || [], {
            qty: diff,
            expiryDate: expiryFromExcel ? new Date(expiryFromExcel) : null,
            productionDate: productionFromExcel ? new Date(productionFromExcel) : null,
            receivedAt: new Date(),
            reference: impRef,
            unitCost: unitCostForValuation
          });
        }
        existing.expiryDate = soonestExpiry(existing.expiryBatches || []);
        await existing.save({ session });

        await StockCard.create([{
          inventoryId: existing._id,
          itemName: existing.itemName,
          type: 'Stock Take Import',
          reference: impRef,
          qtyChange: diff,
          balanceAfter: existing.stockQty,
          unitCost: existing.unitCost,
          remarks: `Bulk import: ${diff >= 0 ? '+' : ''}${diff} ${baseUnit}`
        }], { session });

        if (Math.abs(valueImpact) > 0.001) {
          // Stock-take increase = opening-balance / owner-funded stock → Owner's Capital
          // (equity), not a P&L gain. Decrease = real variance loss → Spoilage expense.
          const lines = diff >= 0
            ? [
                { accountCode: '130000', accountName: 'Inventory Asset', debit: valueImpact, credit: 0 },
                { accountCode: '310000', accountName: "Owner's Capital", debit: 0, credit: valueImpact }
              ]
            : [
                { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: valueImpact, credit: 0 },
                { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: valueImpact }
              ];
          assertBalanced(lines, `IMPORT-${existing.itemName}`);
          await JournalEntry.create([{
            reference: impRef,
            description: `Stock take import: ${existing.itemName} (${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ${baseUnit} @ P${unitCostForValuation.toFixed(4)})`,
            lines, totalDebit: valueImpact, totalCredit: valueImpact
          }], { session });
        }

        summary.updated++;
        if (diff > 0) { summary.increased++; summary.gainValue += valueImpact; }
        if (diff < 0) { summary.decreased++; summary.lossValue += valueImpact; }

        // Sync the linked Product (log only - the product IS the stocked good).
        // Raw materials (unit-cost only, no SRP - e.g. an "RM1xxx" category) never
        // get a shop/POS listing: a row with no SRP does NOT create one. An item
        // that's already listed (SRP was set on some earlier import) keeps being
        // maintained regardless of THIS row's SRP - we only gate creation, never
        // retroactively pull an existing listing because a later row omits it.
        const hasSrp = srp != null && !isNaN(srp) && srp > 0;
        if (syncProduct) {
          const productExists = await Product.findOne({ productCode: existing.itemCode, businessType: BUSINESS_TYPE }).session(session);
          if (hasSrp || productExists) {
            const cat = await Category.findOneAndUpdate(
              { name: { $regex: new RegExp(`^${productCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, businessType: BUSINESS_TYPE },
              { $setOnInsert: { name: productCategory, department: 'Logistics', businessType: BUSINESS_TYPE } },
              { upsert: true, returnDocument: 'after', session }
            );
            // Base recipe links the product to its OWN stock item (1:1).
            const baseRecipe = [{ invId: existing._id, name: existing.itemName, qty: existing.unitMultiplier || mult, cost: existing.unitCost || 0, unit: existing.unit || baseUnit }];
            // basePrice must never appear in both $set and $setOnInsert - Mongo
            // rejects an update that targets the same path from two operators.
            // A valid SRP always wins (goes in $set); only fall back to
            // $setOnInsert (default 0 on first creation) when there's no SRP.
            const prod = await Product.findOneAndUpdate(
              { productCode: existing.itemCode, businessType: BUSINESS_TYPE },
              {
                $set: {
                  name: existing.itemName,
                  category: cat.name,
                  isAvailable: existing.stockQty > 0,
                  ...(hasSrp ? { basePrice: srp } : {}),
                },
                $setOnInsert: { businessType: BUSINESS_TYPE, baseRecipe, ...(hasSrp ? {} : { basePrice: 0 }) },
              },
              { upsert: true, returnDocument: 'after', session }
            );
            // Backfill the stock link on a pre-existing menu entry that never had one.
            if (prod && !(prod.baseRecipe || []).some(r => r.invId)) {
              prod.baseRecipe = baseRecipe;
              await prod.save({ session });
            }
          }
        }
      } else {
        // New item - onboard via Inventory Adjustment Gain (DR 1500 / CR 4200)
        const newCode = itemCode || await generateNextSequence(Inventory, 'RML', 'itemCode');
        const initialBatches = ((expiryFromExcel || productionFromExcel) && newBaseQty > 0)
          ? [{
              qty: newBaseQty,
              expiryDate: expiryFromExcel ? new Date(expiryFromExcel) : null,
              productionDate: productionFromExcel ? new Date(productionFromExcel) : null,
              receivedAt: new Date(), reference: impRef, unitCost: newCostPerBase || 0,
            }]
          : [];
        const created = await Inventory.create([{
          itemCode: newCode,
          itemName,
          stockQty: newBaseQty,
          unit: baseUnit,
          unitCost: newCostPerBase != null ? newCostPerBase : 0,
          lowStockThreshold: 0,
          displayUnit,
          unitMultiplier: mult,
          packSize: packSizeFromExcel,
          expiryBatches: initialBatches,
          expiryDate: soonestExpiry(initialBatches),
          businessType: BUSINESS_TYPE,
          stockCategory: categoryName || '',
        }], { session });
        const item = created[0];
        const valueImpact = newBaseQty * (item.unitCost || 0);

        await StockCard.create([{
          inventoryId: item._id,
          itemName: item.itemName,
          type: 'Stock Take Import',
          reference: impRef,
          qtyChange: newBaseQty,
          balanceAfter: newBaseQty,
          unitCost: item.unitCost,
          remarks: `Created via bulk import (initial onboard)`
        }], { session });

        if (valueImpact > 0.001) {
          // Opening-balance load: offset to Owner's Capital (equity), NOT a P&L gain -
          // the owner funded this stock; loading it is a capital contribution, not income.
          const lines = [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: valueImpact, credit: 0 },
            { accountCode: '310000', accountName: "Owner's Capital", debit: 0, credit: valueImpact }
          ];
          assertBalanced(lines, `IMPORT-NEW-${item.itemName}`);
          await JournalEntry.create([{
            reference: impRef,
            description: `Stock take import (new item): ${item.itemName} (${newBaseQty.toFixed(2)} ${baseUnit} @ P${item.unitCost.toFixed(4)})`,
            lines, totalDebit: valueImpact, totalCredit: valueImpact
          }], { session });
        }
        summary.created++;
        summary.increased++;
        summary.gainValue += valueImpact;

        // Create the linked Product (log only - the product IS the stocked good).
        // Raw materials (no SRP - e.g. an "RM1xxx" category, unit-cost only) never
        // get a shop/POS listing: skip entirely unless a Product with this code
        // already exists independently (then just backfill its stock link).
        if (syncProduct) {
          const hasSrp = srp != null && !isNaN(srp) && srp > 0;
          const productExists = await Product.findOne({ productCode: item.itemCode, businessType: BUSINESS_TYPE }).session(session);
          if (!productExists && hasSrp) {
            const cat = await Category.findOneAndUpdate(
              { name: { $regex: new RegExp(`^${productCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, businessType: BUSINESS_TYPE },
              { $setOnInsert: { name: productCategory, department: 'Logistics', businessType: BUSINESS_TYPE } },
              { upsert: true, returnDocument: 'after', session }
            );
            // Explicitly link the product's base recipe to its OWN stock item (1:1),
            // so the menu shows the stock item as the base material and each sale
            // deducts it directly - no reliance on the code/name fallback.
            const baseRecipe = [{ invId: item._id, name: item.itemName, qty: mult, cost: item.unitCost || 0, unit: baseUnit }];
            await Product.create([{
              productCode: item.itemCode,
              name: item.itemName,
              category: cat.name,
              basePrice: srp,
              baseSize: displayUnit,
              baseRecipe,
              isAvailable: newBaseQty > 0,
              businessType: BUSINESS_TYPE,
            }], { session });
          } else if (productExists && !(productExists.baseRecipe || []).some(r => r.invId)) {
            // Existing menu entry with no linked stock - backfill the link.
            const baseRecipe = [{ invId: item._id, name: item.itemName, qty: mult, cost: item.unitCost || 0, unit: baseUnit }];
            productExists.baseRecipe = baseRecipe;
            await productExists.save({ session });
          }
        }
      }
    }

    await session.commitTransaction();
    session.endSession();
    emitToMgr('erpUpdated');
    emitToAll('menuUpdated');
    res.json({ success: true, summary });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    log.error({ err }, 'inventory import failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- SPOILAGE / WASTE LOGGING ---
app.post('/api/inventory/spoilage/:id', verifyToken, requireStaff, async (req, res) => {
  // Money/stock event - the stock write, the stock-card row, and the balanced
  // journal entry commit together. withOptionalTransaction keeps that guarantee
  // on a replica set and still runs (non-atomically, with a warning) on a
  // standalone MongoDB, so dev/e2e environments can exercise this path.
  try {
    const { qty, reason, note } = req.body;
    const spoilQty = parseFloat(qty);
    if (!spoilQty || spoilQty <= 0) return res.status(400).json({ success: false, error: 'Invalid quantity.' });
    if (!reason) return res.status(400).json({ success: false, error: 'Reason is required.' });

    const item = await withOptionalTransaction(mongoose, async (session) => {
      const it = await Inventory.findById(req.params.id).session(session ?? null);
      if (!it) throw Object.assign(new Error('Item not found.'), { httpStatus: 404 });
      if (it.stockQty < spoilQty) throw Object.assign(new Error('Cannot spoil more than available stock.'), { httpStatus: 400 });

      const spoilageCost = spoilQty * (it.unitCost || 0);
      it.stockQty = +(it.stockQty - spoilQty).toFixed(6);
      // FEFO-consume from batches (oldest first - typical spoilage pattern)
      if (it.expiryBatches && it.expiryBatches.length > 0) {
        const r = consumeBatches(it.expiryBatches, spoilQty);
        it.expiryBatches = r.batches;
      }
      it.expiryDate = soonestExpiry(it.expiryBatches || []);
      // If spoilage zeros out the item, also clear any remaining batches
      if (it.stockQty <= 0.0001) {
        it.expiryBatches = [];
        it.expiryDate = null;
      }
      await it.save({ session });

      const spoilRef = await mkSeqRef('INV-SPOIL');

      await StockCard.create([{
        inventoryId: it._id,
        itemName: it.itemName,
        type: 'Spoilage',
        reference: spoilRef,
        qtyChange: -spoilQty,
        balanceAfter: it.stockQty,
        unitCost: it.unitCost,
        remarks: `${reason}${note ? ': ' + note : ''}`
      }], { session });

      if (spoilageCost > 0.001) {
        const lines = [
          { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: spoilageCost, credit: 0 },
          { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: spoilageCost }
        ];
        assertBalanced(lines, spoilRef);
        await JournalEntry.create([{
          reference: spoilRef,
          description: `Spoilage/Waste: ${spoilQty}${it.unit} of ${it.itemName} (${reason})`,
          lines,
          totalDebit: spoilageCost,
          totalCredit: spoilageCost
        }], { session });
      }
      return it;
    }, { log });

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    if (err?.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
