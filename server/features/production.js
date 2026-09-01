// production routes - Production Orders convert raw materials already in
// Inventory into a finished item ("Green Beans + Roasting = Roasted Beans").
// Mirrors the RequisitionSlip shape (requisitions.js) exactly: filing is
// open to any staff member and touches nothing; only APPROVAL - gated behind
// production.approve - actually decreases the materials and increases (or
// creates) the output, atomically, stamped with one shared batch number.
//
// Money note: production doesn't create or destroy value, it moves it -
// Inventory Asset (130000) already holds the materials' cost; approval
// re-labels that same value as the output's cost (materials' total cost ÷
// output qty = the output's unit cost, blended on top of whatever stock it
// already had for an 'existing' output). A real, balanced journal entry
// (both legs on 130000) is still posted per batch so the event is visible
// and filterable in the Ledger - the account's own balance is unaffected
// either way, but the movement itself is not silent.
import { captureError } from '../lib/errorLog.js';
import { withOptionalTransaction } from '../lib/txn.js';
import { upper } from '../lib/normalize.js';
import { hasPermission } from '../lib/authz.js';

export default function registerProduction(ctx) {
  const {
    app,
    mongoose,
    IS_PROD,
    BUSINESS_TYPE,
    tenantScope,
    requireStaff,
    requirePermission,
    verifyToken,
    log,
    logAudit,
    emitToMgr,
    mkSeqRef,
    generateNextSequence,
    escapeRegex,
    consumeBatches,
    soonestExpiry,
    Inventory,
    StockCard,
    JournalEntry,
    assertBalanced,
    ProductionOrder,
    PRODUCTION_ORDER_STATUSES,
    PRODUCTION_FULFILLMENT_STATUSES,
  } = ctx;

  const canApproveProd = [requireStaff, requirePermission('production.approve')];

  // ── LIST ──────────────────────────────────────────────────────────────────
  // Same self-service scoping as requisitions: anyone can check their own
  // filed orders; production.view widens that to every order.
  app.get('/api/production-orders', verifyToken, requireStaff, async (req, res) => {
    try {
      const filter = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status && PRODUCTION_ORDER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
      if (req.query.fulfillmentStatus && PRODUCTION_FULFILLMENT_STATUSES.includes(req.query.fulfillmentStatus)) filter.fulfillmentStatus = req.query.fulfillmentStatus;
      if (!hasPermission(req.user, 'production.view')) filter.requestedBy = req.user?.name || '\0no-name\0';
      const orders = await ProductionOrder.find(filter).sort({ createdAt: -1 }).limit(500).lean();
      res.json({ success: true, orders });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.get('/api/production-orders/:id', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const order = await ProductionOrder.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!order) return res.status(404).json({ success: false, error: 'Not found' });
      if (!hasPermission(req.user, 'production.view') && order.requestedBy !== (req.user?.name || '')) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      res.json({ success: true, order });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ────────────────────────────────────────────────────────────────
  // Any staff can file one - nothing here touches stock. `materials` are
  // taken as DISPLAY quantities from the client and converted to base units
  // against each item's own unitMultiplier, matching every other qty input
  // in the app (transfers, restocks) so "20" always means what the operator
  // saw on screen, not a raw g/ml number.
  app.post('/api/production-orders', verifyToken, requireStaff, async (req, res) => {
    try {
      const { materials, outputType, outputInvId, outputName, outputQty, outputUnit, outputPackSize,
        outputStockCategory, outputStockLocation, outputExpiryDate, productionDate, notes } = req.body || {};

      if (!Array.isArray(materials) || materials.length === 0) {
        return res.status(400).json({ success: false, error: 'At least one material is required.' });
      }
      const invIds = materials.map(m => m?.invId).filter(id => mongoose.Types.ObjectId.isValid(id || ''));
      if (invIds.length !== materials.length) return res.status(400).json({ success: false, error: 'Every material needs a valid inventory item.' });
      const invDocs = await Inventory.find({ _id: { $in: invIds } }).lean();
      const invById = new Map(invDocs.map(d => [String(d._id), d]));

      // `qty` arrives already converted to BASE units (g/ml/pcs) - the client
      // does that conversion itself using the item's pack size (see
      // ProductionTab's itemDisplay/packInfo use), same convention as Stock
      // Transfers: a packed item like "CONDENSED MILK 377G" is counted and
      // typed in PIECES everywhere in this app, and 1 piece = packBase base
      // units (377 for that item), NOT the same as unitMultiplier (which is
      // only the fixed kg/L <-> g/ml conversion, not a pack size). Trusting
      // the client's own conversion here mirrors how requestStockTransfer
      // already works, rather than re-deriving pack size server-side (which
      // would mean duplicating the name-parsing logic that only exists
      // client-side in AdminDashboard's packInfo()).
      const cleanMaterials = [];
      for (const m of materials) {
        const item = invById.get(String(m.invId));
        if (!item) return res.status(400).json({ success: false, error: 'One of the materials no longer exists.' });
        const baseQty = Number(m.qty);
        if (!Number.isFinite(baseQty) || baseQty <= 0) return res.status(400).json({ success: false, error: `Enter a positive quantity for ${item.itemName}.` });
        cleanMaterials.push({ invId: item._id, itemName: item.itemName, qty: baseQty, unit: item.unit });
      }

      if (!['new', 'existing'].includes(outputType)) return res.status(400).json({ success: false, error: 'outputType must be "new" or "existing".' });

      let cleanOutputInvId = null;
      let cleanOutputName = '';
      let cleanOutputUnit = '';
      if (outputType === 'existing') {
        if (!mongoose.Types.ObjectId.isValid(outputInvId || '')) return res.status(400).json({ success: false, error: 'Choose the item this production adds to.' });
        const outItem = await Inventory.findById(outputInvId).lean();
        if (!outItem) return res.status(404).json({ success: false, error: 'Output item not found.' });
        cleanOutputInvId = outItem._id;
        cleanOutputName = outItem.itemName;
        cleanOutputUnit = outItem.unit;
      } else {
        cleanOutputName = upper(String(outputName || '').trim());
        if (!cleanOutputName) return res.status(400).json({ success: false, error: 'Name the new product this production creates.' });
        const dup = await Inventory.findOne({ itemName: { $regex: new RegExp(`^${escapeRegex(cleanOutputName)}$`, 'i') } }).lean();
        if (dup) return res.status(400).json({ success: false, error: `"${cleanOutputName}" already exists as an inventory item - use "adds to an existing item" instead.` });
        cleanOutputUnit = String(outputUnit || '').trim() || 'pcs';
      }
      // Optional, 'new' only: how many base units make up ONE piece of the
      // new item (e.g. 377 for "CONDENSED MILK 377G"), stored as the created
      // item's packSize so every LATER production run against it can also be
      // counted in pieces, not raw grams/ml.
      const cleanOutputPackSize = outputType === 'new' && Number(outputPackSize) > 0 ? Number(outputPackSize) : null;

      const outQty = Number(outputQty);
      if (!Number.isFinite(outQty) || outQty <= 0) return res.status(400).json({ success: false, error: 'Output quantity must be a positive number.' });

      const order = await ProductionOrder.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        status: 'Pending',
        materials: cleanMaterials,
        outputType,
        outputInvId: cleanOutputInvId,
        outputName: cleanOutputName,
        outputQty: outQty,
        outputUnit: cleanOutputUnit,
        outputPackSize: cleanOutputPackSize,
        outputStockCategory: String(outputStockCategory || '').trim(),
        outputStockLocation: String(outputStockLocation || '').trim(),
        outputExpiryDate: outputExpiryDate ? new Date(outputExpiryDate) : null,
        productionDate: productionDate ? new Date(productionDate) : new Date(),
        notes: String(notes || '').trim().slice(0, 500),
        requestedBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'ProductionOrder', entityId: order._id, after: { outputName: order.outputName, outputQty: order.outputQty } });
      res.json({ success: true, order });
    } catch (err) {
      log.error?.({ err }, 'POST /api/production-orders failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── APPROVE ───────────────────────────────────────────────────────────────
  // Re-validates against CURRENT stock (levels can have moved since filing),
  // then consumes every material - if any material is short, nothing moves
  // and the order stays Pending so it can be edited/refiled rather than
  // half-consuming the batch. This is ONLY the materials leaving; the output
  // is NOT credited yet (see /reconcile below) - yield is never guaranteed,
  // so crediting the planned outputQty here would silently book stock that
  // may not actually exist. Approving flips fulfillmentStatus to Processing,
  // same idea as a Purchase Order moving to "Ordered": the plan is committed,
  // the real-world result gets confirmed separately.
  app.post('/api/production-orders/:id/approve', verifyToken, ...canApproveProd, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const order = await ProductionOrder.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!order) return res.status(404).json({ success: false, error: 'Not found' });
      if (order.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending order can be approved (this one is ${order.status}).` });

      const batchNumber = await mkSeqRef('PROD');

      const result = await withOptionalTransaction(mongoose, async (session) => {
        let totalMaterialsCost = 0;

        for (const m of order.materials) {
          const item = await Inventory.findById(m.invId).session(session ?? null);
          if (!item) throw Object.assign(new Error(`Material "${m.itemName}" no longer exists.`), { httpStatus: 400 });
          if (item.stockQty < m.qty) throw Object.assign(new Error(`Not enough "${item.itemName}" on hand - have ${item.stockQty}${item.unit}, need ${m.qty}${item.unit}.`), { httpStatus: 400 });

          totalMaterialsCost += m.qty * (Number(item.unitCost) || 0);

          item.stockQty = +(item.stockQty - m.qty).toFixed(6);
          if (item.expiryBatches?.length) {
            const r = consumeBatches(item.expiryBatches, m.qty);
            item.expiryBatches = r.batches;
          }
          item.expiryDate = soonestExpiry(item.expiryBatches || []);
          if (item.stockQty <= 0.0001) { item.expiryBatches = []; item.expiryDate = null; }
          await item.save({ session });

          await StockCard.create([{
            inventoryId: item._id, itemName: item.itemName, type: 'Production Consumption',
            reference: batchNumber, qtyChange: -m.qty, balanceAfter: item.stockQty,
            unitCost: item.unitCost, remarks: `Consumed for production batch ${batchNumber}`,
          }], { session });
        }

        order.status = 'Approved';
        order.fulfillmentStatus = 'Processing';
        order.batchNumber = batchNumber;
        order.totalMaterialsCost = +totalMaterialsCost.toFixed(6);
        order.approvedBy = req.user?.name || '';
        order.approvedAt = new Date();
        await order.save({ session });

        return order;
      }, { log });

      await logAudit(req, { action: 'approve', entity: 'ProductionOrder', entityId: order._id, after: { batchNumber, approvedBy: order.approvedBy, totalMaterialsCost: order.totalMaterialsCost } });
      emitToMgr('erpUpdated');
      res.json({ success: true, order: result });
    } catch (err) {
      if (err?.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
      log.error?.({ err }, 'POST /api/production-orders/:id/approve failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── RECONCILE ────────────────────────────────────────────────────────────
  // The Purchase Order "receive" step, for production: type in what actually
  // came out of the batch. Credits the output at THAT figure (not the
  // planned outputQty), so the recorded unit cost reflects the real yield -
  // a lower-than-planned yield means each unit actually cost more, and this
  // is where that shows up. fulfillmentStatus becomes Complete when the
  // actual figure meets or beats the plan, Partial when it falls short.
  app.post('/api/production-orders/:id/reconcile', verifyToken, ...canApproveProd, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const order = await ProductionOrder.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!order) return res.status(404).json({ success: false, error: 'Not found' });
      if (order.status !== 'Approved') return res.status(409).json({ success: false, error: 'Only an approved order can be reconciled.' });
      if (order.fulfillmentStatus !== 'Processing') return res.status(409).json({ success: false, error: `This batch is already ${order.fulfillmentStatus}.` });

      const actualQty = Number(req.body?.actualOutputQty);
      if (!Number.isFinite(actualQty) || actualQty <= 0) return res.status(400).json({ success: false, error: 'Enter the actual quantity produced (a positive number).' });

      const batchNumber = order.batchNumber;
      const totalMaterialsCost = Number(order.totalMaterialsCost) || 0;
      const outputUnitCost = +(totalMaterialsCost / actualQty).toFixed(6);

      const result = await withOptionalTransaction(mongoose, async (session) => {
        let outputItem;
        if (order.outputType === 'existing') {
          outputItem = await Inventory.findById(order.outputInvId).session(session ?? null);
          if (!outputItem) throw Object.assign(new Error('Output item no longer exists.'), { httpStatus: 404 });

          const existingQty = Number(outputItem.stockQty) || 0;
          const existingValue = existingQty * (Number(outputItem.unitCost) || 0);
          const addedValue = actualQty * outputUnitCost;
          const newQty = +(existingQty + actualQty).toFixed(6);
          outputItem.stockQty = newQty;
          outputItem.unitCost = newQty > 0 ? +((existingValue + addedValue) / newQty).toFixed(6) : 0;

          outputItem.expiryBatches = [...(outputItem.expiryBatches || []), {
            qty: actualQty,
            expiryDate: order.outputExpiryDate || null,
            productionDate: order.productionDate || new Date(),
            receivedAt: new Date(),
            reference: batchNumber,
            unitCost: outputUnitCost,
          }];
          outputItem.expiryDate = soonestExpiry(outputItem.expiryBatches);
          await outputItem.save({ session });
        } else {
          const itemCode = await generateNextSequence(Inventory, 'RML', 'itemCode');
          const created = await Inventory.create([{
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            itemCode, itemName: order.outputName,
            stockQty: actualQty, unit: order.outputUnit,
            unitCost: outputUnitCost,
            displayUnit: order.outputUnit, unitMultiplier: 1,
            packSize: order.outputPackSize || null,
            stockCategory: order.outputStockCategory || '',
            stockLocation: order.outputStockLocation || '',
            expiryDate: order.outputExpiryDate || null,
            expiryBatches: [{
              qty: actualQty,
              expiryDate: order.outputExpiryDate || null,
              productionDate: order.productionDate || new Date(),
              receivedAt: new Date(),
              reference: batchNumber,
              unitCost: outputUnitCost,
            }],
          }], { session });
          outputItem = created[0];
        }

        await StockCard.create([{
          inventoryId: outputItem._id, itemName: outputItem.itemName, type: 'Production Output',
          reference: batchNumber, qtyChange: actualQty, balanceAfter: outputItem.stockQty,
          unitCost: outputUnitCost, remarks: `Produced in batch ${batchNumber} (planned ${order.outputQty}${order.outputUnit})`,
        }], { session });

        // Wired into the Ledger: a real, balanced journal entry so the batch
        // shows up in the General Journal and is filterable by its reference,
        // same as any other stock event. Both legs post to Inventory Asset
        // (130000) - production doesn't create or destroy value, it just
        // re-labels materials' cost as the output's cost, so the account's
        // own balance is unaffected even though the entry is real, not a
        // zero-value memo.
        if (totalMaterialsCost > 0.001) {
          const lines = [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: totalMaterialsCost, credit: 0, memo: `Finished goods produced: ${outputItem.itemName}` },
            { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: totalMaterialsCost, memo: 'Raw materials consumed' },
          ];
          assertBalanced(lines, batchNumber);
          await JournalEntry.create([{
            reference: batchNumber,
            description: `Production batch ${batchNumber}: ${order.materials.map(m => m.itemName).join(', ')} → ${actualQty}${order.outputUnit} ${outputItem.itemName} (planned ${order.outputQty}${order.outputUnit})`,
            lines, totalDebit: totalMaterialsCost, totalCredit: totalMaterialsCost,
          }], { session });
        }

        order.fulfillmentStatus = actualQty >= order.outputQty ? 'Complete' : 'Partial';
        order.actualOutputQty = actualQty;
        order.outputInvId = outputItem._id;
        order.reconciledBy = req.user?.name || '';
        order.reconciledAt = new Date();
        await order.save({ session });

        return { order, outputItem };
      }, { log });

      await logAudit(req, { action: 'reconcile', entity: 'ProductionOrder', entityId: order._id, after: { batchNumber, actualQty, fulfillmentStatus: result.order.fulfillmentStatus } });
      emitToMgr('erpUpdated');
      res.json({ success: true, order: result.order, outputItem: result.outputItem });
    } catch (err) {
      if (err?.httpStatus) return res.status(err.httpStatus).json({ success: false, error: err.message });
      log.error?.({ err }, 'POST /api/production-orders/:id/reconcile failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── REJECT ────────────────────────────────────────────────────────────────
  app.post('/api/production-orders/:id/reject', verifyToken, ...canApproveProd, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { reason } = req.body || {};
      if (!reason?.trim()) return res.status(400).json({ success: false, error: 'A reason is required to reject an order.' });
      const order = await ProductionOrder.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!order) return res.status(404).json({ success: false, error: 'Not found' });
      if (order.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending order can be rejected (this one is ${order.status}).` });

      order.status = 'Rejected';
      order.rejectedBy = req.user?.name || '';
      order.rejectedAt = new Date();
      order.rejectionReason = reason.trim().slice(0, 500);
      await order.save();

      await logAudit(req, { action: 'reject', entity: 'ProductionOrder', entityId: order._id, after: { reason: order.rejectionReason } });
      res.json({ success: true, order });
    } catch (err) {
      log.error?.({ err }, 'POST /api/production-orders/:id/reject failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── CANCEL (by the requester, while still Pending) ──────────────────────────
  app.post('/api/production-orders/:id/cancel', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const order = await ProductionOrder.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!order) return res.status(404).json({ success: false, error: 'Not found' });
      if (order.requestedBy !== (req.user?.name || '') && !hasPermission(req.user, 'production.approve')) {
        return res.status(403).json({ success: false, error: 'Only the requester (or an approver) can cancel this order.' });
      }
      if (order.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending order can be cancelled (this one is ${order.status}).` });

      order.status = 'Rejected';
      order.rejectedBy = req.user?.name || '';
      order.rejectedAt = new Date();
      order.rejectionReason = 'Cancelled by requester';
      await order.save();

      res.json({ success: true, order });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
