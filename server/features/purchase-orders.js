// purchase-orders routes - procurement workflow (draft PO → reconcile delivery).
// Models/helpers/middleware live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { title, lower, freeText, squish } from '../lib/normalize.js';

import { captureError } from '../lib/errorLog.js';

export default function registerPurchaseOrders(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    mkSeqRef,
    tenantScope,
    logAudit,
    PurchaseOrder,
    PO_STATUSES,
    Bill,
    BUSINESS_TYPE,
    Supplier,
    Inventory,
    StockCard,
    JournalEntry,
    emitToMgr,
    verifyToken,
    requireStaff,
    requireSuperAdmin,
    requirePermission,
  } = ctx;

  // Procurement domain gates (superadmin bypasses inside requirePermission).
  // requireStaff is the floor; view/manage/delete are the granular layer on top -
  // "manage" covers both POs and the supplier directory (viewing them is cheap,
  // creating/editing/deleting a supplier or PO is not).
  const canViewProc   = [requireStaff, requirePermission('procurement.view')];
  const canManageProc = [requireStaff, requirePermission('procurement.manage')];
  const canDeleteProc = [requireStaff, requirePermission('procurement.delete')];

  // Round money to 2dp; guard against NaN from bad client input.
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Recompute estTotal from ordered qty × unit cost across all lines.
  const estTotalOf = (lines) =>
    money((lines || []).reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0));

  // Normalize an incoming line into our stored shape.
  const cleanLine = (l) => ({
    invId:             l.invId && mongoose.Types.ObjectId.isValid(l.invId) ? l.invId : null,
    itemName:          String(l.itemName || '').slice(0, 200),
    itemCode:          String(l.itemCode || '').slice(0, 60),
    unit:              String(l.unit || '').slice(0, 20),
    packSize:          l.packSize != null && l.packSize !== '' ? Math.max(0, Number(l.packSize) || 0) : null,
    orderedQty:        Math.max(0, Number(l.orderedQty) || 0),
    unitCost:          Math.max(0, money(l.unitCost)),
    expiryDate:        l.expiryDate ? new Date(l.expiryDate) : null,
    expiryWarnDays:    l.expiryWarnDays != null ? Math.max(1, Number(l.expiryWarnDays) || 7) : null,
    lowStockThreshold: l.lowStockThreshold != null ? Math.max(0, Number(l.lowStockThreshold) || 0) : null,
    stockLocation:     l.stockLocation ? String(l.stockLocation).slice(0, 100) : null,
    stockCategory:     l.stockCategory ? String(l.stockCategory).slice(0, 100) : null,
    creditAccount:     l.creditAccount ? String(l.creditAccount).slice(0, 50) : null,
    receivedQty:       null,
  });

  // ── LIST ────────────────────────────────────────────────────────────────────
  // GET /api/purchase-orders?status=Ordered&limit=100
  app.get('/api/purchase-orders', verifyToken, ...canViewProc, async (req, res) => {
    try {
      const q = { ...tenantScope(req) };
      if (req.query.status && PO_STATUSES.includes(req.query.status)) q.status = req.query.status;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const pos = await PurchaseOrder.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      res.json({ success: true, purchaseOrders: pos });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SINGLE ──────────────────────────────────────────────────────────────────
  app.get('/api/purchase-orders/:id', verifyToken, ...canViewProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) }).lean();
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, purchaseOrder: po });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE (draft a planned PO) ───────────────────────────────────────────────
  // POST /api/purchase-orders  { supplier, expectedDate, notes, lines:[{invId,itemName,itemCode,unit,orderedQty,unitCost}] }
  app.post('/api/purchase-orders', verifyToken, ...canManageProc, async (req, res) => {
    try {
      const { supplier = '', supplierId = null, supplierRef = '', expectedDate = null, notes = '', lines = [] } = req.body || {};
      // Link to the supplier record when one is given, and prefer its canonical
      // name over the free-text field. The PO schema has always had supplierId;
      // the create route was silently dropping it, which left every payable
      // unattributed downstream.
      let supplierDoc = null;
      if (supplierId && mongoose.Types.ObjectId.isValid(String(supplierId))) {
        supplierDoc = await Supplier.findOne({ _id: supplierId, ...tenantScope(req) }).lean();
        if (!supplierDoc) return res.status(404).json({ success: false, error: 'Supplier not found.' });
      }
      const clean = (Array.isArray(lines) ? lines : [])
        .map(cleanLine)
        .filter(l => l.itemName && l.orderedQty > 0);
      if (clean.length === 0) return res.status(400).json({ success: false, error: 'A purchase order needs at least one line with a name and quantity.' });

      const poNumber = await mkSeqRef('PO');
      const po = await PurchaseOrder.create({
        poNumber,
        supplierRef: String(supplierRef).slice(0, 100),
        supplier: supplierDoc?.name || String(supplier).slice(0, 200),
        supplierId: supplierDoc?._id || null,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes: String(notes).slice(0, 1000),
        status: 'Ordered',
        lines: clean,
        estTotal: estTotalOf(clean),
        createdBy: req.user?.name || '',
        ...tenantScope(req),
      });
      logAudit?.(req, { action: 'create', entity: 'purchase_order', entityId: poNumber, after: { lines: clean.length, estTotal: po.estTotal } });
      res.status(201).json({ success: true, purchaseOrder: po.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── UPDATE (edit draft header/lines, or move status Ordered↔Processing) ────────
  // PATCH /api/purchase-orders/:id  { supplier?, expectedDate?, notes?, status?, lines? }
  // Editing lines is only allowed before the PO is reconciled (Complete/Incomplete).
  app.patch('/api/purchase-orders/:id', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      // Complete is fully terminal. Incomplete (a short delivery) is still
      // receivable - the ONE edit allowed on it is cancelling the remainder;
      // everything else (supplier, lines, re-opening to Ordered/Processing) stays locked.
      const bodyKeys = Object.keys(req.body || {});
      const isCancelOnly = po.status === 'Incomplete' && bodyKeys.length === 1 && req.body.status === 'Cancelled';
      if (po.status === 'Complete' || (po.status === 'Incomplete' && !isCancelOnly)) {
        return res.status(409).json({ success: false, error: 'This PO has already been received. Reconciled POs cannot be edited.' });
      }

      const { supplier, supplierRef, expectedDate, notes, status, lines } = req.body || {};
      if (supplierRef !== undefined) po.supplierRef = String(supplierRef).slice(0, 100);
      if (supplier !== undefined) po.supplier = String(supplier).slice(0, 200);
      if (notes !== undefined) po.notes = String(notes).slice(0, 1000);
      if (expectedDate !== undefined) po.expectedDate = expectedDate ? new Date(expectedDate) : null;
      if (status !== undefined) {
        // Only allow the pre-delivery transitions here; receiving is done via /receive.
        if (!['Ordered', 'Processing', 'Cancelled'].includes(status)) {
          return res.status(400).json({ success: false, error: 'Status can only be set to Ordered, Processing, or Cancelled here. Use Receive to reconcile a delivery.' });
        }
        po.status = status;
      }
      if (Array.isArray(lines)) {
        const clean = lines.map(cleanLine).filter(l => l.itemName && l.orderedQty > 0);
        if (clean.length === 0) return res.status(400).json({ success: false, error: 'A purchase order needs at least one line.' });
        po.lines = clean;
        po.estTotal = estTotalOf(clean);
      }
      await po.save();
      logAudit?.(req, { action: 'update', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status } });
      res.json({ success: true, purchaseOrder: po.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── RECEIPT POSTING ───────────────────────────────────────────────────────────
  // Moves a delivery's quantities into Inventory (weighted-average cost) and
  // books the matching journal entry. Only lines linked to a real Inventory item
  // (invId set) post - unlinked lines stay PO-only tracking, by design.
  //
  // Unit model: a PO line is priced and counted in PACKS, while Inventory holds
  // BASE units (ml/g/pcs). basePerPack = line.packSize × item.unitMultiplier, so
  // 10 packs of 1L milk with unitMultiplier 1000 posts 10,000 ml at ₱0.08/ml.
  const postReceiptToStock = async (req, deltas, po) => {
    let totalCost = 0;
    for (const { line, delta } of deltas) {
      if (!line.invId || !mongoose.Types.ObjectId.isValid(String(line.invId))) continue;
      const item = await Inventory.findById(line.invId);
      if (!item) continue;

      const basePerPack = (Number(line.packSize) || 1) * (Number(item.unitMultiplier) || 1);
      const baseQty = delta * basePerPack;
      const lineCost = money(delta * (Number(line.unitCost) || 0));
      if (baseQty <= 0) continue;

      // WAC (GAAP/IFRS): blend the incoming batch into the existing holding.
      const currentValue = (Number(item.stockQty) || 0) * (Number(item.unitCost) || 0);
      const newStockQty = (Number(item.stockQty) || 0) + baseQty;
      item.unitCost = newStockQty > 0 ? (currentValue + lineCost) / newStockQty : 0;
      item.stockQty = newStockQty;
      await item.save();

      const rcvRef = await mkSeqRef('PO-RCV');
      await StockCard.create({
        inventoryId: item._id,
        itemName: item.itemName,
        type: 'Restock',
        reference: rcvRef,
        qtyChange: baseQty,
        unitCost: baseQty > 0 ? lineCost / baseQty : 0,
        balanceAfter: item.stockQty,
        remarks: `Received on PO`,
      });

      if (lineCost > 0) {
        // Credit A/P: a PO is a purchase on account. Paying the supplier is a
        // separate A/P settlement, not part of receiving the goods.
        await JournalEntry.create({
          reference: rcvRef,
          description: `Received ${delta} × ${line.itemName || item.itemName} on ${po?.poNumber || 'PO'}${po?.supplier ? ` from ${po.supplier}` : ''}`,
          // Attributed so the A/P view can answer "how much do we owe this
          // supplier?" without parsing descriptions.
          supplierId: po?.supplierId ? String(po.supplierId) : null,
          supplierName: po?.supplier || '',
          lines: [
            { accountCode: '130000', accountName: 'Inventory Asset',    debit: lineCost, credit: 0 },
            { accountCode: '220000', accountName: 'Accounts Payable',   debit: 0, credit: lineCost },
          ],
          totalDebit: lineCost,
          totalCredit: lineCost,
        });
        totalCost = money(totalCost + lineCost);
      }
    }
    return { totalCost };
  };

  // ── RECEIVE (reconcile actual delivery) ───────────────────────────────────────
  // POST /api/purchase-orders/:id/receive  { received: [{ lineId?, index?, receivedQty }], notes? }
  // Sets receivedQty per line, computes actualTotal, and flips status to Complete
  // (every line received ≥ ordered) or Incomplete (any short). Terminal - the PO
  // becomes read-only afterward.
  app.post('/api/purchase-orders/:id/receive', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      // Complete is terminal. Incomplete (a short delivery) is NOT - it stays
      // receivable so a follow-up delivery can top up just the outstanding qty.
      if (po.status === 'Complete') {
        return res.status(409).json({ success: false, error: 'This PO has already been received.' });
      }
      if (po.status === 'Cancelled') {
        return res.status(409).json({ success: false, error: 'Cancelled POs cannot be received.' });
      }

      const received = Array.isArray(req.body?.received) ? req.body.received : [];
      // Map incoming actuals onto lines - accept a line _id or a positional index.
      // Each entry is what arrived in THIS delivery (a delta), not a replacement total.
      const byId = new Map();
      received.forEach((r, i) => {
        const key = r.lineId != null ? String(r.lineId) : (r.index != null ? `#${r.index}` : `#${i}`);
        byId.set(key, Math.max(0, Number(r.receivedQty) || 0));
      });
      // Collect this delivery's deltas per line BEFORE mutating, so stock posting
      // moves only what arrived now - a top-up delivery must not re-post the
      // quantities an earlier delivery already put into inventory.
      const deltas = [];
      po.lines.forEach((line, idx) => {
        let delta;
        if (byId.has(String(line._id))) delta = byId.get(String(line._id));
        else if (byId.has(`#${idx}`)) delta = byId.get(`#${idx}`);
        // Lines omitted from this delivery's payload are left untouched - NOT reset to 0.
        if (delta == null) return;
        line.receivedQty = (Number(line.receivedQty) || 0) + delta;
        if (delta > 0) deltas.push({ line, delta });
      });

      const allFull = po.lines.every(l => (l.receivedQty ?? 0) >= (l.orderedQty || 0));
      po.status = allFull ? 'Complete' : 'Incomplete';
      po.actualTotal = money(po.lines.reduce((s, l) => s + (Number(l.receivedQty) || 0) * (Number(l.unitCost) || 0), 0));
      po.receivedAt = new Date();
      po.receivedBy = req.user?.name || '';
      if (req.body?.notes !== undefined) po.notes = String(req.body.notes).slice(0, 1000);
      await po.save();

      // Post the delivery into stock and the books. Without this the PO flips to
      // Complete while inventory never moves - goods marked received that the
      // stock ledger never hears about.
      const posted = await postReceiptToStock(req, deltas, po);

      // One Bill per delivery (not per line - a supplier sends one invoice for
      // the whole shipment), awaiting approval before it can be scheduled/paid.
      // The A/P journal entry already posted above at receipt time - see the
      // BillSchema comment in server.js for why source:'PO' bills don't wait
      // for approval to book the liability, only to be paid.
      let bill = null;
      // Bill.supplierId is required - a PO placed against a free-text supplier
      // name with no linked Supplier record (po.supplierId unset) can't get a
      // bill. The receipt and its journal entry still post either way; this
      // only affects the approval/scheduling workflow layered on top.
      if (posted.totalCost > 0 && po.supplierId) {
        const billNumber = await mkSeqRef('BILL');
        bill = await Bill.create({
          businessType: BUSINESS_TYPE,
          ...tenantScope(req),
          billNumber,
          supplierId: po.supplierId,
          supplierName: po.supplier || '',
          source: 'PO',
          purchaseOrderId: po._id,
          poNumber: po.poNumber,
          description: `Delivery received on ${po.poNumber}`,
          amount: posted.totalCost,
          createdBy: req.user?.name || '',
        }).catch((err) => { captureError(req, err); return null; }); // a bill-creation failure shouldn't roll back a receipt that already posted
      }

      logAudit?.(req, { action: 'receive', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status, actualTotal: po.actualTotal, stockPosted: posted.totalCost, billNumber: bill?.billNumber } });
      if (posted.totalCost > 0) emitToMgr?.('erpUpdated');
      res.json({ success: true, purchaseOrder: po.toObject(), bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── DELETE (only drafts / cancelled - never a reconciled record) ───────────────
  app.delete('/api/purchase-orders/:id', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      // A cancelled PO with no receiving activity is a plain discarded draft - safe
      // to delete. One with activity (some lines already partially received before
      // the remainder was cancelled) is a real record and stays permanent, same as
      // Complete/Incomplete.
      const hasReceivedActivity = (po.lines || []).some(l => (Number(l.receivedQty) || 0) > 0);
      if (['Complete', 'Incomplete'].includes(po.status) || (po.status === 'Cancelled' && hasReceivedActivity)) {
        return res.status(409).json({ success: false, error: 'Received POs are permanent records and cannot be deleted. Cancel a draft instead.' });
      }
      await po.deleteOne();
      logAudit?.(req, { action: 'delete', entity: 'purchase_order', entityId: po.poNumber });
      res.json({ success: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SUPPLIERS - managed directory (CRUD) that POs draw from ────────────────────
  // A PO stores both a supplierId link AND a supplier name snapshot (see
  // PurchaseOrderSchema), so renaming/deleting a supplier never rewrites history.

  // Per supplier, what they supply and how much we've bought from them - rolled
  // up from every non-cancelled PO's lines, grouped by item. estSpend uses the
  // ordered qty (what we committed to); actualSpend uses receivedQty (what
  // actually arrived) so a still-outstanding order doesn't inflate "bought".
  const productSummaryBySupplier = async (supplierIds) => {
    if (!supplierIds.length) return {};
    const rows = await PurchaseOrder.aggregate([
      { $match: { supplierId: { $in: supplierIds }, status: { $ne: 'Cancelled' } } },
      { $unwind: '$lines' },
      { $group: {
          _id: { supplierId: '$supplierId', itemName: '$lines.itemName', itemCode: '$lines.itemCode' },
          unit: { $first: '$lines.unit' },
          orderedQty: { $sum: '$lines.orderedQty' },
          receivedQty: { $sum: { $ifNull: ['$lines.receivedQty', 0] } },
          estSpend: { $sum: { $multiply: ['$lines.orderedQty', '$lines.unitCost'] } },
          actualSpend: { $sum: { $multiply: [{ $ifNull: ['$lines.receivedQty', 0] }, '$lines.unitCost'] } },
          lastOrderedAt: { $max: '$createdAt' },
        } },
      { $sort: { estSpend: -1 } },
    ]);
    const bySupplier = {};
    for (const r of rows) {
      const sid = String(r._id.supplierId);
      (bySupplier[sid] ||= []).push({
        itemName: r._id.itemName, itemCode: r._id.itemCode, unit: r.unit,
        orderedQty: r.orderedQty, receivedQty: r.receivedQty,
        estSpend: money(r.estSpend), actualSpend: money(r.actualSpend),
        lastOrderedAt: r.lastOrderedAt,
      });
    }
    return bySupplier;
  };

  // GET /api/suppliers - directory + catalog (what they say they sell, at what
  // price - set by staff) + purchaseHistory (what we've actually bought, derived
  // from PO lines). Catalog answers "who's cheaper" even before a PO exists;
  // purchaseHistory is the read-only after-the-fact record.
  app.get('/api/suppliers', verifyToken, ...canViewProc, async (req, res) => {
    try {
      const suppliers = await Supplier.find({ ...tenantScope(req) }).sort({ name: 1 }).lean();
      const summary = await productSummaryBySupplier(suppliers.map(s => s._id));
      const withProducts = suppliers.map(s => {
        const purchaseHistory = summary[String(s._id)] || [];
        return {
          ...s,
          catalog: s.catalog || [],
          purchaseHistory,
          totalEstSpend: money(purchaseHistory.reduce((sum, p) => sum + p.estSpend, 0)),
          totalSpend: money(purchaseHistory.reduce((sum, p) => sum + p.actualSpend, 0)),
        };
      });
      res.json({ success: true, suppliers: withProducts });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.post('/api/suppliers', verifyToken, ...canManageProc, async (req, res) => {
    try {
      const { name, contactPerson = '', phone = '', email = '', address = '', notes = '' } = req.body || {};
      // Canonicalize before the duplicate check, so "abc trading", "ABC Trading"
      // and "  ABC   Trading " can't all become separate supplier records.
      const cleanName = title(name);
      if (!cleanName) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
      const dupe = await Supplier.findOne({ name: cleanName, ...tenantScope(req) }).lean();
      if (dupe) return res.status(409).json({ success: false, error: `Supplier "${cleanName}" already exists.` });
      const supplierCode = await mkSeqRef('SUP');
      const supplier = await Supplier.create({
        supplierCode, name: cleanName,
        contactPerson: title(contactPerson).slice(0, 200),
        phone: squish(phone).slice(0, 40),
        email: lower(email).slice(0, 200),
        address: freeText(address).slice(0, 300),
        notes: freeText(notes).slice(0, 1000),
        ...tenantScope(req),
      });
      logAudit?.(req, { action: 'create', entity: 'supplier', entityId: supplierCode });
      res.status(201).json({ success: true, supplier: supplier.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.patch('/api/suppliers/:id', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { name, contactPerson, phone, email, address, notes, isActive } = req.body || {};
      const update = {};
      if (name !== undefined) {
        const cleanName = title(name);
        if (!cleanName) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
        // Same canonical-name guard as create, excluding this supplier itself.
        const dupe = await Supplier.findOne({ name: cleanName, _id: { $ne: req.params.id }, ...tenantScope(req) }).lean();
        if (dupe) return res.status(409).json({ success: false, error: `Supplier "${cleanName}" already exists.` });
        update.name = cleanName;
      }
      if (contactPerson !== undefined) update.contactPerson = title(contactPerson).slice(0, 200);
      if (phone !== undefined) update.phone = squish(phone).slice(0, 40);
      if (email !== undefined) update.email = lower(email).slice(0, 200);
      if (address !== undefined) update.address = freeText(address).slice(0, 300);
      if (notes !== undefined) update.notes = freeText(notes).slice(0, 1000);
      if (typeof isActive === 'boolean') update.isActive = isActive;
      const supplier = await Supplier.findOneAndUpdate(
        { _id: req.params.id, ...tenantScope(req) }, { $set: update }, { new: true }
      );
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      logAudit?.(req, { action: 'update', entity: 'supplier', entityId: supplier.supplierCode });
      res.json({ success: true, supplier: supplier.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.delete('/api/suppliers/:id', verifyToken, ...canDeleteProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const supplier = await Supplier.findOneAndDelete({ _id: req.params.id, ...tenantScope(req) });
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      logAudit?.(req, { action: 'delete', entity: 'supplier', entityId: supplier.supplierCode });
      res.json({ success: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SUPPLIER CATALOG - what a supplier says they sell + their quoted price ─────
  // Manually maintained (not derived from POs), so "who's cheaper for X" can be
  // answered before ever placing an order with them.
  const cleanCatalogEntry = (l) => ({
    invId:     l.invId && mongoose.Types.ObjectId.isValid(l.invId) ? l.invId : null,
    itemName:  String(l.itemName || '').trim().slice(0, 200),
    itemCode:  String(l.itemCode || '').trim().slice(0, 60),
    unit:      String(l.unit || '').trim().slice(0, 20),
    packSize:  l.packSize != null && l.packSize !== '' ? Math.max(0, Number(l.packSize) || 0) : null,
    unitCost:  Math.max(0, money(l.unitCost)),
    notes:     String(l.notes || '').trim().slice(0, 300),
  });

  app.post('/api/suppliers/:id/products', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const entry = cleanCatalogEntry(req.body || {});
      if (!entry.itemName) return res.status(400).json({ success: false, error: 'Item name is required.' });
      if (!(entry.unitCost > 0)) return res.status(400).json({ success: false, error: 'A positive price is required.' });
      const supplier = await Supplier.findOneAndUpdate(
        { _id: req.params.id, ...tenantScope(req) },
        { $push: { catalog: entry } },
        { new: true }
      );
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      logAudit?.(req, { action: 'update', entity: 'supplier', entityId: supplier.supplierCode, after: { addedProduct: entry.itemName } });
      res.status(201).json({ success: true, supplier: supplier.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.patch('/api/suppliers/:id/products/:productId', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.productId)) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      const supplier = await Supplier.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      const entry = supplier.catalog.id(req.params.productId);
      if (!entry) return res.status(404).json({ success: false, error: 'Product not found on this supplier.' });

      const { itemName, itemCode, unit, packSize, unitCost, notes, invId } = req.body || {};
      if (itemName !== undefined) {
        const trimmed = String(itemName).trim().slice(0, 200);
        if (!trimmed) return res.status(400).json({ success: false, error: 'Item name is required.' });
        entry.itemName = trimmed;
      }
      if (itemCode !== undefined) entry.itemCode = String(itemCode).trim().slice(0, 60);
      if (unit !== undefined) entry.unit = String(unit).trim().slice(0, 20);
      if (packSize !== undefined) entry.packSize = packSize !== '' && packSize != null ? Math.max(0, Number(packSize) || 0) : null;
      if (unitCost !== undefined) {
        const cost = money(unitCost);
        if (!(cost > 0)) return res.status(400).json({ success: false, error: 'A positive price is required.' });
        entry.unitCost = cost;
      }
      if (notes !== undefined) entry.notes = String(notes).trim().slice(0, 300);
      if (invId !== undefined) entry.invId = invId && mongoose.Types.ObjectId.isValid(invId) ? invId : null;

      await supplier.save();
      logAudit?.(req, { action: 'update', entity: 'supplier', entityId: supplier.supplierCode, after: { editedProduct: entry.itemName } });
      res.json({ success: true, supplier: supplier.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.delete('/api/suppliers/:id/products/:productId', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.productId)) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      const supplier = await Supplier.findOneAndUpdate(
        { _id: req.params.id, ...tenantScope(req) },
        { $pull: { catalog: { _id: req.params.productId } } },
        { new: true }
      );
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      logAudit?.(req, { action: 'update', entity: 'supplier', entityId: supplier.supplierCode, after: { removedProduct: req.params.productId } });
      res.json({ success: true, supplier: supplier.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
