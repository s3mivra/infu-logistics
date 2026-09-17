// settings routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';
import { loadSeriesPrefixes, invalidateSeriesCache, normalizePrefix, describeSeries, isSeriesKey, seriesForKey } from '../lib/docSeries.js';
import { isValidBranchCode } from '../lib/branchCode.js';
import { isValidTimeZone, setBusinessTimeZone, businessTimeZone } from '../lib/businessTime.js';
import { moduleStates, MODULE_KEYS, truthy } from '../lib/optionalModules.js';

export default function registerSettings(ctx) {
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
    invalidateBranchCodeCache,
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

// Client-portal branding/copy. These are the ONLY settings readable without a
// staff token - the portal is served to logged-out clients, so anything listed
// here is effectively public. Never add operational settings (credit limits,
// auto-close, ...) to this list.
const PUBLIC_PORTAL_KEYS = [
  'portalWelcomeTitle',
  'portalWelcomeMessage',
  'portalAnnouncement',
  'portalSupportLink',
  'portalSupportLabel',
  'portalPaymentInstructions',
  'portalShowPrices',
  'portalAllowNotes',
  'portalCompanyName',
  'portalCompanyAddress',
  'portalCompanyPhone',
  'portalCompanyEmail',
  'portalSlipFooter',
  'businessLogo',
  'paymentQrImage',
  'printLogo',
  'printLogoEnabled',
  'logoColor',
  'logoRadius',
];

// ── SETTINGS ROUTES ──────────────────────────────────────────────────────────

// Unauthenticated: the client portal reads its own copy/branding from here.
app.get('/api/public/portal-settings', async (req, res) => {
  try {
    const rows = await Settings.find({ key: { $in: PUBLIC_PORTAL_KEYS } }).lean();
    res.json({ success: true, settings: Object.fromEntries(rows.map(s => [s.key, s.value])) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// PUBLIC, no session - the login screen needs to know whether to ask for a
// starting cash float BEFORE anyone is authenticated (that's what the setting
// controls). Whitelist only what is genuinely safe pre-login; this is not a
// general escape hatch for reading settings without a token.
app.get('/api/settings/public', async (req, res) => {
  try {
    const [row, sharedRow] = await Promise.all([
      Settings.findOne({ key: 'requireCashShift' }).lean(),
      Settings.findOne({ key: 'sharedDrawer' }).lean(),
    ]);
    const sharedDrawer = sharedRow?.value === true;
    // Whether the shop's one drawer is already open. The login screen needs it
    // BEFORE anyone authenticates: on a shared drawer the float is declared
    // once by whoever opens up, and asking the second and third person of the
    // morning for a starting cash amount invites them to type the same figure
    // again - which is the exact double-count the shared drawer exists to
    // prevent. Discloses only that the till is open, which anyone standing at
    // the counter can already see.
    const drawerOpen = sharedDrawer
      ? Boolean(await mongoose.model('Shift').exists({ scope: 'drawer', status: 'Open' }))
      : false;
    // Unset means the historical behaviour: required. Preserves every existing
    // deployment's current login flow until someone explicitly turns it off.
    res.json({ success: true, requireCashShift: row?.value !== false, sharedDrawer, drawerOpen });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Which optional accounting modules this business uses. Read by the sidebar so
// a module that is off does not appear at all - a screen that posts into books
// nobody reads is worse than no screen.
app.get('/api/settings/modules', verifyToken, requireStaff, async (req, res) => {
  try {
    res.json({ success: true, modules: await moduleStates(Settings) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});


// ── WHAT STILL HAS TO BE SET BEFORE TRADING ─────────────────────────────────
// Some settings can be put right at any time. One cannot: the receipt serial
// start number locks the moment the first receipt is issued, because moving it
// afterwards would renumber receipts already in customers' hands. Nothing
// stopped a business ringing up its first sale before setting it, and by the
// time anyone noticed it was permanent.
//
// So this says what is outstanding AND how long it can still be put right,
// which is the part that actually matters.
app.get('/api/settings/readiness', verifyToken, requireStaff, async (req, res) => {
  try {
    const [rows, receiptsIssued] = await Promise.all([
      Settings.find({ key: { $in: ['businessTimeZone', 'orStartNumber', 'orPrefix', 'birPermitNo', 'birMachineId', 'businessTin', 'vatEnabled'] } }).lean(),
      mongoose.model('Order').countDocuments({ orNumber: { $nin: [null, ''] } }),
    ]);
    const val = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const isSet = (k) => val[k] !== undefined && String(val[k]).trim() !== '';
    const serialLocked = receiptsIssued > 0;

    const items = [];

    // The one with a deadline.
    if (!serialLocked) {
      items.push({
        key: 'orStartNumber',
        label: 'Receipt serial start number',
        set: isSet('orStartNumber'),
        severity: 'locks',
        note: isSet('orStartNumber')
          ? `Set to ${val.orStartNumber}. Still changeable - it locks permanently once the first receipt is issued.`
          : 'Set this to the number your registered booklet is already up to, BEFORE your first sale. It locks permanently once the first receipt is issued.',
      });
    }

    items.push({
      key: 'businessTimeZone',
      label: 'Business time zone',
      set: isSet('businessTimeZone'),
      severity: 'important',
      note: 'Decides which day a sale belongs to, when the day locks, and what a daily report covers. Change it between trading days, not mid-service.',
    });

    // Printed on every receipt. Fixable later, but every receipt issued before
    // then goes out without them.
    for (const [key, label] of [
      ['businessTin', 'Business TIN'],
      ['birPermitNo', 'ATP / Permit number'],
      ['birMachineId', 'Machine ID / serial'],
    ]) {
      items.push({
        key, label, set: isSet(key), severity: 'receipts',
        note: 'Printed on every receipt and invoice. Receipts issued before it is filled in go out without it.',
      });
    }

    const outstanding = items.filter(i => !i.set);
    res.json({
      success: true,
      ready: outstanding.length === 0,
      receiptsIssued,
      serialLocked,
      items,
      outstanding: outstanding.length,
      // The single thing worth interrupting someone for.
      urgent: outstanding.find(i => i.severity === 'locks') || null,
    });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// What every document a person actually holds is called. The screen needs the
// labels, the notes and a worked sample per series - building that list in the
// client would mean the two ends disagreeing the moment one changes.
app.get('/api/settings/document-series', verifyToken, requireStaff, async (req, res) => {
  try {
    res.json({ success: true, series: describeSeries(await loadSeriesPrefixes(Settings)) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.get('/api/settings', verifyToken, requireStaff, async (req, res) => {
  try {
    const rows = await Settings.find().lean();
    res.json({ success: true, settings: Object.fromEntries(rows.map(s => [s.key, s.value])) });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// Keys that change how an order's tax is computed. Flipping any of them has to
// reach the orders already on the counter, or the cashier turns VAT on and the
// pending sale in front of them stubbornly keeps showing 0%.
const VAT_KEYS = new Set(['vatEnabled', 'vatRate', 'scPwdOrder', 'vatInclusive']);

// Re-stamps VAT on every order that is not yet final, so a settings change reaches
// the sales already on the counter. Under VAT-INCLUSIVE pricing the customer's
// total is unchanged and only the net/VAT split moves; under EXCLUSIVE pricing the
// total genuinely rises (VAT added on top), which is why the total is rewritten
// here too. Completed, voided, cancelled and refunded orders are deliberately
// untouched - those are booked history, and re-pricing them would rewrite the ledger.
async function restampOpenOrdersVat() {
  const [enabledRow, rateRow, orderRow, inclusiveRow] = await Promise.all([
    Settings.findOne({ key: 'vatEnabled' }).lean(),
    Settings.findOne({ key: 'vatRate' }).lean(),
    Settings.findOne({ key: 'scPwdOrder' }).lean(),
    Settings.findOne({ key: 'vatInclusive' }).lean(),
  ]);
  const enabled = enabledRow?.value === true || enabledRow?.value === 'true';
  const rate = normaliseVatRate(rateRow?.value, DEFAULT_VAT_RATE);
  const scPwdOrder = orderRow?.value === 'discount-first' ? 'discount-first' : 'vat-first';
  const inclusive = inclusiveRow ? inclusiveRow.value !== false && inclusiveRow.value !== 'false' : true;

  const open = await Order.find({
    status: { $nin: ['Completed', 'Voided', 'Cancelled', 'Refunded'] },
  });

  let updated = 0;
  for (const order of open) {
    let baseAfterLineDisc = 0;
    let discountableBase = 0;
    let exemptBase = 0;
    let lineDiscTotal = 0;

    for (const item of order.items || []) {
      const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
      const itemBase = ((item.price || 0) + addOnTotal) * (item.quantity || 1);
      const linePct = Math.max(Number(item.productDiscountPercent || 0), Number(item.discountPercent || 0));
      const lineDisc = +(itemBase * linePct / 100).toFixed(2);
      lineDiscTotal += lineDisc;
      baseAfterLineDisc += itemBase - lineDisc;
      if (linePct === 0 && item.hasDiscount !== false) discountableBase += itemBase;
      if (item.vatExempt === true) exemptBase += itemBase - lineDisc;
    }

    // Derive the exemption from the discount actually applied, not from the
    // stored boolean: every order written before VAT went live inherited
    // isVatExempt=true from the old schema default, and trusting it would exempt
    // the entire back catalogue.
    const exemptSale = order.discountType === 'SC/PWD';

    const r = order.isComplimentary
      ? { total: 0, vatAmount: 0, vatableSales: 0, vatExemptSales: 0, discount: +baseAfterLineDisc.toFixed(2) }
      : computeOrderVat({
          grossInclusive: baseAfterLineDisc,
          discountableGross: discountableBase,
          exemptGross: exemptBase,
          discountPercent: Number(order.discountPercent || 0),
          vatEnabled: enabled,
          vatRate: rate,
          isVatExempt: exemptSale,
          scPwdOrder,
          vatInclusive: inclusive,
        });

    order.isVatExempt = exemptSale;
    order.vatRate = enabled ? rate : 0;
    order.scPwdOrder = scPwdOrder;
    order.isVatInclusive = inclusive;
    order.vatAmount = Number(r.vatAmount.toFixed(2));
    order.vatableSales = Number(r.vatableSales.toFixed(2));
    order.vatExemptSales = Number(r.vatExemptSales.toFixed(2));
    order.discount = Number((lineDiscTotal + (r.discount || 0)).toFixed(2));
    // Under INCLUSIVE pricing this is a no-op - the total never moves when VAT
    // toggles. Under EXCLUSIVE pricing the total genuinely rises, so it must be
    // written or the order and its printed VAT would disagree.
    order.total = Number(r.total.toFixed(2));
    await order.save();
    updated += 1;
  }
  return updated;
}

// ── CURRENCY (DISPLAY CONFIG ONLY) ────────────────────────────────────────────
// IMPORTANT SCOPE NOTE: this configures the currency SYMBOL and ISO code the UI
// shows - it is NOT multi-currency / FX support. Every amount in the system is
// still a single flat number with no currency dimension, and no conversion
// happens anywhere. Changing this to 'USD'/'$' relabels the display; it does
// NOT convert existing peso figures. True multi-currency (per-transaction
// currency, exchange rates, revaluation) would touch every money calculation
// in the app and is deliberately out of scope. Default stays ₱/PHP.
const DEFAULT_CURRENCY = { symbol: '₱', code: 'PHP' };

app.get('/api/settings/currency', verifyToken, requireStaff, async (req, res) => {
  try {
    const row = await Settings.findOne({ key: 'currency' }).lean();
    const currency = (row?.value && typeof row.value === 'object') ? { ...DEFAULT_CURRENCY, ...row.value } : DEFAULT_CURRENCY;
    res.json({ success: true, currency });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.patch('/api/settings/currency', verifyToken, requireStaff, requirePermission('settings.manage'), async (req, res) => {
  try {
    const symbol = String(req.body?.symbol ?? '').trim();
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!symbol || symbol.length > 4) return res.status(400).json({ success: false, error: 'symbol is required (max 4 chars).' });
    if (!/^[A-Z]{3}$/.test(code)) return res.status(400).json({ success: false, error: 'code must be a 3-letter ISO currency code (e.g. PHP, USD).' });
    const value = { symbol, code };
    await Settings.findOneAndUpdate({ key: 'currency' }, { value }, { upsert: true });
    emitToAll('settingsUpdated', { key: 'currency', value });
    res.json({ success: true, currency: value });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.patch('/api/settings/:key', verifyToken, requireStaff, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { value } = req.body;

    // branchCode identifies this deployment in a consolidated report
    // ("AC-A001": business AC, location A, inventory 001). A malformed code is
    // rejected rather than stored, because the report groups on it - a typo
    // would file this branch's money under "Unassigned" and nobody would
    // notice until the location totals came out short. Empty clears it.
    if (req.params.key === 'branchCode') {
      const code = String(value == null ? '' : value).trim().toUpperCase();
      if (code && !isValidBranchCode(code)) {
        return res.status(400).json({
          success: false,
          error: 'Branch code must look like AC-A001 - a business code, a location letter, then the inventory number at that location.',
        });
      }
      const saved = await Settings.findOneAndUpdate({ key: 'branchCode' }, { value: code }, { upsert: true, returnDocument: 'after' });
      invalidateBranchCodeCache();
      emitToAll('settingsUpdated', { key: 'branchCode', value: code });
      return res.json({ success: true, setting: saved });
    }

    // The business's clock. Every day boundary hangs off it - report ranges,
    // the EOD lock, the midnight close - so it is validated before it is stored
    // and applied to the running server at once: a shop that has just told the
    // system where it is should not have to wait for a restart to get its own
    // day back.
    if (req.params.key === 'businessTimeZone') {
      const zone = String(value || '').trim();
      if (!isValidTimeZone(zone)) {
        return res.status(400).json({ success: false, error: 'That is not a timezone this system knows. Pick one from the list.' });
      }
      const saved = await Settings.findOneAndUpdate({ key: 'businessTimeZone' }, { value: zone }, { upsert: true, returnDocument: 'after' });
      setBusinessTimeZone(zone);
      try { await logAudit(req, { action: 'update', entity: 'Settings', entityId: 'businessTimeZone', after: { timeZone: zone } }); } catch { /* audit is best-effort */ }
      emitToAll('settingsUpdated', { key: 'businessTimeZone', value: zone });
      return res.json({ success: true, setting: saved, timeZone: businessTimeZone() });
    }

    // A document prefix is a label, not an identity: the counter behind each
    // series is keyed on its own canonical code, so renaming one here changes
    // what future documents are CALLED without restarting the sequence or
    // colliding with the numbers already issued.
    if (isSeriesKey(req.params.key)) {
      const series = seriesForKey(req.params.key);
      const prefix = normalizePrefix(value, series.defaultPrefix);
      const saved = await Settings.findOneAndUpdate({ key: req.params.key }, { value: prefix }, { upsert: true, returnDocument: 'after' });
      invalidateSeriesCache();
      try { await logAudit(req, { action: 'update', entity: 'Settings', entityId: req.params.key, after: { prefix } }); } catch { /* audit is best-effort */ }
      emitToAll('settingsUpdated', { key: req.params.key, value: prefix });
      return res.json({ success: true, setting: saved, series: describeSeries(await loadSeriesPrefixes(Settings)) });
    }

    // The receipt series is a registered, gapless sequence. Where it STARTS can
    // be declared once, before the first receipt is issued - after that, moving
    // it would renumber receipts already in a customer's hands or skip numbers
    // nobody can account for. The prefix and permit details stay editable; the
    // starting number does not.
    if (req.params.key === 'orStartNumber') {
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ success: false, error: 'The starting receipt number must be zero or a positive whole number.' });
      }
      if (await mongoose.model('Order').exists({ orNumber: { $nin: [null, ''] } })) {
        return res.status(409).json({
          success: false,
          error: 'Receipts have already been issued from this series, so its starting number can no longer be changed.',
        });
      }
      const saved = await Settings.findOneAndUpdate({ key: 'orStartNumber' }, { value: n }, { upsert: true, returnDocument: 'after' });
      try { await logAudit(req, { action: 'update', entity: 'Settings', entityId: 'orStartNumber', after: { start: n } }); } catch { /* audit is best-effort */ }
      emitToAll('settingsUpdated', { key: 'orStartNumber', value: n });
      return res.json({ success: true, setting: saved });
    }

    // Cash-drawer controls, coerced on the way in for the same reason module
    // switches are: a form posting the string "false" is truthy in JavaScript,
    // and a shared drawer that silently stays on because of it would have every
    // cashier ringing into one float they never agreed to.
    // Lock the register after each sale, so the next one cannot be rung under
    // the last person's name. Coerced for the same reason as the drawer flags.
    if (req.params.key === 'askOperatorEachSale') {
      const flag = truthy(value, false);
      const saved = await Settings.findOneAndUpdate({ key: 'askOperatorEachSale' }, { value: flag }, { upsert: true, returnDocument: 'after' });
      try { await logAudit(req, { action: 'update', entity: 'Settings', entityId: 'askOperatorEachSale', after: { value: flag } }); } catch { /* audit is best-effort */ }
      emitToAll('settingsUpdated', { key: 'askOperatorEachSale', value: flag });
      return res.json({ success: true, setting: saved });
    }
    if (req.params.key === 'sharedDrawer' || req.params.key === 'blindClose') {
      const flag = truthy(value, false);
      const saved = await Settings.findOneAndUpdate({ key: req.params.key }, { value: flag }, { upsert: true, returnDocument: 'after' });
      emitToAll('settingsUpdated', { key: req.params.key, value: flag });
      return res.json({ success: true, setting: saved });
    }
    // Maximum hours a drawer session may stay open; 0 disables the boundary.
    // A duration rather than a clock time, because a 24/7 counter is busiest at
    // the hour a midnight cut-off would fire.
    if (req.params.key === 'drawerMaxHours') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 168) {
        return res.status(400).json({ success: false, error: 'Session limit must be between 0 hours (off) and 168 (one week).' });
      }
      const saved = await Settings.findOneAndUpdate({ key: 'drawerMaxHours' }, { value: n }, { upsert: true, returnDocument: 'after' });
      emitToAll('settingsUpdated', { key: 'drawerMaxHours', value: n });
      return res.json({ success: true, setting: saved });
    }
    if (req.params.key === 'varianceThreshold') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ success: false, error: 'The variance threshold must be zero or a positive amount.' });
      }
      const saved = await Settings.findOneAndUpdate({ key: 'varianceThreshold' }, { value: n }, { upsert: true, returnDocument: 'after' });
      emitToAll('settingsUpdated', { key: 'varianceThreshold', value: n });
      return res.json({ success: true, setting: saved });
    }

    // A module switch is stored as a real boolean whatever the form posted, so
    // every reader gets the same answer without each one re-deciding what
    // "false" means.
    const stored = MODULE_KEYS.has(req.params.key) ? truthy(value, false) : value;
    const setting = await Settings.findOneAndUpdate({ key: req.params.key }, { value: stored }, { upsert: true, returnDocument: 'after' });
    emitToAll('settingsUpdated', { key: req.params.key, value: stored });

    if (MODULE_KEYS.has(req.params.key)) {
      await logAudit(req, { action: 'update', entity: 'Settings', entityId: req.params.key, after: { enabled: stored } });
      return res.json({ success: true, setting, modules: await moduleStates(Settings) });
    }

    if (VAT_KEYS.has(req.params.key)) {
      const updated = await restampOpenOrdersVat();
      // Push the recalculated orders to every open till, so a cashier mid-sale
      // sees the new split without reloading.
      if (updated > 0) emitToAll('ordersUpdated', { reason: 'vat-settings-changed' });
      return res.json({ success: true, setting, ordersRestamped: updated });
    }

    res.json({ success: true, setting });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});
}
