import { LEDGER_WRITE_OPS, inLedgerMaintenance } from '../lib/ledgerGuard.js';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { ACCOUNTS } from '../lib/chartOfAccounts.js';
import { code } from '../lib/normalize.js';
import { requireStaff, setCustomRolePermissions } from '../lib/authz.js';

// Database definitions: client accounts, collection reminders, custom roles, change requests, discount rules and price tiers.
// Moved out of server.js as it was. It is called once, at the same point in
// start-up where this code used to sit, and handed what it reads from there.
export default function defineClientModels({ BUSINESS_TYPE, log }) {
  // ── CLIENT ACCOUNTS (logistics mode only) ────────────────────────────────────
  // Pre-registered clients who log in to place orders directly (no QR scan).
  // Created/managed by superadmin. paymentMethod is pre-set per client.
  const ClientAccountSchema = new mongoose.Schema({
    clientCode:    { type: String, index: true },                 // standard customer ID, e.g. CUS-1000-A0001 (legacy accounts may still carry CLT-A0001)
    username:      { type: String, required: true, unique: true },
    password:      { type: String, required: true },              // bcrypt-hashed
    name:          { type: String, required: true },
    // Contact details for collections/notices/general CRM. All optional and
    // free-form - a POS-promoted walk-in (source:'pos') often has none, and a
    // portal signup isn't required to provide them either. `phone`/`email` are
    // deliberately NOT unique: two family members can legitimately share a phone.
    phone:         { type: String, default: '' },
    email:         { type: String, default: '' },
    contactNotes:  { type: String, default: '' },                 // free-form ("prefers SMS", "call after 5pm", etc.)
    paymentMethod: { type: String, default: 'Cash' },             // pre-set; can be overridden per order
    isActive:      { type: Boolean, default: true },
    // A related business - a satellite or affiliate branch that buys from this
    // one. What it owes is still a receivable, collected the same way, but the
    // receivables screens total it apart from what outside customers owe.
    isAffiliate:   { type: Boolean, default: false },
    // 'portal' = real client-portal login (username/password usable). 'pos' = auto-promoted
    // from a repeat POS walk-in (3+ Completed orders under the same name) - carries a
    // placeholder username/unusable password since it has no login of its own.
    source:        { type: String, enum: ['portal', 'pos'], default: 'portal' },
    // Credit limit in pesos for on-account (non-cash) buying.
    //   null  = no per-client limit set - falls back to the global limit if the
    //           active mode uses one.
    //   0     = an explicit "no credit at all" (different from null on purpose).
    // Whether either limit is enforced at all is decided by the `creditLimitMode`
    // setting; see resolveCreditLimit().
    // A VAT-registered BUYER needs a VAT invoice in their own registered name,
    // with their TIN and registered address on it, or they cannot claim the
    // input VAT they just paid us. Blank for ordinary customers.
    isVatRegistered: { type: Boolean, default: false },
    tin:           { type: String, default: '' },
    registeredName:{ type: String, default: '' },
    registeredAddress: { type: String, default: '' },
    creditLimit:   { type: Number, default: null },
    // Payment terms in days for on-account (non-cash) sales. When a non-cash order
    // Completes, this is snapshotted onto the order to compute its A/R due date
    // (dueDate = completedAt + creditTermsDays). 0 = due on receipt (COD-style).
    // null = no terms configured - the A/R views then age from the order date only.
    creditTermsDays: { type: Number, default: null },
    // Free-form tags (e.g. "wholesale", "vip") a product's segmentDiscounts can
    // target instead of (or in addition to) a one-off clientDiscounts entry for
    // this specific client. Empty = no segment-level discount applies.
    segments:      { type: [String], default: [] },
    // The salesperson who looks after this client (a staff member's name). Their
    // orders are credited to that person unless the POS names someone else.
    assignedSalesperson: { type: String, default: '' },
    // The client's OWN portal appearance, stored on the account so it follows them
    // across devices. Deliberately separate from the staff-side `dash.theme`
    // (per-device localStorage): a shop changing its POS theme must not restyle
    // its customers' portals. null = follow the shipped default.
    theme:         { type: String, enum: ['default', 'light', 'yellow', 'ocean', null], default: null },
    // Self-service onboarding link (#10): superadmin generates a one-time token
    // from the Command Center for an auto-promoted (source:'pos') account that
    // has no real login yet - the client opens the link, confirms/fills their
    // own contact details, and sets their own username/password. Single-use:
    // cleared the moment onboarding completes. null = no link outstanding.
    // Some buyers are quoted before they buy: wholesale, anything with freight,
    // anything priced per job. With this on, their portal asks for a quotation
    // instead of placing an order, and nothing is committed until the business
    // has priced it and they have accepted. Off by default - a regular who buys
    // at their tier price should not have to wait for a human.
    requiresQuote:            { type: Boolean, default: false },
    onboardingToken:          { type: String, default: null, index: true },
    // Sessions signed before this moment are refused: set when the office
    // resets the password or issues a new login, so an old session ends there.
    sessionsValidFrom: { type: Date, default: null },
    onboardingTokenExpiresAt: { type: Date, default: null },
    // A link made with no name: the account carries a placeholder until the
    // client types their own name on the sign-up page.
    namePending: { type: Boolean, default: false },
    // Running credit balance from overpaying an invoice - a LIABILITY (we owe
    // it back to them), separate from whatever they still owe us on open
    // orders. Grows when an A/R settlement exceeds the order's remaining
    // balance; shrinks when that credit is applied to a later order's
    // settlement or refunded out via a Check Voucher. See
    // POST /api/orders/:id/settle-ar and /api/client-accounts/:id/credit/* .
    creditBalance: { type: Number, default: 0 },
    creditHistory: [{
      type:        { type: String, enum: ['overpayment', 'applied', 'refunded', 'adjusted'], required: true },
      amount:      { type: Number, required: true },     // always positive; `type` says the direction
      orderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
      orderNumber: { type: String, default: '' },
      reference:   { type: String, default: '' },        // the JournalEntry / CheckVoucher reference tied to this movement
      note:        { type: String, default: '' },
      by:          { type: String, default: '' },
      at:          { type: Date, default: Date.now },
    }],
  }, { timestamps: true });
  const ClientAccount = mongoose.model('ClientAccount', ClientAccountSchema);

  // --- AR COLLECTION REMINDERS ---
  // A log of contact attempts against an overdue client, not an automated
  // sender - nothing in this app emails/SMSes a client on its own (same reason
  // payment gateway integration is out of scope: no new third-party dependency).
  // Staff log that a call/text/email/letter went out and when to follow up next;
  // `/api/collections/overdue` and `/api/collections/due` (collections.js) turn
  // that into a worklist.
  //
  // Keyed by `clientKey`, NOT clientAccountId - orders here can carry
  // customerName with no linked ClientAccount at all (see ar-ageing's own
  // `keyOf` resolution in finance.js), so reminders use the exact same resolved
  // key the aging views group by, or the two would silently disagree about who
  // owes what.
  const CollectionReminderSchema = new mongoose.Schema({
    businessType:     { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    clientKey:        { type: String, required: true, index: true },
    clientAccountId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ClientAccount', default: null },
    method:           { type: String, enum: ['Call', 'SMS', 'Email', 'In-person', 'Letter', 'Other'], required: true },
    note:             { type: String, default: '' },
    amountOwedAtTime: { type: Number, default: 0 }, // snapshot - the aged balance keeps moving, this is what it was when contact was made
    loggedBy:         { type: String, default: '' },
    nextFollowUpDate: { type: Date, default: null },
  }, { timestamps: true });
  CollectionReminderSchema.index({ businessType: 1, clientKey: 1, createdAt: -1 });
  const CollectionReminder = mongoose.model('CollectionReminder', CollectionReminderSchema);

  // Refresh-token session store - enables instant server-side revocation.
  // tokenHash = sha256(rawRefreshToken); the raw token lives only in the client's
  // httpOnly cookie. `revoked` is set on logout/rotation; expired docs auto-purge
  // via the TTL index on expiresAt.
  const RefreshSessionSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, index: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    revoked:   { type: Boolean, default: false },
    replacedBy:{ type: String },          // tokenHash of the rotated successor (audit trail)
    userAgent: { type: String },
    expiresAt: { type: Date, required: true },
  }, { timestamps: true });
  RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-cleanup
  const RefreshSession = mongoose.model('RefreshSession', RefreshSessionSchema);

  // --- NEW: CUSTOM ROLES SCHEMA & ROUTES ---
  // Custom roles created in the UI role-maker. `permissions` is the granular set a
  // user with this role gets by default (unless the user has an explicit override).
  const RoleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    permissions: { type: [String], default: [] },
  });
  const Role = mongoose.model('Role', RoleSchema);

  // Load custom-role permissions into the authz resolver. Called at boot and after
  // every role mutation so newly-granted permissions take effect on next login/refresh.
  async function refreshCustomRolePerms() {
    try { setCustomRolePermissions(await Role.find().lean()); }
    catch (e) { (typeof log !== 'undefined' ? log.error : console.error)({ err: e }, 'refreshCustomRolePerms failed'); }
  }


  // ── CLIENT ACCOUNTS (logistics mode only) ────────────────────────────────────








  // 1. Minimal Audit Log Schema (New)
  // ── CHANGE REQUESTS ──────────────────────────────────────────────────────────
  // A held edit to a money lever - a selling price, a cost basis, a client's
  // credit line. Someone without pricing.approve edits as normal; the guarded
  // FIELDS of that edit are peeled off into one of these and the rest is written
  // straight away, so a price change never lands unreviewed while a harmless
  // rename still works. See lib/changeApproval.js for which fields are gated.
  //
  // `changes` snapshots BOTH values: the approver is agreeing to a specific
  // "250 -> 300", so applying it later re-checks that the current value is still
  // 250 rather than blindly overwriting whatever it has since become.
  const CHANGE_REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected'];
  const ChangeRequestSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    entity:       { type: String, enum: ['Product', 'Inventory', 'ClientAccount', 'Supplier'], required: true },
    entityId:     { type: String, required: true, index: true },
    entityName:   { type: String, default: '' },   // snapshot, so the queue reads well even if renamed later
    changes: [{
      field:    { type: String, required: true },
      label:    { type: String, default: '' },
      oldValue: mongoose.Schema.Types.Mixed,
      newValue: mongoose.Schema.Types.Mixed,
    }],
    reason:       { type: String, default: '' },
    status:       { type: String, enum: CHANGE_REQUEST_STATUSES, default: 'Pending', index: true },
    requestedBy:  { type: String, default: '' },
    approvedBy:   { type: String, default: '' },
    approvedAt:   { type: Date },
    rejectedBy:   { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    appliedAt:    { type: Date },
  }, { timestamps: true });
  ChangeRequestSchema.index({ businessType: 1, status: 1, createdAt: -1 });
  const ChangeRequest = mongoose.model('ChangeRequest', ChangeRequestSchema);

  const AuditLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    action: { type: String, required: true },
    targetReference: { type: String, required: true },
    details: { type: Object },
    timestamp: { type: Date, default: Date.now }
  });
  // The audit log grows faster than anything except the ledger, and the Audit
  // Report reads it by date, by user and by action.
  AuditLogSchema.index({ createdAt: -1 });
  AuditLogSchema.index({ userId: 1, createdAt: -1 });
  AuditLogSchema.index({ action: 1, createdAt: -1 });
  AuditLogSchema.index({ targetReference: 1 });
  AuditLogSchema.pre(LEDGER_WRITE_OPS, { query: true, document: false }, function () {
    if (!inLedgerMaintenance()) { const e = new Error(`The audit log is append-only: ${this.op || 'update'} refused.`); e.status = 409; throw e; }
  });
  AuditLogSchema.pre('deleteOne', { document: true, query: false }, function () {
    if (!inLedgerMaintenance()) { const e = new Error('The audit log is append-only: deleteOne refused.'); e.status = 409; throw e; }
  });
  AuditLogSchema.pre('save', function () {
    if (!this.isNew && !inLedgerMaintenance()) { const e = new Error('The audit log is append-only: save refused.'); e.status = 409; throw e; }
  });
  const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

  // (Auth middleware - verifyToken, requireStaff, verifyClientToken, requireSuperAdmin,
  //  requireSuperOrAdmin, verifyOrderAuth - are defined earlier, before the first route
  //  that uses them, to avoid TDZ errors.)

  const DiscountSchema = new mongoose.Schema({
    name: String,        // e.g., "Senior Citizen 20%", "Employee 10%"
    percentage: Number,  // e.g., 20
    isSCPWD: { type: Boolean, default: false },
  });
  const Discount = mongoose.model('Discount', DiscountSchema);

  // --- CONFIGURABLE DISCOUNT RULE ENGINE ---
  // Order-level CONDITIONAL discount rules - the "spend ₱1000 get 10% off",
  // "15% off on Tuesdays", "wholesale segment gets 5% all December" kind - which
  // none of the existing discount mechanisms cover: Product.discountPercent /
  // clientDiscounts / segmentDiscounts / bulkBreaks are all PER-LINE and
  // unconditional, and the Discount model is just named SC/PWD-style presets.
  //
  // DELIBERATELY NOT auto-applied in the order money path. The POS calls
  // POST /api/discount-rules/evaluate with an order's context, gets back the
  // single best matching rule's percent, and applies it through the EXISTING,
  // fully-tested order-level `discountPercent` field on the order. That keeps the
  // VAT/discount/ledger math - the most safety-critical code in the app -
  // completely untouched; this feature only decides WHICH percent to suggest,
  // never how it's booked.
  const DiscountRuleSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    name:         { type: String, required: true },
    percent:      { type: Number, required: true, min: 0, max: 100 }, // the discount this rule grants
    active:       { type: Boolean, default: true, index: true },
    priority:     { type: Number, default: 0 }, // tie-breaker when two rules grant the same percent (higher wins)
    // Conditions - ALL present ones must hold for the rule to apply. An omitted
    // condition is simply not checked (a rule with no conditions always applies).
    minSubtotal:  { type: Number, default: null },        // order subtotal must be ≥ this
    daysOfWeek:   { type: [Number], default: [] },         // 0=Sun..6=Sat (Manila); empty = any day
    startDate:    { type: Date, default: null },           // active-from (inclusive)
    endDate:      { type: Date, default: null },           // active-until (inclusive)
    segment:      { type: String, default: '' },           // client must carry this segment tag; '' = any
    createdBy:    { type: String, default: '' },
  }, { timestamps: true });
  DiscountRuleSchema.index({ businessType: 1, active: 1 });
  const DiscountRule = mongoose.model('DiscountRule', DiscountRuleSchema);

  // --- PRICE TIERS (customer classes: Dealer, Satellite, Wholesale, ...) ---
  // The canonical registry for the free-form tags that already live in
  // ClientAccount.segments and Product.segmentDiscounts[].segment. Those two
  // fields are matched by EXACT string in orders.js productDiscPct, so a
  // "Dealer" tag on the account and a "dealer" override on the product silently
  // grant no discount at all - money quietly leaks with no error anywhere. This
  // collection makes the tag list pickable in both editors so the two sides can
  // never disagree.
  //
  // `percent` is the tier's DEFAULT rate, applied to every product the buyer
  // touches. It's what makes "Dealers get 15% off" a one-line setup instead of a
  // segmentDiscounts row on every single product. A per-product segment override
  // still beats it (see productDiscPct), so a tier default is a floor, not a cap.
  const PriceTierSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    name:     { type: String, required: true },                        // the segment tag itself, e.g. "Dealer"
    percent:  { type: Number, default: 0, min: 0, max: 100 },          // default discount for this class; 0 = tag only, no automatic rate
    // 'percent' = the flat `percent` above applies to every product (the original
    // behaviour). 'per_product' = this tier instead prices EVERY product
    // individually via `productPrices` below - for a dealer sheet that isn't a
    // clean percent off list price. `percent` is ignored in that mode.
    pricingMode: { type: String, enum: ['percent', 'per_product'], default: 'percent' },
    // Only meaningful when pricingMode === 'per_product'. One row per product
    // this tier has an explicit price for; a product with no row here has no
    // per-product rate from this tier (falls through to whatever else applies).
    productPrices: [{
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      price:     { type: Number, required: true, min: 0 },
    }],
    // Quantity breaks, scoped to this TIER (not one client - see the Product
    // schema's clientBulkBreaks for that). "Anyone in Kape Sinukuan Price who
    // orders 20+ of this product pays ₱550 each" rather than the tier's flat
    // per-product rate above. Independent array (not nested under productPrices)
    // so a product can have a flat tier rate with no break, a break with no flat
    // rate, or both - resolveTierPrice takes whichever benefits the buyer more
    // once the ordered quantity is known.
    productBulkBreaks: [{
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      minQty:    { type: Number, required: true },
      price:     { type: Number, required: true, min: 0 },
    }],
    note:     { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  }, { timestamps: true });
  PriceTierSchema.index({ businessType: 1, name: 1 }, { unique: true });
  const PriceTier = mongoose.model('PriceTier', PriceTierSchema);

  const EODRecordSchema = new mongoose.Schema({
    dateString: String, // e.g., '2026-04-29'
    status: { type: String, default: 'OPEN' }, // 'OPEN' or 'LOCKED'
    lockedAt: Date,
    lockedBy: String
  });
  const EODRecord = mongoose.model('EODRecord', EODRecordSchema);

  // Atomic sequence counter - one document per prefix, incremented with $inc to prevent race conditions
  const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
  const Counter = mongoose.model('Counter', CounterSchema);

  return {
    RefreshSession, Counter, ClientAccount, Role, refreshCustomRolePerms, AuditLog,
    EODRecord, PriceTierSchema, PriceTier, ChangeRequestSchema, ChangeRequest, CHANGE_REQUEST_STATUSES,
    ClientAccountSchema, CollectionReminderSchema, CollectionReminder, RefreshSessionSchema, RoleSchema, AuditLogSchema,
    DiscountSchema, Discount, DiscountRuleSchema, DiscountRule, EODRecordSchema, CounterSchema,
  };
}
