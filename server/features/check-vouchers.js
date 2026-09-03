// check-vouchers routes - the actual paper trail for a disbursement.
// Created automatically by /api/bills/:id/pay and
// /api/client-accounts/:id/credit/refund (see bills.js / orders.js); this
// module is just the read/void side - the printable/filable record and a
// way to mark one Voided if it was issued in error (does NOT reverse the
// underlying journal entry - that's a separate, deliberate correction).
import { captureError } from '../lib/errorLog.js';

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
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  const canViewAcct = [requireStaff, requirePermission('accounting.view')];
  const canPostAcct = [requireStaff, requirePermission('accounting.manage')];

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/check-vouchers', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.payeeType && ['supplier', 'client', 'other'].includes(req.query.payeeType)) q.payeeType = req.query.payeeType;
      if (req.query.status && ['Issued', 'Voided'].includes(req.query.status)) q.status = req.query.status;
      if (req.query.start || req.query.end) {
        q.date = {};
        if (req.query.start) q.date.$gte = new Date(req.query.start);
        if (req.query.end) { const e = new Date(req.query.end); e.setHours(23, 59, 59, 999); q.date.$lte = e; }
      }
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const vouchers = await CheckVoucher.find(q).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
      const total = vouchers.filter(v => v.status === 'Issued').reduce((s, v) => s + v.amount, 0);
      res.json({ success: true, vouchers, total: +total.toFixed(2) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
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
