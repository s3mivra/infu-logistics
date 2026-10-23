import mongoose from 'mongoose';
import { code } from '../lib/normalize.js';

// Database definitions: purchase orders, bills, check vouchers, journals awaiting approval, attachments, budgets, leave, advances, stock reservations, fixed assets, bank reconciliation, quotations and payroll.
// Moved out of server.js as it was. It is called once, at the same point in
// start-up where this code used to sit, and handed what it reads from there.
export default function defineWorkflowModels({ BUSINESS_TYPE, currentBranchCode, mkSeqRef, acctMeta, log }) {
  // ── PURCHASE ORDERS (procurement workflow) ───────────────────────────────────
  // Two-stage tracking tool. A PO is drafted with line items pulled from inventory,
  // tracked through Ordered → Processing, then reconciled against the actual
  // delivery (per-line receivedQty typed in by hand) which flips it to Complete
  // (everything arrived) or Incomplete (short/over). Purely a tracking record - it
  // does NOT post to inventory or the ledger; restock + journal entries stay on the
  // existing /api/inventory/restock flow so there's no double counting.
  // Suppliers - a managed directory (CRUD) that POs can be drawn from. A PO stores
  // both a supplierId link AND a supplier name snapshot, so renaming/deleting a
  // supplier never rewrites the history of past POs.
  const SupplierSchema = new mongoose.Schema({
    supplierCode:  { type: String, index: true },             // SUP-2026-000001
    name:          { type: String, required: true, index: true },
    contactPerson: { type: String, default: '' },
    phone:         { type: String, default: '' },
    email:         { type: String, default: '' },
    address:       { type: String, default: '' },
    notes:         { type: String, default: '' },
    // A supplier's TIN and registered name are what a 2307 is made out to, and
    // what substantiates input VAT claimed on their invoice. Without them the
    // certificate cannot be filed and the credit has nothing behind it.
    tin:           { type: String, default: '' },
    registeredName:{ type: String, default: '' },
    // Whether they charge VAT - decides whether input VAT is claimable on what
    // they bill, which is the question the receiving and bill screens ask.
    isVatRegistered: { type: Boolean, default: false },
    isActive:      { type: Boolean, default: true },
    tenantId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    // Catalog: what this supplier says they sell + their quoted price - set by staff,
    // independent of whether a PO has ever been placed. This is what lets "who's
    // cheaper for X" be answered before ever buying, not just from purchase history.
    catalog: [{
      invId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', default: null },
      itemName:  { type: String, required: true },
      itemCode:  { type: String, default: '' },
      unit:      { type: String, default: '' },
      packSize:  { type: Number, default: null },
      unitCost:  { type: Number, required: true },
      notes:     { type: String, default: '' },
    }],
    // What this supplier's invoices say about when they expect to be paid
    // ("30 days", "COD"). The data export already had a Terms column and the
    // schema never declared the field, so Mongoose silently dropped whatever
    // was written to it and the column came back empty every time.
    paymentTerms:  { type: String, default: '' },
    // Days from ordering to delivery with this supplier. Stock movement and the
    // Suggested PO use it for the items this supplier provides (buy enough to
    // last until the next delivery); null = use the business-wide default.
    leadTimeDays:  { type: Number, default: null, min: 0, max: 90 },
    // Running credit balance from overpaying this supplier - an ASSET (they
    // owe it back to us), separate from whatever they're currently owed on
    // open bills. Grows when a bill payment exceeds what was actually due;
    // shrinks when that credit is applied to a later bill or refunded out via
    // a Check Voucher. See POST /api/bills/:id/pay and
    // /api/suppliers/:id/credit/* in bills.js.
    creditBalance: { type: Number, default: 0 },
    creditHistory: [{
      type:        { type: String, enum: ['overpayment', 'applied', 'refunded', 'adjusted'], required: true },
      amount:      { type: Number, required: true },     // always positive; `type` says the direction
      billId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', default: null },
      billNumber:  { type: String, default: '' },
      reference:   { type: String, default: '' },        // the JournalEntry / CheckVoucher reference tied to this movement
      note:        { type: String, default: '' },
      by:          { type: String, default: '' },
      at:          { type: Date, default: Date.now },
    }],
  }, { timestamps: true });
  const Supplier = mongoose.model('Supplier', SupplierSchema);

  const PO_STATUSES = ['Ordered', 'Processing', 'Complete', 'Incomplete', 'Cancelled'];
  const PurchaseOrderSchema = new mongoose.Schema({
    poNumber:     { type: String, index: true },              // PO-2026-000001
    supplier:     { type: String, default: '' },              // name snapshot at draft time
    supplierId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    status:       { type: String, default: 'Ordered', enum: PO_STATUSES, index: true },
    expectedDate: { type: Date },
    notes:        { type: String, default: '' },
    lines: [{
      // What is actually being bought. Every line used to be treated as stock,
      // so a PO for an espresso machine landed in Inventory - where a recipe
      // could consume it - and booked a TRADE payable for a non-trade purchase.
      //   inventory   goods to sell or consume  DR 130000 / CR 220000 (trade)
      //   fixedAsset  equipment                 DR 1401xx / CR 225100 (non-trade)
      //   expense     a service                 DR expense / CR 225200 (non-trade)
      purchaseType: { type: String, enum: ['inventory', 'fixedAsset', 'expense'], default: 'inventory' },
      // Which account the non-inventory kinds land in. Ignored for inventory.
      assetAccountCode:   { type: String, default: '' },   // 1401xx for fixedAsset
      expenseAccountCode: { type: String, default: '' },   // any expense account
      // Depreciation terms, captured at purchase so the asset register can be
      // created on receipt rather than chased up afterwards.
      usefulLifeMonths: { type: Number, default: null },
      salvageValue:     { type: Number, default: 0 },
      invId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', default: null },
      itemName:    { type: String, default: '' },
      itemCode:    { type: String, default: '' },
      unit:        { type: String, default: '' },             // display unit captured at draft time (kg/L/pcs)
      packSize:    { type: Number, default: null },           // weight/volume per pack, in `unit` (e.g. 1 for "1L", 250 for "250g"); optional
      orderedQty:  { type: Number, default: 0 },
      unitCost:    { type: Number, default: 0 },
      expiryDate:  { type: Date, default: null },             // optional expiry for the incoming stock
      productionDate: { type: Date, default: null },          // for goods with no real expiry (beans, etc.)
      receivedQty: { type: Number, default: null },           // null until reconciled
      // Goods sent back to the supplier off this line - short-shipped, damaged,
      // wrong item, off-spec. Kept separately from receivedQty so the delivery
      // record still says what actually arrived; what we KEPT is the difference.
      returnedQty: { type: Number, default: 0 },
    }],
    // Whether the VAT on this delivery was taken as creditable input VAT. A
    // return has to give back exactly what was claimed, and asking the operator
    // again at return time would let the two answers disagree.
    inputVatClaimed: { type: Boolean, default: false },
    // Goods sent back after receiving. Each one is a debit memo: stock leaves,
    // and what the supplier is owed drops by the same amount (or, if their
    // invoice is already paid, it becomes credit they hold for us).
    returns: [{
      returnNumber: { type: String, default: '' },
      reason:       { type: String, default: '' },
      amount:       { type: Number, default: 0 },      // gross, as the supplier billed it
      vatAmount:    { type: Number, default: 0 },      // input VAT given back inside `amount`
      restoredToAdvance: { type: Number, default: 0 }, // put back onto a prepayment
      appliedToBills: { type: Number, default: 0 },    // how much reduced an open bill
      creditToSupplier: { type: Number, default: 0 },  // the rest: credit they now hold for us
      reference:    { type: String, default: '' },     // the JournalEntry this posted under
      lines: [{
        itemName: { type: String, default: '' },
        qty:      { type: Number, default: 0 },        // in the PO's own pack/unit
        amount:   { type: Number, default: 0 },
      }],
      by:           { type: String, default: '' },
      at:           { type: Date, default: Date.now },
    }],
    // Paid before the goods arrive. That is NOT a payable - nothing is owed,
    // the supplier owes US delivery - so it books a supplier advance (170200)
    // instead, and receiving liquidates the advance rather than crediting A/P.
    // Recording it as a payable would overstate both what we owe and, once the
    // cash also left, what we hold.
    prepaid:        { type: Boolean, default: false },
    prepaidAmount:  { type: Number, default: 0 },
    prepaidDate:    { type: Date, default: null },
    prepaidFromAccount: { type: String, default: '' },
    // Paid on delivery (COD): what each delivery brings is paid there and then,
    // from this cash/bank account - for what was RECEIVED, never what was
    // ordered. No payable, no bill. The receive step may still change it.
    payOnDelivery: { type: Boolean, default: false },
    payOnDeliveryAccount: { type: String, default: '' },
    // Closed without a delivery, because a payable already in the books (carried
    // in by the setup workbook, or typed in) was linked to it: the bill's number,
    // and the status the order had, so taking the link off reopens it.
    closedByBill: { type: String, default: '' },
    statusBeforeLink: { type: String, default: '' },
    paidOnDelivery: { type: Number, default: 0 },   // running total paid at deliveries
    // The Advance this PO was paid through, so receiving can liquidate it.
    advanceId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Advance', default: null },
    advanceNumber:  { type: String, default: '' },
    estTotal:     { type: Number, default: 0 },
    actualTotal:  { type: Number, default: 0 },
    receivedAt:   { type: Date, default: null },
    receivedBy:   { type: String, default: '' },
    createdBy:    { type: String, default: '' },
    // Every other export-scoped model carries this, and data-export.js already
    // filtered POs by it - against a field the schema never declared, so the
    // Purchase Orders export silently returned zero rows however many POs
    // existed. Same shape and default as the rest; the tenancy re-backfill
    // stamps the existing docs.
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
  }, { timestamps: true });
  const PurchaseOrder = mongoose.model('PurchaseOrder', PurchaseOrderSchema);

  // --- AP BILL APPROVAL WORKFLOW ---
  // A Bill is a payable awaiting sign-off, in one of two ways:
  //   - source:'PO'     - created automatically when a PO delivery is received
  //                        (purchase-orders.js's /receive route). The A/P journal
  //                        entry (DR Inventory / CR 220000) posts immediately at
  //                        receipt as before - that's a real liability the moment
  //                        goods arrive, not something to hold open pending review.
  //                        Approving a PO-sourced bill doesn't post anything new;
  //                        it's the "someone checked this invoice against the PO"
  //                        sign-off gate before it can be scheduled/paid.
  //   - source:'Manual'  - entered directly (a utility bill, rent, anything with
  //                        no PO). No JE exists yet when Pending - approval is
  //                        what books the liability (DR expenseAccountCode /
  //                        CR 220000), since a manual entry has no independent
  //                        physical-receipt event to already justify it.
  // 'Partially Paid' sits between Approved and Paid - a bill only reaches Paid
  // once its running paidAmount (see below) actually reaches its full amount.
  const BILL_STATUSES = ['Pending', 'Approved', 'Partially Paid', 'Rejected', 'Paid'];
  const BillSchema = new mongoose.Schema({
    businessType:      { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    billNumber:        { type: String, index: true },              // BILL-2026-000001
    supplierId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName:      { type: String, default: '' },               // snapshot at creation time
    // 'Opening': a bill still unpaid when the business moved onto the system,
    // carried in by the setup workbook. It arrives Approved and never posts - the
    // opening balance sheet already holds it in Accounts Payable.
    source:            { type: String, enum: ['PO', 'Manual', 'Opening'], required: true },
    purchaseOrderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    poNumber:          { type: String, default: '' },
    // Carried in through the setup workbook (Open Payables or Bills sheet), not
    // typed in on screen. Only these can be given a PO number by hand.
    imported:          { type: Boolean, default: false },
    description:       { type: String, default: '' },               // required context for Manual bills
    supplierInvoiceNo: { type: String, default: '' },               // the supplier's own number for it
    amount:            { type: Number, required: true },
    expenseAccountCode:{ type: String, default: '' },               // Manual bills only - which account to debit on approval
    // VAT charged by a VAT-registered supplier, inside `amount`. Creditable
    // against output VAT, so on approval it is split out of the cost and held in
    // 170300 rather than expensed. Only meaningful while the business itself is
    // VAT-registered; false leaves the bill posting exactly as it always did.
    claimInputVat:     { type: Boolean, default: false },
    inputVatAmount:    { type: Number, default: 0 },
    status:            { type: String, default: 'Pending', enum: BILL_STATUSES, index: true },
    dueDate:           { type: Date, default: null },                // when the supplier expects payment
    scheduledPaymentDate: { type: Date, default: null },              // when WE plan to pay it - only settable once Approved
    createdBy:         { type: String, default: '' },
    approvedBy:        { type: String, default: '' },
    approvedAt:        { type: Date, default: null },
    rejectedBy:        { type: String, default: '' },
    rejectedAt:        { type: Date, default: null },
    rejectionReason:   { type: String, default: '' },
    paidAt:            { type: Date, default: null },
    // ── Three-way match (lib/threeWayMatch.js) ──
    // The supplier's invoice, as recorded against this bill, and how it compared
    // with the PO and what was received. A PO bill cannot be approved for
    // payment until this is Matched - or Accepted by someone allowed to approve
    // price changes, with a reason. supplierInvoiceKey is the normalised invoice
    // number, so the same invoice cannot be entered twice for one supplier.
    supplierInvoiceKey:    { type: String, default: '', index: true },
    supplierInvoiceAmount: { type: Number, default: null },
    // What arrived in the delivery this bill is for. A PO received in parts
    // raises one bill per delivery, and each bill's invoice is matched against
    // its own delivery - not against everything received on the PO so far.
    deliveryLines: [{ _id: false, itemName: String, qty: Number, unitCost: Number }],
    supplierInvoiceDate:   { type: Date, default: null },
    match: {
      status:        { type: String, enum: ['Unmatched', 'Matched', 'Exception', 'Accepted'], default: 'Unmatched' },
      poValue:       { type: Number, default: null },
      receivedValue: { type: Number, default: null },
      invoiceAmount: { type: Number, default: null },
      variance:      { type: Number, default: 0 },
      issues:        [{ code: String, text: String }],
      checkedBy:     { type: String, default: '' },
      checkedAt:     { type: Date, default: null },
      acceptedBy:    { type: String, default: '' },
      acceptReason:  { type: String, default: '' },
      varianceJournalRef: { type: String, default: '' },
    },
    // Reference of the JournalEntry this bill is tied to: the PO-receipt entry for
    // source:'PO' bills, the approval entry for source:'Manual' bills, and
    // overwritten with the LATEST payment entry's reference once any payment lands.
    journalEntryRef:   { type: String, default: '' },
    // External reference for the payment - a bank transaction ID, check number,
    // GCash ref, etc. Distinct from journalEntryRef (the internal mkSeqRef code) -
    // this is what ties the record back to an actual bank statement or receipt.
    // Kept for the LATEST payment; the full history is in `payments` below.
    paymentReference:  { type: String, default: '' },
    // --- PARTIAL / OVERPAYMENT TRACKING (mirrors Order.arPaidAmount/arPayments) ---
    // A bill is rarely paid in one clean shot either. `paidAmount` is the
    // running sum of every payment posted against this bill; `status` only
    // reaches 'Paid' once it meets `amount`. A payment that pushes paidAmount
    // PAST `amount` is capped here at exactly `amount` - the excess is
    // diverted to the supplier's creditBalance instead (see POST .../pay),
    // never silently overstating what this specific bill "collected".
    paidAmount:        { type: Number, default: 0 },
    payments: [{
      amount:          { type: Number, required: true },
      payFromAccount:  { type: String, default: '' },
      referenceNumber: { type: String, default: '' },
      checkVoucherRef: { type: String, default: '' },      // the CheckVoucher this payment was issued through
      journalRef:      { type: String, default: '' },
      paidBy:          { type: String, default: '' },
      at:              { type: Date, default: Date.now },
    }],
  }, { timestamps: true });
  BillSchema.index({ businessType: 1, status: 1 });
  BillSchema.index({ supplierId: 1, supplierInvoiceKey: 1 });
  const Bill = mongoose.model('Bill', BillSchema);

  // A bill that comes round every month - rent, internet, a retainer. Each
  // month it is PROPOSED as an ordinary Pending bill (never posted, never paid
  // on its own), so it still goes through the same approval as a typed-in one.
  // `lastMonth` ("2026-10") is the month it was last raised for, so a month is
  // never raised twice.
  const RecurringBillSchema = new mongoose.Schema({
    businessType:       { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    supplierId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName:       { type: String, default: '' },
    description:        { type: String, required: true },
    amount:             { type: Number, required: true },
    expenseAccountCode: { type: String, required: true },
    dayOfMonth:         { type: Number, default: 1 },      // 1-28: the day it falls due
    isActive:           { type: Boolean, default: true },
    lastMonth:          { type: String, default: '' },
    createdBy:          { type: String, default: '' },
  }, { timestamps: true });
  const RecurringBill = mongoose.model('RecurringBill', RecurringBillSchema);

  // --- CHECK VOUCHER ---
  // The actual paper trail for a disbursement - standard PH bookkeeping
  // practice: every outgoing payment (an AP bill payment, or an A/R
  // overpayment refunded back out to a client) gets one numbered voucher,
  // independent of which record it happened to be paid against. A bill/refund
  // keeps its own reference to the voucher (paymentReference / journalRef),
  // but this is the canonical, printable/filable record of the payment itself.
  const CheckVoucherSchema = new mongoose.Schema({
    businessType:   { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    voucherNumber:  { type: String, index: true },                    // CV-2026-000001
    // Which inventory issued this. mkSeqRef numbers restart per deployment, so
    // the number alone is not unique across a business with several branches -
    // (branchCode, number) is. Blank until the deployment is given a code; the
    // consolidated views surface that as "not set" rather than silently
    // grouping it with everything else.
    branchCode:     { type: String, default: '', index: true },
    // Who the money went to. 'other' covers a manual/ad-hoc disbursement not
    // tied to a Bill or a client credit refund.
    payeeType:      { type: String, enum: ['supplier', 'client', 'other'], required: true },
    payeeId:        { type: String, default: '' },                    // Supplier._id or ClientAccount._id, when applicable
    payeeName:      { type: String, required: true },
    amount:         { type: Number, required: true },
    // What the money was for. 'other' covers a disbursement with no richer
    // classification. There is deliberately no 'supplier-credit-refund': a
    // supplier returning our overpayment is money coming IN, and a check voucher
    // documents money going OUT - that refund is a receipt, not a voucher.
    purpose:        { type: String, enum: ['bill-payment', 'client-credit-refund', 'payroll', 'expense', 'petty-cash', 'advance', 'other'], required: true },
    sourceAccount:  { type: String, default: '111000' },               // which cash/bank account the money left from
    sourceAccountName: { type: String, default: '' },
    referenceNumber:{ type: String, default: '' },                    // the actual check number / bank transfer ref
    notes:          { type: String, default: '' },
    status:         { type: String, enum: ['Issued', 'Voided'], default: 'Issued' },
    voidedBy:       { type: String, default: '' },
    voidedAt:       { type: Date, default: null },
    voidReason:     { type: String, default: '' },
    billId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', default: null },
    journalEntryRef:{ type: String, default: '' },
    issuedBy:       { type: String, default: '' },
    date:           { type: Date, default: Date.now },
  }, { timestamps: true });
  CheckVoucherSchema.index({ businessType: 1, date: -1 });
  const CheckVoucher = mongoose.model('CheckVoucher', CheckVoucherSchema);

  // ── MANUAL JOURNAL APPROVAL ──────────────────────────────────────────────────
  // A journal entry typed by hand is prepared, then approved, then posted - the
  // automatic ones (sales, receipts, payments) come from approved transactions
  // already. Someone holding journal.approve posts their own entry straight
  // away (their approval is recorded); anyone else's waits here as Pending
  // until an approver posts or rejects it. Only a Posted one is in the ledger.
  const MANUAL_JOURNAL_STATUSES = ['Pending', 'Posted', 'Rejected'];
  const ManualJournalSchema = new mongoose.Schema({
    businessType:  { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    draftNumber:   { type: String, index: true },            // MJ-2026-000001
    date:          { type: Date, default: null },            // the entry's date once posted (null = the day it is approved)
    description:   { type: String, default: '' },
    lines: [{
      accountCode: { type: String, required: true },
      accountName: { type: String, default: '' },
      debit:       { type: Number, default: 0 },
      credit:      { type: Number, default: 0 },
    }],
    totalDebit:    { type: Number, default: 0 },
    totalCredit:   { type: Number, default: 0 },
    status:        { type: String, enum: MANUAL_JOURNAL_STATUSES, default: 'Pending', index: true },
    preparedBy:    { type: String, default: '' },
    preparedById:  { type: String, default: '' },
    approvedBy:    { type: String, default: '' },
    approvedAt:    { type: Date, default: null },
    rejectedBy:    { type: String, default: '' },
    rejectedAt:    { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
    postedReference: { type: String, default: '' },          // the JournalEntry it became
  }, { timestamps: true });
  const ManualJournal = mongoose.model('ManualJournal', ManualJournalSchema);

  // ── DOCUMENT ATTACHMENTS ─────────────────────────────────────────────────────
  // Supporting documents - a supplier's invoice, an official receipt, a signed
  // voucher - kept with the transaction they support. Stored in the tenant's
  // own database, so they are in every backup and restore with the books.
  const ATTACHMENT_ENTITIES = ['ManualJournal', 'JournalEntry', 'Bill', 'PurchaseOrder', 'CheckVoucher', 'Advance', 'Order', 'RequisitionSlip'];
  const AttachmentSchema = new mongoose.Schema({
    businessType:  { type: String, default: () => BUSINESS_TYPE, index: true },
    entity:        { type: String, enum: ATTACHMENT_ENTITIES, required: true },
    entityId:      { type: String, required: true },
    filename:      { type: String, required: true },
    mime:          { type: String, required: true },
    size:          { type: Number, required: true },
    data:          { type: Buffer, required: true },
    uploadedBy:    { type: String, default: '' },
    uploadedById:  { type: String, default: '' },
  }, { timestamps: true });
  AttachmentSchema.index({ entity: 1, entityId: 1, createdAt: 1 });
  const Attachment = mongoose.model('Attachment', AttachmentSchema);

  // ── BUDGETS ──────────────────────────────────────────────────────────────────
  // One amount per account per month (features/budgets.js).
  const BudgetSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    year:         { type: Number, required: true },
    month:        { type: Number, required: true, min: 1, max: 12 },
    accountCode:  { type: String, required: true },
    amount:       { type: Number, required: true, min: 0 },
    setBy:        { type: String, default: '' },
  }, { timestamps: true });
  BudgetSchema.index({ businessType: 1, tenantId: 1, year: 1, month: 1, accountCode: 1 }, { unique: true });
  const Budget = mongoose.model('Budget', BudgetSchema);

  // ── LEAVE & OVERTIME (Phase 2, features/timeoff.js) ─────────────────────────
  // Dates are YYYY-MM-DD strings on the business calendar, like ClockEntry.date.
  const TimeOffBase = {
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    userId:       { type: String, required: true, index: true },
    userName:     { type: String, required: true },
    reason:       { type: String, default: '' },
    status:       { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
    filedBy:      { type: String, default: '' },
    decidedBy:    { type: String, default: '' },
    decidedAt:    { type: Date, default: null },
    decisionNote: { type: String, default: '' },
  };
  const LeaveRequestSchema = new mongoose.Schema({
    ...TimeOffBase,
    type: { type: String, enum: ['Vacation', 'Sick', 'Emergency', 'Unpaid'], required: true },
    from: { type: String, required: true },
    to:   { type: String, required: true },
    days: { type: Number, required: true },
    paid: { type: Boolean, default: true },
  }, { timestamps: true });
  // The overlap check (one person's live leave) and the timesheet (approved
  // leave touching a pay period), plus the list screen.
  LeaveRequestSchema.index({ userId: 1, status: 1, from: 1, to: 1 });
  LeaveRequestSchema.index({ status: 1, from: 1, to: 1 });
  LeaveRequestSchema.index({ businessType: 1, tenantId: 1, status: 1, createdAt: -1 });
  const LeaveRequest = mongoose.model('LeaveRequest', LeaveRequestSchema);
  const OvertimeRequestSchema = new mongoose.Schema({
    ...TimeOffBase,
    date:  { type: String, required: true },
    hours: { type: Number, required: true },
  }, { timestamps: true });
  OvertimeRequestSchema.index({ status: 1, date: 1 });
  OvertimeRequestSchema.index({ businessType: 1, tenantId: 1, status: 1, createdAt: -1 });
  const OvertimeRequest = mongoose.model('OvertimeRequest', OvertimeRequestSchema);

  // Cash, bank, and e-wallet accounts - the ones money can actually leave from.
  const VOUCHER_SOURCE_ACCOUNTS = /^(111|112|113|114)/;

  // Issue the voucher for a disbursement.
  //
  // Every payment out of a cash or bank account gets one: it is the document
  // somebody signs, and the file of them is what "money out" reconciles against.
  // Centralised because it was hand-rolled at each call site, which is how four
  // copies of the same record end up with four different shapes.
  //
  // Returns null - never throws - when there is nothing to document: money that
  // did not leave a cash account (an on-account expense raises a payable, it does
  // not pay anyone), or a zero amount. A failure to write the voucher is logged
  // loudly but does not fail the payment: the money has already moved and the
  // journal entry has already posted, so refusing the request would leave the
  // books and the response disagreeing.
  const issueCheckVoucher = async (req, {
    payeeType = 'other', payeeId = '', payeeName, amount, purpose = 'other',
    sourceAccount, referenceNumber = '', notes = '', billId = null,
    journalEntryRef = '', date = null,
  } = {}) => {
    const code = String(sourceAccount || '');
    if (!VOUCHER_SOURCE_ACCOUNTS.test(code)) return null;
    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    if (!(amt > 0)) return null;
    try {
      return await CheckVoucher.create({
        businessType: BUSINESS_TYPE,
        tenantId: req?.user?.tenantId || null,
        branchCode: await currentBranchCode(),
        voucherNumber: await mkSeqRef('CV'),
        payeeType, payeeId: String(payeeId || ''), payeeName: String(payeeName || 'Payee'),
        amount: amt, purpose,
        sourceAccount: code, sourceAccountName: acctMeta(code)?.name || code,
        referenceNumber: String(referenceNumber || ''), notes: String(notes || '').slice(0, 500),
        billId, journalEntryRef,
        issuedBy: req?.user?.name || '',
        ...(date ? { date } : {}),
      });
    } catch (err) {
      // Logged rather than reported through captureError: this file does not
      // import it, and a voucher that failed to write must not take the payment
      // down with it.
      log.error({ err }, 'Could not issue a check voucher');
      return null;
    }
  };

  // ── ADVANCE ──────────────────────────────────────────────────────────────────
  // Money that changed hands BEFORE the transaction it belongs to exists. Three
  // shapes, one model, because the lifecycle is identical - issue, liquidate in
  // parts, close - and only the accounts flip:
  //
  //   employee  cash handed to staff to spend      DR 170100 / CR cash   (asset)
  //   supplier  prepayment/deposit on an order     DR 170200 / CR cash   (asset)
  //   customer  deposit received against future    DR cash   / CR 260200 (liability)
  //
  // Distinct from the credit balances (160100/260100), which are what is left
  // over after OVERpaying something that already existed. An advance is
  // deliberate and comes first; a credit balance is a leftover and comes second.
  const ADVANCE_TYPES = ['employee', 'supplier', 'customer'];
  const ADVANCE_STATUSES = ['Open', 'Partially Liquidated', 'Liquidated', 'Cancelled'];
  const ADVANCE_ACCOUNTS = {
    employee: { code: '170100', name: 'Advances to Employees' },
    supplier: { code: '170200', name: 'Advances to Suppliers' },
    customer: { code: '260200', name: 'Customer Advances / Deposits' },
  };
  const AdvanceSchema = new mongoose.Schema({
    businessType:   { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    advanceNumber:  { type: String, index: true },
    // Which inventory issued this. mkSeqRef numbers restart per deployment, so
    // the number alone is not unique across a business with several branches -
    // (branchCode, number) is. Blank until the deployment is given a code; the
    // consolidated views surface that as "not set" rather than silently
    // grouping it with everything else.
    branchCode:     { type: String, default: '', index: true },
    type:           { type: String, enum: ADVANCE_TYPES, required: true },
    payeeName:      { type: String, required: true },
    payeeId:        { type: String, default: '' },
    // Customer deposits only: the ClientAccount the money came from. Set, the
    // deposit shows on that client's row, in their portal, and can only be
    // applied to that client's orders. Blank = a deposit from someone with no
    // account (kept working for walk-in style deposits).
    clientId:       { type: String, default: '', index: true },
    amount:         { type: Number, required: true },
    // How much has been cleared so far. status is derived from this vs amount.
    liquidatedAmount: { type: Number, default: 0 },
    status:         { type: String, enum: ADVANCE_STATUSES, default: 'Open', index: true },
    purpose:        { type: String, default: '' },
    // The control account this advance sits in (from ADVANCE_ACCOUNTS above).
    account:        { type: String, default: '' },
    sourceAccount:  { type: String, default: '111000' },
    sourceAccountName: { type: String, default: '' },
    referenceNumber:{ type: String, default: '' },
    journalEntryRef:{ type: String, default: '' },
    checkVoucherRef:{ type: String, default: '' },
    // Each partial clearing. `method` records HOW it cleared, which decides the
    // contra account: an expense code, a bill, an order, or cash returned.
    liquidations: [{
      amount:        { type: Number, required: true },
      method:        { type: String, enum: ['expense', 'bill', 'order', 'cash-return'], required: true },
      expenseAccount:{ type: String, default: '' },
      billId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', default: null },
      orderId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
      reference:     { type: String, default: '' },
      journalRef:    { type: String, default: '' },
      note:          { type: String, default: '' },
      by:            { type: String, default: '' },
      at:            { type: Date, default: Date.now },
    }],
    issuedBy:       { type: String, default: '' },
    date:           { type: Date, default: Date.now },
    cancelledBy:    { type: String, default: '' },
    cancelledAt:    { type: Date, default: null },
    cancelReason:   { type: String, default: '' },
  }, { timestamps: true });
  AdvanceSchema.index({ businessType: 1, date: -1 });
  AdvanceSchema.index({ businessType: 1, type: 1, status: 1 });
  const Advance = mongoose.model('Advance', AdvanceSchema);

  // ── STOCK RESERVATION ────────────────────────────────────────────────────────
  // Stock held for a named client, usually because they have paid a deposit
  // against it. Until now nothing held stock at all: an order only touches
  // inventory when it COMPLETES, so goods promised to one client could be sold to
  // somebody else in the meantime and the promise quietly broke.
  //
  // A reservation raises Inventory.reservedQty. Everyone else sells against
  // stockQty - reservedQty, so held stock is invisible to other sales. The
  // reserving client's own order releases its hold immediately before it deducts,
  // so the reservation never blocks the sale it exists for.
  //
  // It ends one of four ways, and only 'Open' holds anything:
  //   Released   the order it was held for completed (or staff released it)
  //   Cancelled  called off by hand
  //   Expired    nobody collected; swept once the date passes
  const RESERVATION_STATUSES = ['Open', 'Released', 'Cancelled', 'Expired'];
  const ReservationSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    reservationNumber: { type: String, index: true },
    branchCode:   { type: String, default: '', index: true },
    clientId:     { type: String, default: '', index: true },
    clientName:   { type: String, default: '' },
    // The order this stock is held for, when it was reserved from one. Completing
    // that order releases the hold automatically.
    orderId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    orderNumber:  { type: String, default: '' },
    // What a deposit, if any, was taken against it - so the two are traceable to
    // each other without reading notes.
    advanceId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Advance', default: null },
    items: [{
      invId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      itemName: { type: String, default: '' },
      // Base units, same as Inventory.stockQty - a reservation in display units
      // would need re-deriving every time the item's pack size changed.
      qty:      { type: Number, required: true },
      releasedQty: { type: Number, default: 0 },
    }],
    status:       { type: String, enum: RESERVATION_STATUSES, default: 'Open', index: true },
    // A hold with no end date is stock nobody can sell and nobody remembers.
    expiresAt:    { type: Date, default: null, index: true },
    note:         { type: String, default: '' },
    createdBy:    { type: String, default: '' },
    closedBy:     { type: String, default: '' },
    closedAt:     { type: Date, default: null },
    closeReason:  { type: String, default: '' },
  }, { timestamps: true });
  ReservationSchema.index({ businessType: 1, status: 1, expiresAt: 1 });
  const Reservation = mongoose.model('Reservation', ReservationSchema);


  // ── FIXED ASSET ──────────────────────────────────────────────────────────────
  // Equipment, furniture, vehicles - what the business owns and writes down over
  // time. Until now 140000 Fixed Assets was a header with no children, so none of
  // this could be recorded and the balance sheet understated what the business
  // owned by however much the fit-out cost.
  //
  // Cost and accumulated depreciation are held separately and posted to paired
  // accounts (1401xx asset / 1501xx contra-asset). Netting them into one number
  // loses the distinction between "we own a P60,000 machine that is half worn
  // out" and "we own a P30,000 machine", which are different facts.
  const FIXED_ASSET_STATUSES = ['Active', 'Fully Depreciated', 'Disposed'];
  // Each class pairs its cost account with its own accumulated-depreciation
  // account, so a class can be read net without unpicking a pooled contra.
  const FIXED_ASSET_CLASSES = {
    '140100': { name: 'Furniture & Fixtures', accum: '150100' },
    '140200': { name: 'Machinery & Equipment', accum: '150200' },
    '140300': { name: 'Computer & IT Equipment', accum: '150300' },
    '140400': { name: 'Vehicles', accum: '150400' },
    '140500': { name: 'Leasehold Improvements', accum: '150500' },
  };
  const FixedAssetSchema = new mongoose.Schema({
    businessType:  { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    assetCode:     { type: String, index: true },
    branchCode:    { type: String, default: '', index: true },
    name:          { type: String, required: true },
    description:   { type: String, default: '' },
    // Which 1401xx it is carried in; its paired 1501xx is looked up, never stored,
    // so the two cannot drift apart.
    accountCode:   { type: String, required: true },
    acquisitionDate: { type: Date, required: true },
    acquisitionCost: { type: Number, required: true },
    salvageValue:  { type: Number, default: 0 },
    usefulLifeMonths: { type: Number, default: 60 },
    accumulatedDepreciation: { type: Number, default: 0 },
    lastDepreciationDate: { type: Date, default: null },
    status:        { type: String, enum: FIXED_ASSET_STATUSES, default: 'Active', index: true },
    serialNumber:  { type: String, default: '' },
    location:      { type: String, default: '' },
    supplierName:  { type: String, default: '' },
    referenceNumber: { type: String, default: '' },
    journalEntryRef: { type: String, default: '' },
    // Each posting, so a depreciation charge can be traced back to its entry.
    depreciationHistory: [{
      amount: { type: Number, required: true },
      months: { type: Number, default: 0 },
      throughDate: { type: Date },
      journalRef: { type: String, default: '' },
      by: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    disposedAt:    { type: Date, default: null },
    disposalProceeds: { type: Number, default: 0 },
    disposalNote:  { type: String, default: '' },
    disposalJournalRef: { type: String, default: '' },
    createdBy:     { type: String, default: '' },
  }, { timestamps: true });
  FixedAssetSchema.index({ businessType: 1, status: 1 });
  const FixedAsset = mongoose.model('FixedAsset', FixedAssetSchema);

  // --- BANK RECONCILIATION ---
  // One statement, for one bank account, for one period.
  //
  // The ledger says what the business THINKS is in the bank; the statement says
  // what the bank says. They disagree for legitimate reasons - a cheque written
  // but not yet presented, a deposit in transit, a bank charge nobody has booked
  // - and reconciling is the act of explaining every peso of that difference.
  // The moment it cannot be explained, something is wrong: a missed entry, a
  // duplicate, or money gone.
  const BankReconciliationSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    branchCode:   { type: String, default: '', index: true },
    reference:    { type: String, index: true },              // BREC-2026-000001
    accountCode:  { type: String, required: true, index: true },
    accountName:  { type: String, default: '' },
    statementDate: { type: Date, required: true, index: true },
    // What the bank's own statement says the closing balance is. Typed in from
    // the statement, never computed - it is the outside fact being reconciled TO.
    statementBalance: { type: Number, required: true },
    // The ledger balance for the same account as at the same date, captured when
    // the reconciliation is opened so a later posting cannot silently move it.
    ledgerBalance: { type: Number, default: 0 },
    // Journal lines the operator has ticked off against the statement.
    clearedLines: [{
      journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
      reference: { type: String, default: '' },
      date:      { type: Date },
      debit:     { type: Number, default: 0 },
      credit:    { type: Number, default: 0 },
      clearedAt: { type: Date, default: Date.now },
      clearedBy: { type: String, default: '' },
    }],
    status: { type: String, enum: ['Open', 'Reconciled'], default: 'Open', index: true },
    reconciledAt: { type: Date, default: null },
    reconciledBy: { type: String, default: '' },
    notes:        { type: String, default: '' },
    createdBy:    { type: String, default: '' },
  }, { timestamps: true });
  BankReconciliationSchema.index({ businessType: 1, accountCode: 1, statementDate: -1 });
  const BankReconciliation = mongoose.model('BankReconciliation', BankReconciliationSchema);

  // --- QUOTATIONS ---
  // A price asked for, not a sale made.
  //
  // Deliberately its own collection rather than another Order status. If a quote
  // were an order, every sales report, the EOD close, the P&L, the A/R list and
  // each ledger path would have to learn to exclude it, and the first one that
  // forgot would put revenue on the books for something nobody has agreed to
  // buy. A separate collection cannot leak into sales by accident.
  //
  // Nothing here posts. Acceptance creates a real Order through the ordinary
  // path, and from that moment it is an ordinary order in every respect.
  const QUOTATION_STATUSES = ['Requested', 'Quoted', 'Accepted', 'Declined', 'Expired'];
  const QuotationSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    branchCode:   { type: String, default: '', index: true },
    quoteNumber:  { type: String, index: true },              // QUO-2026-000001
    clientAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientAccount', required: true, index: true },
    clientName:   { type: String, default: '' },

    lines: [{
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
      name:      { type: String, required: true },
      quantity:  { type: Number, default: 1 },
      // What the client saw when they asked. Kept so a later quote can be read
      // against what they were expecting to pay.
      askedPrice: { type: Number, default: 0 },
      // What the business came back with. Null until someone prices it.
      quotedPrice: { type: Number, default: null },
      note:      { type: String, default: '' },
    }],

    clientNotes:  { type: String, default: '' },              // what they asked for
    quoteNotes:   { type: String, default: '' },              // terms, freight, lead time
    // A quote that never expires is a price the business is bound to forever.
    validUntil:   { type: Date, default: null },
    status:       { type: String, enum: QUOTATION_STATUSES, default: 'Requested', index: true },

    quotedBy:     { type: String, default: '' },
    quotedAt:     { type: Date, default: null },
    respondedAt:  { type: Date, default: null },
    declineReason: { type: String, default: '' },
    // Set once accepted, so a quote can never be turned into two orders.
    orderId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber:  { type: String, default: '' },
  }, { timestamps: true });
  QuotationSchema.index({ businessType: 1, status: 1, createdAt: -1 });
  const Quotation = mongoose.model('Quotation', QuotationSchema);

  // --- PAYROLL ---
  // One pay period, and what each person earned and had deducted.
  //
  // Gross pay is the expense - it is what the work cost the business. What the
  // employee actually receives is less, because the statutory deductions are
  // withheld from THEIR money and held until each agency is paid. Booking only
  // the net would understate wages and hide three separate liabilities that are
  // remitted to three separate agencies on three separate schedules.
  //
  //   DR 610000 Salaries & Wages   gross
  //   CR 240100 SSS Payable        employee share
  //   CR 240200 PhilHealth Payable employee share
  //   CR 240300 Pag-IBIG Payable   employee share
  //   CR 230200 Withholding Tax    tax on compensation
  //   CR 240400 Net Pay Payable    what is left to hand over
  const PAYROLL_RUN_STATUSES = ['Draft', 'Approved', 'Paid'];
  const PayrollRunSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    branchCode:   { type: String, default: '', index: true },
    reference:    { type: String, index: true },              // PAY-2026-000001
    periodStart:  { type: Date, required: true, index: true },
    periodEnd:    { type: Date, required: true, index: true },
    payDate:      { type: Date, required: true },
    lines: [{
      employeeName: { type: String, required: true },
      employeeId:   { type: String, default: '' },
      // Copied from the staff record when the run is created, not looked up when
      // the payslip is printed: a payslip is a record of what was remitted under
      // which account number at the time, and a number corrected next year must
      // not silently rewrite the slips already issued under the old one.
      sssNumber:        { type: String, default: '' },
      philhealthNumber: { type: String, default: '' },
      pagibigNumber:    { type: String, default: '' },
      tin:              { type: String, default: '' },
      // Gross = basic pay + extra pay (allowances, bonuses). Both parts are kept
      // so the payslip can show them; gross is what the books and every total
      // use. Older runs have no split: basicPay is null and gross is the basic.
      basicPay:     { type: Number, default: null },
      allowances:   { type: Number, default: 0 },
      grossPay:     { type: Number, default: 0 },
      sss:          { type: Number, default: 0 },
      philhealth:   { type: Number, default: 0 },
      pagibig:      { type: Number, default: 0 },
      withholdingTax: { type: Number, default: 0 },
      otherDeductions: { type: Number, default: 0 },
      // Derived, but stored: a payslip is a record of what was actually paid,
      // and recomputing it later from rates that have since changed would make
      // the payslip disagree with the bank.
      netPay:       { type: Number, default: 0 },
      notes:        { type: String, default: '' },
    }],
    totals: {
      gross: { type: Number, default: 0 },
      sss: { type: Number, default: 0 },
      philhealth: { type: Number, default: 0 },
      pagibig: { type: Number, default: 0 },
      withholdingTax: { type: Number, default: 0 },
      otherDeductions: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
    },
    status: { type: String, enum: PAYROLL_RUN_STATUSES, default: 'Draft', index: true },
    journalEntryRef: { type: String, default: '' },
    paymentJournalRef: { type: String, default: '' },
    paidFromAccount: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    paidAt:     { type: Date, default: null },
    notes:      { type: String, default: '' },
    createdBy:  { type: String, default: '' },
  }, { timestamps: true });
  PayrollRunSchema.index({ businessType: 1, status: 1, periodEnd: -1 });
  const PayrollRun = mongoose.model('PayrollRun', PayrollRunSchema);

  return {
    PurchaseOrder, Bill, Budget, LeaveRequest, OvertimeRequest, ManualJournal,
    MANUAL_JOURNAL_STATUSES, Attachment, ATTACHMENT_ENTITIES, issueCheckVoucher, SupplierSchema, Supplier,
    PurchaseOrderSchema, PO_STATUSES, BillSchema, BILL_STATUSES, CheckVoucherSchema, CheckVoucher,
    ADVANCE_TYPES, FIXED_ASSET_STATUSES, FIXED_ASSET_CLASSES, BankReconciliation, PayrollRun, PAYROLL_RUN_STATUSES,
    Quotation, QUOTATION_STATUSES, FixedAssetSchema, FixedAsset, ADVANCE_STATUSES, ADVANCE_ACCOUNTS,
    AdvanceSchema, Advance, Reservation, RESERVATION_STATUSES,
  };
}
