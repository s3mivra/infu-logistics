// check-vouchers routes - the actual paper trail for a disbursement.
// Created automatically by /api/bills/:id/pay and
// /api/client-accounts/:id/credit/refund (see bills.js / orders.js); this
// module is the read/void side - the printable/filable record and a way to
// mark one Voided if it was issued in error (does NOT reverse the underlying
// journal entry - that's a separate, deliberate correction) - plus a voucher
// written by hand, for a payment nothing else raised one for.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';

export default function registerCheckVouchers(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    log,
    tenantScope,
    logAudit,
    BUSINESS_TYPE,
    CheckVoucher,
    JournalEntry,
    acctMeta,
    mkSeqRef,
    assertBalanced,
    periodLockFor,
    issueCheckVoucher,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  const canViewAcct = [requireStaff, requirePermission('accounting.view')];
  const canPostAcct = [requireStaff, requirePermission('accounting.manage')];

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/check-vouchers', verifyToken, ...canViewAcct, requirePermission('screen.reports.checkvouchers'), async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.payeeType && ['supplier', 'client', 'other'].includes(req.query.payeeType)) q.payeeType = req.query.payeeType;
      if (req.query.status && ['Issued', 'Voided'].includes(req.query.status)) q.status = req.query.status;
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
      const vouchers = await CheckVoucher.find(q).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
      const total = vouchers.filter(v => v.status === 'Issued').reduce((s, v) => s + v.amount, 0);
      res.json({ success: true, vouchers, total: +total.toFixed(2) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── WRITTEN BY HAND ──────────────────────────────────────────────────────────
  // POST /api/check-vouchers
  //   { payeeName, payeeType?, amount, date?, sourceAccount, referenceNumber?,
  //     notes, chargeAccount, alreadyRecorded? }
  // Records the payment as well as documenting it:
  //   DR chargeAccount   CR sourceAccount (cash / bank / e-wallet)
  // unless `alreadyRecorded` - a voucher for a payment the books already hold,
  // which posts nothing (posting it again would count the money out twice).
  const CASH_LIKE = /^(111|112|113|114)/;
  app.post('/api/check-vouchers', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      const b = req.body || {};
      const payeeName = String(b.payeeName || '').trim().slice(0, 120);
      const notes = String(b.notes || '').trim().slice(0, 300);
      const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
      const sourceAccount = String(b.sourceAccount || '');
      const chargeAccount = String(b.chargeAccount || '');
      const alreadyRecorded = b.alreadyRecorded === true;
      if (!payeeName) return res.status(400).json({ success: false, error: 'Who is the voucher payable to?' });
      if (!(amount > 0) || amount > 999_999_999.99) return res.status(400).json({ success: false, error: 'Enter the amount.' });
      if (!notes) return res.status(400).json({ success: false, error: 'Say what the payment is for.' });
      if (!acctMeta(sourceAccount) || !CASH_LIKE.test(sourceAccount)) return res.status(400).json({ success: false, error: 'Pick the cash, bank or e-wallet account it is paid from.' });
      const date = b.date ? new Date(`${String(b.date).slice(0, 10)}T12:00:00`) : new Date();
      if (Number.isNaN(date.getTime())) return res.status(400).json({ success: false, error: 'Invalid date.' });

      let reference = '';
      if (!alreadyRecorded) {
        const charge = acctMeta(chargeAccount);
        if (!charge) return res.status(400).json({ success: false, error: 'Pick the account this payment is charged to.' });
        if (CASH_LIKE.test(chargeAccount)) return res.status(400).json({ success: false, error: 'Charging it to another cash or bank account is a transfer, not a payment - use a fund transfer.' });
        const lock = await periodLockFor(date);
        if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed.` });
        reference = await mkSeqRef('CV-JE');
        const lines = [
          { accountCode: chargeAccount, accountName: charge.name, debit: amount, credit: 0 },
          { accountCode: sourceAccount, accountName: acctMeta(sourceAccount).name, debit: 0, credit: amount },
        ];
        assertBalanced(lines, reference);
        await JournalEntry.create({
          date, reference, lines, totalDebit: amount, totalCredit: amount,
          description: `Check voucher - ${payeeName}: ${notes}${b.referenceNumber ? ` [ref: ${String(b.referenceNumber).trim().slice(0, 60)}]` : ''}`,
        });
      }
      const voucher = await issueCheckVoucher(req, {
        payeeType: ['supplier', 'client', 'other'].includes(b.payeeType) ? b.payeeType : 'other',
        payeeName, amount, purpose: 'other', sourceAccount,
        referenceNumber: String(b.referenceNumber || '').trim().slice(0, 60),
        notes: alreadyRecorded ? `${notes} (document only - payment already in the books)` : notes,
        journalEntryRef: reference, date,
      });
      if (!voucher) return res.status(500).json({ success: false, error: `The voucher could not be written${reference ? ` - the payment was posted as ${reference}; do not enter it again` : ''}.` });
      await logAudit(req, { action: 'create', entity: 'CheckVoucher', entityId: voucher._id, after: { voucherNumber: voucher.voucherNumber, payeeName, amount, sourceAccount, chargeAccount: alreadyRecorded ? '' : chargeAccount, journalEntryRef: reference } });
      res.json({ success: true, voucher, journalReference: reference });
    } catch (err) {
      log.error?.({ err }, 'POST /api/check-vouchers failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── SINGLE ───────────────────────────────────────────────────────────────────
  app.get('/api/check-vouchers/:id', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const voucher = await CheckVoucher.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!voucher) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, voucher });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── VOID ─────────────────────────────────────────────────────────────────────
  // Marks the voucher itself Voided (e.g. it was printed wrong, or issued
  // against the wrong payee). Deliberately does NOT touch the JournalEntry,
  // Bill, or credit balance it's tied to - those need their own explicit
  // correction (a reversing entry, re-opening the bill, etc.) since a real
  // check may already be in someone's hands.
  app.post('/api/check-vouchers/:id/void', verifyToken, ...canPostAcct, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { reason } = req.body || {};
      if (!reason?.trim()) return res.status(400).json({ success: false, error: 'A reason is required to void a voucher.' });
      const voucher = await CheckVoucher.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!voucher) return res.status(404).json({ success: false, error: 'Not found' });
      if (voucher.status !== 'Issued') return res.status(409).json({ success: false, error: `Only an Issued voucher can be voided (this one is ${voucher.status}).` });

      voucher.status = 'Voided';
      voucher.voidedBy = req.user?.name || '';
      voucher.voidedAt = new Date();
      voucher.voidReason = reason.trim().slice(0, 500);
      await voucher.save();

      await logAudit(req, { action: 'void', entity: 'CheckVoucher', entityId: voucher._id, after: { voucherNumber: voucher.voucherNumber, reason: voucher.voidReason } });
      res.json({ success: true, voucher });
    } catch (err) {
      log.error?.({ err }, 'POST /api/check-vouchers/:id/void failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
