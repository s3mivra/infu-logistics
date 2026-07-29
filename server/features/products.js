// products routes — moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';

export default function registerProducts(ctx) {
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

// Categories
app.get('/api/categories', async (req, res) => {
  try {
    // Tenancy: only return rows belonging to this server's business type.
    const categories = await Category.find({ businessType: BUSINESS_TYPE }).lean();
    res.json({ success: true, categories });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/categories', verifyToken, requireStaff, async (req, res) => {
  try {
    // Save the department along with the name
    const newCat = await Category.create({
      name: req.body.name,
      department: req.body.department || 'Kitchen'
    });
    emitToAll('menuUpdated');
    res.json({ success: true, category: newCat });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// --- NEW: UPDATE CATEGORY ROUTE ---
app.put('/api/categories/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    const updated = await Category.findByIdAndUpdate(
      req.params.id, 
      { name: req.body.name, department: req.body.department }, 
      { returnDocument: 'after' }
    );
    emitToAll('menuUpdated');
    res.json({ success: true, category: updated });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.delete('/api/categories/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    emitToAll('menuUpdated');
    res.json({ success: true });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Products
app.get('/api/products', async (req, res) => {
  try {
    // Identify the caller so we can return the right shape:
    //  • client JWT  → effectiveDiscountPercent for that client; raw overrides stripped
    //  • admin/staff → keep clientDiscounts so the Products tab can show & re-save them
    //  • anonymous   → product default discountPercent only; raw overrides stripped
    let buyerClientId = '';
    let isAdminCaller = false;
    try {
      const raw = req.headers.authorization?.replace(/^Bearer /, '') || req.cookies?.client_token || '';
      if (raw) {
        const dec = jwt.verify(raw, process.env.JWT_SECRET);
        if (dec?.role === 'client') buyerClientId = String(dec.clientId || dec._id || '');
        else if (dec?.role) isAdminCaller = true; // any non-client authenticated user is staff/admin
      }
    } catch { /* anonymous / invalid token — fall back to the default discount */ }

    // Exclude soft-deleted products; tenancy-scoped to this server's businessType.
    // Removed products (isAvailable=false): visible to admin/staff for management,
    // hidden from customer-facing menu. OOS products: visible to everyone (UI
    // surfaces the OOS badge).
    const productQuery = { isArchived: { $ne: true }, businessType: BUSINESS_TYPE };
    if (!isAdminCaller) productQuery.isAvailable = { $ne: false };
    const products = await Product.find(productQuery).populate('modifierGroups').lean();
    // Product images can be globally disabled via the superadmin "Product Images" setting.
    // Customers then receive no image (the menu shows a placeholder); staff/admin keep the
    // image so they can still see and manage it.
    let imagesEnabled = true;
    if (!isAdminCaller) {
      const imgSetting = await Settings.findOne({ key: 'imagesEnabled' }).lean();
      imagesEnabled = !imgSetting || imgSetting.value !== false;
    }
    // Resolve the effective per-line discount for this caller.
    products.forEach(p => {
      if (!isAdminCaller && !imagesEnabled) p.image = '';
      let pct = Number(p.discountPercent || 0);
      if (buyerClientId) {
        const ov = (p.clientDiscounts || []).find(d => String(d.clientId) === buyerClientId);
        if (ov) pct = Number(ov.percent || 0);
      }
      p.effectiveDiscountPercent = Math.max(0, Math.min(100, pct));
      // Only strip raw overrides from non-admin responses. Admin / staff need
      // them to power the edit form and the on-behalf client picker in POS;
      // stripping made the form silently lose overrides on save (the form
      // rendered as empty, then "Save" overwrote real data with [] ).
      if (!isAdminCaller) {
        delete p.clientDiscounts;
        // Strip internal cost / recipe (BOM) data from customer-facing responses so
        // ingredient lists, per-item costs, and margins are not exposed publicly.
        // Keep customer-relevant fields (size name/price, add-on name/price).
        delete p.baseRecipe; delete p.costOverride;
        (p.sizes  || []).forEach(s => { delete s.recipe; delete s.costOverride; });
        (p.addOns || []).forEach(a => { delete a.recipe; });
      }
    });

    // Compute stockAvailable from live inventory.
    //  • FB / recipe products: every linked ingredient must have enough stock.
    //  • LOG / 1:1 products (no recipe): the product IS a stocked good — match the
    //    linked inventory item by itemCode (then itemName) and require at least one
    //    sellable unit (unitMultiplier base units) on hand.
    const invItems = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }, { _id: 1, itemCode: 1, itemName: 1, stockQty: 1, unitMultiplier: 1 }).lean();
    const invById = {}, invByCode = {}, invByName = {};
    invItems.forEach(i => {
      invById[i._id.toString()] = i;
      if (i.itemCode) invByCode[i.itemCode] = i;
      if (i.itemName) invByName[i.itemName] = i;
    });
    products.forEach(p => {
      const recipe = p.baseRecipe || [];
      if (recipe.some(r => r.invId)) {
        p.stockAvailable = recipe.every(ing => {
          if (!ing.invId) return true;                  // unlinked — don't block the product
          const inv = invById[ing.invId];
          const need = Number(ing.qty) || 0;
          return inv && inv.stockQty > 0 && inv.stockQty >= need;
        });
      } else {
        // 1:1 logistics good: the product IS the stocked good, so with no recipe
        // to fall back on, a missing OR zero/insufficient linked item must block
        // the product — never default to "available" just because nothing matched.
        const inv = invByCode[p.productCode] || invByName[p.name];
        p.stockAvailable = !!inv && inv.stockQty >= baseUnitsPerSale(p, inv);
      }
    });

    res.json({ success: true, products });
  } catch (err) {
    log.error({ err }, 'GET /api/products failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/products', verifyToken, requireStaff, validate(productSchema), async (req, res) => {
  try {
  // Generate base product code (e.g., DRS-A0001)
  const catPrefix = getCategoryPrefix(req.body.category);
  req.body.productCode = await generateNextSequence(Product, catPrefix, 'productCode');
  
  // Generate size codes if they exist (e.g., DRS-A0002, DRS-A0003)
  if (req.body.sizes && req.body.sizes.length > 0) {
    for (let i = 0; i < req.body.sizes.length; i++) {
      // Temporarily save the product to reserve the code, or generate sequentially
      const nextNum = parseInt(req.body.productCode.split('-A')[1], 10) + 1 + i;
      req.body.sizes[i].sizeCode = `${catPrefix}-A${nextNum.toString().padStart(4, '0')}`;
    }
  }

  const newProduct = await Product.create(req.body);
  emitToAll('menuUpdated');
  res.json({ success: true, product: newProduct });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.put('/api/products/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id).lean();
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' });
    // Reason from the X-Change-Reason header (URL-encoded). Required for every
    // price / recipe-cost change; the client refuses to submit without one.
    const changeReason = (() => {
      try { return decodeURIComponent(String(req.headers['x-change-reason'] || '')).slice(0, 300); }
      catch { return String(req.headers['x-change-reason'] || '').slice(0, 300); }
    })();

    if (existing && req.body.basePrice !== undefined && Number(req.body.basePrice) !== Number(existing.basePrice)) {
      await AuditLog.create({
        userId: req.user ? req.user.name : 'System',
        action: 'PRODUCT_PRICE_CHANGED',
        targetReference: updatedProduct.productCode || req.params.id,
        details: { name: updatedProduct.name, oldPrice: existing.basePrice, newPrice: updatedProduct.basePrice, reason: changeReason },
      });
      // Memo journal entry — zero-money, balanced row pair on Inventory Asset
      // so it threads onto the ledger filter without affecting balances.
      // Lets finance trace every catalogue price change in the same place as
      // real movements. Uses a unique reference per change.
      try {
        const memoRef = await mkSeqRef('PRICE');
        await JournalEntry.create({
          reference: memoRef,
          description: `Price change · ${updatedProduct.name} · ₱${Number(existing.basePrice).toFixed(2)} → ₱${Number(updatedProduct.basePrice).toFixed(2)} · ${changeReason || 'no reason given'}`,
          lines: [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: 0, memo: 'price change (memo)' },
            { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: 0, memo: 'price change (memo)' },
          ],
          totalDebit: 0,
          totalCredit: 0,
        });
      } catch (e) { log?.error?.({ err: e }, 'price-change memo JE failed'); }
    }
    if (existing && req.body.costOverride !== undefined && Number(req.body.costOverride || 0) !== Number(existing.costOverride || 0)) {
      await AuditLog.create({
        userId: req.user ? req.user.name : 'System',
        action: 'PRODUCT_RECIPE_COST_CHANGED',
        targetReference: updatedProduct.productCode || req.params.id,
        details: { name: updatedProduct.name, oldCost: existing.costOverride || 0, newCost: updatedProduct.costOverride || 0, reason: changeReason },
      });
      try {
        const memoRef = await mkSeqRef('RCOST');
        await JournalEntry.create({
          reference: memoRef,
          description: `Recipe cost change · ${updatedProduct.name} · ₱${Number(existing.costOverride || 0).toFixed(2)} → ₱${Number(updatedProduct.costOverride || 0).toFixed(2)} · ${changeReason || 'no reason given'}`,
          lines: [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: 0, memo: 'recipe cost change (memo)' },
            { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: 0, memo: 'recipe cost change (memo)' },
          ],
          totalDebit: 0,
          totalCredit: 0,
        });
      } catch (e) { log?.error?.({ err: e }, 'recipe-cost memo JE failed'); }
    }
    // General edit audit — records every PUT for forensic trail.
    await logAudit(req, {
      action: 'update', entity: 'Product', entityId: req.params.id,
      before: existing ? { name: existing.name, basePrice: existing.basePrice, category: existing.category, costOverride: existing.costOverride } : null,
      after:  updatedProduct ? { name: updatedProduct.name, basePrice: updatedProduct.basePrice, category: updatedProduct.category, costOverride: updatedProduct.costOverride } : null,
    });
    emitToAll('menuUpdated');
    res.json({ success: true, product: updatedProduct });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// PATCH /api/products/:id/availability — superadmin toggle. Permanently REMOVES
// the product from menu + POS. Reporting still surfaces it while stock remains.
app.patch('/api/products/:id/availability', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean')
      return res.status(400).json({ success: false, error: 'isAvailable must be true or false.' });
    const product = await Product.findByIdAndUpdate(req.params.id, { isAvailable }, { returnDocument: 'after' });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });
    await AuditLog.create({
      userId: req.user?.name || 'System',
      action: isAvailable ? 'PRODUCT_RESTORED' : 'PRODUCT_REMOVED',
      targetReference: product.productCode || req.params.id,
      details: { name: product.name, isAvailable, changedBy: req.user?.name }
    });
    emitToAll('menuUpdated');
    res.json({ success: true, product });
  } catch (err) {
    log.error({ err }, 'PATCH /api/products/:id/availability failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// PATCH /api/products/:id/oos — toggle "Out of Stock". Distinct from Removed —
// OOS products still appear in menu (with a badge) and in all reports. Use this
// for a temporary stockout; use /availability for permanent removal.
app.patch('/api/products/:id/oos', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { isOutOfStock } = req.body;
    if (typeof isOutOfStock !== 'boolean')
      return res.status(400).json({ success: false, error: 'isOutOfStock must be true or false.' });
    const product = await Product.findByIdAndUpdate(req.params.id, { isOutOfStock }, { returnDocument: 'after' });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });
    await AuditLog.create({
      userId: req.user?.name || 'System',
      action: isOutOfStock ? 'PRODUCT_MARKED_OOS' : 'PRODUCT_BACK_IN_STOCK',
      targetReference: product.productCode || req.params.id,
      details: { name: product.name, isOutOfStock, changedBy: req.user?.name }
    });
    emitToAll('menuUpdated');
    res.json({ success: true, product });
  } catch (err) {
    log.error({ err }, 'PATCH /api/products/:id/oos failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Change to PUT or handle inside DELETE for archiving
app.delete('/api/products/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id, 
      { isArchived: true }, 
      { returnDocument: 'after' }
    );
    
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // Log the archive event
    await AuditLog.create({
      userId: req.user ? req.user.name : 'System',
      action: 'PRODUCT_ARCHIVED',
      targetReference: product.productCode || req.params.id,
      details: { name: product.name }
    });

    emitToAll('menuUpdated');
    res.json({ success: true, message: 'Product securely archived.' });
  } catch (error) {
    captureError(req, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── MODIFIER GROUP CRUD ──────────────────────────────────────────────────────
app.get('/api/modifier-groups', verifyToken, requireStaff, async (req, res) => {
  try { res.json({ success: true, groups: await ModifierGroup.find().lean() }); }
  catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.post('/api/modifier-groups', verifyToken, requireSuperAdmin, validate(modifierGroupSchema), async (req, res) => {
  try { const group = await ModifierGroup.create(req.body); emitToAll('menuUpdated'); res.json({ success: true, group }); }
  catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.put('/api/modifier-groups/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { const group = await ModifierGroup.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true }); emitToAll('menuUpdated'); res.json({ success: true, group }); }
  catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.delete('/api/modifier-groups/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { await ModifierGroup.findByIdAndDelete(req.params.id); emitToAll('menuUpdated'); res.json({ success: true }); }
  catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

// ── COMBO / BUNDLE CRUD (Product Promos) ─────────────────────────────────────
app.get('/api/combos', async (req, res) => {
  try {
    const combos = await Combo.find(req.query.all ? {} : { isActive: true }).lean();
    res.json({ success: true, combos });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.post('/api/combos', verifyToken, requireSuperAdmin, validate(comboSchema), async (req, res) => {
  try {
    if (!req.body.name || !(req.body.price > 0)) return res.status(400).json({ success: false, error: 'Name and a positive price are required.' });
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) return res.status(400).json({ success: false, error: 'A combo needs at least one component product.' });
    req.body.comboCode = await generateNextSequence(Combo, 'CMB', 'comboCode');
    const combo = await Combo.create(req.body);
    emitToAll('menuUpdated');
    res.json({ success: true, combo });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.put('/api/combos/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { const combo = await Combo.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }); emitToAll('menuUpdated'); res.json({ success: true, combo }); }
  catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.delete('/api/combos/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { await Combo.findByIdAndDelete(req.params.id); emitToAll('menuUpdated'); res.json({ success: true }); }
  catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});
}
