// products routes - moved verbatim from server.js (feature-driven restructure).
// All models/helpers/middleware still live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { captureError } from '../lib/errorLog.js';
import { splitUpdate } from '../lib/changeApproval.js';
import { hasPermission } from '../lib/authz.js';
import { loadTierContext, resolveEffectiveDiscountPercent } from '../lib/discounts.js';

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
    unitTypeOf,
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
    SaleSchema,
    Sale,
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
    PriceTier,
    RefreshSessionSchema,
    RefreshSession,
    RoleSchema,
    Role,
    AuditLogSchema,
    AuditLog,
    DiscountSchema,
    Discount,
    DiscountRule,
    EODRecordSchema,
    EODRecord,
    CounterSchema,
    Counter,
    emitToOps,
    emitToAll,
    emitToMgr,
    ChangeRequest,
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
    const categories = await Category.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
    res.json({ success: true, categories });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// Routing departments are mutually exclusive per business type: fb routes to
// Kitchen/Bar, log to Logistics/Warehouse. A department from the other type
// (e.g. 'Kitchen' on a log deployment) is coerced to this type's default rather
// than rejected - keeping the invariant without failing the request. Returns the
// department to store, or null when omitted (so the schema's per-type default applies).
const DEPTS_BY_TYPE = { log: ['Logistics', 'Warehouse'], fb: ['Kitchen', 'Bar'] };
function validDepartment(dept) {
  const allowed = DEPTS_BY_TYPE[BUSINESS_TYPE] || DEPTS_BY_TYPE.fb;
  if (dept == null || dept === '') return null;      // omitted → schema default
  if (!allowed.includes(dept)) return allowed[0];    // wrong-type → coerce to default
  return dept;
}

