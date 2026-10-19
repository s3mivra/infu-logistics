import { z } from 'zod';
import mongoose from 'mongoose';
import { code } from '../lib/normalize.js';

// Database definitions: categories, products, add-ons, combos, promotions and orders.
// Moved out of server.js as it was. It is called once, at the same point in
// start-up where this code used to sit, and handed what it reads from there.
export default function defineCatalogModels({ BUSINESS_TYPE }) {
  // --- DATABASE SCHEMAS ---
  const CategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    // fb routes to Kitchen/Bar; log routes to Logistics/Warehouse. The enum must
    // cover both or category creation 500s in log mode, where the Products tab
    // only offers the logistics pair. Default follows the running BUSINESS_TYPE.
    department: {
      type: String,
      enum: ['Kitchen', 'Bar', 'Logistics', 'Warehouse'],
      default: () => (BUSINESS_TYPE === 'log' ? 'Logistics' : 'Kitchen'),
    },
    // Tenancy seed: which business type owns this category. Defaults to the env
    // BUSINESS_TYPE on create. Old docs without this field still read fine.
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
    // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  }, { timestamps: true });
  const Category = mongoose.model('Category', CategorySchema);
  // ── MODIFIER GROUPS ─────────────────────────────────────────────────────────
  // A modifier group is a required or optional selection prompt on a product.
  // e.g. "Choose your milk" (required, pick 1) or "Extra shots" (optional, 0–3).
  const ModifierGroupSchema = new mongoose.Schema({
    name:       { type: String, required: true },
    isRequired: { type: Boolean, default: true },
    minSelect:  { type: Number, default: 1 },
    maxSelect:  { type: Number, default: 1 },
    options:    [{ name: String, price: { type: Number, default: 0 }, recipe: [{ invId: String, name: String, qty: Number, unit: String, nonStock: Boolean, packBase: Number }] }]
  }, { timestamps: true });
  const ModifierGroup = mongoose.model('ModifierGroup', ModifierGroupSchema);

  // ── SETTINGS ─────────────────────────────────────────────────────────────────
  // Key/value store for system-wide toggles (isAcceptingQROrders, etc.)
  const SettingsSchema = new mongoose.Schema({ key: { type: String, unique: true, required: true }, value: { type: mongoose.Schema.Types.Mixed } });
  const Settings = mongoose.model('Settings', SettingsSchema);

  // ── TENANT (multi-tenancy, Phase 1) ──────────────────────────────────────────
  // A Tenant is an isolated business in a shared deployment. Phase 1 introduces the
  // model + a default tenant + tenantId backfill (additive, non-breaking - existing
  // queries are unchanged). Phase 2 wires tenantId into the access token, per-tenant
  // query scoping, and Socket.io room partitioning.
  const TenantSchema = new mongoose.Schema({
    name:         { type: String, required: true, trim: true },
    slug:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    businessType: { type: String, default: () => BUSINESS_TYPE },
    isActive:     { type: Boolean, default: true },
  }, { timestamps: true });
  const Tenant = mongoose.model('Tenant', TenantSchema);

  // Tenant management - superadmin only (Phase 1 CRUD over the tenant registry).
  const tenantSchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/i, 'slug must be alphanumeric/hyphen'),
    businessType: z.enum(['fb', 'log']).optional(),
    isActive: z.boolean().optional(),
  });

  // --- ADD-ONS SCHEMA & ROUTES ---
  const AddOnSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, default: 'Extras' },
    recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String, nonStock: Boolean, packBase: Number, takeoutOnly: Boolean }]
  }, { timestamps: true });
  const AddOn = mongoose.model('AddOn', AddOnSchema);



  // 1. UPDATE THE PRODUCT SCHEMA (Add Recipes)
  const ProductSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
    // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    productCode: String,
    // Scanned barcode (UPC/EAN/QR payload). Sparse index: most products may not
    // have one, but the ones that do are looked up by it at the POS
    // (GET /api/products/by-barcode/:code). NOT unique at the schema level - a
    // shop can legitimately have the same barcode on two size variants, and a
    // hard unique constraint would reject the second on import; the lookup route
    // returns the first match and the response notes when a barcode is ambiguous.
    barcode: { type: String, default: '', index: true },
    // Bulk-sale flag - surfaces the product under a dedicated "Bulk" filter in the
    // POS and client portal (e.g. wholesale/sack quantities), separate from the
    // per-line quantity-break pricing in `bulkBreaks`.
    isBulk: { type: Boolean, default: false, index: true },
    name: { type: String, required: true, index: true },
    description: String,
    category: { type: String, index: true },
    basePrice: { type: Number, required: true },
    // Per-product discount (%). Applies only to this product's order lines, not the
    // whole order. 0 = no discount. Applies to ALL buyers by default.
    discountPercent: { type: Number, default: 0 },
    // VAT classification. Defaults to VATable (false), the ERP convention: the
    // company-level VAT setting governs, and you flag the EXCEPTIONS here - raw
    // agricultural produce, prescription medicines, and the like. Defaulting the
    // other way would silently under-remit VAT on any product left unconfigured,
    // which surfaces at audit rather than at the counter.
    vatExempt: { type: Boolean, default: false },
    // Optional per-client overrides. When a logged-in client buys this product, the
    // matching entry's percent is used instead of the default discountPercent. Lets
    // you give a specific client a special rate on a specific product (pre-reg, VIP,
    // bulk-buyer, etc.). Empty array = no overrides → falls back to discountPercent.
    clientDiscounts: [{ clientId: String, percent: { type: Number, default: 0 } }],
    // Segment-level overrides - same idea as clientDiscounts but keyed by a tag on
    // the buyer's ClientAccount.segments (e.g. "wholesale", "vip") instead of one
    // specific client id, so a rate can apply to a whole class of buyer at once.
    // When a buyer carries more than one matching segment, the highest percent
    // wins (see productDiscPct in orders.js) - never stacked.
    segmentDiscounts: [{ segment: String, percent: { type: Number, default: 0 } }],
    // Quantity-break bulk pricing, independent of the fixed-price Combo model.
    // Each line item's ordered quantity is checked against minQty (highest
    // qualifying minQty wins) and combined with the other discount percents via
    // Math.max, same as clientDiscounts/segmentDiscounts - never stacked.
    bulkBreaks: [{ minQty: { type: Number, required: true }, percent: { type: Number, default: 0 } }],
    // Per-client quantity breaks that set an explicit PRICE, not a percent -
    // "once Client X orders 50+ of this, charge them PHP 180 each" rather than
    // "X% off". Kept as a real price (not a discount%) because that is how the
    // deal is actually quoted to the client; it is converted to an equivalent
    // discount percent at resolution time (same technique PriceTier's
    // per_product mode already uses) so it flows through the existing
    // percent-based discount/VAT pipeline unchanged. Unlike the universal
    // bulkBreaks above, this only applies to the named client - someone else
    // ordering the same quantity pays the regular price.
    clientBulkBreaks: [{
      clientId: { type: String, required: true },
      minQty:   { type: Number, required: true },
      price:    { type: Number, required: true },
    }],
    baseSize: String,
    costOverride: Number,
    baseRecipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String, nonStock: Boolean, packBase: Number, takeoutOnly: Boolean }],
    sizes: [{
      sizeCode: String,
      name: String,
      price: Number,
      costOverride: Number,
      recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String, nonStock: Boolean, packBase: Number, takeoutOnly: Boolean }]
    }],
    addOns: [{ name: String, price: Number, recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String, nonStock: Boolean, packBase: Number, takeoutOnly: Boolean }] }],
    image: String,
    // Renamed from "86'd". `isAvailable === false` means REMOVED from the menu
    // (and from reporting too - unless the product still has stock, in which
    // case it shows in reporting so historical inventory is visible).
    isAvailable:    { type: Boolean, default: true },
    // Manual out-of-stock toggle. OOS products STILL show in menu (with an OOS
    // badge) and STILL appear in every report. Separate from isAvailable so a
    // temporary stockout doesn't get conflated with a permanent removal.
    isOutOfStock:   { type: Boolean, default: false },
    // Set when a sale drained an ingredient and the product was taken off the
    // menu automatically (isAvailable false). Only these are put back by
    // lib/autoRestore.js once stock returns; a manual removal clears it.
    autoUnavailable: { type: Boolean, default: false, index: true },
    // Café: whether customers see it on the table QR menu. Off = counter-only -
    // still sold at the POS, never offered to (or orderable from) a QR code.
    showOnQr:       { type: Boolean, default: true },
    isArchived:     { type: Boolean, default: false },   // soft-delete; hidden from menu + POS
    modifierGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ModifierGroup' }]  // required/optional selection prompts
  }, { timestamps: true });
  const Product = mongoose.model('Product', ProductSchema);

  // ── COMBO / BUNDLE (Product Promo) ───────────────────────────────────────────
  // A fixed-price set of existing products sold as one line, e.g.
  // "Budget Meal: Americano + Pandesal = ₱99". On completion the ERP engine
  // deducts each component product's recipe so COGS and stock stay accurate.
  const ComboSchema = new mongoose.Schema({
    comboCode:   String,
    name:        { type: String, required: true },
    description: String,
    price:       { type: Number, required: true },   // fixed bundle price
    image:       String,
    isActive:    { type: Boolean, default: true },
    items: [{
      productId: String,
      name:      String,
      sizeName:  String,   // optional specific size; '' = base
      quantity:  { type: Number, default: 1 },
    }],
  }, { timestamps: true });
  const Combo = mongoose.model('Combo', ComboSchema);

  // ── SALES / PROMOTIONS ────────────────────────────────────────────────────────
  // Time-boxed promotional pricing overlaid on top of normal product prices.
  // Rules:
  //   fixed_price  – product sells at salePrice during the window
  //   percent_off  – product gets discountPercent% off
  //   threshold    – if order subtotal >= thresholdAmount, a product gets discountPercent% off
  const SaleSchema = new mongoose.Schema({
    name:        { type: String, required: true },
    description: String,
    startsAt:    { type: Date, required: true },
    endsAt:      { type: Date, required: true },
    isActive:    { type: Boolean, default: true },
    // Hours inside the dates (lib/salePricing.js saleRunsNow): which weekdays
    // (0 = Sunday; none = every day) and between which times of day, HH:MM on
    // the business's clock (both blank = all day).
    daysOfWeek:  { type: [Number], default: [] },
    dailyFrom:   { type: String, default: '' },
    dailyTo:     { type: String, default: '' },
    rules: [{
      ruleType:          { type: String, enum: ['fixed_price', 'percent_off', 'threshold'], required: true },
      productId:         String,
      productName:       String,
      salePrice:         Number,   // for fixed_price
      discountPercent:   Number,   // for percent_off and threshold
      thresholdAmount:   Number,   // for threshold: minimum order subtotal
    }],
  }, { timestamps: true });
  const Sale = mongoose.model('Sale', SaleSchema);

  const OrderSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    // Multi-tenancy (Phase 1): every tenant-scoped doc carries a tenantId. Backfilled
    // to the default tenant on boot. Query-scoping/auth wiring lands in Phase 2.
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    orderNumber: String,
    table: String,
    // Which branch/location rang this up - a StorageLocation name snapshot, set
    // by the device (see client localStorage 'posBranch'), same convention as
    // Inventory.stockLocation. Blank means single-location or unset - every
    // existing order predates this and is untagged, which is fine (reports
    // treat blank as its own "(Unassigned)" bucket, never dropped).
    location: { type: String, default: '', index: true },
    isArchived: { type: Boolean, default: false, index: true },
    status: { type: String, default: 'Pending' },
    // Parked / held tabs: saved but not yet sent to the kitchen or completed.
    isParked: { type: Boolean, default: false, index: true },
    // Idempotency key - prevents duplicate orders from retries / offline-queue replays.
    // unique+sparse: makes double-submit protection DB-enforced, not just the
    // app-level findOne-then-create check in orders.js (which has a TOCTOU
    // window - two concurrent requests can both pass the findOne before either
    // create() completes). The unique index turns a lost race into an E11000
    // the create-order route catches, instead of a duplicate order.
    idempotencyKey: { type: String, index: true, unique: true, sparse: true },
    customerName: { type: String, default: 'Guest' },
    paymentMethod: { type: String, default: 'Cash' },

    // Item Level Tracking
  items: [{
      productId: String,
      productCode: String,
      name: String,
      // A name typed at the till for PRINTING only ("House Blend 1kg" for what
      // the books call "COMMERCIAL BLEND"). The customer's ORIGINAL copy shows
      // it; the office DUPLICATE, stock, reports and the ledger keep `name`.
      printName: { type: String, default: '' },
      // Rung up at the till for something not on the menu: its name and price
      // were typed in, and it takes nothing from stock (it has no recipe).
      isOpenItem: { type: Boolean, default: false },
      price: Number,
      // The product's SRP when it was sold (its size's price for a size, the
      // combo's price for a combo) - so the sales report can show it beside what
      // a price tier or discount actually charged. Stamped, not looked up, so a
      // later SRP change never rewrites an old sale's comparison.
      listPrice: { type: Number, default: null },
      quantity: Number,
      // Served in the bar's own cups: how many units of this line still have NOT
      // had their take-out packaging taken from stock, and what one unit would
      // take (base units). Set when the order is completed with useBarCups;
      // POST /api/orders/:id/take-out draws on it if the customer leaves with it.
      barCupQty: { type: Number, default: 0 },
      barCupPack: [{ _id: false, invId: String, name: String, qty: Number }],
      fulfilledQty: { type: Number, default: 0 },        // units fulfilled so far (partial fulfillment)
      // Cumulative units of THIS line refunded/returned so far, across however many
      // partial-refund passes (see POST /api/orders/:id/partial-refund). Never
      // exceeds `quantity`. Whole-order /refund and /void don't touch this - they
      // already terminate the order outright.
      refundedQty: { type: Number, default: 0 },
      // True for a line added by POST /api/orders/:id/exchange (a replacement item) -
      // distinguishes it from the order's original lines in the UI/receipt history.
      addedViaExchange: { type: Boolean, default: false },
      productDiscountPercent: { type: Number, default: 0 }, // per-product discount applied to this line
      // VAT classification COPIED from the product at ring-up. Stamped rather than
      // looked up later: reclassifying a product must never rewrite the tax on
      // receipts already issued.
      vatExempt: { type: Boolean, default: false },
      selectedAddOns: [{ name: String, price: Number }],
      hasDiscount: { type: Boolean, default: true },
      department: { type: String, default: 'Kitchen' }, // <-- NEW: Routes to Kitchen or Bar
      itemStatus: { type: String, default: 'Received' }, // <-- NEW: Item-level progress
      discountPercent: { type: Number, default: 0 },
      // Combo / bundle line: deducts each component recipe on completion
      isCombo: { type: Boolean, default: false },
      comboItems: [{ productId: String, name: String, sizeName: String, quantity: Number }]
    }],

    // Strict Accounting Fields
    isVatInclusive: { type: Boolean, default: true }, // Enforces Rule 3 (System-wide standard)
    discountType: { type: String, default: 'None' },  // Enforces Rules 6 & 9
    discountBy: { type: String },                      // staff who applied the discount (logged-in user, not the order's cashier)

    subtotal: { type: Number, default: 0 },           // Gross Sales
    vatableSales: { type: Number, default: 0 },       // Base for VAT
    vatExemptSales: { type: Number, default: 0 },     // Base for SC/PWD
    vatRate: { type: Number, default: 0 },
    vatAmount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    // SC/PWD exemption for this sale. Defaults FALSE - an ordinary sale is VATable.
    // This used to default true, which was harmless only while VAT was disabled
    // system-wide; with VAT live it would have exempted every legacy order and
    // quietly zeroed the output VAT on all of them.
    isVatExempt: { type: Boolean, default: false },
    // WHO the SC/PWD discount was given to. The 20% discount and the VAT
    // exemption are granted against a specific ID, and the BIR expects the
    // cardholder's name and ID number recorded against the sale - a discount with
    // nobody's name on it is the one an examiner disallows. Captured at the
    // register when the discount is applied; blank on every other sale.
    scPwdName:     { type: String, default: '' },
    scPwdIdNumber: { type: String, default: '' },
    // 'Senior Citizen' or 'PWD' - they are different laws (RA 9994 / RA 10754)
    // and are reported separately.
    scPwdKind:     { type: String, default: '' },
    // Which SC/PWD basis was in force when this order was rung up. Stamped per
    // order, not read from settings at read time: changing the setting must never
    // retroactively alter a receipt that has already been issued, and the math
    // validator has to be able to reproduce a historical total exactly.
    scPwdOrder: { type: String, default: 'vat-first' },
    // Whether the delivery charge on THIS sale carried VAT. A delivery service is
    // generally part of gross receipts and VATable, but some businesses bill it as
    // a pure pass-through of a third-party courier's fee - so it is the business's
    // own answer, stamped per order rather than read from settings at print time.
    deliveryFeeVatable: { type: Boolean, default: false },
    // --- ENTERPRISE FIELDS ---
    cashier: { type: String, default: 'System', index: true },
    // --- AMENDMENTS (POST /api/orders/:id/amend) ---
    // Changes made to an order's lines BEFORE it is completed - a client who
    // ordered too much, a line out of stock. Nothing has posted yet at that
    // stage, so the order is corrected in place; this history keeps what it
    // was, who changed it, and why. Completed orders are never amended - they
    // go through refunds instead.
    revision: { type: Number, default: 0 },
    amendments: [{
      revision:    Number,
      at:          { type: Date, default: Date.now },
      by:          String,
      reason:      String,
      totalBefore: Number,
      totalAfter:  Number,
      changes:     [{ name: String, from: Number, to: Number }],
    }],
    // --- PARTIAL FULFILLMENT (logistics - single order, fulfilled in batches) ---
    amountPaid:       { type: Number, default: 0 },        // cash/AR collected so far
    depositRemaining: { type: Number, default: 0 },
    // Which liability account holds that deposit (260200 for new deposits; legacy
    // orders were booked to 260000). Released from the same account it went into.
    depositAccount: { type: String, default: '' },        // prepaid-but-unfulfilled value held as Customer Deposits
    // When the remaining units of a partially-fulfilled order are dropped, the
    // order finalizes as Completed at the fulfilled quantity and the dropped units
    // are recorded here (they carry no ledger entries - they were never fulfilled).
    droppedItems: [{ name: String, productCode: String, droppedQty: Number, price: Number }],
    droppedBy:   { type: String, default: '' },
    droppedAt:   { type: Date },
    clientReceived:   { type: Boolean, default: false },   // client confirmed receipt from the portal
    transactionType: { type: String, enum: ['NORMAL', 'COMPLIMENTARY', 'REFUND', 'VOID'], default: 'NORMAL' },
    isComplimentary: { type: Boolean, default: false },
    employeeName: { type: String, default: '' },          // beneficiary (who the comp is for)
    complimentaryReasonType: {
      type: String,
      enum: ['VIP_CUSTOMER','CUSTOMER_RECOVERY','FOOD_QUALITY_ISSUE','SERVICE_DELAY','EMPLOYEE_MEAL',
             'OWNER_APPROVAL','MARKETING_PROMOTION','INFLUENCER_PROMO','SYSTEM_ERROR',
             'TRAINING_ORDER','LOYALTY_REWARD','EVENT_SPONSORSHIP'],
      default: null
    },
    complimentaryReasonNote: { type: String, default: '' },
    complimentaryApprovedBy: { type: String, default: '' },
    complimentaryApprovedAt: { type: Date },
    complimentaryAmount: { type: Number, default: 0 },
    complimentaryCost:   { type: Number, default: 0 },
    complimentaryReferenceNumber: { type: String, default: '' },
    // Exactly what this sale took from stock, in base units, at the cost it was
    // taken at - written when the stock leaves (completion, each partial
    // fulfilment, a backdated sale). A void, refund or exchange gives back THESE
    // quantities: re-reading the product's recipe at that time returned the
    // wrong amount once the recipe had changed, and valued it at today's cost.
    // lineIndex is the order line it belongs to, so a partial refund can take
    // back its share. Orders from before this field existed have none, and are
    // reversed from the recipe as before.
    // Dine-in, served in the bar's cups rather than take-out ones (cafe). The
    // take-out packaging in each recipe is left on the shelf at completion.
    useBarCups: { type: Boolean, default: false },
    // A dine-in order the customer left with after it was completed (a drink
    // they did not finish). Recorded whether or not any take-out cup came off
    // the shelf for it - see POST /api/orders/:id/take-out.
    takenOutAt: { type: Date, default: null },
    takenOutBy: { type: String, default: '' },
    // Cost of goods sold booked for this sale from a cost figure alone (an
    // imported order with no product lines) - see account 139000. Recorded so
    // the same cost is never booked twice.
    costPosted: { type: Number, default: 0 },
    // Cafe, when "Dine-in / Take-out" is switched on in Menu Setup: which one
    // this order is. Dine-in is served in the shop's own cups (useBarCups), so
    // take-out packaging stays on the shelf. '' = not asked.
    serviceMode: { type: String, enum: ['', 'dine-in', 'take-out'], default: '' },
    stockMoves: [{
      _id: false,
      invId: String,
      qty: Number,          // base units taken (positive)
      unitCost: Number,     // cost per base unit at the time
      lineIndex: Number,
    }],
    // Items this sale left below zero (Settings -> selling below zero = warn;
    // lib/negativeStock.js). Empty for a sale that had the stock.
    belowZeroItems: [{
      _id: false,
      invId: String,
      itemName: String,
      balanceAfter: Number,   // base units, after this sale
    }],
    voidReason: { type: String, default: '' },
    // Attribution - who actually voided / cancelled the order. Captured from the
    // verified JWT, never the request body. Distinct from `cashier` (which is the
    // original placer - could be the client themselves on a client-portal order).
    voidedBy: { type: String, default: '' },
    voidedAt: { type: Date },
    cancelledBy: { type: String, default: '' },
    cancelledAt: { type: Date },
    // Audit trail of partial refunds (see POST /api/orders/:id/partial-refund) -
    // not everything has to be refunded at once, and it can happen more than once
    // over time as long as no line is ever refunded past what was ordered. Whole-
    // order /refund and /void are unaffected - they stay one-shot/terminal.
    refundHistory: [{
      reference:       { type: String, default: '' },
      at:              { type: Date, default: Date.now },
      by:              { type: String, default: '' },
      reason:          { type: String, default: '' },
      inventoryAction: { type: String, default: 'None' }, // 'Restock' | 'Spoilage' | 'None'
      items:           [{ itemIndex: Number, name: String, qty: Number }],
      amount:          { type: Number, default: 0 },
    }],
    // True when a logged-in client placed the order directly from the client portal.
    // Used to exclude these orders from "staff activity" panels - their `cashier`
    // is the client's own username, not real staff.
    placedByClient: { type: Boolean, default: false, index: true },
    clientAccountId: { type: String, index: true },
    // Marks orders added via the superadmin Backdate Sales tool. Skips inventory
    // deduction and recipe COGS - purely a revenue/finance tally.
    isBackdated:    { type: Boolean, default: false, index: true },
    // Source transaction/invoice number from a Backdate Sale bulk Excel import
    // (the sheet's own reference, e.g. "TRANSACTION NO."). Blank for a manually
    // entered backdated sale, which has no such reference to dedupe against.
    // Lets re-importing the same (or an overlapping) file skip rows that were
    // already posted instead of creating a second sale for the same reference.
    importRef:      { type: String, default: '', index: true },
    amountTendered: { type: Number, default: 0 },
    changeDue: { type: Number, default: 0 },
    // --- DELIVERY / PICKUP FIELDS ---
    deliveryAddress: { type: String, default: '' },
    customerPhone:   { type: String, default: '' },
    deliveryFee:     { type: Number, default: 0 },
    scheduledTime:   { type: String, default: '' },
    dispatchStatus:  { type: String, enum: ['', 'Preparing', 'Out for Delivery', 'Awaiting Pickup', 'Delivered', 'Picked Up'], default: '' },
    // Customer / cashier special instructions (e.g. "no sugar", "extra shot")
    orderNotes: { type: String, default: '' },
    // Guest/cover count (for analytics - how many people at the table)
    guestCount: { type: Number, default: 1 },
    // Who allowed a paid order to be cancelled (a manager, by PIN, or the
    // canceller themselves when they hold orders.delete).
    cancelApprovedBy: { type: String, default: null },
    // Split-payment breakdown: [{ method, amount }]
    // A part paid by check keeps that check's number and date.
    payments: [{ method: String, amount: Number, reference: { type: String, default: '' }, checkDate: { type: Date, default: null } }],
    // External reference the CUSTOMER supplies for their own payment - the GCash
    // / Maya / InstaPay confirmation number after scanning a payment QR, a bank
    // transfer reference, etc. Required for QR orders placed through the client
    // portal, because a QR payment leaves no trace on our side otherwise: the
    // money arrives in the wallet and this number is the only thing tying it to
    // an order. Distinct from arSettledReference, which is OUR reference for
    // collecting a receivable later.
    paymentReference: { type: String, default: '' },
    // Date written on the check when the sale was tendered by check. Post-dated
    // checks are normal in PH trade, so this is not necessarily the sale date -
    // it is the earliest the check can be banked. Carried through to the check
    // register when the receivable is collected.
    paymentCheckDate: { type: Date, default: null },
    // A/R settlement tracking (delivery partner payouts: Grab/Foodpanda/Manual Delivery)
    arSettled:        { type: Boolean, default: false },
    arSettledAt:      { type: Date },
    arSettledAmount:  { type: Number, default: 0 },
    arSettledMethod:  { type: String, default: '' },
    arSettledNote:    { type: String, default: '' },
    // External reference for this settlement - a bank transaction ID, check
    // number, GCash ref, etc. Distinct from the auto-generated internal
    // JournalEntry.reference (mkRef('ARS', ...)) - this is what ties the record
    // back to an actual bank statement line or receipt for reconciliation.
    arSettledReference: { type: String, default: '' },
    // --- PARTIAL A/R SETTLEMENT ---
    // A receivable is rarely paid in one clean shot: a client settles ₱1,500 of a
    // ₱1,700 invoice and the remaining ₱200 must stay on the books. `arPaidAmount`
    // is the running sum of every collection posted against this order, and
    // `arSettled` only flips true once that sum reaches `total`. Every A/R view
    // reads `total - arPaidAmount` (see arBalance in lib/credit.js) so a partly
    // paid invoice ages on its remaining balance, not its original face value.
    arPaidAmount: { type: Number, default: 0 },
    // What has been refunded off this sale. A partial refund credits Accounts
    // Receivable in the ledger - the debt really is smaller - but the order keeps
    // its face `total`, so without this every A/R view (ageing, credit limit,
    // collections, the client's statement) went on demanding money that had
    // already been credited back. Kept as a running total rather than summed from
    // refundHistory, because an EXCHANGE also writes a history entry while
    // adjusting `total` directly, and counting both would refund it twice.
    refundedAmount: { type: Number, default: 0 },
    // One row per collection. collectionDate = when the money was actually taken
    // in from the client (what the collector reports); depositDate = when it hit
    // the bank/fund. They are genuinely different dates - cash collected Friday
    // is often only banked Monday - and reconciliation needs both.
    arPayments: [{
      amount:          { type: Number, required: true },
      paymentMethod:   { type: String, default: '' },
      referenceNumber: { type: String, default: '' },
      note:            { type: String, default: '' },
      collectionDate:  { type: Date },
      depositDate:     { type: Date },
      collectedBy:     { type: String, default: '' },
      recordedBy:      { type: String, default: '' },
      journalRef:      { type: String, default: '' },
      createdAt:       { type: Date, default: Date.now },
      // --- CHECK COLLECTIONS ---
      // A check is a PROMISE of money, not money. It is booked to Checks on Hand
      // (115000) and only becomes bank cash once it clears, so it carries its own
      // little lifecycle on top of the collection:
      //   On Hand -> Deposited -> Cleared      (the money is really ours)
      //                        -> Bounced      (it never was - the receivable reopens)
      // checkDate is the date written ON the check: post-dated checks are normal
      // in PH trade, and one cannot be deposited before that date.
      checkNumber:     { type: String, default: '' },
      checkDate:       { type: Date },
      checkBank:       { type: String, default: '' },
      // Whose account the check is drawn against - usually but not always the
      // client themselves (a third-party check is worth flagging).
      checkDrawer:     { type: String, default: '' },
      // One check that paid several sales is recorded as a part on each sale;
      // every part carries the same group, and they are deposited, cleared or
      // bounced together because it is one piece of paper.
      checkGroup:      { type: String, default: '' },
      checkStatus:     { type: String, enum: ['', 'On Hand', 'Deposited', 'Cleared', 'Bounced'], default: '' },
      checkDepositedAt:{ type: Date },
      checkClearedAt:  { type: Date },
      checkBouncedAt:  { type: Date },
      checkBounceReason:{ type: String, default: '' },
      // Where a cleared check's money landed, so the JE and the register agree.
      checkClearedTo:  { type: String, default: '' },
    }],
    // Payment-terms snapshot for on-account (non-cash) sales, captured when the
    // order Completes so later changes to the client's default terms don't
    // retroactively move an existing receivable's due date.
    //   arTermsDays = the terms in days that applied at completion (null if none)
    //   arDueDate   = completedAt + arTermsDays; the date this A/R turns overdue.
    arTermsDays:      { type: Number, default: null },
    arDueDate:        { type: Date, default: null },
    // A sale placed over the client's credit limit with an approver's sign-off:
    // who approved it and the numbers they saw.
    creditOverride: {
      approvedBy:  { type: String, default: '' },
      approvedAt:  { type: Date, default: null },
      limit:       { type: Number, default: null },
      outstanding: { type: Number, default: null },
      orderTotal:  { type: Number, default: null },
    },
    // ── Logistics fields ──────────────────────────────────────────────────────
    // billingNumber: monthly-reset sequential ref (YYYY-MM-XXXX), log mode only
    billingNumber:   { type: String, default: '' },
    // The serial number on the registered receipt/invoice this sale was issued
    // under. Assigned once, when the sale COMPLETES - a sale that never completed
    // was never issued a receipt, and burning a serial on it would leave a gap
    // nobody can account for. Continues from the series configured in Settings.
    orNumber:        { type: String, default: '', index: true },
    // When the sale was completed - its POSTING date. createdAt is the document
    // date (when the order was taken); the two differ for an order taken today
    // and delivered tomorrow, and the daily sales report shows both.
    completedAt:     { type: Date, default: null, index: true },
    // Wholesale or retail, decided when the order is placed: a buyer whose
    // client account carries a "wholesale" segment buys wholesale. The sales
    // by channel report groups on it.
    channel:         { type: String, enum: ['Retail', 'Wholesale'], default: 'Retail', index: true },
    // Who the sale is credited to: picked at the POS, else the client's assigned
    // salesperson, else whoever rang it up. Commissions follow it.
    salesperson:     { type: String, default: '', index: true },
    // Delivery receipts (logistics): one per delivery. A partly fulfilled order
    // gets one per batch; drNumber is the latest.
    drNumber:        { type: String, default: '', index: true },
    deliveryReceipts: [{
      drNumber: { type: String, required: true },
      at:       { type: Date, default: Date.now },
      lines:    [{ index: Number, name: String, itemCode: String, qty: Number }],
    }],
    termsOfPayment:  { type: String, default: '' },
    // Client who placed the order (log mode; blank for fb/POS-originated orders)
    clientId:        { type: String, default: '' },
    clientUsername:  { type: String, default: '' },
  }, { timestamps: true });
  OrderSchema.index({ createdAt: -1 });
  OrderSchema.index({ status: 1, isArchived: 1 });
  OrderSchema.index({ orderNumber: 1 }, { unique: true, sparse: true });
  // A client's orders (portal history, statements, the Clients screen) were a
  // full collection scan on clientId; and every report filters on the business,
  // the status and a date range together.
  OrderSchema.index({ clientId: 1, createdAt: -1 });
  OrderSchema.index({ businessType: 1, status: 1, createdAt: -1 });
  const Order = mongoose.model('Order', OrderSchema);

  const QRSessionSchema = new mongoose.Schema({
    sessionId: { type: String, unique: true },
    table: String,
    isActive: { type: Boolean, default: true },
    expiresAt: Date,
    // Set the moment the customer's phone actually opens the menu page, which is
    // the only reliable signal that a code has been scanned - a scan is otherwise
    // invisible to the server. The staff screen swaps in a fresh code on the back
    // of it, so the next person to walk up never scans a code someone else is
    // already ordering on. Stays null for a code that was displayed and never
    // used.
    claimedAt: { type: Date, default: null }
  });
  const QRSession = mongoose.model('QRSession', QRSessionSchema);

  return {
    Settings, Order, Product, Category, Tenant, QRSession,
    CategorySchema, ModifierGroupSchema, ModifierGroup, SettingsSchema, TenantSchema, tenantSchema,
    AddOnSchema, AddOn, ProductSchema, ComboSchema, Combo, SaleSchema,
    Sale, OrderSchema, QRSessionSchema,
  };
}
