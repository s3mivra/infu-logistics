// addons routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';
import { requirePermission as permit } from '../lib/authz.js';

export default function registerAddons(ctx) {
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

app.get('/api/addons', async (req, res) => {
  try {
    // Public, because the customer menu lists extras before anyone signs in.
    // An add-on's recipe is not public, though: what goes into it and what
    // each part costs. It was never filled in, so there was nothing to leak;
    // now that it can be, only staff see it - the same line /api/products
    // draws for a drink's recipe.
    let isStaff = false;
    try {
      const raw = req.headers.authorization?.replace(/^Bearer /, '') || '';
      if (raw) { const dec = jwt.verify(raw, process.env.JWT_SECRET); isStaff = !!dec?.role && dec.role !== 'client'; }
    } catch { /* anonymous or expired: treated as the public */ }
    const addons = await AddOn.find({}, isStaff ? undefined : { recipe: 0 }).lean();
    res.json({ success: true, addons });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// requireSuperAdmin: only superadmin can create or remove add-ons (menu integrity)
app.post('/api/addons', verifyToken, requireSuperAdmin, validate(addonSchema), async (req, res) => {
  try {
    const newAddOn = await AddOn.create(req.body);
    emitToAll('menuUpdated');
    res.json({ success: true, addon: newAddOn });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// requireSuperAdmin: only superadmin can edit add-ons (menu integrity)
app.patch('/api/addons/:id', verifyToken, requireSuperAdmin, validate(addonSchema), async (req, res) => {
  try {
    const addon = await AddOn.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!addon) return res.status(404).json({ success: false, error: 'Add-on not found' });
    emitToAll('menuUpdated');
    res.json({ success: true, addon });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/addons/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await AddOn.findByIdAndDelete(req.params.id);
    emitToAll('menuUpdated');
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
// ── LINK ADD-ONS TO PRODUCTS, IN BULK ─────────────────────────────────────
// Attaching an extra used to mean opening every drink and ticking it there -
// forty drinks, forty edits, and the one that got missed sells without its
// Extra Shot option. This attaches (or detaches) any set of add-ons across
// all products, some categories, or a chosen list, in one request.
//
// It writes exactly what the product editor writes when an add-on is ticked:
// { name, price, recipe: [] }. The empty recipe is deliberate - at the till it
// falls back to the add-on's own recipe (see resolveAddOnRecipe in orders.js).
// A product that already has the add-on is left alone, so a price or recipe
// set on that one product is never overwritten by a bulk attach.
app.post('/api/addons/link', verifyToken, requireStaff, permit('products.manage'), async (req, res) => {
  try {
    const { addOnIds, target = {}, action } = req.body || {};
    if (action !== 'attach' && action !== 'detach') return res.status(400).json({ success: false, error: 'Choose attach or detach.' });

    const ids = Array.isArray(addOnIds) ? addOnIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id))) : [];
    const addOns = addOnIds === 'all' ? await AddOn.find({}).lean() : await AddOn.find({ _id: { $in: ids } }).lean();
    if (!addOns.length) return res.status(400).json({ success: false, error: 'Pick at least one add-on.' });

    const filter = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    if (target.all === true) {
      // every product
    } else if (Array.isArray(target.categories) && target.categories.length) {
      filter.category = { $in: target.categories.map(String) };
    } else if (Array.isArray(target.productIds) && target.productIds.length) {
      filter._id = { $in: target.productIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id))) };
    } else {
      return res.status(400).json({ success: false, error: 'Pick which products: all, some categories, or specific ones.' });
    }
    const inScope = await Product.countDocuments(filter);
    if (!inScope) return res.status(400).json({ success: false, error: 'No products match that choice.' });

    const perAddOn = [];
    if (action === 'attach') {
      for (const a of addOns) {
        const r = await Product.updateMany(
          { ...filter, 'addOns.name': { $ne: a.name } },
          { $push: { addOns: { name: a.name, price: Number(a.price) || 0, recipe: [] } } },
        );
        perAddOn.push({ name: a.name, changed: r.modifiedCount || 0 });
      }
    } else {
      for (const a of addOns) {
        const r = await Product.updateMany({ ...filter, 'addOns.name': a.name }, { $pull: { addOns: { name: a.name } } });
        perAddOn.push({ name: a.name, changed: r.modifiedCount || 0 });
      }
    }

    await logAudit(req, {
      action: 'update', entity: 'Product', entityId: 'bulk-addon-link',
      after: { action, addOns: addOns.map((a) => a.name), target, products: inScope, perAddOn },
    });
    emitToAll('menuUpdated');
    res.json({ success: true, action, products: inScope, perAddOn });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});
}