app.post('/api/categories', verifyToken, requireStaff, async (req, res) => {
  try {
    const department = validDepartment(req.body.department);
    // Stamp businessType/tenant so the row survives the scoped GET filter above -
    // without this a new category is saved untagged and vanishes from the list.
    // Let the schema default set the department (Logistics for log, Kitchen for fb)
    // when none is supplied, instead of forcing 'Kitchen' onto log deployments.
    const newCat = await Category.create({
      name: req.body.name,
      ...(department ? { department } : {}),
      businessType: BUSINESS_TYPE,
      ...tenantScope(req),
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
    const department = validDepartment(req.body.department);
    // Only overwrite department when one was supplied; otherwise leave the stored
    // value untouched (a bare rename shouldn't blank the routing).
    const update = { name: req.body.name };
    if (department) update.department = department;
    const updated = await Category.findByIdAndUpdate(
      req.params.id,
      update,
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
    } catch { /* anonymous / invalid token - fall back to the default discount */ }

    // Staff placing a manual/POS order "on behalf of" a client: previewing
    // THAT client's price (not the caller's own) requires an explicit id -
    // never trusted from anywhere but this query param, and only honoured for
    // an authenticated staff caller, never anonymous or a client impersonating
    // another client.
    if (isAdminCaller && req.query.onBehalfClientId && mongoose.Types.ObjectId.isValid(req.query.onBehalfClientId)) {
      buyerClientId = String(req.query.onBehalfClientId);
    }

    // Buyer's segment tags, for segmentDiscounts + price-tier resolution. Only
    // fetched when a specific buyer is in play (self via client JWT, or an
    // explicit on-behalf id) - an anonymous/regular-walk-in view has none.
    let buyerSegments = [];
    if (buyerClientId) {
      try {
        const acct = await ClientAccount.findById(buyerClientId, { segments: 1 }).lean();
        buyerSegments = acct?.segments || [];
      } catch { /* invalid id - no segment/tier discount applies */ }
    }
    const { tierDefaultPct, perProductTiers } = await loadTierContext({
      PriceTier, businessType: BUSINESS_TYPE, tenantScope, req, buyerSegments,
    });

    // Exclude soft-deleted products; tenancy-scoped to this server's businessType.
    // Removed products (isAvailable=false): visible to admin/staff for management,
    // hidden from customer-facing menu. OOS products: visible to everyone (UI
    // surfaces the OOS badge).
    // basePrice<=0: a raw material with no SRP - stock the admin tracks but never
    // sells. Same visibility split as isAvailable: admin/staff still see it (so
    // they can find it and give it a real price), customer-facing menu/portal never do.
    const productQuery = { isArchived: { $ne: true }, businessType: BUSINESS_TYPE };
    if (!isAdminCaller) { productQuery.isAvailable = { $ne: false }; productQuery.basePrice = { $gt: 0 }; }
    const products = await Product.find(productQuery).populate('modifierGroups').lean();
    // Product images can be globally disabled via the superadmin "Product Images" setting.
    // Customers then receive no image (the menu shows a placeholder); staff/admin keep the
    // image so they can still see and manage it.
    let imagesEnabled = true;
    if (!isAdminCaller) {
      const imgSetting = await Settings.findOne({ key: 'imagesEnabled' }).lean();
      imagesEnabled = !imgSetting || imgSetting.value !== false;
    }
    // Resolve the effective per-line discount for this caller, via the SAME
    // resolver orders.js uses at checkout - a buyer sees exactly the price
    // they'll be charged, including per-product and price-tier discounts, not
    // just the per-client override this endpoint used to consider alone.
    products.forEach(p => {
      if (!isAdminCaller && !imagesEnabled) p.image = '';
      p.effectiveDiscountPercent = resolveEffectiveDiscountPercent(p, {
        buyerClientId, buyerSegments, tierDefaultPct, perProductTiers,
      });
      // Only strip raw overrides from non-admin responses. Admin / staff need
      // them to power the edit form and the on-behalf client picker in POS;
      // stripping made the form silently lose overrides on save (the form
      // rendered as empty, then "Save" overwrote real data with [] ).
      if (!isAdminCaller) {
        delete p.clientDiscounts;
        // Strip internal cost / recipe (BOM) data from customer-facing responses so
        // ingredient lists, per-item costs, and margins are not exposed publicly.
        // Keep customer-relevant fields (size name/price, add-on name/price).
        // Keep a private copy for the stockAvailable computation further down.
        // Deleting outright made every recipe-built product look like a 1:1
        // stocked good to customers, which meant it could never be in stock -
        // the whole FB menu showed "Not available" no matter the inventory.
        p.__recipeForStock = p.baseRecipe;
        // Size recipes are stripped too, so keep the shape the stock/size checks
        // need before it goes. Names only - no quantities or costs.
        p.__sizeRecipesForStock = (p.sizes || []).map(sz => ({
          name: sz.name, sizeCode: sz.sizeCode, recipe: sz.recipe || [],
        }));
        delete p.baseRecipe; delete p.costOverride;
        (p.sizes  || []).forEach(s => { delete s.recipe; delete s.costOverride; });
        (p.addOns || []).forEach(a => { delete a.recipe; });
      }
    });

    // Overlay active sale pricing (fixed_price / percent_off rules).
    // Threshold rules are returned as activeSaleThresholds alongside products
    // so the POS can apply them when the order subtotal is known client-side.
    const now = new Date();
    const activeSales = await Sale.find({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } }).lean();
    const thresholdRules = [];
    const salePriceMap = {};   // productId → { salePrice, saleName, salePercent }
    for (const sale of activeSales) {
      for (const rule of (sale.rules || [])) {
        if (rule.ruleType === 'threshold') {
          thresholdRules.push({ saleName: sale.name, productId: rule.productId, productName: rule.productName, thresholdAmount: rule.thresholdAmount, discountPercent: rule.discountPercent });
        } else if (rule.productId) {
          const pid = String(rule.productId);
          const existing = salePriceMap[pid];
          // Last sale wins if multiple overlap; could extend to "lowest price" if needed
          if (rule.ruleType === 'fixed_price') {
            salePriceMap[pid] = { salePrice: rule.salePrice, saleName: sale.name, salePercent: null };
          } else if (rule.ruleType === 'percent_off' && !existing?.salePrice) {
            salePriceMap[pid] = { salePercent: rule.discountPercent, saleName: sale.name, salePrice: null };
          }
        }
      }
    }
    products.forEach(p => {
      const overlay = salePriceMap[String(p._id)];
      if (overlay) {
        p.saleName = overlay.saleName;
        if (overlay.salePrice != null) {
          p.activeSalePrice = overlay.salePrice;
        } else if (overlay.salePercent != null) {
          p.activeSalePrice = +(p.basePrice * (1 - overlay.salePercent / 100)).toFixed(2);
          p.activeSalePercent = overlay.salePercent;
        }
      }
    });

    // Compute stockAvailable from live inventory.
    //  • FB / recipe products: every linked ingredient must have enough stock.
    //  • LOG / 1:1 products (no recipe): the product IS a stocked good - match the
    //    linked inventory item by itemCode (then itemName) and require at least one
    //    sellable unit (unitMultiplier base units) on hand.
    const invItems = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }, { _id: 1, itemCode: 1, itemName: 1, stockQty: 1, unitMultiplier: 1, displayUnit: 1, unit: 1, packSize: 1 }).lean();
    const invById = {}, invByCode = {}, invByName = {};
    invItems.forEach(i => {
      invById[i._id.toString()] = i;
      if (i.itemCode) invByCode[i.itemCode] = i;
      if (i.itemName) invByName[i.itemName] = i;
    });
    // A pack under one whole kg/L reads better in the sub-unit: 0.377kg → 377g,
    // 0.5L → 500ml. Mirrors the dashboard's fmtPackLabel so the slip and the
    // inventory screen agree. Math.round strips the ×1000 float noise.
    const fmtPackLabel = (value, unit) => {
      const v = Number(value);
      const u = String(unit || '');
      if (!Number.isFinite(v) || v <= 0) return `${value}${unit}`;
      const ul = u.toLowerCase();
      if (ul === 'kg' && v < 1) return `${Math.round(v * 1000 * 1000) / 1000}g`;
      if (ul === 'l' && v < 1) return `${Math.round(v * 1000 * 1000) / 1000}ml`;
      return `${v}${u}`; // ≥1 or already a sub-unit - keep the entered unit casing
    };
    // Pack/unit label from an inventory item, mirroring the dashboard's packInfo:
    // an explicit packSize wins ("1kg"/"377g"), else a size embedded in the name
    // ("250g"), else the bare display unit ("kg").
    const unitLabelOf = (inv) => {
      if (!inv) return '';
      const u = (inv.displayUnit || inv.unit || '').trim();
      if (inv.packSize && inv.packSize > 0) return fmtPackLabel(inv.packSize, u);
      const m = String(inv.itemName || '').match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs?)\b/i);
      if (m) return fmtPackLabel(m[1], m[2]);
      return u;
    };

    products.forEach(p => {
      // baseRecipe is stripped from customer-facing responses above, so fall
      // back to the copy kept there - availability must not depend on who is
      // asking.
      const recipe = p.baseRecipe || p.__recipeForStock || [];
      // Resolve the linked stock item: FB recipe products link via invId; log 1:1
      // goods match by code then name. Used for both stock and the unit label.
      const linkedInv = recipe.find(r => r.invId) ? invById[recipe.find(r => r.invId).invId]
        : (invByCode[p.productCode] || invByName[p.name]);
      p.unitLabel = unitLabelOf(linkedInv);

      // Why a product is unavailable, so staff are not left guessing when the
      // menu hides something the stock screen says is in stock. Only set when
      // stockAvailable is false; costs nothing when everything is fine.
      p.stockReason = '';
      if (recipe.some(r => r.invId)) {
        p.stockAvailable = recipe.every(ing => {
          if (!ing.invId) return true;                  // unlinked - don't block the product
          // ing.invId is a snapshot of an Inventory _id, not a live foreign key -
          // it goes dangling the moment that inventory doc is deleted and
          // recreated (e.g. Purge Data, or just re-adding the item), even though
          // an inventory item with the exact same name now exists. Fall back to
          // matching by ing.name (the ingredient's own recipe-time snapshot),
          // mirroring the 1:1 logistics-good lookup a few lines below - a stale
          // ID must never permanently strand an otherwise-in-stock product.
          const inv = invById[ing.invId] || (ing.name ? invByName[ing.name] : null);
          const need = Number(ing.qty) || 0;
          if (!inv) {
            p.stockReason = `Ingredient "${ing.name || ing.invId}" is not in inventory (its stock record was deleted or renamed).`;
            return false;
          }
          if (!(inv.stockQty > 0)) {
            p.stockReason = `"${inv.itemName}" is out of stock.`;
            return false;
          }
          if (inv.stockQty < need) {
            p.stockReason = `"${inv.itemName}" has ${inv.stockQty}${inv.unit || ''} on hand but the recipe needs ${need}${inv.unit || ''} per serving.`;
            return false;
          }
          return true;
        });
      } else {
        // No linked materials. Two very different situations share this branch:
        //
        //  LOG - the product IS the stocked good (1:1), so it is sellable as
        //        long as a stock record matches its code or name.
        //  FB  - a drink assembled from materials. With nothing linked there is
        //        nothing to make it FROM and nothing to deduct, so selling it
        //        would move no stock and cost nothing. It must not be offered.
        //
        // An FB product can still be a plain resold good (bottled water), so a
        // genuine stock match by code/name is honoured either way - that is the
        // only route by which a recipe-less product is sellable.
        const inv = invByCode[p.productCode] || invByName[p.name];
        p.stockAvailable = !!inv && inv.stockQty >= baseUnitsPerSale(p, inv);
        if (!p.stockAvailable) {
          if (inv) {
            p.stockReason = `"${inv.itemName}" has ${inv.stockQty}${inv.unit || ''} on hand, below one sellable unit.`;
          } else if (recipe.length === 0) {
            p.stockReason = 'No materials have been added to the base recipe, so this cannot be made.';
          } else {
            p.stockReason = 'None of the base recipe materials are linked to an inventory item, so this cannot be made.';
          }
        }
      }

      // A size priced but with no materials of its own sells for money while
      // deducting nothing and costing nothing. It does not block the product -
      // the base size may be perfectly sellable, and a half-built size is a
      // normal in-progress state - but it is surfaced so it does not go
      // unnoticed and quietly leak stock.
      const sizesForCheck = p.__sizeRecipesForStock
        || (p.sizes || []).map(sz => ({ name: sz.name, sizeCode: sz.sizeCode, recipe: sz.recipe || [] }));
      p.sizesWithoutRecipe = sizesForCheck
        .filter(sz => !(sz.recipe || []).some(r => r.invId))
        .map(sz => sz.name || sz.sizeCode || 'unnamed size');
    });

    // The private recipe copy must never leave the server.
    products.forEach(p => { delete p.__recipeForStock; delete p.__sizeRecipesForStock; });
    res.json({ success: true, products, saleThresholds: thresholdRules });
  } catch (err) {
    log.error({ err }, 'GET /api/products failed');
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── BARCODE LOOKUP ────────────────────────────────────────────────────────────
// GET /api/products/by-barcode/:code - resolve a scanned barcode to a product
// at the POS. Exact match on the stored `barcode` field, scoped to this
// business. Barcodes aren't schema-unique (see the field comment in
// server.js), so this returns the first match and flags `ambiguous:true` when
// more than one product carries the same code, letting the POS prompt instead
// of silently ringing up the wrong variant.
app.get('/api/products/by-barcode/:code', verifyToken, requireStaff, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).json({ success: false, error: 'A barcode is required.' });
    const matches = await Product.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      barcode: code, isArchived: { $ne: true },
    }).limit(5).lean();
    if (matches.length === 0) return res.status(404).json({ success: false, error: 'No product with that barcode.' });
    res.json({ success: true, product: matches[0], ambiguous: matches.length > 1, matchCount: matches.length });
  } catch (err) {
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

// Bulk menu import (fb-style businesses): one upload creates/updates several
// Products at once, each with its recipe wired to existing Inventory items -
// the menu-side counterpart to the Inventory bulk import (which only ever
// touches raw ingredients). Client resolves the sheet into
// { rows: [{ category, name, srp, ingredients: [{ name, qty, unit }] }] } -
// this route re-matches ingredients against the CURRENT Inventory (never
// trusts a client-supplied invId/cost) and does the actual create/update.
// ── MENU BACKUP / RESTORE ────────────────────────────────────────────────────
// A lossless round-trip of the whole menu, so a rebuilt or refreshed database
// does not mean rebuilding every product and recipe by hand.
//
// Deliberately NOT the same thing as /api/products/import-menu: that one is a
// fuzzy first-time import from a spreadsheet a human typed. This is a backup
// of what the system already holds, and it aims to restore byte-for-byte.
//
// The one thing that CANNOT be trusted across databases is invId - Inventory
// ObjectIds are regenerated when stock is rebuilt. So every recipe line carries
// the stock ITEM CODE, NAME and UNIT alongside its invId, and restore resolves
// in that order of confidence: id (same database) -> itemCode (rebuilt, and the
// code is the thing a human actually curates) -> name (last resort, since names
// get retyped and drift). A line whose ingredient cannot be found is reported
// as unmatched rather than dropped silently, because a recipe that quietly
// loses an ingredient understates COGS forever after.
const MENU_BACKUP_VERSION = 1;

app.get('/api/products/menu-backup', verifyToken, requireStaff, async (req, res) => {
  try {
    const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const includeArchived = req.query.includeArchived === 'true';
    const q = { ...scope };
    if (!includeArchived) q.isArchived = { $ne: true };

    // Only Category and DiscountRule carry businessType/tenantId; ModifierGroup,
    // AddOn, Combo and Discount are global to the deployment, so scoping those
    // queries would silently return nothing.
    const [products, modifierGroups, invItems, categories, addOns, combos, discounts, discountRules] = await Promise.all([
      Product.find(q).sort({ category: 1, name: 1 }).lean(),
      ModifierGroup.find({}).lean(),
      Inventory.find(scope, { itemCode: 1, itemName: 1 }).lean(),
      Category.find(scope).sort({ name: 1 }).lean(),
      AddOn.find({}).sort({ category: 1, name: 1 }).lean(),
      Combo.find({}).sort({ name: 1 }).lean(),
      Discount.find({}).lean(),
      DiscountRule.find(scope).sort({ name: 1 }).lean(),
    ]);

    // Modifier groups are referenced by ObjectId, which will not survive a
    // rebuild either - export them by name so restore can re-link.
    const groupNameById = new Map(modifierGroups.map(g => [String(g._id), g.name]));

    // A recipe line stores invId + name but not the stock's own code, so look
    // it up here. The code is what a human curates and keeps stable, which
    // makes it the best key for re-linking into a rebuilt database.
    const codeByInvId = new Map(invItems.map(i => [String(i._id), i.itemCode || '']));
    const codeByName = new Map(invItems.map(i => [String(i.itemName || '').toLowerCase().trim(), i.itemCode || '']));

    const exportRecipe = (recipe) => (recipe || []).map(r => ({
      itemCode: codeByInvId.get(String(r.invId)) || codeByName.get(String(r.name || '').toLowerCase().trim()) || '',
      name: r.name, qty: r.qty, unit: r.unit, cost: r.cost, invId: r.invId,
    }));

    res.json({
      success: true,
      version: MENU_BACKUP_VERSION,
      businessType: BUSINESS_TYPE,
      exportedAt: new Date(),
      exportedBy: req.user?.name || '',
      counts: {
        products: products.length, modifierGroups: modifierGroups.length,
        categories: categories.length, addOns: addOns.length, combos: combos.length,
        discounts: discounts.length, discountRules: discountRules.length,
      },
      categories: categories.map(c => ({ name: c.name, department: c.department })),
      modifierGroups: modifierGroups.map(g => ({
        name: g.name, isRequired: g.isRequired, minSelect: g.minSelect, maxSelect: g.maxSelect,
        options: (g.options || []).map(o => ({ name: o.name, price: o.price, recipe: exportRecipe(o.recipe) })),
      })),
      // Standalone add-ons (the shared library), distinct from the per-product
      // addOns embedded on each product below.
      addOns: addOns.map(a => ({ name: a.name, price: a.price, category: a.category, recipe: exportRecipe(a.recipe) })),
      // Combos reference their component products by NAME, since product ids
      // change on a rebuild the same way inventory ids do.
      combos: combos.map(c => ({
        comboCode: c.comboCode, name: c.name, description: c.description,
        price: c.price, image: c.image, isActive: c.isActive,
        items: (c.items || []).map(i => ({ name: i.name, sizeName: i.sizeName, quantity: i.quantity })),
      })),
      discounts: discounts.map(d => ({ name: d.name, percentage: d.percentage, isSCPWD: d.isSCPWD })),
      discountRules: discountRules.map(r => ({
        name: r.name, percent: r.percent, active: r.active, priority: r.priority,
        minSubtotal: r.minSubtotal, daysOfWeek: r.daysOfWeek,
        startDate: r.startDate, endDate: r.endDate, segment: r.segment,
      })),
      products: products.map(p => ({
        productCode: p.productCode, barcode: p.barcode, name: p.name,
        description: p.description, category: p.category, isBulk: p.isBulk,
        basePrice: p.basePrice, discountPercent: p.discountPercent, vatExempt: p.vatExempt,
        baseSize: p.baseSize, costOverride: p.costOverride,
        bulkBreaks: p.bulkBreaks, clientBulkBreaks: p.clientBulkBreaks,
        clientDiscounts: p.clientDiscounts, segmentDiscounts: p.segmentDiscounts,
        image: p.image, isAvailable: p.isAvailable, isOutOfStock: p.isOutOfStock,
        isArchived: p.isArchived,
        baseRecipe: exportRecipe(p.baseRecipe),
        sizes: (p.sizes || []).map(s => ({
          sizeCode: s.sizeCode, name: s.name, price: s.price,
          costOverride: s.costOverride, recipe: exportRecipe(s.recipe),
        })),
        addOns: (p.addOns || []).map(a => ({ name: a.name, price: a.price, recipe: exportRecipe(a.recipe) })),
        // By NAME, so the link survives a rebuild.
        modifierGroupNames: (p.modifierGroups || []).map(id => groupNameById.get(String(id))).filter(Boolean),
      })),
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/products/menu-backup/restore', verifyToken, requireStaff, async (req, res) => {
  try {
    const backup = req.body?.backup || req.body;
    const products = Array.isArray(backup?.products) ? backup.products : null;
    if (!products) return res.status(400).json({ success: false, error: 'That file does not look like a menu backup - no products array.' });
    if (backup.version && Number(backup.version) > MENU_BACKUP_VERSION) {
      return res.status(400).json({ success: false, error: `This backup was made by a newer version (v${backup.version}) than this server understands (v${MENU_BACKUP_VERSION}).` });
    }

    const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const dryRun = req.body?.dryRun === true;
    // 'skip' protects a live menu; 'overwrite' is for restoring into an empty
    // or known-stale one. Skip is the default because losing hand-tuned
    // pricing to a stale backup is worse than an incomplete restore.
    const onConflict = req.body?.onConflict === 'overwrite' ? 'overwrite' : 'skip';

    const invItems = await Inventory.find(scope).lean();
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byId = new Map(invItems.map(i => [String(i._id), i]));
    const byCode = new Map(invItems.filter(i => i.itemCode).map(i => [String(i.itemCode).toLowerCase().trim(), i]));
    const byName = new Map(invItems.map(i => [String(i.itemName || '').toLowerCase().trim(), i]));

    const unmatchedNames = new Set();
    const matchedBy = { invId: 0, itemCode: 0, name: 0 };
    // Resolve in descending order of confidence: the original invId (same
    // database), then the stock's own item code (survives a rebuild and is
    // curated by a human), then the name (last resort - names get retyped).
    // A cross-dimension match is refused outright so a "ml" line can never
    // land on a pcs-tracked item and silently corrupt the cost.
    const resolveLine = (line) => {
      let item = byId.get(String(line.invId || ''));
      if (item) matchedBy.invId++;
      if (!item && line.itemCode) {
        item = byCode.get(String(line.itemCode).toLowerCase().trim());
        if (item) matchedBy.itemCode++;
      }
      if (!item) {
        item = byName.get(String(line.name || '').toLowerCase().trim())
          || invItems.find(i => norm(i.itemName) === norm(line.name));
        if (item) matchedBy.name++;
      }
      if (!item) { if (line.name || line.itemCode) unmatchedNames.add(line.name || line.itemCode); return null; }
      if (line.unit && unitTypeOf(line.unit) !== unitTypeOf(item.unit)) { unmatchedNames.add(`${line.name} (unit ${line.unit})`); return null; }
      return {
        invId: String(item._id), name: item.itemName,
        qty: Number(line.qty) || 0,
        cost: item.unitCost || 0,          // always re-priced from CURRENT stock
        unit: line.unit || effectiveDisplay(item).displayUnit,
      };
    };
    const resolveRecipe = (recipe) => (recipe || []).map(resolveLine).filter(Boolean);

    // Everything a product depends on is restored BEFORE the products, so the
    // links resolve. Combos come after, since they point AT products.
    // Existing records are matched by name and left alone - these are shared
    // library objects, and clobbering a live discount rule from a stale file
    // would change what customers are charged.
    const added = { categories: 0, modifierGroups: 0, addOns: 0, combos: 0, discounts: 0, discountRules: 0 };

    for (const c of (backup.categories || [])) {
      if (!c?.name) continue;
      if (await Category.findOne({ ...scope, name: new RegExp(`^${escapeRegex(c.name)}$`, 'i') })) continue;
      added.categories++;
      if (!dryRun) await Category.create({ ...scope, name: c.name, ...(c.department ? { department: c.department } : {}) });
    }

    // ModifierGroup / AddOn / Combo / Discount carry no businessType - they are
    // global to the deployment, so they are queried and created unscoped.
    const groupIdByName = new Map();
    for (const g of (backup.modifierGroups || [])) {
      if (!g?.name) continue;
      const existing = await ModifierGroup.findOne({ name: new RegExp(`^${escapeRegex(g.name)}$`, 'i') });
      if (existing) { groupIdByName.set(g.name.toLowerCase(), existing._id); continue; }
      added.modifierGroups++;
      if (dryRun) continue;
      const created = await ModifierGroup.create({
        name: g.name,
        isRequired: g.isRequired !== false,
        minSelect: Number.isFinite(g.minSelect) ? g.minSelect : 1,
        maxSelect: Number.isFinite(g.maxSelect) ? g.maxSelect : 1,
        options: (g.options || []).map(o => ({ name: o.name, price: o.price || 0, recipe: resolveRecipe(o.recipe) })),
      });
      groupIdByName.set(g.name.toLowerCase(), created._id);
    }

    for (const a of (backup.addOns || [])) {
      if (!a?.name) continue;
      if (await AddOn.findOne({ name: new RegExp(`^${escapeRegex(a.name)}$`, 'i') })) continue;
      added.addOns++;
      if (!dryRun) await AddOn.create({ name: a.name, price: Number(a.price) || 0, category: a.category || 'Extras', recipe: resolveRecipe(a.recipe) });
    }

    for (const d of (backup.discounts || [])) {
      if (!d?.name) continue;
      if (await Discount.findOne({ name: new RegExp(`^${escapeRegex(d.name)}$`, 'i') })) continue;
      added.discounts++;
      if (!dryRun) await Discount.create({ name: d.name, percentage: Number(d.percentage) || 0, isSCPWD: !!d.isSCPWD });
    }

    for (const r of (backup.discountRules || [])) {
      if (!r?.name) continue;
      if (await DiscountRule.findOne({ ...scope, name: new RegExp(`^${escapeRegex(r.name)}$`, 'i') })) continue;
      added.discountRules++;
      if (!dryRun) {
        await DiscountRule.create({
          ...scope, name: r.name, percent: Number(r.percent) || 0,
          active: r.active !== false, priority: Number(r.priority) || 0,
          minSubtotal: r.minSubtotal ?? null, daysOfWeek: r.daysOfWeek || [],
          startDate: r.startDate || null, endDate: r.endDate || null, segment: r.segment || '',
        });
      }
    }

    const results = [];
    let created = 0, updated = 0, skipped = 0;

    for (const p of products) {
      const name = String(p?.name || '').trim();
      if (!name || !(Number(p.basePrice) >= 0)) {
        results.push({ name: name || '(missing)', ok: false, error: 'Missing product name or base price.' });
        continue;
      }
      try {
        const existing = await Product.findOne({
          ...scope, name: new RegExp(`^${escapeRegex(name)}$`, 'i'), isArchived: { $ne: true },
        });
        if (existing && onConflict === 'skip') {
          skipped++;
          results.push({ name, ok: true, action: 'skipped', reason: 'already on the menu' });
          continue;
        }

        const doc = {
          barcode: p.barcode || '', description: p.description || '',
          category: String(p.category || 'Uncategorized').trim(),
          isBulk: !!p.isBulk, basePrice: Number(p.basePrice),
          discountPercent: Number(p.discountPercent) || 0, vatExempt: !!p.vatExempt,
          baseSize: p.baseSize || '', costOverride: p.costOverride,
          bulkBreaks: p.bulkBreaks || [], clientBulkBreaks: p.clientBulkBreaks || [],
          clientDiscounts: p.clientDiscounts || [], segmentDiscounts: p.segmentDiscounts || [],
          image: p.image || '',
          isAvailable: p.isAvailable !== false, isOutOfStock: !!p.isOutOfStock,
          baseRecipe: resolveRecipe(p.baseRecipe),
          sizes: (p.sizes || []).map(s => ({
            sizeCode: s.sizeCode, name: s.name, price: s.price,
            costOverride: s.costOverride, recipe: resolveRecipe(s.recipe),
          })),
          addOns: (p.addOns || []).map(a => ({ name: a.name, price: a.price || 0, recipe: resolveRecipe(a.recipe) })),
          modifierGroups: (p.modifierGroupNames || [])
            .map(n => groupIdByName.get(String(n).toLowerCase())).filter(Boolean),
        };

        const recipeLines = doc.baseRecipe.length
          + doc.sizes.reduce((s, x) => s + x.recipe.length, 0)
          + doc.addOns.reduce((s, x) => s + x.recipe.length, 0);

        if (dryRun) {
          existing ? updated++ : created++;
          results.push({ name, ok: true, action: existing ? 'would update' : 'would create', recipeLines });
          continue;
        }

        if (existing) {
          Object.assign(existing, doc);
          await existing.save();
          updated++;
          results.push({ name, ok: true, action: 'updated', recipeLines });
        } else {
          const catPrefix = getCategoryPrefix(doc.category);
          // Keep the original code when it is still free, so references in
          // history and printed material keep resolving.
          const codeTaken = p.productCode ? await Product.exists({ ...scope, productCode: p.productCode }) : true;
          const productCode = (p.productCode && !codeTaken)
            ? p.productCode
            : await generateNextSequence(Product, catPrefix, 'productCode');
          await Product.create({ ...scope, ...doc, productCode, name });
          created++;
          results.push({ name, ok: true, action: 'created', recipeLines });
        }
      } catch (e) {
        results.push({ name, ok: false, error: e.message });
      }
    }

    // Combos LAST: they name the products they bundle, so those have to exist
    // first. A combo whose components are missing is reported rather than
    // created half-empty, since a bundle silently short of an item would sell
    // at the bundle price and hand over less than it promised.
    const incompleteCombos = [];
    for (const c of (backup.combos || [])) {
      if (!c?.name) continue;
      if (await Combo.findOne({ name: new RegExp(`^${escapeRegex(c.name)}$`, 'i') })) continue;
      const items = [];
      const missing = [];
      for (const i of (c.items || [])) {
        const prod = await Product.findOne({ ...scope, name: new RegExp(`^${escapeRegex(String(i.name || ''))}$`, 'i'), isArchived: { $ne: true } }).lean();
        if (!prod) { missing.push(i.name); continue; }
        items.push({ productId: String(prod._id), name: prod.name, sizeName: i.sizeName || '', quantity: Number(i.quantity) || 1 });
      }
      if (missing.length) { incompleteCombos.push({ combo: c.name, missing }); continue; }
      added.combos++;
      if (!dryRun) {
        await Combo.create({
          comboCode: c.comboCode, name: c.name, description: c.description || '',
          price: Number(c.price) || 0, image: c.image || '', isActive: c.isActive !== false, items,
        });
      }
    }

    if (!dryRun) emitToMgr('erpUpdated');
    res.json({
      success: true, dryRun,
      created, updated, skipped,
      added,
      // Bundles that could not be built because a component product is absent.
      incompleteCombos,
      // How each recipe line was re-linked. A restore leaning on `name` is
      // worth a second look: it means the stock codes did not line up.
      matchedBy,
      // Surfaced loudly: these recipe lines could NOT be linked to stock, so
      // those products will under-report COGS until the ingredient exists.
      unmatchedIngredients: [...unmatchedNames].sort(),
      results,
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.post('/api/products/import-menu', verifyToken, requireStaff, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'No rows to import.' });

    const invItems = await Inventory.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
    // Exact case-insensitive name → item, for the common case; a normalized
    // (spaces/punctuation stripped) index backs the fallback "contains" match.
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byExactName = new Map(invItems.map(i => [String(i.itemName || '').toLowerCase().trim(), i]));

    const matchIngredient = (ingName, unit) => {
      const key = String(ingName || '').toLowerCase().trim();
      if (!key) return null;
      let item = byExactName.get(key);
      if (!item) {
        const nk = norm(key);
        item = invItems.find(i => norm(i.itemName).includes(nk) || nk.includes(norm(i.itemName)));
      }
      if (!item) return null;
      // Refuse a cross-dimension match (e.g. a "10 ml" ingredient line landing
      // on a pcs-tracked item) - that would silently corrupt the recipe cost.
      if (unit && unitTypeOf(unit) !== unitTypeOf(item.unit)) return null;
      return item;
    };

    const results = [];
    let created = 0, updated = 0;

    for (const row of rows) {
      const name = String(row?.name || '').trim();
      const srp = Number(row?.srp);
      if (!name || !(srp >= 0)) {
        results.push({ name: name || '(missing)', ok: false, error: 'Missing product name or SRP.' });
        continue;
      }
      try {
        const recipe = [];
        const unmatched = [];
        for (const ing of (Array.isArray(row.ingredients) ? row.ingredients : [])) {
          const ingName = String(ing?.name || '').trim();
          if (!ingName) continue;
          const item = matchIngredient(ingName, ing.unit);
          if (!item) { unmatched.push(ingName); continue; }
          const baseQty = displayToBase(Number(ing.qty) || 0, ing.unit || item.unit);
          if (!(baseQty > 0)) continue;
          recipe.push({
            invId: String(item._id), name: item.itemName, qty: baseQty,
            cost: item.unitCost || 0, unit: effectiveDisplay(item).displayUnit,
          });
        }

        const category = String(row.category || 'Uncategorized').trim();
        const existing = await Product.findOne({
          businessType: BUSINESS_TYPE, ...tenantScope(req),
          name: new RegExp(`^${escapeRegex(name)}$`, 'i'), isArchived: { $ne: true },
        });

        if (existing) {
          existing.basePrice = srp;
          existing.category = category;
          existing.baseRecipe = recipe;
          await existing.save();
          updated++;
          results.push({ name, ok: true, action: 'updated', matched: recipe.length, unmatched });
        } else {
          const catPrefix = getCategoryPrefix(category);
          const productCode = await generateNextSequence(Product, catPrefix, 'productCode');
          await Product.create({
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            productCode, name, category, basePrice: srp, baseRecipe: recipe,
          });
          created++;
          results.push({ name, ok: true, action: 'created', matched: recipe.length, unmatched });
        }
      } catch (rowErr) {
        results.push({ name, ok: false, error: rowErr.message });
      }
    }

    await logAudit(req, { action: 'import-menu', entity: 'Product', entityId: 'bulk', after: { created, updated, rows: results.length } });
    emitToAll('menuUpdated');
    res.json({ success: true, created, updated, results });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

app.put('/api/products/:id', verifyToken, requireStaff, async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, error: 'Product not found.' });

    // Reason from the X-Change-Reason header (URL-encoded). Required for every
    // price / recipe-cost change; the client refuses to submit without one.
    const changeReason = (() => {
      try { return decodeURIComponent(String(req.headers['x-change-reason'] || '')).slice(0, 300); }
      catch { return String(req.headers['x-change-reason'] || '').slice(0, 300); }
    })();

    // ── APPROVAL GATE ────────────────────────────────────────────────────────
    // A selling price is a money decision, so it is held for sign-off unless
    // the editor is someone who would sign it off anyway. Everything else in
    // the same submission (name, category, recipe) still saves immediately -
    // an unrelated typo fix must not be blocked behind a price review.
    const { apply, pending } = splitUpdate({
      entity: 'Product',
      existing,
      update: req.body,
      canApprove: hasPermission(req.user, 'pricing.approve'),
    });

    let changeRequest = null;
    if (pending.length) {
      changeRequest = await ChangeRequest.create({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        entity: 'Product',
        entityId: String(existing._id),
        entityName: existing.name || '',
        changes: pending,
        reason: changeReason,
        requestedBy: req.user?.name || '',
      });
      // Tell whoever can act on it that something is waiting.
      emitToMgr?.('mgrAlert', {
        kind: 'changeRequest',
        ref: existing.name || existing.productCode || '',
        message: `${req.user?.name || 'Someone'} requested a price change on ${existing.name}: ${pending.map(c => `${c.label} ${c.oldValue} -> ${c.newValue}`).join(', ')}.`,
      });
    }

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, apply, { returnDocument: 'after' });

    if (existing && apply.basePrice !== undefined && Number(apply.basePrice) !== Number(existing.basePrice)) {
      await AuditLog.create({
        userId: req.user ? req.user.name : 'System',
        action: 'PRODUCT_PRICE_CHANGED',
        targetReference: updatedProduct.productCode || req.params.id,
        details: { name: updatedProduct.name, oldPrice: existing.basePrice, newPrice: updatedProduct.basePrice, reason: changeReason },
      });
      // Memo journal entry - zero-money, balanced row pair on Inventory Asset
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
    // General edit audit - records every PUT for forensic trail.
    await logAudit(req, {
      action: 'update', entity: 'Product', entityId: req.params.id,
      before: existing ? { name: existing.name, basePrice: existing.basePrice, category: existing.category, costOverride: existing.costOverride } : null,
      after:  updatedProduct ? { name: updatedProduct.name, basePrice: updatedProduct.basePrice, category: updatedProduct.category, costOverride: updatedProduct.costOverride } : null,
    });
    emitToAll('menuUpdated');
    // `pendingApproval` is how the UI knows to say "saved, but the price is
    // awaiting approval" instead of reporting a clean save that silently
    // dropped the number the user typed.
    res.json({
      success: true,
      product: updatedProduct,
      ...(pending.length ? { pendingApproval: pending, changeRequestId: String(changeRequest?._id || '') } : {}),
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// ── PRICE HISTORY ─────────────────────────────────────────────────────────────
// Every base-price and recipe-cost change already gets logged to AuditLog
// (PRODUCT_PRICE_CHANGED / PRODUCT_RECIPE_COST_CHANGED, see PUT above) - this
// just reads that trail back for one product, newest first, mirroring the
// Inventory tab's "History" button so Pricing Control gets the same "as of
// [date]: price" view. `targetReference` is stamped as productCode when the
// product has one, else falls back to the Mongo _id - check both so a
// product that only got its code assigned after its first price change still
// shows its full history.
app.get('/api/products/:id/price-history', verifyToken, requireStaff, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });
    const refs = [String(req.params.id)];
    if (product.productCode) refs.push(product.productCode);

    const rows = await AuditLog.find({
      action: { $in: ['PRODUCT_PRICE_CHANGED', 'PRODUCT_RECIPE_COST_CHANGED'] },
      targetReference: { $in: refs },
    }).sort({ timestamp: -1 }).limit(200).lean();

    const history = rows.map(r => ({
      date: r.timestamp,
      type: r.action === 'PRODUCT_PRICE_CHANGED' ? 'price' : 'cost',
      oldValue: r.action === 'PRODUCT_PRICE_CHANGED' ? r.details?.oldPrice : r.details?.oldCost,
      newValue: r.action === 'PRODUCT_PRICE_CHANGED' ? r.details?.newPrice : r.details?.newCost,
      reason: r.details?.reason || '',
      changedBy: r.userId || '',
      // Who asked vs who allowed it. Only set on changes that went through the
      // approval queue; a change made directly by an approver has neither, and
      // `viaApproval` is what tells the two apart in the UI.
      viaApproval: !!r.details?.viaApproval,
      requestedBy: r.details?.requestedBy || '',
      approvedBy: r.details?.approvedBy || '',
    }));

    // Changes still waiting on someone. Shown alongside the applied history so
    // "why is this still ₱250 when I changed it" has an answer on the same
    // screen, rather than looking like the edit was lost.
    const pending = await ChangeRequest.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      entity: 'Product', entityId: String(product._id), status: 'Pending',
    }).sort({ createdAt: -1 }).lean();

    res.json({
      success: true,
      product: { name: product.name, basePrice: product.basePrice, costOverride: product.costOverride },
      history,
      pending: pending.map(r => ({
        _id: r._id,
        date: r.createdAt,
        changes: r.changes,
        reason: r.reason,
        requestedBy: r.requestedBy,
      })),
    });
  } catch (err) {
    (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  }
});

// PATCH /api/products/:id/availability - superadmin toggle. Permanently REMOVES
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

// PATCH /api/products/:id/oos - toggle "Out of Stock". Distinct from Removed -
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

// ── ARCHIVED PRODUCTS CLEANUP (superadmin only) ──────────────────────────────
// "Delete" above only ever archives (isArchived:true) - the document, INCLUDING
// its embedded image (products store images as base64 data URIs directly on
// the doc, not in separate file storage), stays in MongoDB forever. That's
// invisible dead weight: the menu UI only ever shows non-archived products, so
// there was no way to see this pile building up, let alone reclaim it. These
// routes let a superadmin actually empty it out.
app.get('/api/products/archived', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const products = await Product.find({ businessType: BUSINESS_TYPE, isArchived: true }, { name: 1, productCode: 1, category: 1, image: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).lean();
    // Rough on-disk size of each doc's own image field - the single biggest
    // contributor to how heavy this pile actually is (a base64 image easily
    // runs tens to hundreds of KB per product).
    let imageBytes = 0;
    const rows = products.map(p => {
      const bytes = p.image ? Buffer.byteLength(p.image, 'utf8') : 0;
      imageBytes += bytes;
      return { _id: p._id, name: p.name, productCode: p.productCode, category: p.category, hasImage: !!p.image, imageBytes: bytes, updatedAt: p.updatedAt };
    });
    res.json({ success: true, products: rows, count: rows.length, totalImageBytes: imageBytes });
  } catch (error) {
    captureError(req, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/products/archived/permanent', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    // Explicit opt-in list wins (client sends exactly which archived products
    // to purge, from the list above); omitted entirely = everything archived.
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => mongoose.Types.ObjectId.isValid(id)) : null;
    const filter = { businessType: BUSINESS_TYPE, isArchived: true, ...(ids ? { _id: { $in: ids } } : {}) };
    const toDelete = await Product.find(filter, { name: 1, productCode: 1 }).lean();
    if (toDelete.length === 0) return res.json({ success: true, deletedCount: 0 });
    const result = await Product.deleteMany(filter);
    await logAudit(req, { action: 'permanent-delete', entity: 'Product', entityId: 'bulk', after: { count: result.deletedCount, products: toDelete.map(p => p.productCode || p.name) } });
    emitToAll('menuUpdated');
    res.json({ success: true, deletedCount: result.deletedCount });
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
    // Promo/combo codes read "C10001", "C10002"… - a distinct C-series so they
    // stand apart from product/stock codes on slips and in the ledger. Reuse the
    // lowest freed number: if C10001 was deleted, the next new combo takes it back
    // (no ever-growing gaps), which is what an operator expects from a short code.
    const existing = await Combo.find({ comboCode: /^C\d+$/ }, { comboCode: 1 }).lean();
    const used = new Set(existing.map(c => parseInt(c.comboCode.slice(1), 10)).filter(n => !Number.isNaN(n)));
    let n = 10001;
    while (used.has(n)) n++;
    req.body.comboCode = `C${n}`;
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

// ── SALES / PROMOTIONS CRUD ───────────────────────────────────────────────────
app.get('/api/sales', verifyToken, requireStaff, async (req, res) => {
  try {
    const sales = await Sale.find().sort({ startsAt: -1 }).lean();
    res.json({ success: true, sales });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.post('/api/sales', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, description, startsAt, endsAt, rules } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Sale name is required.' });
    if (!startsAt || !endsAt) return res.status(400).json({ success: false, error: 'Start and end dates are required.' });
    if (new Date(startsAt) >= new Date(endsAt)) return res.status(400).json({ success: false, error: 'End date must be after start date.' });
    const sale = await Sale.create({ name: name.trim(), description, startsAt: new Date(startsAt), endsAt: new Date(endsAt), rules: rules || [] });
    emitToAll('menuUpdated');
    res.json({ success: true, sale });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.put('/api/sales/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, description, startsAt, endsAt, isActive, rules } = req.body;
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt))
      return res.status(400).json({ success: false, error: 'End date must be after start date.' });
    const sale = await Sale.findByIdAndUpdate(req.params.id,
      { name, description, startsAt: startsAt ? new Date(startsAt) : undefined, endsAt: endsAt ? new Date(endsAt) : undefined, isActive, rules },
      { returnDocument: 'after', runValidators: true }
    );
    if (!sale) return res.status(404).json({ success: false, error: 'Sale not found.' });
    emitToAll('menuUpdated');
    res.json({ success: true, sale });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});

app.delete('/api/sales/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await Sale.findByIdAndDelete(req.params.id);
    emitToAll('menuUpdated');
    res.json({ success: true });
  } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
});
}
