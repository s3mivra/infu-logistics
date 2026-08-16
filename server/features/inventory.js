// inventory routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { title } from '../lib/normalize.js';
import { withOptionalTransaction } from '../lib/txn.js';
import { captureError } from '../lib/errorLog.js';

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

app.get('/api/inventory/history/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    const history = await StockCard.find({ inventoryId: req.params.id }).sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Fetch ALL stock card history for the master PDF report
app.get('/api/inventory/history', verifyToken, requireStaff, async (req, res) => {
  try {
    const history = await StockCard.find().sort({ date: -1 });
    res.json({ success: true, history });
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
app.post('/api/stock-transfers', verifyToken, requireStaff, async (req, res) => {
  try {
    const { fromItemId, toItemId, qtyBase, note } = req.body || {};
    if (!fromItemId || !toItemId) return res.status(400).json({ success: false, error: 'Source and destination items are required.' });
    if (String(fromItemId) === String(toItemId)) return res.status(400).json({ success: false, error: 'Source and destination must be different items.' });
    const qty = Number(qtyBase);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, error: 'Transfer quantity must be greater than zero.' });
    const [from, to] = await Promise.all([Inventory.findById(fromItemId), Inventory.findById(toItemId)]);
    if (!from || !to) return res.status(404).json({ success: false, error: 'Source or destination item not found.' });
    if (qty > (from.stockQty || 0) + 1e-6) return res.status(400).json({ success: false, error: `Only ${from.stockQty} ${from.unit || ''} on hand at source.` });
    const reference = await mkSeqRef('XFER');
    const transfer = await StockTransfer.create({
      reference, fromItemId, toItemId, itemName: from.itemName,
      fromLocation: from.stockLocation || '', toLocation: to.stockLocation || '',
      qtyBase: qty, unit: from.unit || '', status: 'Requested',
      note: String(note || '').trim().slice(0, 500), requestedBy: req.user?.name || '',
    });
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
    // Canonicalize first so the stored name is stable ("test milk" → "Test Milk")
    // and the existing case-insensitive dup check compares like with like.
    // title() leaves digit-bearing tokens uppercase, so pack labels survive: "1L".
    req.body.itemName = title(req.body.itemName);
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
    // Seed expiryBatches with the initial batch if expiry is provided
    const purchRef = await mkSeqRef('INV-PURCH');
    if (req.body.expiryDate && req.body.stockQty > 0) {
      req.body.expiryBatches = [{
        qty: req.body.stockQty,
        expiryDate: new Date(req.body.expiryDate),
        receivedAt: new Date(),
        reference: purchRef,
        unitCost: req.body.unitCost || 0
      }];
    }
    // Resolve creditAccount against the full COA (canonical + custom). Allowed
    // parents: 111 (Cash), 112 (Bank), 113 (E-Wallet), 220 (AP). Any sub-account
    // under those parents works too - so users can route to specific cash drawers,
    // bank accounts, or supplier-specific AP sub-ledgers added in the COA UI.
    const { creditAccount: rawCreditCode } = req.body;
    const isAllowedParent = (c) => /^(111|112|113|220)/.test(String(c || ''));
    const resolved = acctMeta(rawCreditCode);
    const creditCode = (resolved && isAllowedParent(rawCreditCode)) ? rawCreditCode : '111000';
    const creditName = acctMeta(creditCode)?.name || 'Cash on Hand';

    const newItem = await Inventory.create(req.body);

    // --- AUTO-JOURNAL FOR PURCHASING INVENTORY ---
    const totalCost = newItem.stockQty * newItem.unitCost;
    if (totalCost > 0) {
      const reference = purchRef;
      const lines = [
        { accountCode: '130000', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: creditCode, accountName: creditName,   debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({ reference, description: `Purchased ${newItem.stockQty}${newItem.unit} of ${newItem.itemName}`, lines, totalDebit: totalCost, totalCredit: totalCost });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item: newItem });
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
  const { addedStock, totalCost, expiryDate, creditAccount: rawCreditCode } = req.body;
  const isAllowedParent = (c) => /^(111|112|113|220)/.test(String(c || ''));
  const resolved = acctMeta(rawCreditCode);
  const creditCode = (resolved && isAllowedParent(rawCreditCode)) ? rawCreditCode : '111000';
  const creditName = acctMeta(creditCode)?.name || 'Cash on Hand';

  const MAX_TXN_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_TXN_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      let savedItem = null;
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

        if (expiryDate && addedStock > 0) {
          item.expiryBatches = addBatch(item.expiryBatches || [], {
            qty: addedStock,
            expiryDate: new Date(expiryDate),
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
            reference: rstRef, description: `Restocked ${addedStock}${item.unit} of ${item.itemName}`,
            lines, totalDebit: totalCost, totalCredit: totalCost
          }], { session });
        }
      });

      emitToMgr('erpUpdated');
      await logAudit(req, { action: 'restock', entity: 'Inventory', entityId: req.params.id, after: { addedStock, totalCost } });
      return res.json({ success: true, item: savedItem });
    } catch (error) {
      // Standalone MongoDB without a replica set throws this - fall through to
      // the legacy non-transactional path so dev environments still work.
      const msg = String(error?.errorLabels || error?.message || '');
      const isTransient = (error?.errorLabels || []).includes('TransientTransactionError') || /WriteConflict/i.test(msg);
      if (isTransient && attempt < MAX_TXN_ATTEMPTS) {
        continue; // retry
      }
      if (error?.httpStatus === 404) {
        return res.status(404).json({ success: false, error: 'Item not found' });
      }
      const isUnsupported = /Transaction numbers are only allowed|Transactions are not supported/i.test(msg);
      if (isUnsupported && attempt === 1) {
        // Dev mode (no replica set) - fall back to non-transactional path.
        log?.warn?.('Restock txn unsupported, falling back to non-transactional path.');
        try {
          const item = await Inventory.findById(req.params.id);
          if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
          const currentTotalValue = item.stockQty * item.unitCost;
          const newTotalValue = currentTotalValue + totalCost;
          const newStockQty = item.stockQty + addedStock;
          const newUnitCost = newStockQty > 0 ? newTotalValue / newStockQty : 0;
          item.stockQty = newStockQty;
          item.unitCost = newUnitCost;
          const rstRef = await mkSeqRef('INV-RST');
          if (expiryDate && addedStock > 0) {
            item.expiryBatches = addBatch(item.expiryBatches || [], { qty: addedStock, expiryDate: new Date(expiryDate), receivedAt: new Date(), reference: rstRef, unitCost: newUnitCost });
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
            await JournalEntry.create({ reference: rstRef, description: `Restocked ${addedStock}${item.unit} of ${item.itemName}`, lines, totalDebit: totalCost, totalCredit: totalCost });
          }
          emitToMgr('erpUpdated');
          await logAudit(req, { action: 'restock', entity: 'Inventory', entityId: req.params.id, after: { addedStock, totalCost, fallback: true } });
          return res.json({ success: true, item });
        } catch (fallbackErr) {
          captureError(req, fallbackErr);
          return res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : fallbackErr.message });
        }
      }
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
      update.itemName = title(update.itemName);
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

// --- BATCH MANAGEMENT: add a new expiry batch manually ---
app.post('/api/inventory/:id/batches', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { qty, expiryDate, reference } = req.body;
    const n = parseFloat(qty);
    if (!n || n <= 0) return res.status(400).json({ success: false, error: 'qty must be > 0' });
    if (!expiryDate) return res.status(400).json({ success: false, error: 'expiryDate required' });
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const batchRef = await mkSeqRef('INV-BATCH');
    const unitCost = item.unitCost || 0;
    item.expiryBatches = addBatch(item.expiryBatches || [], {
      qty: n,
      expiryDate: new Date(expiryDate),
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

    for (let i = 0; i < items.length; i++) {
      const row = items[i] || {};
      const itemCode = String(row.itemCode || row.code || '').trim();
      const itemName = String(row.itemName || row.product || row.name || '').trim();
      // Category (and the linked Product/menu-setup sync it triggers below) is a
      // logistics-only concept - an fb import brings in raw inventory data (stock,
      // cost, expiry) only, and never touches menu setup even if the sheet has one.
      const categoryName = BUSINESS_TYPE === 'log' ? String(row.category || '').trim() : '';
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
      const expiryFromExcel = row.expiryDate || row.expiry || null;
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

      if (existing) {
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

        // Expiry batches:
        //  - If Excel row carries an expiry: append it as a new batch with the +diff qty (only if diff > 0).
        //  - If diff < 0: FEFO-consume the absolute diff from existing batches.
        //  - If diff > 0 and no expiry on Excel row: leave batches untouched (caller assumes existing batch still applies).
        if (diff < 0) {
          const r = consumeBatches(existing.expiryBatches || [], Math.abs(diff));
          existing.expiryBatches = r.batches;
        } else if (diff > 0 && expiryFromExcel) {
          existing.expiryBatches = addBatch(existing.expiryBatches || [], {
            qty: diff,
            expiryDate: new Date(expiryFromExcel),
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
        if (syncProduct) {
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
          const hasSrp = srp != null && !isNaN(srp);
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
      } else {
        // New item - onboard via Inventory Adjustment Gain (DR 1500 / CR 4200)
        const newCode = itemCode || await generateNextSequence(Inventory, 'RML', 'itemCode');
        const initialBatches = (expiryFromExcel && newBaseQty > 0)
          ? [{ qty: newBaseQty, expiryDate: new Date(expiryFromExcel), receivedAt: new Date(), reference: impRef, unitCost: newCostPerBase || 0 }]
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
        if (syncProduct) {
          const cat = await Category.findOneAndUpdate(
            { name: { $regex: new RegExp(`^${productCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, businessType: BUSINESS_TYPE },
            { $setOnInsert: { name: productCategory, department: 'Logistics', businessType: BUSINESS_TYPE } },
            { upsert: true, returnDocument: 'after', session }
          );
          // Explicitly link the product's base recipe to its OWN stock item (1:1),
          // so the menu shows the stock item as the base material and each sale
          // deducts it directly - no reliance on the code/name fallback.
          const baseRecipe = [{ invId: item._id, name: item.itemName, qty: mult, cost: item.unitCost || 0, unit: baseUnit }];
          const productExists = await Product.findOne({ productCode: item.itemCode, businessType: BUSINESS_TYPE }).session(session);
          if (!productExists) {
            await Product.create([{
              productCode: item.itemCode,
              name: item.itemName,
              category: cat.name,
              basePrice: srp != null && !isNaN(srp) ? srp : 0,
              baseSize: displayUnit,
              baseRecipe,
              isAvailable: newBaseQty > 0,
              businessType: BUSINESS_TYPE,
            }], { session });
          } else if (!(productExists.baseRecipe || []).some(r => r.invId)) {
            // Existing menu entry with no linked stock - backfill the link.
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
