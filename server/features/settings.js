// settings routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';

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
    const setting = await Settings.findOneAndUpdate({ key: req.params.key }, { value }, { upsert: true, returnDocument: 'after' });
    emitToAll('settingsUpdated', { key: req.params.key, value });

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
