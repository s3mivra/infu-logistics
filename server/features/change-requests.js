// Change-request routes - the approval queue for edits to money levers.
//
// The gate itself lives at the edit sites (products.js, inventory.js,
// clients.js): each peels the guarded fields off an update via
// lib/changeApproval.js and files them here. This module is the queue and the
// two decisions that close one out.
//
// Applying is deliberately the ONLY path that writes an approved value, so a
// price can never reach the catalogue without either passing the gate or
// having been made by someone who holds the approval permission.
import { captureError } from '../lib/errorLog.js';
import { checkStale, labelFor } from '../lib/changeApproval.js';
import { hasPermission } from '../lib/authz.js';

export default function registerChangeRequests(ctx) {
  const {
    app,
    mongoose,
    IS_PROD,
    BUSINESS_TYPE,
    tenantScope,
    requireStaff,
    requirePermission,
    verifyToken,
    logAudit,
    emitToAll,
    emitToMgr,
    AuditLog,
    Product,
    Inventory,
    ClientAccount,
    ChangeRequest,
    CHANGE_REQUEST_STATUSES,
  } = ctx;

  const canApproveChanges = [requireStaff, requirePermission('pricing.approve')];

  // The model each entity name maps to. Kept here rather than passed around so
  // there is exactly one place that decides what a request can touch.
  const MODELS = { Product, Inventory, ClientAccount };

  // Audit actions per field, chosen so an approved change lands in the SAME
  // trail the direct-edit path writes to - otherwise price history would show
  // only the changes that skipped the queue.
  const AUDIT_ACTION = {
    'Product.basePrice':          'PRODUCT_PRICE_CHANGED',
    'Product.costOverride':       'PRODUCT_RECIPE_COST_CHANGED',
    'Inventory.unitCost':         'INVENTORY_COST_CHANGED',
    'Inventory.srp':              'INVENTORY_SRP_CHANGED',
    'ClientAccount.creditLimit':  'CLIENT_CREDIT_LIMIT_CHANGED',
    'ClientAccount.creditTermsDays': 'CLIENT_CREDIT_TERMS_CHANGED',
  };

  // ── LIST ──────────────────────────────────────────────────────────────────
  // Any staff member can see this, but without pricing.approve you only ever
  // see your OWN requests - someone who filed one needs to know whether it is
  // still waiting, which is not the same as being allowed to read every price
  // decision in the business. Mirrors how requisition slips already scope.
  app.get('/api/change-requests', verifyToken, requireStaff, async (req, res) => {
    try {
      const filter = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status && CHANGE_REQUEST_STATUSES.includes(req.query.status)) filter.status = req.query.status;
      if (req.query.entity && MODELS[req.query.entity]) filter.entity = req.query.entity;
      if (!hasPermission(req.user, 'pricing.approve')) filter.requestedBy = req.user?.name || '\0no-name\0';

      const requests = await ChangeRequest.find(filter).sort({ createdAt: -1 }).limit(500).lean();
      res.json({
        success: true,
        requests,
        pendingCount: await ChangeRequest.countDocuments({ ...filter, status: 'Pending' }),
        canApprove: hasPermission(req.user, 'pricing.approve'),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── APPROVE ───────────────────────────────────────────────────────────────
  // Writes the requested values, but only onto the values the approver agreed
  // about. A field whose current value has drifted since the request was filed
  // is reported back instead of overwritten - the approver said yes to
  // "250 -> 300", not to "whatever it is now -> 300".
  app.post('/api/change-requests/:id/approve', verifyToken, ...canApproveChanges, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Request not found.' });
      const reqDoc = await ChangeRequest.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!reqDoc) return res.status(404).json({ success: false, error: 'Request not found.' });
      if (reqDoc.status !== 'Pending') return res.status(400).json({ success: false, error: `Request is already ${reqDoc.status}.` });

      const Model = MODELS[reqDoc.entity];
      if (!Model) return res.status(400).json({ success: false, error: 'Unknown entity on this request.' });

      const doc = await Model.findById(reqDoc.entityId);
      if (!doc) return res.status(404).json({ success: false, error: `The ${reqDoc.entity} this request targets no longer exists.` });

      const conflicts = [];
      const applied = [];
      for (const change of reqDoc.changes) {
        const state = checkStale(change, doc);
        if (state.stale) {
          // Already at the requested value: nothing to write, and not a
          // conflict - approving it is simply a no-op for that field.
          if (state.alreadyApplied) continue;
          conflicts.push({
            field: change.field,
            label: change.label || labelFor(reqDoc.entity, change.field),
            expected: change.oldValue,
            current: state.currentValue,
            requested: change.newValue,
          });
          continue;
        }
        doc[change.field] = change.newValue;
        applied.push(change);
      }

      if (conflicts.length) {
        return res.status(409).json({
          success: false,
          error: `This request was filed against values that have since changed. Reject it and file a fresh one.`,
          conflicts,
        });
      }

      await doc.save();

      // Land each applied change in the same audit trail a direct edit writes,
      // so price history is complete regardless of which path the change took.
      for (const change of applied) {
        const action = AUDIT_ACTION[`${reqDoc.entity}.${change.field}`];
        if (!action) continue;
        await AuditLog.create({
          userId: req.user?.name || 'System',
          action,
          targetReference: doc.productCode || doc.itemCode || doc.clientCode || String(doc._id),
          details: {
            name: doc.name || doc.itemName || '',
            oldPrice: change.oldValue, newPrice: change.newValue,   // price-shaped readers
            oldCost: change.oldValue, newCost: change.newValue,     // cost-shaped readers
            oldValue: change.oldValue, newValue: change.newValue,
            field: change.field,
            reason: reqDoc.reason || '',
            // Who asked vs who allowed it - the pair is the point of the gate.
            requestedBy: reqDoc.requestedBy,
            approvedBy: req.user?.name || '',
            viaApproval: true,
          },
        }).catch(() => { /* the change itself already landed; a missing trail row must not fail it */ });
      }

      reqDoc.status = 'Approved';
      reqDoc.approvedBy = req.user?.name || '';
      reqDoc.approvedAt = new Date();
      reqDoc.appliedAt = new Date();
      await reqDoc.save();

      try { await logAudit?.(req, { action: 'approve', entity: 'ChangeRequest', entityId: String(reqDoc._id), after: { entity: reqDoc.entity, entityName: reqDoc.entityName, changes: applied } }); } catch { /* non-fatal */ }

      // A price change has to reach the POS and the menu immediately, or a
      // till keeps selling at the old number.
      if (reqDoc.entity === 'Product') emitToAll?.('menuUpdated');
      emitToMgr?.('erpUpdated');

      res.json({ success: true, request: reqDoc, applied });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── REJECT ────────────────────────────────────────────────────────────────
  // Nothing was ever written, so this only closes the request out. The reason
  // is what the requester reads to know why their price change did not happen.
  app.post('/api/change-requests/:id/reject', verifyToken, ...canApproveChanges, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Request not found.' });
      const reqDoc = await ChangeRequest.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!reqDoc) return res.status(404).json({ success: false, error: 'Request not found.' });
      if (reqDoc.status !== 'Pending') return res.status(400).json({ success: false, error: `Request is already ${reqDoc.status}.` });

      reqDoc.status = 'Rejected';
      reqDoc.rejectedBy = req.user?.name || '';
      reqDoc.rejectionReason = String(req.body?.reason || '').trim().slice(0, 500);
      await reqDoc.save();

      try { await logAudit?.(req, { action: 'reject', entity: 'ChangeRequest', entityId: String(reqDoc._id), after: { entity: reqDoc.entity, entityName: reqDoc.entityName, reason: reqDoc.rejectionReason } }); } catch { /* non-fatal */ }
      res.json({ success: true, request: reqDoc });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── WITHDRAW ──────────────────────────────────────────────────────────────
  // The requester changed their mind. Only their own, only while Pending.
  app.post('/api/change-requests/:id/withdraw', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Request not found.' });
      const reqDoc = await ChangeRequest.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!reqDoc) return res.status(404).json({ success: false, error: 'Request not found.' });
      if (reqDoc.status !== 'Pending') return res.status(400).json({ success: false, error: `Request is already ${reqDoc.status}.` });
      if (reqDoc.requestedBy !== (req.user?.name || '') && !hasPermission(req.user, 'pricing.approve')) {
        return res.status(403).json({ success: false, error: 'You can only withdraw your own requests.' });
      }

      reqDoc.status = 'Rejected';
      reqDoc.rejectedBy = req.user?.name || '';
      reqDoc.rejectionReason = 'Withdrawn by requester';
      await reqDoc.save();
      res.json({ success: true, request: reqDoc });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
