// advances routes - money that changed hands BEFORE the transaction it belongs
// to exists (see AdvanceSchema in server.js for the three shapes and their
// accounts). Issue puts cash out (or takes a deposit in); liquidation clears it
// against whatever it was actually for; cancel returns it.
//
// Every advance keeps its own running liquidatedAmount, so a P5,000 staff
// advance can be cleared by a P3,200 expense liquidation and a P1,800 cash
// return without either step needing to know about the other.
//
// Every posting route accepts a referenceNumber (the real-world document: OR
// number, check number, deposit slip) and a free-text note/remarks, and both
// are carried onto the journal entry description so the ledger says WHY.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';

export default function registerAdvances(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    log,
    tenantScope,
    logAudit,
    BUSINESS_TYPE,
    Advance,
    ADVANCE_TYPES,
    ADVANCE_ACCOUNTS,
    Bill,
    Order,
    CheckVoucher,
    JournalEntry,
    assertBalanced,
    acctMeta,
    mkSeqRef,
    currentBranchCode,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  const canViewAcct = [requireStaff, requirePermission('accounting.view')];
  const canPostAcct = [requireStaff, requirePermission('accounting.manage')];

  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const isCashLike = (c) => /^(111|112|113|114)/.test(String(c || ''));
  const outstandingOf = (a) => money(a.amount - (a.liquidatedAmount || 0));
  // Status is always derived, never set by hand, so it cannot drift from the
  // numbers it describes.
  const statusFor = (a) => {
    if (a.status === 'Cancelled') return 'Cancelled';
    if ((a.liquidatedAmount || 0) >= a.amount - 0.01) return 'Liquidated';
    return (a.liquidatedAmount || 0) > 0 ? 'Partially Liquidated' : 'Open';
  };

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/advances', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (ADVANCE_TYPES.includes(req.query.type)) q.type = req.query.type;
      if (req.query.status) q.status = req.query.status;
      if (req.query.start || req.query.end) {
        q.date = {};
        // dayStart/dayEnd, not new Date(): a bare YYYY-MM-DD is parsed by JS as
        // UTC midnight while setHours() works in local time, so mixing them
        // gave a window of local 08:00-23:59 in UTC+8 and silently dropped
        // everything recorded before 8am. Both bounds must share one basis.
        if (req.query.start) q.date.$gte = dayStart(req.query.start);
        if (req.query.end) q.date.$lte = dayEnd(req.query.end);
      }
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const advances = await Advance.find(q).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
      // Outstanding excludes Cancelled - a cancelled advance is not money we
      // are still waiting to see cleared.
      const live = advances.filter(a => a.status !== 'Cancelled');
      res.json({
        success: true,
        advances: advances.map(a => ({ ...a, outstanding: outstandingOf(a) })),
        totalIssued: money(live.reduce((s, a) => s + a.amount, 0)),
        totalOutstanding: money(live.reduce((s, a) => s + outstandingOf(a), 0)),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SINGLE ───────────────────────────────────────────────────────────────────
  app.get('/api/advances/:id', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const advance = await Advance.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!advance) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, advance: { ...advance, outstanding: outstandingOf(advance) } });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── ISSUE ────────────────────────────────────────────────────────────────────
  // employee/supplier: real cash leaves, so this issues a Check Voucher exactly
  // like a bill payment does. customer: cash comes IN, so no voucher - the
  // deposit is a liability, not a disbursement.
  app.post('/api/advances', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      const { type, payeeName, payeeId, amount, purpose, sourceAccount, referenceNumber } = req.body || {};
      if (!ADVANCE_TYPES.includes(type)) return res.status(400).json({ success: false, error: `type must be one of: ${ADVANCE_TYPES.join(', ')}.` });
      if (!String(payeeName || '').trim()) return res.status(400).json({ success: false, error: 'A payee name is required.' });
      const amt = money(amount);
      if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });

      const ctl = ADVANCE_ACCOUNTS[type];
      const srcCode = (acctMeta(sourceAccount) && isCashLike(sourceAccount)) ? sourceAccount : '111000';
      const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';

      const advanceNumber = await mkSeqRef('ADV');
      const reference = await mkSeqRef('ADV-JE');
      // customer advances take cash IN; the other two pay cash OUT.
      const inbound = type === 'customer';
      const lines = inbound
        ? [{ accountCode: srcCode, accountName: srcName, debit: amt, credit: 0 },
           { accountCode: ctl.code, accountName: ctl.name, debit: 0, credit: amt }]
        : [{ accountCode: ctl.code, accountName: ctl.name, debit: amt, credit: 0 },
           { accountCode: srcCode, accountName: srcName, debit: 0, credit: amt }];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: new Date(), reference,
        description: `${inbound ? 'Advance received from' : 'Advance to'} ${payeeName}${purpose ? ` - ${purpose}` : ''}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      let voucher = null;
      if (!inbound) {
        const voucherNumber = await mkSeqRef('CV');
        voucher = await CheckVoucher.create({
          businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
          voucherNumber,
          payeeType: type === 'supplier' ? 'supplier' : 'other',
          payeeId: String(payeeId || ''), payeeName,
          amount: amt, purpose: 'other',
          sourceAccount: srcCode, sourceAccountName: srcName,
          referenceNumber: referenceNumber || '',
          notes: `Advance ${advanceNumber}${purpose ? ` - ${purpose}` : ''}`,
          journalEntryRef: reference, issuedBy: req.user?.name || '',
        });
      }

      const advance = await Advance.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
        advanceNumber, type, payeeName: String(payeeName).trim(), payeeId: String(payeeId || ''),
        amount: amt, purpose: purpose || '', account: ctl.code,
        sourceAccount: srcCode, sourceAccountName: srcName,
        referenceNumber: referenceNumber || '', journalEntryRef: reference,
        checkVoucherRef: voucher?.voucherNumber || '',
        issuedBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'Advance', entityId: advance._id, after: { advanceNumber, type, payeeName, amount: amt } });
      res.json({ success: true, advance: { ...advance.toObject(), outstanding: amt }, voucher });
    } catch (err) {
      log.error?.({ err }, 'POST /api/advances failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── LIQUIDATE ────────────────────────────────────────────────────────────────
  // Clears part (or all) of an advance against what it was actually for. The
  // advance's control account is always the side that shrinks; `method` picks
  // what sits opposite it:
  //
  //   expense      staff spent it          DR expense  / CR 170100
  //   cash-return  staff gave it back      DR cash     / CR 170100
  //   bill         applied to a payable    DR 220000   / CR 170200
  //   order        applied to a receivable DR 260200   / CR 120000
  //
  // Deliberately does NOT touch the Bill's paidAmount or the Order's
  // arPaidAmount: applying an advance settles the ledger position, and the
  // document's own payment history is a separate, explicit action.
  app.post('/api/advances/:id/liquidate', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const advance = await Advance.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!advance) return res.status(404).json({ success: false, error: 'Not found' });
      if (advance.status === 'Cancelled') return res.status(409).json({ success: false, error: 'This advance was cancelled.' });

      const outstanding = outstandingOf(advance);
      if (outstanding <= 0) return res.status(409).json({ success: false, error: 'This advance is already fully liquidated.' });

      const { method, amount, expenseAccount, billId, orderId, note, referenceNumber, returnToAccount } = req.body || {};
      const validMethods = advance.type === 'customer' ? ['order', 'cash-return'] : ['expense', 'bill', 'cash-return'];
      if (!validMethods.includes(method)) {
        return res.status(400).json({ success: false, error: `method for a ${advance.type} advance must be one of: ${validMethods.join(', ')}.` });
      }
      const amt = money(amount !== undefined && amount !== null && amount !== '' ? amount : outstanding);
      if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });
      if (amt > outstanding + 0.01) {
        return res.status(400).json({ success: false, error: `Amount exceeds what is left on this advance (P${outstanding.toFixed(2)} of P${advance.amount.toFixed(2)}).` });
      }

      const ctl = ADVANCE_ACCOUNTS[advance.type];
      let contra = null;
      let bill = null, order = null;

      if (method === 'expense') {
        const meta = acctMeta(expenseAccount);
        if (!meta || meta.type !== 'expense') return res.status(400).json({ success: false, error: 'A valid expense account is required to liquidate against an expense.' });
        contra = { code: expenseAccount, name: meta.name };
      } else if (method === 'cash-return') {
        const back = (acctMeta(returnToAccount) && isCashLike(returnToAccount)) ? returnToAccount : '111000';
        contra = { code: back, name: acctMeta(back)?.name || 'Cash on Hand' };
      } else if (method === 'bill') {
        if (!mongoose.Types.ObjectId.isValid(billId)) return res.status(400).json({ success: false, error: 'A valid billId is required.' });
        bill = await Bill.findOne({ _id: billId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
        if (!bill) return res.status(404).json({ success: false, error: 'Bill not found.' });
        contra = { code: '220000', name: 'Accounts Payable' };
      } else if (method === 'order') {
        if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, error: 'A valid orderId is required.' });
        order = await Order.findOne({ _id: orderId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
        if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
        contra = { code: '120000', name: 'Accounts Receivable' };
      }

      const reference = await mkSeqRef('ADV-LIQ');
      // A customer advance is a liability, so clearing it DEBITS the control
      // account. The asset advances credit theirs. Either way the advance
      // shrinks and the contra account takes the other side.
      const inbound = advance.type === 'customer';
      const lines = inbound
        ? [{ accountCode: ctl.code, accountName: ctl.name, debit: amt, credit: 0 },
           { accountCode: contra.code, accountName: contra.name, debit: 0, credit: amt }]
        : [{ accountCode: contra.code, accountName: contra.name, debit: amt, credit: 0 },
           { accountCode: ctl.code, accountName: ctl.name, debit: 0, credit: amt }];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: new Date(), reference,
        description: `Liquidation of advance ${advance.advanceNumber} (${advance.payeeName}) via ${method}${note ? ` - ${note}` : ''}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      advance.liquidatedAmount = money((advance.liquidatedAmount || 0) + amt);
      advance.status = statusFor(advance);
      advance.liquidations.push({
        amount: amt, method,
        expenseAccount: method === 'expense' ? expenseAccount : '',
        billId: bill?._id || null, orderId: order?._id || null,
        reference: referenceNumber || '', journalRef: reference,
        note: note || '', by: req.user?.name || '',
      });
      await advance.save();

      await logAudit(req, { action: 'update', entity: 'Advance', entityId: advance._id, after: { advanceNumber: advance.advanceNumber, method, amount: amt, status: advance.status } });
      res.json({ success: true, advance: { ...advance.toObject(), outstanding: outstandingOf(advance) } });
    } catch (err) {
      log.error?.({ err }, 'POST /api/advances/:id/liquidate failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── CANCEL ───────────────────────────────────────────────────────────────────
  // Reverses the ORIGINAL issue entry and closes the advance. Only allowed
  // while nothing has been liquidated yet - once part of it has been spent or
  // applied, the remainder has to be cleared through liquidate (cash-return)
  // instead, so the ledger keeps a record of what actually happened rather
  // than pretending the advance never existed.
  app.post('/api/advances/:id/cancel', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { reason } = req.body || {};
      if (!String(reason || '').trim()) return res.status(400).json({ success: false, error: 'A reason is required to cancel an advance.' });
      const advance = await Advance.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!advance) return res.status(404).json({ success: false, error: 'Not found' });
      if (advance.status === 'Cancelled') return res.status(409).json({ success: false, error: 'This advance is already cancelled.' });
      if ((advance.liquidatedAmount || 0) > 0) {
        return res.status(409).json({ success: false, error: 'Part of this advance has already been liquidated - clear the remainder with a cash return instead of cancelling.' });
      }

      const ctl = ADVANCE_ACCOUNTS[advance.type];
      const amt = money(advance.amount);
      const reference = await mkSeqRef('ADV-CXL');
      const inbound = advance.type === 'customer';
      // Exact mirror of the issue entry.
      const lines = inbound
        ? [{ accountCode: ctl.code, accountName: ctl.name, debit: amt, credit: 0 },
           { accountCode: advance.sourceAccount, accountName: advance.sourceAccountName, debit: 0, credit: amt }]
        : [{ accountCode: advance.sourceAccount, accountName: advance.sourceAccountName, debit: amt, credit: 0 },
           { accountCode: ctl.code, accountName: ctl.name, debit: 0, credit: amt }];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: new Date(), reference,
        description: `Cancellation of advance ${advance.advanceNumber} (${advance.payeeName}) - ${String(reason).trim()}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      advance.status = 'Cancelled';
      advance.cancelledBy = req.user?.name || '';
      advance.cancelledAt = new Date();
      advance.cancelReason = String(reason).trim().slice(0, 500);
      await advance.save();

      await logAudit(req, { action: 'update', entity: 'Advance', entityId: advance._id, after: { advanceNumber: advance.advanceNumber, status: 'Cancelled', reason: advance.cancelReason } });
      res.json({ success: true, advance: { ...advance.toObject(), outstanding: 0 } });
    } catch (err) {
      log.error?.({ err }, 'POST /api/advances/:id/cancel failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
