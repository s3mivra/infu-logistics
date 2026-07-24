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
    Inventory,
    StockCard,
    JournalEntry,
    assertBalanced,
    acctMeta,
    resolveUnit,
    addBatch,
    soonestExpiry,
    emitToMgr,
    log,
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

  // Apply one receiving event to a PO: `byId` maps each line to THIS DELIVERY's
  // quantity (a delta, not a cumulative total) — lines absent from the map are
  // left untouched, which is what lets a short delivery be reopened later and
  // just the outstanding lines submitted again. Every linked line (invId set)
  // posts its delta straight to Inventory via WAC costing + a shared journal
  // entry; unlinked lines only update the PO's own tracking. Runs inside a
  // Mongoose session when one is passed, or without (standalone-Mongo fallback)
  // when `session` is null/undefined — mirrors inventory.js's restock endpoint.
  const applyReceipt = async (po, byId, creditCode, creditName, notes, userName, session) => {
    const rcvRef = await mkSeqRef('PO-RCV');
    let totalDeltaCost = 0;
    for (let idx = 0; idx < po.lines.length; idx++) {
      const line = po.lines[idx];
      let delta = 0;
      if (byId.has(String(line._id))) delta = byId.get(String(line._id));
      else if (byId.has(`#${idx}`)) delta = byId.get(`#${idx}`);
      if (delta <= 0) continue;
      line.receivedQty = (line.receivedQty || 0) + delta;
      const deltaCost = money(delta * (line.unitCost || 0));

      if (line.invId) {
        const invQuery = Inventory.findById(line.invId);
        const inv = session ? await invQuery.session(session) : await invQuery;
        if (inv) {
          // Only a line actually linked to a real Inventory item moves the
          // books — an unlinked line (typed freehand, no invId) has nowhere
          // real to debit 130000 Inventory Asset, so it stays PO-only tracking.
          totalDeltaCost += deltaCost;
          // packSize is the line's per-pack size (in `line.unit`); when absent,
          // one "qty" IS one display unit — either way this resolves to base
          // units per one qty (mirrors client packInfo()/effectiveDisplay()).
          const { mult: unitMult } = resolveUnit(line.unit || inv.displayUnit || 'pcs');
          const packBase = line.packSize && line.packSize > 0 ? (line.packSize * unitMult) : unitMult;
          const deltaBaseQty = delta * packBase;
          const deltaUnitCostPerBase = deltaBaseQty > 0 ? deltaCost / deltaBaseQty : 0;

          const currentTotalValue = inv.stockQty * inv.unitCost;
          const newStockQty = inv.stockQty + deltaBaseQty;
          inv.unitCost = newStockQty > 0 ? (currentTotalValue + deltaCost) / newStockQty : inv.unitCost;
          inv.stockQty = newStockQty;

          if (line.expiryDate && deltaBaseQty > 0) {
            inv.expiryBatches = addBatch(inv.expiryBatches || [], {
              qty: deltaBaseQty, expiryDate: new Date(line.expiryDate),
              receivedAt: new Date(), reference: rcvRef, unitCost: deltaUnitCostPerBase,
            });
            inv.expiryDate = soonestExpiry(inv.expiryBatches);
          }
          if (session) await inv.save({ session }); else await inv.save();

          const scDoc = {
            inventoryId: inv._id, itemName: inv.itemName, type: 'PO Receive',
            reference: rcvRef, qtyChange: deltaBaseQty, unitCost: deltaUnitCostPerBase,
            balanceAfter: inv.stockQty, remarks: `Received ${po.poNumber}${po.supplier ? ' · ' + po.supplier : ''}`,
          };
          if (session) await StockCard.create([scDoc], { session }); else await StockCard.create(scDoc);
        }
      }
    }

    if (totalDeltaCost > 0.001) {
      const jeLines = [
        { accountCode: '130000', accountName: 'Inventory Asset', debit: totalDeltaCost, credit: 0 },
        { accountCode: creditCode, accountName: creditName, debit: 0, credit: totalDeltaCost },
      ];
      assertBalanced(jeLines, rcvRef);
      const jeDoc = {
        reference: rcvRef, description: `PO receipt: ${po.poNumber}${po.supplier ? ' from ' + po.supplier : ''}`,
        lines: jeLines, totalDebit: totalDeltaCost, totalCredit: totalDeltaCost,
      };
      if (session) await JournalEntry.create([jeDoc], { session }); else await JournalEntry.create(jeDoc);
    }

    const allFull = po.lines.every(l => (l.receivedQty ?? 0) >= (l.orderedQty || 0));
    po.status = allFull ? 'Complete' : 'Incomplete';
    po.actualTotal = money(po.lines.reduce((s, l) => s + (Number(l.receivedQty) || 0) * (Number(l.unitCost) || 0), 0));
    po.receivedAt = new Date();
    po.receivedBy = userName;
    if (notes !== undefined) po.notes = String(notes).slice(0, 1000);
    if (session) await po.save({ session }); else await po.save();
  };

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
  // Complete is fully terminal — nothing about it can change. Incomplete has real
  // inventory/journal postings tied to its lines already, so supplier/lines/dates
  // stay locked; the one thing still allowed is cancelling the OUTSTANDING balance
  // when the rest will never arrive — already-received stock is never reversed.
  app.patch('/api/purchase-orders/:id', verifyToken, requireStaff, canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });

      const { supplier, supplierId, expectedDate, notes, status, lines } = req.body || {};

      if (po.status === 'Complete') {
        return res.status(409).json({ success: false, error: 'This PO has been fully received. Reconciled POs cannot be edited.' });
      }
      if (po.status === 'Incomplete') {
        const touchesOtherFields = supplier !== undefined || supplierId !== undefined || expectedDate !== undefined || notes !== undefined || lines !== undefined;
        if (touchesOtherFields || status !== 'Cancelled') {
          return res.status(409).json({ success: false, error: 'This PO is partially received — only cancelling the remaining balance is allowed (already-received stock is unaffected).' });
        }
        po.status = 'Cancelled';
        await po.save();
        logAudit?.(req, { action: 'update', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status } });
        return res.json({ success: true, purchaseOrder: po.toObject() });
      }

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

  // ── RECEIVE (reconcile a delivery — repeatable until fully received) ───────────
  // POST /api/purchase-orders/:id/receive
  //   { received: [{ lineId?, index?, receivedQty }], notes?, creditAccount? }
  // `receivedQty` is THIS DELIVERY's quantity (a delta, not a cumulative total),
  // so a short delivery can be reopened later and just the outstanding lines
  // submitted again — lines omitted from `received` are left untouched. Each
  // linked line (invId set) posts its delta to Inventory (WAC costing) via a
  // journal entry (DR Inventory Asset / CR the chosen account, default Accounts
  // Payable); unlinked lines only update the PO's own tracking. Status becomes
  // Complete once every line's cumulative receivedQty ≥ orderedQty — only
  // Complete/Cancelled block further receiving, so Incomplete stays open.
  app.post('/api/purchase-orders/:id/receive', verifyToken, requireStaff, canManage, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });

    const isAllowedParent = (c) => /^(111|112|113|220)/.test(String(c || ''));
    const rawCredit = req.body?.creditAccount;
    const resolvedCredit = acctMeta(rawCredit);
    const creditCode = (resolvedCredit && isAllowedParent(rawCredit)) ? rawCredit : '220000';
    const creditName = acctMeta(creditCode)?.name || 'Accounts Payable';

    const received = Array.isArray(req.body?.received) ? req.body.received : [];
    const byId = new Map();
    received.forEach((r, i) => {
      const key = r.lineId != null ? String(r.lineId) : (r.index != null ? `#${r.index}` : `#${i}`);
      byId.set(key, Math.max(0, Number(r.receivedQty) || 0));
    });
    const notes = req.body?.notes;
    const userName = req.user?.name || '';

    const MAX_TXN_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_TXN_ATTEMPTS; attempt++) {
      const session = await mongoose.startSession();
      try {
        let savedPo = null;
        await session.withTransaction(async () => {
          const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) }).session(session);
          if (!po) throw Object.assign(new Error('Not found'), { httpStatus: 404 });
          if (po.status === 'Complete') throw Object.assign(new Error('This PO has already been fully received.'), { httpStatus: 409 });
          if (po.status === 'Cancelled') throw Object.assign(new Error('Cancelled POs cannot be received.'), { httpStatus: 409 });
          await applyReceipt(po, byId, creditCode, creditName, notes, userName, session);
          savedPo = po;
        });
        emitToMgr?.('erpUpdated');
        logAudit?.(req, { action: 'receive', entity: 'purchase_order', entityId: savedPo.poNumber, after: { status: savedPo.status, actualTotal: savedPo.actualTotal } });
        return res.json({ success: true, purchaseOrder: savedPo.toObject() });
      } catch (error) {
        // Standalone MongoDB without a replica set throws this — fall through to
        // the legacy non-transactional path so dev environments still work.
        const msg = String(error?.errorLabels || error?.message || '');
        const isTransient = (error?.errorLabels || []).includes('TransientTransactionError') || /WriteConflict/i.test(msg);
        if (isTransient && attempt < MAX_TXN_ATTEMPTS) continue;
        if (error?.httpStatus) return res.status(error.httpStatus).json({ success: false, error: error.message });
        const isUnsupported = /Transaction numbers are only allowed|Transactions are not supported/i.test(msg);
        if (isUnsupported && attempt === 1) {
          log?.warn?.('PO receive txn unsupported, falling back to non-transactional path.');
          try {
            const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
            if (!po) return res.status(404).json({ success: false, error: 'Not found' });
            if (po.status === 'Complete') return res.status(409).json({ success: false, error: 'This PO has already been fully received.' });
            if (po.status === 'Cancelled') return res.status(409).json({ success: false, error: 'Cancelled POs cannot be received.' });
            await applyReceipt(po, byId, creditCode, creditName, notes, userName, null);
            emitToMgr?.('erpUpdated');
            logAudit?.(req, { action: 'receive', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status, actualTotal: po.actualTotal, fallback: true } });
            return res.json({ success: true, purchaseOrder: po.toObject() });
          } catch (fallbackErr) {
            return res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : fallbackErr.message });
          }
        }
        return res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : error.message });
      } finally {
        session.endSession();
      }
    }
  });

  // ── DELETE (only drafts / cancelled — never a reconciled record) ───────────────
  app.delete('/api/purchase-orders/:id', verifyToken, requireStaff, canDelete, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      // Block on status AND on any real receiving activity — a PO that was
      // Incomplete then cancelled still has genuine StockCard/JournalEntry
      // postings tied to its poNumber for whatever WAS received; deleting the
      // PO record would orphan that audit trail.
      const hasReceivedActivity = (po.lines || []).some(l => (l.receivedQty || 0) > 0);
      if (['Complete', 'Incomplete'].includes(po.status) || hasReceivedActivity) {
        return res.status(409).json({ success: false, error: 'This PO has received activity posted to inventory and is a permanent record — it cannot be deleted.' });
      }
      await po.deleteOne();
      logAudit?.(req, { action: 'delete', entity: 'purchase_order', entityId: po.poNumber });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
  });
}
