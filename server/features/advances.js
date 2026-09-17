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
import { arBalance, isFullySettled } from '../lib/credit.js';

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
    ClientAccount,
    CheckVoucher,
    issueCheckVoucher,
    JournalEntry,
    assertBalanced,
    acctMeta,
    mkSeqRef,
    currentBranchCode,
    periodLockFor,
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
      if (req.query.clientId) q.clientId = String(req.query.clientId);
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
      const { type, payeeId, amount, purpose, sourceAccount, referenceNumber, date, clientId: rawClientId } = req.body || {};
      let { payeeName } = req.body || {};
      // When the money actually moved. An advance is usually recorded after
      // the fact - the cash left on Friday, someone files it on Monday - so
      // stamping 'now' puts it in the wrong period and the ledger stops
      // matching the bank. Defaults to today when not supplied.
      const txnDate = date ? dayStart(date) : new Date();
      if (Number.isNaN(txnDate.getTime())) return res.status(400).json({ success: false, error: 'Invalid transaction date.' });
      // The transaction date is the whole point of this field, so it is also
      // the way into a month that has already been closed and reported.
      const lock = await periodLockFor(txnDate);
      if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed. Reopen the period first.` });
      if (!ADVANCE_TYPES.includes(type)) return res.status(400).json({ success: false, error: `type must be one of: ${ADVANCE_TYPES.join(', ')}.` });
      // A customer deposit can be tied to a client account. The client's name
      // then becomes the payee, so the two can never disagree.
      let client = null;
      if (rawClientId) {
        if (type !== 'customer') return res.status(400).json({ success: false, error: 'Only a customer deposit can be linked to a client account.' });
        if (!mongoose.Types.ObjectId.isValid(rawClientId)) return res.status(400).json({ success: false, error: 'Client not found.' });
        client = await ClientAccount.findOne({ _id: rawClientId, ...tenantScope(req) }, { name: 1 }).lean();
        if (!client) return res.status(400).json({ success: false, error: 'Client not found.' });
        payeeName = client.name;
      }
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
        date: txnDate, reference,
        description: `${inbound ? 'Advance received from' : 'Advance to'} ${payeeName}${purpose ? ` - ${purpose}` : ''}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      // Money handed out ahead of the transaction still leaves the drawer, so
      // it is documented like any other disbursement. An INBOUND advance (a
      // customer's deposit) is money arriving - there is nothing to disburse.
      const voucher = inbound ? null : await issueCheckVoucher(req, {
        payeeType: type === 'supplier' ? 'supplier' : 'other',
        payeeId, payeeName,
        amount: amt, purpose: 'advance',
        sourceAccount: srcCode, date: txnDate,
        referenceNumber,
        notes: `Advance ${advanceNumber}${purpose ? ` - ${purpose}` : ''}`,
        journalEntryRef: reference,
      });

      const advance = await Advance.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
        advanceNumber, type, payeeName: String(payeeName).trim(), payeeId: String(payeeId || ''),
        clientId: client ? String(client._id) : '',
        amount: amt, purpose: purpose || '', account: ctl.code,
        sourceAccount: srcCode, sourceAccountName: srcName,
        referenceNumber: referenceNumber || '', journalEntryRef: reference,
        checkVoucherRef: voucher?.voucherNumber || '',
        date: txnDate,
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
  // An order liquidation also records a payment on the order itself (the same
  // way applying client credit does). Crediting 120000 without moving the
  // order's arPaidAmount left the A/R screens showing the full balance while
  // the ledger said it was partly paid - the two stopped agreeing.
  // A bill liquidation does the same for the bill: it records a payment, so the
  // A/P aging and the bill's own status agree with 220000.
  app.post('/api/advances/:id/liquidate', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const advance = await Advance.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!advance) return res.status(404).json({ success: false, error: 'Not found' });
      if (advance.status === 'Cancelled') return res.status(409).json({ success: false, error: 'This advance was cancelled.' });

      const outstanding = outstandingOf(advance);
      if (outstanding <= 0) return res.status(409).json({ success: false, error: 'This advance is already fully liquidated.' });

      const { method, amount, expenseAccount, billId, orderId, note, referenceNumber, returnToAccount, date } = req.body || {};
      // Same reasoning as issuing: a liquidation filed on Monday for a
      // Friday receipt belongs in Friday's period.
      const txnDate = date ? dayStart(date) : new Date();
      if (Number.isNaN(txnDate.getTime())) return res.status(400).json({ success: false, error: 'Invalid transaction date.' });
      // The transaction date is the whole point of this field, so it is also
      // the way into a month that has already been closed and reported.
      const lock = await periodLockFor(txnDate);
      if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed. Reopen the period first.` });
      const validMethods = advance.type === 'customer' ? ['order', 'cash-return'] : ['expense', 'bill', 'cash-return'];
      if (!validMethods.includes(method)) {
        return res.status(400).json({ success: false, error: `method for a ${advance.type} advance must be one of: ${validMethods.join(', ')}.` });
      }
      const amountGiven = amount !== undefined && amount !== null && amount !== '';
      let amt = money(amountGiven ? amount : outstanding);
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
        // Only an approved bill has booked its payable; paying a pending one
        // would drive 220000 below what is actually owed.
        if (!['Approved', 'Partially Paid'].includes(bill.status)) {
          return res.status(409).json({ success: false, error: `Only an Approved or Partially Paid bill can be settled (this one is ${bill.status}).` });
        }
        const billOwes = money(bill.amount - (bill.paidAmount || 0));
        if (billOwes <= 0) return res.status(409).json({ success: false, error: 'This bill is already fully paid.' });
        if (!amountGiven) amt = money(Math.min(outstanding, billOwes));
        if (amt > billOwes + 0.01) return res.status(400).json({ success: false, error: `Cannot apply more than the bill's outstanding balance (P${billOwes.toFixed(2)}).` });
        contra = { code: '220000', name: 'Accounts Payable' };
      } else if (method === 'order') {
        if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, error: 'A valid orderId is required.' });
        order = await Order.findOne({ _id: orderId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
        if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
        // Only a completed on-account sale has a receivable to relieve. A cash
        // sale never touched 120000, and an unfinished order has not posted its
        // receivable yet - crediting A/R for either would drive it negative.
        if (order.status !== 'Completed') return res.status(400).json({ success: false, error: 'The order must be Completed before a deposit can be applied to it.' });
        if (order.paymentMethod === 'Cash' || order.isComplimentary) return res.status(400).json({ success: false, error: 'This order has no receivable to apply a deposit against.' });
        const orderClient = String(order.clientId || order.clientAccountId || '');
        if (advance.clientId && orderClient !== advance.clientId) {
          return res.status(400).json({ success: false, error: `This deposit belongs to ${advance.payeeName} - apply it to one of their orders.` });
        }
        const orderOwes = arBalance(order);
        if (orderOwes <= 0) return res.status(409).json({ success: false, error: 'This order has no outstanding balance.' });
        // No amount given = use as much of the deposit as this order can take.
        if (!amountGiven) amt = money(Math.min(outstanding, orderOwes));
        if (amt > orderOwes + 0.01) return res.status(400).json({ success: false, error: `Cannot apply more than the order's outstanding balance (P${orderOwes.toFixed(2)}).` });
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
        date: txnDate, reference,
        description: `Liquidation of advance ${advance.advanceNumber} (${advance.payeeName}) via ${method}${note ? ` - ${note}` : ''}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      if (bill) {
        bill.paidAmount = money((bill.paidAmount || 0) + amt);
        bill.status = bill.paidAmount >= bill.amount - 0.01 ? 'Paid' : 'Partially Paid';
        bill.paidAt = txnDate;
        bill.journalEntryRef = reference;
        bill.payments.push({
          amount: amt, payFromAccount: ctl.code,
          referenceNumber: referenceNumber || `Advance ${advance.advanceNumber} applied`,
          journalRef: reference, paidBy: req.user?.name || '',
        });
        await bill.save();
      }

      if (order) {
        order.arPayments.push({
          amount: amt, paymentMethod: 'Customer Deposit',
          referenceNumber: referenceNumber || advance.advanceNumber,
          note: note || `Deposit ${advance.advanceNumber} applied`,
          collectionDate: txnDate, depositDate: txnDate,
          recordedBy: req.user?.name || '', journalRef: reference,
        });
        order.arPaidAmount = money((order.arPaidAmount || 0) + amt);
        order.arSettled = isFullySettled(order);
        order.arSettledAt = txnDate;
        order.arSettledAmount = order.arPaidAmount;
        order.arSettledMethod = 'Customer Deposit';
        order.arSettledReference = referenceNumber || advance.advanceNumber;
        await order.save();
      }

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
