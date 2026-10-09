// admin-tools routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { reopenOrdersClosedByPendingBills } from '../lib/billPoLink.js';
import { roundMoney } from '../lib/money.js';
import { saleDebitAccount } from '../lib/saleAccounts.js';
import { captureError } from '../lib/errorLog.js';
import { saleRevenueLines, vatFromInclusive } from '../lib/vatPosting.js';
import { loadVatConfig } from '../lib/vatSettings.js';
import { isAnonymousCustomerName } from '../lib/customerName.js';

import { withLedgerMaintenance } from '../lib/ledgerGuard.js';
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
    requirePermission,
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
    CheckVoucher,
    Advance,
    FixedAsset,
    ProductionOrder,
    CrossTransfer,
    TransferRequest,
    ChangeRequest,
    CollectionReminder,
    ScheduledShift,
    DiscountRule,
    StockCategory,
    StorageLocation,
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
    Supplier,
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

// ── TENANCY HEALTH ───────────────────────────────────────────────────────────
// Every doc in this deployment should carry this server's BUSINESS_TYPE, so the
// report is: per collection, how many docs are missing the stamp, and how many
// carry the *other* type. Both are defects - partners linked through the hub are
// separate deployments with their own databases (partnerSlug is a MONGO_URI
// slug, not a businessType), so a foreign stamp here is always a mis-stamp, not
// a tenant sharing the database.
//
// The collection list is derived from the Mongoose registry rather than typed
// out, because the hand-written version covered 4 of the 24 schemas that carry
// the field while the screen claimed to check every doc.
//
// EXCLUDED: `Tenant.businessType` describes what kind of business that tenant
// row *is* - a `log` tenant listed on an `fb` server is correct data, not a
// mis-stamp - so scanning it would report permanent phantom defects.
const TENANCY_SCAN_EXCLUDE = new Set(['Tenant']);

const tenancyModels = () =>
  Object.entries(mongoose.models)
    .filter(([name, model]) =>
      !TENANCY_SCAN_EXCLUDE.has(name) && !!model.schema.path('businessType'))
    .map(([name, model]) => ({ name, model }))
    .sort((a, b) => a.name.localeCompare(b.name));

// Deliberately NOT `$or` with `$exists: false`. That form cannot use an index -
// `$exists: false` forces a full collection scan, and wrapping it in `$or`
// stops the other branches using one either. Across two dozen collections that
// is ~46 full scans per report, which is what made this screen sit on "Loading
// report..." on a real database while being instant on an empty one.
//
// `{ field: null }` already matches documents where the field is MISSING as
// well as explicitly null, and a standard (non-sparse) index stores a missing
// field as null - so `$in: [null, '']` covers all three cases and reads from
// the index. Every scanned model indexes businessType.
const TENANCY_MISSING = { businessType: { $in: [null, ''] } };

// A cap so one slow collection cannot hang the whole request - the report is a
// diagnostic, and a partial answer that arrives beats a spinner that never
// resolves. Surfaced per collection below rather than failing the report.
const TENANCY_COUNT_TIMEOUT_MS = 8000;

// One collection's counts. Shared by the full report and the per-collection
// mode below, so the two can never disagree about what counts as a defect.
// $nin over an indexed field is an index scan; $exists is dropped because $nin
// already excludes null and '' explicitly, and keeping it would push this back
// to a collection scan for no gain.
const tenancyRowFor = async ({ name, model }) => {
  const wrong = { businessType: { $nin: [null, '', BUSINESS_TYPE] } };
  // A collection that times out reports as `timedOut` rather than as a
  // confident zero - "we could not check this" and "this is clean" must never
  // look the same on a screen whose whole job is to find defects. A collection
  // that was never created simply counts as zero.
  let timedOut = false;
  const count = (filter) => model.countDocuments(filter).maxTimeMS(TENANCY_COUNT_TIMEOUT_MS)
    .catch(() => { timedOut = true; return 0; });
  const [missingBusinessType, otherBusinessType] = await Promise.all([count(TENANCY_MISSING), count(wrong)]);
  return { collection: name, missingBusinessType, otherBusinessType, timedOut };
};

// The names to scan, so a client can walk them one at a time and show real
// progress. A single request that answers everything at once can only ever be
// shown as a spinner, which cannot tell "nearly done" from "stuck".
app.get('/api/admin/tenancy-report/collections', verifyToken, requireSuperAdmin, async (req, res) => {
  res.json({ success: true, currentBusinessType: BUSINESS_TYPE, collections: tenancyModels().map(m => m.name) });
});

