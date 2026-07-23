// purchase-orders routes — procurement workflow (draft PO → reconcile delivery).
// Models/helpers/middleware live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
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
    Supplier,
    verifyToken,
    requireStaff,
    requireSuperAdmin,
    requirePermission,
  } = ctx;

  // Permission gates for this domain (superadmin bypasses inside requirePermission).
  const canView   = requirePermission('procurement.view');
  const canManage = requirePermission('procurement.manage');
  const canDelete = requirePermission('procurement.delete');

  // Round money to 2dp; guard against NaN from bad client input.
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Recompute estTotal from ordered qty × unit cost across all lines.
  const estTotalOf = (lines) =>
    money((lines || []).reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0));

  // Normalize an incoming line into our stored shape.
  const cleanLine = (l) => {
    const packSize = l.packSize === '' || l.packSize == null ? null : Math.max(0, Number(l.packSize) || 0);
    const exp = l.expiryDate ? new Date(l.expiryDate) : null;
    return {
      invId:      l.invId && mongoose.Types.ObjectId.isValid(l.invId) ? l.invId : null,
      itemName:   String(l.itemName || '').slice(0, 200),
      itemCode:   String(l.itemCode || '').slice(0, 60),
      unit:       String(l.unit || '').slice(0, 20),
      packSize:   packSize && packSize > 0 ? packSize : null,
      orderedQty: Math.max(0, Number(l.orderedQty) || 0),
      unitCost:   Math.max(0, money(l.unitCost)),
      expiryDate: exp && !Number.isNaN(exp.getTime()) ? exp : null,
      receivedQty: null,
    };
  };

  // ══ SUPPLIERS (managed directory) ═════════════════════════════════════════════
  app.get('/api/suppliers', verifyToken, requireStaff, canView, async (req, res) => {
    try {
      const q = { ...tenantScope(req) };
      if (req.query.active === 'true') q.isActive = true;
      const suppliers = await Supplier.find(q).sort({ name: 1 }).lean();
      res.json({ success: true, suppliers });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  app.post('/api/suppliers', verifyToken, requireStaff, canManage, async (req, res) => {
    try {
      const { name, contactPerson = '', phone = '', email = '', address = '', notes = '' } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
      const supplierCode = await mkSeqRef('SUP');
      const supplier = await Supplier.create({
        supplierCode,
        name: String(name).trim().slice(0, 200),
        contactPerson: String(contactPerson).slice(0, 200),
        phone: String(phone).slice(0, 60),
        email: String(email).slice(0, 200),
        address: String(address).slice(0, 500),
        notes: String(notes).slice(0, 1000),
        ...tenantScope(req),
      });
      logAudit?.(req, { action: 'create', entity: 'supplier', entityId: supplierCode, after: { name: supplier.name } });
      res.status(201).json({ success: true, supplier: supplier.toObject() });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  app.patch('/api/suppliers/:id', verifyToken, requireStaff, canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const supplier = await Supplier.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      const { name, contactPerson, phone, email, address, notes, isActive } = req.body || {};
      if (name !== undefined) {
        if (!String(name).trim()) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
        supplier.name = String(name).trim().slice(0, 200);
      }
      if (contactPerson !== undefined) supplier.contactPerson = String(contactPerson).slice(0, 200);
      if (phone !== undefined) supplier.phone = String(phone).slice(0, 60);
      if (email !== undefined) supplier.email = String(email).slice(0, 200);
      if (address !== undefined) supplier.address = String(address).slice(0, 500);
      if (notes !== undefined) supplier.notes = String(notes).slice(0, 1000);
      if (isActive !== undefined) supplier.isActive = !!isActive;
      await supplier.save();
      logAudit?.(req, { action: 'update', entity: 'supplier', entityId: supplier.supplierCode, after: { name: supplier.name, isActive: supplier.isActive } });
      res.json({ success: true, supplier: supplier.toObject() });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  app.delete('/api/suppliers/:id', verifyToken, requireStaff, canDelete, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const supplier = await Supplier.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!supplier) return res.status(404).json({ success: false, error: 'Not found' });
      await supplier.deleteOne();
      logAudit?.(req, { action: 'delete', entity: 'supplier', entityId: supplier.supplierCode });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  // ── LIST ────────────────────────────────────────────────────────────────────
  // GET /api/purchase-orders?status=Ordered&limit=100
  app.get('/api/purchase-orders', verifyToken, requireStaff, canView, async (req, res) => {
    try {
      const q = { ...tenantScope(req) };
      if (req.query.status && PO_STATUSES.includes(req.query.status)) q.status = req.query.status;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const pos = await PurchaseOrder.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      res.json({ success: true, purchaseOrders: pos });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  // ── SINGLE ──────────────────────────────────────────────────────────────────
  app.get('/api/purchase-orders/:id', verifyToken, requireStaff, canView, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) }).lean();
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, purchaseOrder: po });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  // ── CREATE (draft a planned PO) ───────────────────────────────────────────────
  // POST /api/purchase-orders  { supplier, expectedDate, notes, lines:[{invId,itemName,itemCode,unit,orderedQty,unitCost}] }
  app.post('/api/purchase-orders', verifyToken, requireStaff, canManage, async (req, res) => {
    try {
      const { supplier = '', supplierId = null, expectedDate = null, notes = '', lines = [] } = req.body || {};
      const clean = (Array.isArray(lines) ? lines : [])
        .map(cleanLine)
        .filter(l => l.itemName && l.orderedQty > 0);
      if (clean.length === 0) return res.status(400).json({ success: false, error: 'A purchase order needs at least one line with a name and quantity.' });

      const poNumber = await mkSeqRef('PO');
      const po = await PurchaseOrder.create({
        poNumber,
        supplier: String(supplier).slice(0, 200),
        supplierId: supplierId && mongoose.Types.ObjectId.isValid(supplierId) ? supplierId : null,
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
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  // ── UPDATE (edit draft header/lines, or move status Ordered↔Processing) ────────
  // PATCH /api/purchase-orders/:id  { supplier?, expectedDate?, notes?, status?, lines? }
  // Editing lines is only allowed before the PO is reconciled (Complete/Incomplete).
  app.patch('/api/purchase-orders/:id', verifyToken, requireStaff, canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      if (['Complete', 'Incomplete'].includes(po.status)) {
        return res.status(409).json({ success: false, error: 'This PO has already been received. Reconciled POs cannot be edited.' });
      }

      const { supplier, supplierId, expectedDate, notes, status, lines } = req.body || {};
      if (supplier !== undefined) po.supplier = String(supplier).slice(0, 200);
      if (supplierId !== undefined) po.supplierId = supplierId && mongoose.Types.ObjectId.isValid(supplierId) ? supplierId : null;
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
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  // ── RECEIVE (reconcile actual delivery) ───────────────────────────────────────
  // POST /api/purchase-orders/:id/receive  { received: [{ lineId?, index?, receivedQty }], notes? }
  // Sets receivedQty per line, computes actualTotal, and flips status to Complete
  // (every line received ≥ ordered) or Incomplete (any short). Terminal — the PO
  // becomes read-only afterward.
  app.post('/api/purchase-orders/:id/receive', verifyToken, requireStaff, canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      if (['Complete', 'Incomplete'].includes(po.status)) {
        return res.status(409).json({ success: false, error: 'This PO has already been received.' });
      }
      if (po.status === 'Cancelled') {
        return res.status(409).json({ success: false, error: 'Cancelled POs cannot be received.' });
      }

      const received = Array.isArray(req.body?.received) ? req.body.received : [];
      // Map incoming actuals onto lines — accept a line _id or a positional index.
      const byId = new Map();
      received.forEach((r, i) => {
        const key = r.lineId != null ? String(r.lineId) : (r.index != null ? `#${r.index}` : `#${i}`);
        byId.set(key, Math.max(0, Number(r.receivedQty) || 0));
      });
      po.lines.forEach((line, idx) => {
        let qty;
        if (byId.has(String(line._id))) qty = byId.get(String(line._id));
        else if (byId.has(`#${idx}`)) qty = byId.get(`#${idx}`);
        line.receivedQty = qty != null ? qty : 0;
      });

      const allFull = po.lines.every(l => (l.receivedQty ?? 0) >= (l.orderedQty || 0));
      po.status = allFull ? 'Complete' : 'Incomplete';
      po.actualTotal = money(po.lines.reduce((s, l) => s + (Number(l.receivedQty) || 0) * (Number(l.unitCost) || 0), 0));
      po.receivedAt = new Date();
      po.receivedBy = req.user?.name || '';
      if (req.body?.notes !== undefined) po.notes = String(req.body.notes).slice(0, 1000);
      await po.save();
      logAudit?.(req, { action: 'receive', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status, actualTotal: po.actualTotal } });
      res.json({ success: true, purchaseOrder: po.toObject() });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });

  // ── DELETE (only drafts / cancelled — never a reconciled record) ───────────────
  app.delete('/api/purchase-orders/:id', verifyToken, requireStaff, canDelete, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      if (['Complete', 'Incomplete'].includes(po.status)) {
        return res.status(409).json({ success: false, error: 'Received POs are permanent records and cannot be deleted. Cancel a draft instead.' });
      }
      await po.deleteOne();
      logAudit?.(req, { action: 'delete', entity: 'purchase_order', entityId: po.poNumber });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });
}
