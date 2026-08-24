// requisitions routes - #Req-1: request -> approve/reject -> movement, for the
// two flows that can move stock/funds: raising a Purchase Order and
// disbursing from a Revolving Fund. Neither happens directly anymore (see the
// break-glass superadmin routes left in purchase-orders.js / finance.js) -
// both go through here first, so every movement has a named requester and a
// named approver on record before it commences.
//
// Registered AFTER purchase-orders.js and finance.js (see server.js) - both of
// those attach their creation/disbursement logic onto ctx as they register
// (ctx.createPurchaseOrder / ctx.disburseFromFund), which is what the approve
// route below calls once a slip is approved.
import { captureError } from '../lib/errorLog.js';

export default function registerRequisitions(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    BUSINESS_TYPE,
    tenantScope,
    mkSeqRef,
    logAudit,
    emitToMgr,
    hasPermission,
    RequisitionSlip,
    REQUISITION_STATUSES,
    REQUISITION_TYPES,
    verifyToken,
    requireStaff,
    requirePermission,
    createPurchaseOrder,
    disburseFromFund,
  } = ctx;

  const canApprove = [requireStaff, requirePermission('accounting.manage')];

  // ── LIST ────────────────────────────────────────────────────────────────────
  // GET /api/requisitions?status=Pending&type=purchase_order
  // Gated per type, not just requireStaff - a fund_disbursement requisition
  // carries amounts/descriptions of actual cash movements, which shouldn't be
  // any staff's to browse just because they're logged in. type='purchase_order'
  // needs the same procurement.view the Procurement tab itself requires;
  // type='fund_disbursement' (and the unfiltered "both types" query the
  // Approvals inbox uses) needs accounting.manage - the same permission that
  // gates the Approvals tab's nav entry and the approve/reject routes below.
  app.get('/api/requisitions', verifyToken, requireStaff, async (req, res) => {
    try {
      const { status, type } = req.query;
      if (type && !REQUISITION_TYPES.includes(type)) {
        return res.status(400).json({ success: false, error: `type must be one of: ${REQUISITION_TYPES.join(', ')}` });
      }
      if (type === 'purchase_order' && !hasPermission(req.user, 'procurement.view')) {
        return res.status(403).json({ success: false, error: 'Forbidden: procurement.view required.' });
      }
      if ((type === 'fund_disbursement' || !type) && !hasPermission(req.user, 'accounting.manage')) {
        return res.status(403).json({ success: false, error: 'Forbidden: accounting.manage required.' });
      }
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (status && REQUISITION_STATUSES.includes(status)) q.status = status;
      if (type) q.type = type;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const requisitions = await RequisitionSlip.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      res.json({ success: true, requisitions });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ──────────────────────────────────────────────────────────────────
  // POST /api/requisitions
  //   type: 'purchase_order' - { poPayload: { supplier, supplierId?, supplierRef?, expectedDate?, notes?, lines:[...] } }
  //     requires procurement.manage - same gate the old direct PO-create route had.
  //   type: 'fund_disbursement' - { fundId, amount, description, categoryCode? }
  //     requires only requireStaff - matches the old disburse route's "any staff,
  //     they need to log what they spend" gate. The approval step is the new gate.
  app.post('/api/requisitions', verifyToken, requireStaff, async (req, res) => {
    try {
      const { type } = req.body || {};
      if (!REQUISITION_TYPES.includes(type)) {
        return res.status(400).json({ success: false, error: `type must be one of: ${REQUISITION_TYPES.join(', ')}` });
      }

      const reqNumber = await mkSeqRef('REQ');
      const base = {
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        reqNumber, type, status: 'Pending',
        requestedBy: req.user?.name || '', requestedAt: new Date(),
      };

      if (type === 'purchase_order') {
        if (!hasPermission(req.user, 'procurement.manage')) {
          return res.status(403).json({ success: false, error: 'Forbidden: procurement.manage required to request a purchase order.' });
        }
        const { poPayload } = req.body || {};
        const lines = Array.isArray(poPayload?.lines) ? poPayload.lines.filter(l => l?.itemName && Number(l?.orderedQty) > 0) : [];
        if (lines.length === 0) {
          return res.status(400).json({ success: false, error: 'A purchase order needs at least one line with a name and quantity.' });
        }
        base.poPayload = { ...poPayload, lines };
      } else {
        const { fundId, amount, description, categoryCode } = req.body || {};
        if (!fundId || !mongoose.Types.ObjectId.isValid(String(fundId))) {
          return res.status(400).json({ success: false, error: 'A valid fundId is required.' });
        }
        const amt = Number(amount);
        if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be a positive number.' });
        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description is required.' });
        base.fundId = fundId;
        base.amount = amt;
        base.description = String(description).trim().slice(0, 500);
        base.categoryCode = categoryCode || '';
      }

      const requisition = await RequisitionSlip.create(base);
      logAudit?.(req, { action: 'create', entity: 'requisition', entityId: reqNumber, after: { type, requestedBy: base.requestedBy } });
      res.status(201).json({ success: true, requisition });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── APPROVE ─────────────────────────────────────────────────────────────────
  // Actually performs the movement - creates the PO or disburses the fund -
  // using the exact same logic the old direct routes ran, just gated behind
  // this approval instead of firing on the original request.
  app.post('/api/requisitions/:id/approve', verifyToken, ...canApprove, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const slip = await RequisitionSlip.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!slip) return res.status(404).json({ success: false, error: 'Not found' });
      if (slip.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending requisition can be approved (this one is ${slip.status}).` });

      let result;
      if (slip.type === 'purchase_order') {
        const po = await createPurchaseOrder(req, slip.poPayload, slip.requestedBy);
        result = { purchaseOrder: po.toObject ? po.toObject() : po };
        slip.resultRef = po._id;
      } else {
        const { fund, tx } = await disburseFromFund(req, slip.fundId, {
          amount: slip.amount, description: slip.description, categoryCode: slip.categoryCode,
        }, slip.requestedBy);
        result = { fund, tx };
        slip.resultRef = tx._id;
      }

      slip.status = 'Approved';
      slip.approvedBy = req.user?.name || '';
      slip.approvedAt = new Date();
      await slip.save();

      logAudit?.(req, { action: 'approve', entity: 'requisition', entityId: slip.reqNumber, after: { type: slip.type, approvedBy: slip.approvedBy, resultRef: String(slip.resultRef) } });
      emitToMgr('erpUpdated');
      res.json({ success: true, requisition: slip, ...result });
    } catch (err) {
      if (err.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── REJECT ──────────────────────────────────────────────────────────────────
  app.post('/api/requisitions/:id/reject', verifyToken, ...canApprove, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { reason } = req.body || {};
      if (!reason?.trim()) return res.status(400).json({ success: false, error: 'A reason is required to reject a requisition.' });
      const slip = await RequisitionSlip.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!slip) return res.status(404).json({ success: false, error: 'Not found' });
      if (slip.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending requisition can be rejected (this one is ${slip.status}).` });

      slip.status = 'Rejected';
      slip.rejectedBy = req.user?.name || '';
      slip.rejectedAt = new Date();
      slip.rejectionReason = reason.trim().slice(0, 500);
      await slip.save();

      logAudit?.(req, { action: 'reject', entity: 'requisition', entityId: slip.reqNumber, after: { reason: slip.rejectionReason } });
      res.json({ success: true, requisition: slip });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