app.get('/api/admin/tenancy-report', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const all = tenancyModels();
    // ?collection=Name checks one. Anything not in the scan list is refused
    // rather than looked up by name, so this cannot be used to count documents
    // in an arbitrary model.
    if (req.query.collection) {
      const one = all.find(m => m.name === String(req.query.collection));
      if (!one) return res.status(404).json({ success: false, error: 'Not a scanned collection.' });
      return res.json({ success: true, currentBusinessType: BUSINESS_TYPE, row: await tenancyRowFor(one) });
    }
    const rows = await Promise.all(all.map(tenancyRowFor));
    // A timed-out collection is not evidence of cleanliness, so it cannot count
    // toward a clean bill of health.
    const isClean = rows.every(r => !r.timedOut && r.missingBusinessType === 0 && r.otherBusinessType === 0);
    // Clean collections are the common case and crowd out the defects, so the
    // UI is told which rows matter instead of having to re-derive it.
    const flagged = rows.filter(r => r.timedOut || r.missingBusinessType > 0 || r.otherBusinessType > 0);
    res.json({
      success: true,
      currentBusinessType: BUSINESS_TYPE,
      rows,
      flagged,
      scannedCollections: rows.length,
      isClean,
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Manual re-run of the stamping migration. Idempotent - only touches docs
// missing the field, and never overwrites an existing (even wrong) value.
// Scans the same derived model list as the report, so the button can actually
// clear what the report shows.
app.post('/api/admin/tenancy-rebackfill', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const models = tenancyModels();
    const results = await Promise.all(models.map(async ({ name, model }) => {
      const r = await model.updateMany(TENANCY_MISSING, { $set: { businessType: BUSINESS_TYPE } }).catch(() => ({ modifiedCount: 0 }));
      return [name, r.modifiedCount || 0];
    }));
    const stamped = Object.fromEntries(results);
    const totalStamped = results.reduce((s, [, n]) => s + n, 0);
    await logAudit(req, { action: 'rebackfill', entity: 'Tenancy', entityId: BUSINESS_TYPE, after: { stamped, totalStamped } });
    res.json({ success: true, stamped, totalStamped });
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
    if (isAnonymousCustomerName(name)) return;
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
// Undo a backdated sale exactly as it was posted, so it can be recorded again:
// every journal entry it made (the sale, and any later correction of it) is
// mirrored by one reversing entry dated the same day; the stock it took goes
// back at the cost it left at; the running sales counters come down; the order
// is kept, marked Voided, and its sheet reference is released for the new one.
async function reverseBackdatedSale(old, session, actorName, freeNumber = false) {
  const fail = (httpStatus, message) => Object.assign(new Error(message), { httpStatus });
  const sales = await JournalEntry.find({ description: new RegExp(`^Backdated sale: ${escapeRegex(old.orderNumber)}(\\s|$|\\()`) }).session(session).lean();
  if (!sales.length) throw fail(409, `${old.orderNumber} has no ledger entry to reverse - void it by hand, then import again.`);
  const fixes = await JournalEntry.find({ $or: sales.map(j => ({ description: { $regex: escapeRegex(`[fixes ${j.reference}]`) } })) }).session(session).lean();
  // ...and the cost of goods sold booked for it from a cost figure or from the
  // stock items' cost (postCostAwaitingCount), so the sale that replaces it is
  // costed afresh rather than on top.
  const costs = await JournalEntry.find({ description: new RegExp(`^Cost of goods sold for ${escapeRegex(old.orderNumber)} \\(`) }).session(session).lean();
  sales.push(...costs);
  const lines = [...sales, ...fixes].flatMap(j => (j.lines || []).map(l => ({
    accountCode: l.accountCode, accountName: l.accountName, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0,
  })));
  const reference = await mkSeqRef('BDREPL');
  await JournalEntry.create([{
    date: new Date(old.createdAt), reference,
    description: `Reversal: ${old.orderNumber} replaced by a re-import of ${old.importRef}`,
    lines,
  }], { session });

  for (const m of (old.stockMoves || [])) {
    const qty = Number(m.qty) || 0, cost = Number(m.unitCost) || 0;
    if (!(qty > 0) || !mongoose.Types.ObjectId.isValid(String(m.invId))) continue;
    const back = await Inventory.findOneAndUpdate(
      { _id: m.invId },
      [{ $set: {
        unitCost: { $cond: [
          { $gt: [{ $add: [{ $max: ['$stockQty', 0] }, qty] }, 0] },
          { $divide: [{ $add: [{ $multiply: [{ $max: ['$stockQty', 0] }, { $ifNull: ['$unitCost', 0] }] }, qty * cost] }, { $add: [{ $max: ['$stockQty', 0] }, qty] }] },
          cost,
        ] },
        stockQty: { $round: [{ $add: ['$stockQty', qty] }, 6] },
      } }],
      { session, returnDocument: 'after', updatePipeline: true },
    );
    if (back) await StockCard.create([{ inventoryId: back._id, itemName: back.itemName, type: 'Adjustment', reference, qtyChange: qty, balanceAfter: back.stockQty, unitCost: cost, remarks: `Replaced by re-import (${old.orderNumber})` }], { session });
  }

  const comp = !!old.isComplimentary;
  await TenantStats.findOneAndUpdate(
    { businessType: BUSINESS_TYPE, shard: Math.floor(Math.random() * STATS_SHARDS) },
    { $inc: { cumulativeRevenue: comp ? 0 : -(Number(old.total) || 0), cumulativeComp: comp ? -(Number(old.subtotal) || 0) : 0, cumulativeOrderCount: -1, cumulativeNonCompCount: comp ? 0 : -1 } },
    { session, upsert: true },
  );

  // An Orders re-import keeps each order's own number, so the replaced copy
  // steps aside for the corrected one.
  let freed = {};
  if (freeNumber) {
    const aside = `${old.orderNumber}-R`;
    freed = { orderNumber: (await Order.exists({ orderNumber: aside })) ? `${aside}${Date.now().toString(36)}` : aside };
  }
  await Order.updateOne({ _id: old._id }, { $set: {
    status: 'Voided', voidReason: `Replaced by a re-import of ${old.importRef}`, voidedBy: actorName || 'Backdate import',
    importRef: `${old.importRef} (replaced ${new Date().toISOString().slice(0, 10)})`,
    ...freed,
  } }, { session });
}

async function createBackdatedSale(payload, actorName) {
  const { date, customerName, amount, paymentMethod, notes, items, affectInventory = false, discountPercent = 0, discountAmount = 0, isComplimentary = false, importRef = '', deliveryFee = 0, paymentReference = '', paymentCheckDate = null, orderNumber: wantedNumber = '', clientId = '', payments: paymentsIn = null, replaceExisting = false } = payload;
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
  // With replaceExisting, a sheet imported before (e.g. at the subtotal instead
  // of its grand total) is reversed and recorded again, in one transaction.
  let replacing = null;
  if (cleanImportRef) {
    const dupe = await Order.findOne({ businessType: BUSINESS_TYPE, importRef: cleanImportRef, isBackdated: true }).lean();
    if (dupe && !replaceExisting) throw fail(409, `Already imported as ${dupe.orderNumber} (ref: ${cleanImportRef}) - skipped duplicate.`);
    if (dupe) {
      if (dupe.status !== 'Completed') throw fail(409, `${dupe.orderNumber} (ref: ${cleanImportRef}) is ${dupe.status} - it cannot be replaced.`);
      if ((dupe.arPayments || []).length || Number(dupe.refundedAmount) > 0 || dupe.arSettled) {
        throw fail(409, `${dupe.orderNumber} (ref: ${cleanImportRef}) already has a collection or refund recorded - reverse that first, then replace it.`);
      }
      const oldLock = await periodLockFor(new Date(dupe.createdAt));
      if (oldLock) throw fail(423, `${dupe.orderNumber} is in ${oldLock.year}-${String(oldLock.month).padStart(2, '0')}, a closed month - it cannot be replaced.`);
      replacing = dupe;
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const keepsNumber = !!replacing && String(wantedNumber || '').trim() === replacing.orderNumber;
    if (replacing) await reverseBackdatedSale(replacing, session, actorName, keepsNumber);
    // Build the line items - itemized when provided, else a single lump line.
    const itemized = Array.isArray(items) && items.length > 0;
    let orderItems = [];
    if (itemized) {
      // Each line's SRP for the sales report (the sheet's price may be a
      // dealer's); an unmatched line's own price stands in.
      const srpIds = items.map(it => it.productId).filter(id => id && mongoose.Types.ObjectId.isValid(String(id)));
      const srpById = srpIds.length
        ? new Map((await Product.find({ _id: { $in: srpIds } }, { basePrice: 1 }).lean()).map(p => [String(p._id), Number(p.basePrice) || 0]))
        : new Map();
      for (const it of items) {
        const price = Number(it.price), qty = Number(it.quantity);
        if (!it.name || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
          throw fail(400, 'Each item needs a name, a non-negative price, and a positive quantity.');
        }
        // A per-line discount, as the paper receipt showed it (a staff meal at
        // 50%, one damaged item at 20%). Bounded 0-100 like every other discount.
        const linePct = Math.max(0, Math.min(100, Number(it.discountPercent) || 0));
        const srp = srpById.get(String(it.productId || ''));
        orderItems.push({ name: String(it.name), price, listPrice: srp != null && srp > 0 ? srp : price, quantity: qty, productId: it.productId || undefined, productCode: it.productCode || undefined, productDiscountPercent: 0, discountPercent: linePct, itemStatus: 'Served' });
      }
    } else {
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0) throw fail(400, 'Provide either items[] or a positive amount.');
      orderItems = [{ name: 'Historical Sale', price: amt, quantity: 1, productDiscountPercent: 0 }];
    }

    const gross = roundMoney(orderItems.reduce((s, it) => s + it.price * it.quantity, 0));
    // A complimentary sale is free: no discount line, nothing collected. Its cost
    // is booked as Complimentary Expense against revenue (keeps gross visible).
    // Line discounts come off first; the order-wide percent then applies to
    // what is left, the same order the POS applies them in.
    const lineDiscount = comp ? 0 : roundMoney(orderItems.reduce((s, it) => s + roundMoney(it.price * it.quantity * (it.discountPercent || 0) / 100), 0));
    const pct = comp ? 0 : Math.max(0, Math.min(100, Number(discountPercent) || 0));
    // A peso discount as the paper document wrote it (an imported billing
    // statement's DISCOUNT line). Taken exactly, never turned into a percent,
    // so the sale lands on the document's own total to the centavo.
    const afterPct = roundMoney(gross - lineDiscount - (gross - lineDiscount) * pct / 100);
    const flat = comp ? 0 : Math.min(afterPct, Math.max(0, roundMoney(Number(discountAmount) || 0)));
    const discount = roundMoney(lineDiscount + (gross - lineDiscount) * pct / 100 + flat);
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

    // A split tender - part cash, part on account, as the POS allows: each part
    // is its own debit, and only the parts that land in a receivable are owed.
    const splitParts = Array.isArray(paymentsIn)
      ? paymentsIn.map(p => {
          const part = { method: String(p?.method || '').trim(), amount: roundMoney(Number(p?.amount) || 0) };
          if (part.method.toUpperCase() === 'CHECK') {
            part.reference = String(p?.reference || '').trim().slice(0, 60);
            const d = p?.checkDate ? new Date(p.checkDate) : null;
            part.checkDate = d && !Number.isNaN(d.getTime()) ? d : null;
          }
          return part;
        }).filter(p => p.method && p.amount > 0)
      : [];
    const isSplit = !comp && splitParts.length >= 2;
    if (isSplit) {
      const paid = roundMoney(splitParts.reduce((s, p) => s + p.amount, 0));
      if (Math.abs(paid - total) > 0.01) throw fail(400, `The split payments add up to ${paid.toFixed(2)}, but the sale is ${total.toFixed(2)}.`);
      if (splitParts.some(p => p.method.toUpperCase() === 'CHECK' && !p.reference)) throw fail(400, 'A check number is required for the part paid by check.');
    }
    const method = isSplit ? 'Split' : (paymentMethod || 'Cash');
    // The SALE side of the map: On Account is owed by the customer (A/R), never A/P.
    const saleAcct = (m) => saleDebitAccount(accountForPaymentMethod, m);
    const acct = saleAcct(isSplit ? splitParts[0].method : method);
    // A check is paid by its number (and dated), the same as a live check sale
    // - without it the deposit can never be matched or a bounce traced.
    const splitChecks = isSplit ? splitParts.filter(p => p.method.toUpperCase() === 'CHECK') : [];
    const payRef = (String(paymentReference || '').trim() || splitChecks.map(p => p.reference).join(', ')).slice(0, 60);
    let checkDate = splitChecks.find(p => p.checkDate)?.checkDate || null;
    if (!comp && String(method).trim().toUpperCase() === 'CHECK') {
      if (!payRef) throw fail(400, 'A check number is required when the sale was paid by check.');
      if (paymentCheckDate) {
        checkDate = new Date(paymentCheckDate);
        if (Number.isNaN(checkDate.getTime())) throw fail(400, 'Invalid check date.');
      }
    }

    const year = dt.getFullYear();
    // A re-imported order keeps the number it had (the Orders import), when
    // nothing else holds it now; everything else takes the next one.
    const keep = String(wantedNumber || '').trim();
    const orderNumber = keep && (keepsNumber || !(await Order.exists({ orderNumber: keep })))
      ? keep
      : await generateNextSequence(Order, `ORD-${year}`, 'orderNumber', 'ORD');

    // Optional stock deduction + COGS - only when explicitly asked.
    let totalCogs = 0;
    const stockCards = [];
    if (itemized && affectInventory) {
      for (const [lineIndex, item] of orderItems.entries()) {
        const product = item.productId ? await Product.findById(item.productId).session(session) : null;
        if (!product) continue;
        // The same stock a live sale of it takes: its recipe (the size's when
        // it has one), or the 1:1 linked item for a product with no recipe.
        // This used the 1:1 link only, so a recipe product's backdated sale
        // took stock from the wrong place or none at all.
        let recipe = product.baseRecipe || [];
        const sizeMatch = String(item.name || '').match(/\(([^)]+)\)$/);
        if (sizeMatch) {
          const sz = product.sizes?.find(x => x.name === sizeMatch[1]);
          if (sz?.recipe?.length) recipe = sz.recipe;
        }
        let plan = recipe
          .filter(r => r.invId && !r.nonStock && mongoose.Types.ObjectId.isValid(String(r.invId)))
          .map(r => ({ invId: r.invId, qty: +(Number(r.qty) * item.quantity).toFixed(6) }));
        if (!plan.length) {
          const linkInv = await resolveLinkedInventory(product, item.productCode, session);
          if (linkInv) plan = [{ invId: linkInv._id, qty: +(item.quantity * baseUnitsPerSale(product, linkInv)).toFixed(6) }];
        }
        for (const { invId, qty: deductQty } of plan) {
          if (!(deductQty > 0)) continue;
          const updated = await Inventory.findOneAndUpdate(
            { _id: invId, stockQty: { $gte: deductQty } },
            { $inc: { stockQty: -deductQty } },
            { session, returnDocument: 'after' }
          );
          if (!updated) {
            const inv = await Inventory.findById(invId, { itemName: 1 }).session(session).lean();
            throw fail(400, `Not enough stock of "${inv?.itemName || 'an ingredient'}" to reduce for this backdated sale. Turn off "reduce inventory" or receive stock first.`);
          }
          stockCards.push({ inventoryId: updated._id, itemName: updated.itemName, type: 'Sale', reference: mkRef('BACK', orderNumber), qtyChange: -deductQty, balanceAfter: updated.stockQty, unitCost: updated.unitCost || 0, lineIndex, remarks: `Backdated sale (${item.name})` });
          totalCogs += (updated.unitCost || 0) * deductQty;
        }
      }
      if (stockCards.length) await StockCard.insertMany(stockCards, { session });
    }
    totalCogs = +totalCogs.toFixed(2);

    const vatCfg = await loadVatConfig(Settings);
    const backdateVat = comp ? 0 : vatFromInclusive(total - delivery, vatCfg.enabled ? vatCfg.rate : 0, vatCfg.inclusive);

    const [order] = await Order.create([{
      orderNumber,
      table: 'Backdated',
      status: 'Completed',
      createdAt: dt,
      cashier: actorName || 'Backdated Entry',
      customerName: customerName || 'Walk-in (backdated)',
      // The client account it was sold to, so A/R and the client's history
      // carry it - not just a name.
      ...(clientId ? { clientId: String(clientId), clientAccountId: String(clientId) } : {}),
      paymentMethod: method,
      ...(isSplit ? {
        payments: splitParts,
        // What was settled at the sale (cash, bank, wallet) is not owed - only
        // the parts booked to Accounts Receivable stay on the client's A/R.
        arPaidAmount: roundMoney(splitParts.filter(p => saleAcct(p.method).code !== '120000').reduce((s, p) => s + p.amount, 0)),
      } : {}),
      ...(payRef ? { paymentReference: payRef } : {}),
      ...(checkDate ? { paymentCheckDate: checkDate } : {}),
      items: orderItems,
      // What it took, so a void or refund gives back exactly this.
      stockMoves: stockCards.map(c => ({ invId: String(c.inventoryId), qty: -c.qtyChange, unitCost: c.unitCost || 0, lineIndex: c.lineIndex })),
      subtotal: gross,
      discount,
      discountPercent: pct,
      // A backdated sale is a real sale: if the business is VAT-registered it
      // carried VAT on the day it happened, and the books have to show that.
      // Under exclusive pricing the VAT was added on top of the figures on the
      // original document, so it cannot be derived from the total here - the
      // sale is stamped VAT-free and the document's own VAT should be entered
      // as a journal entry.
      vatAmount: backdateVat, vatRate: backdateVat > 0 ? vatCfg.rate : 0,
      isVatInclusive: vatCfg.inclusive,
      vatableSales: backdateVat > 0 ? +(total - delivery - backdateVat).toFixed(2) : 0,
      total,
      deliveryFee: delivery,
      isVatExempt: backdateVat === 0,
      isComplimentary: comp,
      discountType: comp ? 'Complimentary' : (pct > 0 || lineDiscount > 0 || flat > 0 ? 'Promo' : 'None'),
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
      if (isSplit) {
        for (const p of splitParts) {
          const a = saleAcct(p.method);
          lines.push({ accountCode: a.code, accountName: a.name, debit: p.amount, credit: 0 });
        }
      } else {
        lines.push({ accountCode: acct.code, accountName: acct.name, debit: total, credit: 0 });
      }
      if (discount > 0) lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: discount, credit: 0 });
      // Delivery fee folds into the same Sales Revenue credit as the rest of
      // the sale (no separate COA account for it) - it must land on the
      // credit side too, or this entry stops balancing the moment `total`
      // includes it but `gross` alone doesn't.
      if (delivery > 0) lines.push({ accountCode: '420000', accountName: 'Service Sales', debit: 0, credit: delivery });
      lines.push(...saleRevenueLines({ gross, vatAmount: backdateVat, revenueName: 'Sales Revenue' }));
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

// ── ORDERS IMPORT ─────────────────────────────────────────────────────────────
// Brings back the Orders export (Ledger -> Import, or the setup workbook). Each
// row becomes a completed sale through createBackdatedSale - dated to its day,
// posted to the books, keeping its ORIGINAL order number - so the books and the
// client's A/R come back exactly. With the export's "Order Lines" sheet the
// products come back too; without it (an older export) each order gets one
// summary line priced so its subtotal, discount and total match to the centavo.
//
// Never twice: a row whose order number is still in the app, or was imported
// before (its importRef), is skipped. Only Completed orders come back - a
// cancelled or voided one never happened, and a refund cannot be recreated
// from a summary, so those are reported rather than guessed at.
const ORDER_IMPORT_MAX_ROWS = 2000;
// Cost of goods sold for a sale known only as a total: DR 510000 / CR 139000,
// on the sale's own date. The stock count that later finds those goods gone
// clears 139000 rather than booking them again (see inventory count).
const postCostAwaitingCount = async (order, cost, actorName) => {
  const amt = Math.round((Number(cost) || 0) * 100) / 100;
  if (!(amt > 0)) return 0;
  const lock = await periodLockFor(new Date(order.createdAt));
  if (lock) throw new Error(`${order.orderNumber} is in ${lock.year}-${String(lock.month).padStart(2, '0')}, a closed month - its cost cannot be booked.`);
  const reference = await mkSeqRef('COGS-IMP');
  await JournalEntry.create({
    date: new Date(order.createdAt), reference,
    description: `Cost of goods sold for ${order.orderNumber} (imported cost - items taken at the next stock count)${actorName ? ` - ${actorName}` : ''}`,
    lines: [
      { accountCode: '510000', accountName: 'Cost of Goods Sold', debit: amt, credit: 0 },
      { accountCode: '139000', accountName: 'Cost of Sales Awaiting Stock Count', debit: 0, credit: amt },
    ],
    totalDebit: amt, totalCredit: amt,
  });
  await Order.updateOne({ _id: order._id }, { $inc: { costPosted: amt } });
  return amt;
};

// What the goods on an order cost, at what each stock item is carried at now:
// each line's product is followed to its recipe (or, with none, to the stock
// item of the same code), exactly as a sale that takes stock would.
const costOfOrderFromStock = async (order) => {
  let cost = 0; const unpriced = [];
  for (const item of (order.items || [])) {
    const qty = Number(item.quantity) || 0;
    if (!(qty > 0)) continue;
    const code = String(item.productCode || '').trim();
    const product = (item.productId && mongoose.Types.ObjectId.isValid(String(item.productId)) && await Product.findById(item.productId).lean())
      || (code && await Product.findOne({ productCode: { $regex: `^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).lean())
      || await Product.findOne({ name: String(item.name || '').replace(/\s*\(.*?\)\s*$/, '').trim() }).lean();
    if (!product) { unpriced.push(item.name); continue; }
    let recipe = product.baseRecipe || [];
    const sizeMatch = String(item.name || '').match(/\(([^)]+)\)$/);
    if (sizeMatch) { const sz = product.sizes?.find(x => x.name === sizeMatch[1]); if (sz?.recipe?.length) recipe = sz.recipe; }
    let plan = recipe.filter(r => r.invId && !r.nonStock && mongoose.Types.ObjectId.isValid(String(r.invId)))
      .map(r => ({ invId: r.invId, qty: Number(r.qty) * qty }));
    if (!plan.length) {
      const linkInv = await resolveLinkedInventory(product, item.productCode || product.productCode);
      if (linkInv) plan = [{ invId: linkInv._id, qty: qty * baseUnitsPerSale(product, linkInv) }];
    }
    if (!plan.length) { unpriced.push(item.name); continue; }
    const invs = await Inventory.find({ _id: { $in: plan.map(x => x.invId) } }, { unitCost: 1 }).lean();
    const costOf = new Map(invs.map(i => [String(i._id), Number(i.unitCost) || 0]));
    const lineCost = plan.reduce((sum, x) => sum + (costOf.get(String(x.invId)) || 0) * x.qty, 0);
    if (!(lineCost > 0)) unpriced.push(item.name);
    cost += lineCost;
  }
  return { cost: Math.round(cost * 100) / 100, unpriced };
};

// Backdated sales that have their products but took no stock and carry no cost:
// book each one's cost of goods sold from the stock items' cost. The goods are
// not taken item by item (the stock on file may already be as of a later day),
// so the cost waits in 139000 for the next stock count to clear - see
// postCostAwaitingCount. Safe to run again: an order is costed once.
const bookBackdatedCosts = async (actorName) => {
  const orders = await Order.find({
    businessType: BUSINESS_TYPE, isBackdated: true, status: 'Completed', isComplimentary: { $ne: true },
    $and: [{ $or: [{ costPosted: { $exists: false } }, { costPosted: { $lte: 0 } }] }, { $or: [{ stockMoves: { $exists: false } }, { stockMoves: { $size: 0 } }] }],
  }, { items: 1, orderNumber: 1, createdAt: 1 }).limit(20000).lean();
  let booked = 0, total = 0; const noCost = new Set(), problems = [];
  for (const o of orders) {
    try {
      const { cost, unpriced } = await costOfOrderFromStock(o);
      unpriced.forEach(n => n && noCost.add(n));
      if (!(cost > 0)) continue;
      total += await postCostAwaitingCount(o, cost, actorName);
      booked++;
    } catch (e) { if (problems.length < 20) problems.push(e.message); }
  }
  return { checked: orders.length, booked, total: Math.round(total * 100) / 100, noCost: [...noCost].slice(0, 40), problems };
};

// A backdated sale just recorded with its products but without taking stock:
// its cost is booked straight away. Never fails the sale it follows.
const costBackdatedSale = async (result, actorName) => {
  try {
    if (!result?.order || !result.itemized || result.affectInventory) return;
    const fresh = await Order.findById(result.order._id, { items: 1, orderNumber: 1, createdAt: 1, isComplimentary: 1 }).lean();
    if (!fresh || fresh.isComplimentary) return;
    const { cost } = await costOfOrderFromStock(fresh);
    if (cost > 0) await postCostAwaitingCount(fresh, cost, actorName);
  } catch (err) { log.error?.({ err }, 'Could not book the cost of a backdated sale'); }
};

// Once, on its own: the backdated sales already here get their cost, so
// nobody has to press anything after updating.
const catchUpBackdatedCostsOnce = async () => {
  try {
    if (await Settings.findOne({ key: 'backdatedCostCatchUpV1' }).lean()) return;
    const r = await bookBackdatedCosts('System');
    await Settings.findOneAndUpdate({ key: 'backdatedCostCatchUpV1' }, { key: 'backdatedCostCatchUpV1', value: true }, { upsert: true });
    if (r.booked) { log.info?.({ booked: r.booked, total: r.total }, '✅ Cost of goods sold booked for backdated sales'); emitToMgr('erpUpdated'); }
  } catch (err) { log.error?.({ err }, 'Backdated cost catch-up failed'); }
};
if (mongoose.connection.readyState === 1) setTimeout(catchUpBackdatedCostsOnce, 15000);
else mongoose.connection.once('open', () => setTimeout(catchUpBackdatedCostsOnce, 15000));

app.post('/api/admin/backdate-sale/book-costs', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
  try {
    const r = await bookBackdatedCosts(req.user?.name);
    await logAudit(req, { action: 'backdate-book-costs', entity: 'Order', entityId: 'bulk', after: { checked: r.checked, booked: r.booked, total: r.total } });
    emitToMgr('erpUpdated');
    res.json({ success: true, ...r });
  } catch (err) {
    log.error?.({ err }, 'POST /api/admin/backdate-sale/book-costs failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/orders/import', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const lineRows = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!rows.length) return res.status(400).json({ success: false, error: 'No orders to import.' });
    if (rows.length > ORDER_IMPORT_MAX_ROWS) return res.status(400).json({ success: false, error: `Too many rows (${rows.length}) - import at most ${ORDER_IMPORT_MAX_ROWS} at a time.` });

    const pick = (r, ...keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };
    const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

    // Lines by order number.
    const linesByOrder = new Map();
    for (const l of lineRows) {
      const no = String(pick(l, 'Order No', 'orderNo')).trim();
      if (!no) continue;
      if (!linesByOrder.has(no)) linesByOrder.set(no, []);
      linesByOrder.get(no).push(l);
    }
    const [products, clients] = await Promise.all([
      Product.find({}, { name: 1, productCode: 1 }).lean(),
      mongoose.model('ClientAccount').find({}, { name: 1 }).lean(),
    ]);
    const prodByCode = new Map(products.filter(p => p.productCode).map(p => [String(p.productCode).toUpperCase(), p]));
    const prodByName = new Map(products.map(p => [String(p.name).toUpperCase(), p]));
    const clientByName = new Map(clients.map(c => [String(c.name || '').trim().toUpperCase(), c]));

    const created = [], skipped = [], problems = [], costed = [];
    let maxSeqByKey = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const no = String(pick(r, 'Order No', 'orderNo')).trim();
      try {
        if (!no) throw new Error('Order No is required.');
        const status = String(pick(r, 'Status', 'status') || 'Completed').trim();
        if (status.toLowerCase() !== 'completed') throw new Error(`${no} is ${status} - only completed orders are imported.`);
        const total = num(pick(r, 'Total', 'total'));
        if (!(total > 0)) throw new Error(`${no} has no total.`);
        // Already here? Leave it - unless it is an earlier re-import of this
        // same order that landed on a different total (one came in at its
        // subtotal, short of its delivery fee): that one is replaced.
        const cost = Math.max(0, num(pick(r, 'Cost', 'cost', 'COGS')));
        const earlier = await Order.findOne({ importRef: no, isBackdated: true }, { total: 1, status: 1, stockMoves: 1, costPosted: 1, orderNumber: 1, createdAt: 1 }).lean();
        const fixing = !!earlier && earlier.status === 'Completed' && Math.abs((Number(earlier.total) || 0) - total) > 0.005;
        // Already here, and now the sheet says what it cost: book that once.
        if (!fixing && earlier && earlier.status === 'Completed' && cost > 0
            && !(earlier.stockMoves || []).length && !(Number(earlier.costPosted) > 0)) {
          const amt = await postCostAwaitingCount(earlier, cost, req.user?.name);
          costed.push({ row: i + 1, orderNumber: earlier.orderNumber, cost: amt });
          continue;
        }
        if (!fixing && (earlier || await Order.exists({ orderNumber: no }))) throw new Error(`${no} is already in the app - skipped.`);

        const date = pick(r, 'Date', 'date');
        const customer = String(pick(r, 'Customer', 'customer')).trim();
        const payment = String(pick(r, 'Payment', 'paymentMethod') || 'Cash').trim();
        const subtotal = num(pick(r, 'Subtotal', 'subtotal'));
        const discount = Math.max(0, num(pick(r, 'Discount', 'discount')));

        const its = (linesByOrder.get(no) || []).map(l => {
          const code = String(pick(l, 'Code', 'code')).trim().toUpperCase();
          const name = String(pick(l, 'Product', 'product', 'name')).trim();
          const p = (code && prodByCode.get(code)) || prodByName.get(name.toUpperCase());
          return {
            name: name || p?.name || 'Item', price: num(pick(l, 'Unit Price', 'unitPrice', 'price')), quantity: num(pick(l, 'Qty', 'qty', 'quantity')),
            discountPercent: num(pick(l, 'Line Discount %', 'discountPercent')),
            productId: p?._id ? String(p._id) : undefined, productCode: code || p?.productCode || undefined,
          };
        }).filter(it => it.quantity > 0);

        // The order-level discount the lines do not already explain, in pesos,
        // so the sale lands on the exported total exactly.
        let payload;
        if (its.length) {
          const gross = its.reduce((s, it) => s + it.price * it.quantity, 0);
          const lineDisc = its.reduce((s, it) => s + Math.round(it.price * it.quantity * Math.min(100, it.discountPercent) ) / 100, 0);
          const rest = Math.round((gross - lineDisc - total) * 100) / 100;
          // A total above its lines is the delivery fee, which the export
          // folds into Total without a column of its own.
          payload = { items: its, discountAmount: Math.max(0, rest), deliveryFee: Math.max(0, -rest) };
        } else {
          const gross = subtotal > 0 ? subtotal : total + discount;
          const rest = Math.round((gross - Math.min(discount, gross) - total) * 100) / 100;
          payload = { items: [{ name: `Sales - ${no}`, price: gross, quantity: 1 }], // With a fee on top, the sheet's own Discount stands and the fee is what
            // is left over; without one, the discount is whatever reaches Total.
            discountAmount: rest < 0 ? Math.min(discount, gross) : Math.max(0, Math.round((gross - total) * 100) / 100), deliveryFee: Math.max(0, -rest) };
        }
        const client = customer ? clientByName.get(customer.toUpperCase()) : null;
        const result = await createBackdatedSale({
          ...payload, date, customerName: customer || undefined, paymentMethod: payment,
          importRef: no, orderNumber: no, clientId: client ? String(client._id) : '',
          // With product lines and a cost, the goods come off the shelf as of
          // the sale (cost of goods sold at what the stock is carried at).
          notes: `Re-imported - ${no}`, affectInventory: cost > 0 && its.length > 0, replaceExisting: fixing,
        }, req.user?.name);
        // With a total only, the cost waits for the next stock count.
        if (cost > 0 && !its.length) {
          const amt = await postCostAwaitingCount(result.order, cost, req.user?.name);
          costed.push({ row: i + 1, orderNumber: result.order.orderNumber, cost: amt });
        }
        // Product lines but no Cost given: follow what the stock items cost.
        if (!(cost > 0) && its.length) {
          const fromStock = await costOfOrderFromStock(result.order);
          if (fromStock.cost > 0) {
            const amt = await postCostAwaitingCount(result.order, fromStock.cost, req.user?.name);
            costed.push({ row: i + 1, orderNumber: result.order.orderNumber, cost: amt });
          }
        }
        if (fixing) problems.push(`${no}: was in at ${earlier.total}; replaced, now ${result.total}.`);
        if (Math.abs(Number(result.total) - total) > 0.005) problems.push(`${no}: imported at ${result.total}, the sheet says ${total} - check its lines.`);
        if (num(pick(r, 'Refunded')) > 0) problems.push(`${no}: had a refund of ${num(pick(r, 'Refunded'))} - imported at its full total; record the refund again.`);
        if (num(pick(r, 'Collected')) > 0) problems.push(`${no}: ${num(pick(r, 'Collected'))} had been collected on it - record that collection again in A/R.`);
        const m = /^(.+)-A(\d+)$/.exec(result.order.orderNumber);
        if (m) { const key = `ORD${m[1].slice(m[1].indexOf('-'))}`; maxSeqByKey[key] = Math.max(maxSeqByKey[key] || 0, Number(m[2])); }
        created.push({ row: i + 1, orderNumber: result.order.orderNumber, total: result.total, itemized: !!its.length });
      } catch (e) {
        skipped.push({ row: i + 1, error: e.message });
      }
    }
    // Numbers kept from the sheet must never be handed out again.
    const Counter = mongoose.model('Counter');
    for (const [key, seq] of Object.entries(maxSeqByKey)) await Counter.updateOne({ _id: key }, { $max: { seq } }, { upsert: true });

    const total = Math.round(created.reduce((s, c) => s + c.total, 0) * 100) / 100;
    await logAudit(req, { action: 'import', entity: 'Order', entityId: 'orders-import', after: { created: created.length, skipped: skipped.length, total } });
    emitToMgr('erpUpdated');
    const itemized = created.filter(c => c.itemized).length;
    res.json({
      success: true, created: created.length, skipped, problems, total,
      costed: costed.length, costTotal: Math.round(costed.reduce((sum, c) => sum + c.cost, 0) * 100) / 100,
      note: `${created.length} order(s), ₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, back on their own dates with their own numbers and posted to the books.`
        + (created.length && itemized < created.length ? ` ${created.length - itemized} came from a summary-only export, so each has one summary line instead of its products (stock was not touched).` : ''),
    });
  } catch (err) {
    log.error?.({ err }, 'POST /api/orders/import failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/admin/backdate-sale', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
  try {
    const result = await createBackdatedSale(req.body, req.user?.name);
    await costBackdatedSale(result, req.user?.name);
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
app.get('/api/admin/backdate-sale/history', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
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
app.post('/api/admin/backdate-sale/queue', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
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
        deliveryFee: Math.max(0, Number(r.deliveryFee) || 0),
        discountAmount: Math.max(0, Number(r.discountAmount) || 0),
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

app.get('/api/admin/backdate-sale/queue', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
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

app.post('/api/admin/backdate-sale/queue/:id/save', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
  try {
    const q = await BackdateQueueItem.findById(req.params.id);
    if (!q || q.status !== 'pending') return res.status(404).json({ success: false, error: 'Queue item not found or already resolved.' });
    const { paymentMethod, affectInventory = false, discountPercent = 0, isComplimentary = false, notes, paymentReference = '', paymentCheckDate = null } = req.body;
    if (!paymentMethod) return res.status(400).json({ success: false, error: 'A payment method is required to resolve this queue item.' });
    const result = await createBackdatedSale({
      date: q.date, customerName: q.client, paymentMethod, affectInventory, discountPercent, isComplimentary,
      paymentReference, paymentCheckDate,
      notes: notes || (q.transNo ? `Imported (queued) - ${q.transNo}` : 'Imported from Excel (queued)'),
      items: q.items,
      deliveryFee: q.deliveryFee || 0, discountAmount: q.discountAmount || 0,
      // The sheet's reference, so importing the same file again skips it.
      importRef: q.transNo || '',
    }, req.user?.name);
    await costBackdatedSale(result, req.user?.name);
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

app.delete('/api/admin/backdate-sale/queue/:id', verifyToken, requireStaff, requirePermission('sales.backdate'), async (req, res) => {
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
        const acct = saleDebitAccount(accountForPaymentMethod, method);
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
  fixedAssets:     { label: 'Fixed Asset Register', defaultOn: false },
  auditLog:        { label: 'Audit Log', defaultOn: true },
  menu:            { label: 'Menu Setup (Products, Categories, Combos, Add-ons, Modifiers, Price Tiers)', defaultOn: false },
  // Master data, like the menu: off unless asked for, so a routine purge of
  // transactions never takes the vendor list with it.
  suppliers:       { label: 'Suppliers (list and their catalogs)', defaultOn: false },
  // Client accounts. The walk-ins the till promoted on its own (the WALK-IN
  // badge) go with a routine purge; real client accounts - logins, credit
  // terms, price tiers - only when asked for. Either way a client that still
  // has orders, deposits, quotes, reservations or a credit balance after the
  // purge is kept, so nothing is left naming an account that is gone.
  walkInClients:   { label: 'Auto-created walk-in clients (WALK-IN badge)', defaultOn: true },
  clients:         { label: 'All client accounts (logins, credit terms, price tiers)', defaultOn: false },
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
      // The one sanctioned bulk delete of the ledger (see lib/ledgerGuard.js).
      await withLedgerMaintenance(() => del('journalEntries', JournalEntry, false));
      await del('closedPeriods', ClosedPeriod, false);
      await del('bankDeposits', BankDeposit, false);
    }
    if (selected.has('inventory')) {
      await del('inventory', Inventory);
      // Append-only outside maintenance (server.js StockCardSchema).
      await withLedgerMaintenance(() => del('stockCards', StockCard, false));
      await del('inventoryMovements', InventoryMovement, false);
      await del('backdateQueue', BackdateQueueItem);
    }
    if (selected.has('transfers')) {
      await del('stockTransfers', StockTransfer);
      await del('crossTransfers', CrossTransfer);
      await del('transferRequests', TransferRequest);
    }
    if (selected.has('shifts')) {
      await del('shifts', Shift, false);
      await del('clockEntries', ClockEntry);
      await del('scheduledShifts', ScheduledShift);
    }
    if (selected.has('revolvingFunds')) {
      await del('revolvingFunds', RevolvingFund, false);
      await del('revolvingFundTx', RevolvingFundTx, false);
    }
    if (selected.has('inventory')) {
      // The taxonomy and the batches that produced the stock - keeping
      // them leaves categories and production orders pointing at items
      // that no longer exist.
      await del('stockCategories', StockCategory);
      await del('storageLocations', StorageLocation);
      await del('productionOrders', ProductionOrder);
    }
    if (selected.has('procurement')) {
      await del('purchaseOrders', PurchaseOrder, false);
      await del('bills', Bill);
    }
    if (selected.has('ledger')) {
      // Issued alongside ledger entries; leaving them behind orphans a
      // disbursement trail that points at journal entries no longer there.
      await del('checkVouchers', CheckVoucher);
      await del('advances', Advance);
    }
    if (selected.has('fixedAssets')) await del('fixedAssets', FixedAsset);
    // Suppliers carry their catalog inside them, so one delete clears both.
    // No businessType field on Supplier.
    if (selected.has('suppliers')) {
      await del('suppliers', Supplier, false);
    } else if (selected.has('ledger')) {
      // Kept suppliers, wiped ledger: a supplier's credit balance is backed by
      // 160100 Supplier Credit Balance, which just went. Left as it was, the
      // balance would be money nobody's books hold.
      deleted.supplierCreditsCleared = (await Supplier.updateMany({ creditBalance: { $ne: 0 } }, { $set: { creditBalance: 0 } })).modifiedCount;
    }
    // The same for clients, who are never purged: their credit balance is
    // backed by 260100 Client Credit Balance, which a ledger purge removes.
    if (selected.has('ledger')) {
      deleted.clientCreditsCleared = (await ClientAccount.updateMany({ creditBalance: { $ne: 0 } }, { $set: { creditBalance: 0 } })).modifiedCount;
    }
    if (selected.has('requisitions')) await del('requisitionSlips', RequisitionSlip);
    if (selected.has('eod')) await del('eodRecords', EODRecord, false);
    if (selected.has('orders')) {
      await del('collectionReminders', CollectionReminder);
      await del('qrSessions', QRSession, false);
    }
    if (selected.has('auditLog')) await withLedgerMaintenance(() => del('auditLog', AuditLog, false));

    if (selected.has('menu')) {
      // No businessType field on these (see hasBizField note above).
      await del('products', Product, false);
      await del('categories', Category, false);
      await del('combos', Combo, false);
      await del('addOns', AddOn, false);
      await del('modifierGroups', ModifierGroup, false);
      await del('priceTiers', PriceTier);
      await del('discounts', Discount, false);
      await del('discountRules', DiscountRule);
      await del('changeRequests', ChangeRequest);
    } else {
      // Products are KEPT, but "Out of Stock" is a manual per-product flag
      // independent of Inventory (see products.js) - it isn't deleted or
      // derived, so it silently survives a purge and keeps showing stale
      // "OUT OF STOCK" badges on a menu that's otherwise fresh. Reset it
      // without touching anything else about the product.
      deleted.productsMarkedBackInStock = (await Product.updateMany({ ...bizScope, isOutOfStock: true }, { $set: { isOutOfStock: false } })).modifiedCount;
    }

    if (selected.has('clients') || selected.has('walkInClients')) {
      const ClientAccount = mongoose.model('ClientAccount');
      const filter = selected.has('clients') ? {} : { source: 'pos' };
      const candidates = await ClientAccount.find(filter, { _id: 1, creditBalance: 1 }).lean();
      const ids = candidates.map(c => String(c._id));
      const oids = candidates.map(c => c._id);
      const M = (n) => mongoose.model(n);
      const [ord1, ord2, adv, res, quo] = await Promise.all([
        M('Order').distinct('clientId', { clientId: { $in: ids } }),
        M('Order').distinct('clientAccountId', { clientAccountId: { $in: ids } }),
        M('Advance').distinct('clientId', { clientId: { $in: ids } }),
        M('Reservation').distinct('clientId', { clientId: { $in: ids } }),
        M('Quotation').distinct('clientAccountId', { clientAccountId: { $in: oids } }),
      ]);
      const busy = new Set([...ord1, ...ord2, ...adv, ...res, ...quo].map(String));
      const removable = candidates.filter(c => !busy.has(String(c._id)) && !(Math.abs(Number(c.creditBalance) || 0) > 0.004)).map(c => c._id);
      deleted.clients = (await ClientAccount.deleteMany({ _id: { $in: removable } })).deletedCount;
      deleted.clientsKeptWithHistory = candidates.length - removable.length;
    }

    // Cached analytics counters - MUST reset alongside Order/Product,
    // whatever fed them, or Analytics keeps showing pre-purge totals forever
    // (they're not derived live, see reports.js).
    if (selected.has('orders') || selected.has('menu')) {
      await del('tenantStats', TenantStats);
      await del('productStats', ProductStats);
    }

    // Always untouched regardless of selection: User, Role, ClientAccount unless
    // 'walkInClients' / 'clients' is chosen
    // (staff + client logins), Account/Settings/PaymentMethodMap (Chart of
    // Accounts + config), Discount/DiscountRule (promo definitions),
    // StorageLocation/StockCategory (inventory taxonomy), Supplier (vendor
    // master data - unless 'suppliers' is chosen), ScheduledShift (future planning), Tenant, Counter
    // (sequence numbers - left as-is so new records don't reuse old
    // reference/order numbers).

    // An order closed by a link to a bill that is now gone is open again.
    try { await reopenOrdersClosedByPendingBills(mongoose); } catch (err) { log.error?.({ err }, 'purge: linked purchase orders not re-checked'); }
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
