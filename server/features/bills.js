// bills routes - AP bill approval workflow + payment scheduling.
// Models/helpers/middleware live in server.js and arrive via ctx.
// See the BillSchema comment in server.js for the source:'PO' vs 'Manual'
// distinction that drives when the A/P journal entry actually posts.
import { captureError } from '../lib/errorLog.js';

export default function registerBills(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    log,
    mkSeqRef,
    currentBranchCode,
    tenantScope,
    logAudit,
    assertBalanced,
    acctMeta,
    BUSINESS_TYPE,
    Bill,
    BILL_STATUSES,
    Supplier,
    JournalEntry,
    CheckVoucher,
    AuditLog,
    emitToMgr,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  // Same accounting gate ap-payment/journal posting already use - approving,
  // rejecting, scheduling, or paying a bill is a posting-adjacent action.
  const canViewAcct = [requireStaff, requirePermission('accounting.view')];
  const canPostAcct = [requireStaff, requirePermission('accounting.manage')];

  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ── LIST ─────────────────────────────────────────────────────────────────────
  // GET /api/bills?status=Pending&supplierId=...
  app.get('/api/bills', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status && BILL_STATUSES.includes(req.query.status)) q.status = req.query.status;
      if (req.query.supplierId && mongoose.Types.ObjectId.isValid(req.query.supplierId)) q.supplierId = req.query.supplierId;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const bills = await Bill.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      res.json({ success: true, bills });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── PAYMENT SCHEDULE ─────────────────────────────────────────────────────────
  // Approved bills with a scheduled payment date, soonest first - the "what do
  // we owe and when are we paying it" view. Bills scheduled but overdue (date
  // already passed) sort first since they're the most urgent.
  app.get('/api/bills/upcoming', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const q = {
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        status: 'Approved', scheduledPaymentDate: { $ne: null },
      };
      const bills = await Bill.find(q).sort({ scheduledPaymentDate: 1 }).lean();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const withFlag = bills.map(b => ({ ...b, overdue: new Date(b.scheduledPaymentDate) < today }));
      res.json({ success: true, bills: withFlag });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SINGLE ───────────────────────────────────────────────────────────────────
  app.get('/api/bills/:id', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const bill = await Bill.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!bill) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE (manual bill - no PO backing it) ─────────────────────────────────
  // POST /api/bills { supplierId, description, amount, dueDate, expenseAccountCode }
  app.post('/api/bills', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      const { supplierId, description, amount, dueDate, expenseAccountCode } = req.body || {};
      if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({ success: false, error: 'A valid supplier is required.' });
      }
      const amt = money(amount);
      if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });
      if (!description?.trim()) return res.status(400).json({ success: false, error: 'A description is required for a manual bill (what is this for?).' });
      // Validated at approval time too, but fail fast here rather than accept a
      // bill that can never actually be approved.
      if (!expenseAccountCode || !acctMeta(expenseAccountCode)) {
        return res.status(400).json({ success: false, error: 'A valid expense/asset account is required (what gets debited when this is approved).' });
      }

      const supplier = await Supplier.findOne({ _id: supplierId, ...tenantScope(req) }).lean();
      if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });

      const billNumber = await mkSeqRef('BILL');
      const bill = await Bill.create({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        billNumber,
        supplierId,
        supplierName: supplier.name,
        source: 'Manual',
        description: description.trim().slice(0, 500),
        amount: amt,
        expenseAccountCode,
        dueDate: dueDate ? new Date(dueDate) : null,
        createdBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'Bill', entityId: bill._id, after: { billNumber, supplierId, amount: amt } });
      res.json({ success: true, bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Bulk entry of bills that already exist on paper.
  //
  // This is a cutover tool: the day you go live you have a drawer of unpaid
  // supplier invoices, and typing them one at a time is the slowest part of
  // starting. Each row becomes a PENDING bill - deliberately not approved, so
  // nothing posts to the ledger until a person has looked at it. Approving in
  // bulk would book a drawer of payables sight unseen, and a typo in a
  // spreadsheet would become a liability nobody entered on purpose.
  //
  // A row that fails is reported and skipped; one bad supplier name should not
  // lose the other thirty-nine invoices.
  const BILL_IMPORT_MAX_ROWS = 500;
  app.post('/api/bills/import', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) return res.status(400).json({ success: false, error: 'No rows to import.' });
      if (rows.length > BILL_IMPORT_MAX_ROWS) {
        return res.status(400).json({ success: false, error: `Too many rows (${rows.length}) - import at most ${BILL_IMPORT_MAX_ROWS} at a time.` });
      }

      // Suppliers are matched by name, because that is what an invoice carries.
      // One read, not one per row.
      const suppliers = await Supplier.find(tenantScope(req), { name: 1 }).lean();
      const byName = new Map(suppliers.map(s => [String(s.name || '').toLowerCase().trim(), s]));

      const created = [];
      const skipped = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          const supplierName = String(r.supplier ?? r.supplierName ?? r.Supplier ?? '').trim();
          if (!supplierName) throw new Error('Supplier is required.');
          const supplier = byName.get(supplierName.toLowerCase());
          if (!supplier) throw new Error(`No supplier named "${supplierName}" - add them first, or import the supplier list.`);

          const amt = Math.round((Number(r.amount ?? r.Amount) || 0) * 100) / 100;
          if (!(amt > 0)) throw new Error('Amount must be positive.');

          const description = String(r.description ?? r.Description ?? '').trim();
          if (!description) throw new Error('A description is required - what is this bill for?');

          // Which account gets debited when someone approves it. Without this
          // the bill cannot be approved later, so it is required at import
          // rather than discovered as a dead end weeks afterwards.
          const accountCode = String(r.expenseAccountCode ?? r.account ?? r.Account ?? '').trim();
          if (!accountCode || !acctMeta(accountCode)) {
            throw new Error(`"${accountCode || '(blank)'}" is not an account. Give the expense or asset account this bill should be charged to.`);
          }

          const rawDue = r.dueDate ?? r['Due Date'] ?? r.due;
          const dueDate = rawDue ? new Date(rawDue) : null;
          if (dueDate && Number.isNaN(dueDate.getTime())) throw new Error('Invalid due date.');

          const billNumber = await mkSeqRef('BILL');
          await Bill.create({
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            billNumber, supplierId: supplier._id, supplierName: supplier.name,
            source: 'Manual', description: description.slice(0, 500), amount: amt,
            expenseAccountCode: accountCode, dueDate,
            createdBy: req.user?.name || '',
          });
          created.push({ row: i + 1, billNumber, supplier: supplier.name, amount: amt });
        } catch (e) {
          skipped.push({ row: i + 1, error: e.message, data: r });
        }
      }

      await logAudit(req, { action: 'import', entity: 'Bill', entityId: 'bulk', after: { created: created.length, skipped: skipped.length } });
      res.json({
        success: true, created: created.length, skipped, bills: created,
        totalAmount: Math.round(created.reduce((s, b) => s + b.amount, 0) * 100) / 100,
        // Said plainly, because "imported" reads as "done" otherwise.
        note: 'Imported as Pending. Nothing has posted to the ledger - approve each bill to book the payable.',
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── APPROVE ──────────────────────────────────────────────────────────────────
  // For source:'Manual' bills this is what actually books the liability
  // (DR expenseAccountCode / CR 220000 Accounts Payable) - see the BillSchema
  // comment in server.js. For source:'PO' bills the JE already posted at
  // receipt; this is a pure sign-off with no new posting.
  app.post('/api/bills/:id/approve', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const bill = await Bill.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!bill) return res.status(404).json({ success: false, error: 'Not found' });
      if (bill.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending bill can be approved (this one is ${bill.status}).` });

      if (bill.source === 'Manual') {
        const expMeta = acctMeta(bill.expenseAccountCode);
        if (!expMeta) return res.status(400).json({ success: false, error: 'This bill\'s expense account no longer exists - cannot post.' });
        const reference = await mkSeqRef('BILL-APR');
        const lines = [
          { accountCode: bill.expenseAccountCode, accountName: expMeta.name, debit: bill.amount, credit: 0 },
          { accountCode: '220000', accountName: 'Accounts Payable', debit: 0, credit: bill.amount },
        ];
        assertBalanced(lines, reference);
        await JournalEntry.create({
          date: new Date(), reference,
          description: `Bill approved: ${bill.description} (${bill.billNumber})`,
          lines, totalDebit: bill.amount, totalCredit: bill.amount,
          supplierId: String(bill.supplierId), supplierName: bill.supplierName,
        });
        bill.journalEntryRef = reference;
        emitToMgr('erpUpdated');
      }

      bill.status = 'Approved';
      bill.approvedBy = req.user?.name || '';
      bill.approvedAt = new Date();
      await bill.save();

      await logAudit(req, { action: 'approve', entity: 'Bill', entityId: bill._id, after: { billNumber: bill.billNumber, approvedBy: bill.approvedBy } });
      res.json({ success: true, bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── REJECT ───────────────────────────────────────────────────────────────────
  // Note: for source:'PO' bills, rejecting does NOT reverse the receipt's
  // journal entry - goods were physically received, so that liability is real.
  // A rejected PO bill records a dispute for follow-up, not an automatic
  // reversal; correcting the books (e.g. a damaged/short delivery) still goes
  // through a normal journal entry or the PO void path.
  app.post('/api/bills/:id/reject', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { reason } = req.body || {};
      if (!reason?.trim()) return res.status(400).json({ success: false, error: 'A reason is required to reject a bill.' });
      const bill = await Bill.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!bill) return res.status(404).json({ success: false, error: 'Not found' });
      if (bill.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending bill can be rejected (this one is ${bill.status}).` });

      bill.status = 'Rejected';
      bill.rejectedBy = req.user?.name || '';
      bill.rejectedAt = new Date();
      bill.rejectionReason = reason.trim().slice(0, 500);
      await bill.save();

      await logAudit(req, { action: 'reject', entity: 'Bill', entityId: bill._id, after: { billNumber: bill.billNumber, reason: bill.rejectionReason } });
      res.json({ success: true, bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SCHEDULE PAYMENT ─────────────────────────────────────────────────────────
  // PATCH /api/bills/:id/schedule { scheduledPaymentDate }  (null clears it)
  app.patch('/api/bills/:id/schedule', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const bill = await Bill.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!bill) return res.status(404).json({ success: false, error: 'Not found' });
      if (bill.status !== 'Approved') return res.status(409).json({ success: false, error: 'Only an Approved bill can have a payment scheduled.' });

      const { scheduledPaymentDate } = req.body || {};
      bill.scheduledPaymentDate = scheduledPaymentDate ? new Date(scheduledPaymentDate) : null;
      await bill.save();
      res.json({ success: true, bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── PAY ──────────────────────────────────────────────────────────────────────
  // Records a payment against THIS bill specifically (DR 220000 AP / CR the
  // cash/bank/e-wallet account paid from) - same shape as the existing
  // /api/finance/ap-payment, just scoped and attributed to one bill instead of a
  // supplier's running balance. Both post to the same 220000 ledger, so
  // ap-outstanding/vendor-statement see this payment either way.
  //
  // Partial payment: `amount` defaults to the full remaining balance (the old
  // always-pay-in-full behavior), but can be less - the bill then moves to
  // 'Partially Paid' instead of 'Paid', same shape as A/R settlement.
  //
  // Overpayment: if `amount` exceeds what's actually still owed, the excess
  // is diverted to the supplier's creditBalance (160100 Supplier Credit
  // Balance) instead of overstating what this bill collected - never
  // silently lost, never double-counted against the bill itself.
  //
  // Every payment - full, partial, or with an overpay split - issues a
  // Check Voucher, the actual paper trail for the disbursement.
  app.post('/api/bills/:id/pay', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const bill = await Bill.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!bill) return res.status(404).json({ success: false, error: 'Not found' });
      if (!['Approved', 'Partially Paid'].includes(bill.status)) {
        return res.status(409).json({ success: false, error: `Only an Approved or Partially Paid bill can be paid (this one is ${bill.status}).` });
      }

      const outstanding = money(bill.amount - (bill.paidAmount || 0));
      if (outstanding <= 0) return res.status(409).json({ success: false, error: 'This bill is already fully paid.' });

      const isCashLike = (c) => /^(111|112|113)/.test(String(c || ''));
      const { amount, payFromAccount, referenceNumber } = req.body || {};
      const paidAmt = money(amount !== undefined && amount !== null && amount !== '' ? amount : outstanding);
      if (!paidAmt || paidAmt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });

      const applied = Math.min(paidAmt, outstanding);
      const overpay = money(paidAmt - applied);

      const srcMeta = acctMeta(payFromAccount);
      const srcCode = (srcMeta && isCashLike(payFromAccount)) ? payFromAccount : '111000';
      const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';

      const reference = await mkSeqRef('BILL-PAY');
      const lines = [
        { accountCode: '220000', accountName: 'Accounts Payable', debit: applied, credit: 0 },
      ];
      if (overpay > 0) {
        lines.push({ accountCode: '160100', accountName: 'Supplier Credit Balance (Overpayments)', debit: overpay, credit: 0 });
      }
      lines.push({ accountCode: srcCode, accountName: srcName, debit: 0, credit: paidAmt });
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: new Date(), reference,
        description: `Payment for bill ${bill.billNumber} (${bill.description || bill.poNumber || bill.supplierName})${overpay > 0 ? ` - includes ₱${overpay.toFixed(2)} overpayment (credited to supplier)` : ''}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: paidAmt, totalCredit: paidAmt,
        supplierId: String(bill.supplierId), supplierName: bill.supplierName,
      });

      const voucherNumber = await mkSeqRef('CV');
      const voucher = await CheckVoucher.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
        voucherNumber, payeeType: 'supplier', payeeId: String(bill.supplierId), payeeName: bill.supplierName,
        amount: paidAmt, purpose: 'bill-payment', sourceAccount: srcCode, sourceAccountName: srcName,
        referenceNumber: referenceNumber || '', billId: bill._id, journalEntryRef: reference,
        issuedBy: req.user?.name || '',
      });

      bill.paidAmount = money((bill.paidAmount || 0) + applied);
      bill.status = bill.paidAmount >= bill.amount - 0.01 ? 'Paid' : 'Partially Paid';
      bill.paidAt = new Date();
      bill.journalEntryRef = reference;
      bill.paymentReference = referenceNumber || '';
      bill.payments.push({
        amount: paidAmt, payFromAccount: srcCode, referenceNumber: referenceNumber || '',
        checkVoucherRef: voucherNumber, journalRef: reference, paidBy: req.user?.name || '',
      });
      await bill.save();

      if (overpay > 0) {
        await Supplier.updateOne({ _id: bill.supplierId }, {
          $inc: { creditBalance: overpay },
          $push: { creditHistory: { type: 'overpayment', amount: overpay, billId: bill._id, billNumber: bill.billNumber, reference, note: 'Overpayment on bill settlement', by: req.user?.name || '' } },
        });
      }

      await AuditLog.create({
        userId: req.user?.name || 'System', action: 'BILL_PAID', targetReference: bill.billNumber,
        details: { amount: paidAmt, applied, overpay, payFromAccount: srcCode, referenceNumber: referenceNumber || '', voucherNumber, supplierId: String(bill.supplierId), recordedBy: req.user?.name },
      });
      emitToMgr('erpUpdated');
      res.json({ success: true, bill, voucher, overpay });
    } catch (err) {
      log.error({ err }, 'POST /api/bills/:id/pay failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── SUPPLIER CREDIT: apply to a bill ────────────────────────────────────────
  // Reclassifies stored supplier credit (160100, an asset - they owe it to
  // us) directly against a bill's outstanding balance. No cash moves; this is
  // purely "use what they already owe us instead of paying more cash out."
  app.post('/api/suppliers/:id/credit/apply', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Supplier not found.' });
      const supplier = await Supplier.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });

      const { billId, amount, referenceNumber, note } = req.body || {};
      if (!billId || !mongoose.Types.ObjectId.isValid(billId)) return res.status(400).json({ success: false, error: 'A valid bill is required.' });
      const bill = await Bill.findOne({ _id: billId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!bill) return res.status(404).json({ success: false, error: 'Bill not found.' });
      if (String(bill.supplierId) !== String(supplier._id)) return res.status(400).json({ success: false, error: 'This bill belongs to a different supplier.' });
      if (!['Approved', 'Partially Paid'].includes(bill.status)) {
        return res.status(409).json({ success: false, error: `Only an Approved or Partially Paid bill can take a credit application (this one is ${bill.status}).` });
      }

      const outstanding = money(bill.amount - (bill.paidAmount || 0));
      if (outstanding <= 0) return res.status(409).json({ success: false, error: 'This bill is already fully paid.' });

      const requested = money(amount !== undefined && amount !== null && amount !== '' ? amount : Math.min(supplier.creditBalance, outstanding));
      if (!requested || requested <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });
      if (requested > supplier.creditBalance + 0.01) return res.status(400).json({ success: false, error: `Only ₱${supplier.creditBalance.toFixed(2)} of credit is available.` });
      if (requested > outstanding + 0.01) return res.status(400).json({ success: false, error: `Cannot apply more than the bill's outstanding balance (₱${outstanding.toFixed(2)}).` });

      const reference = await mkSeqRef('SUP-CR-APPLY');
      const lines = [
        { accountCode: '220000', accountName: 'Accounts Payable', debit: requested, credit: 0 },
        { accountCode: '160100', accountName: 'Supplier Credit Balance (Overpayments)', debit: 0, credit: requested },
      ];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: new Date(), reference,
        description: `Supplier credit applied to bill ${bill.billNumber} (${supplier.name})${note ? ` - ${note}` : ''}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: requested, totalCredit: requested,
        supplierId: String(supplier._id), supplierName: supplier.name,
      });

      bill.paidAmount = money((bill.paidAmount || 0) + requested);
      bill.status = bill.paidAmount >= bill.amount - 0.01 ? 'Paid' : 'Partially Paid';
      bill.paidAt = new Date();
      bill.journalEntryRef = reference;
      bill.payments.push({ amount: requested, payFromAccount: '160100', referenceNumber: referenceNumber || 'Supplier credit applied', journalRef: reference, paidBy: req.user?.name || '' });
      await bill.save();

      supplier.creditBalance = money(supplier.creditBalance - requested);
      supplier.creditHistory.push({ type: 'applied', amount: requested, billId: bill._id, billNumber: bill.billNumber, reference, note: note || 'Applied to bill', by: req.user?.name || '' });
      await supplier.save();

      await logAudit(req, { action: 'apply-credit', entity: 'Supplier', entityId: supplier._id, after: { billNumber: bill.billNumber, amount: requested } });
      emitToMgr('erpUpdated');
      res.json({ success: true, bill, supplier: { _id: supplier._id, creditBalance: supplier.creditBalance } });
    } catch (err) {
      log.error({ err }, 'POST /api/suppliers/:id/credit/apply failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
