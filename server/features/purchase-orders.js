// purchase-orders routes - procurement workflow (draft PO → reconcile delivery).
// Models/helpers/middleware live in server.js and arrive via ctx.
/* eslint-disable no-unused-vars */
import { title, lower, freeText, squish } from '../lib/normalize.js';
import { INPUT_VAT } from '../lib/vatPosting.js';
import { loadVatConfig } from '../lib/vatSettings.js';

import { captureError } from '../lib/errorLog.js';
import { addBatch, soonestExpiry, consumeBatches } from '../lib/expiry.js';
import { dayStart } from '../lib/reportRange.js';

export default function registerPurchaseOrders(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    mkSeqRef,
    tenantScope,
    acctMeta,
    assertBalanced,
    currentBranchCode,
    FixedAsset,
    FIXED_ASSET_CLASSES,
    Advance,
    CheckVoucher,
    issueCheckVoucher,
    logAudit,
    Settings,
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
  //
  // What a line IS has to survive this. It used to not: purchaseType and the
  // account codes were dropped here, so every line came out as stock however it
  // was sent. A PO for a dough mixer landed the machine in Inventory - where a
  // recipe could consume it - and booked a TRADE payable for equipment, while
  // the fixedAsset/expense handling downstream sat unreachable.
  const LINE_KINDS = new Set(['inventory', 'fixedAsset', 'expense']);
  const cleanLine = (l) => ({
    purchaseType:      LINE_KINDS.has(l.purchaseType) ? l.purchaseType : 'inventory',
    // Each kind carries only the account that means anything for it, so a line
    // switched from expense to stock cannot leave a stale code behind.
    assetAccountCode:  l.purchaseType === 'fixedAsset' ? String(l.assetAccountCode || '').slice(0, 20) : '',
    expenseAccountCode: l.purchaseType === 'expense' ? String(l.expenseAccountCode || '').slice(0, 20) : '',
    usefulLifeMonths:  l.purchaseType === 'fixedAsset' && l.usefulLifeMonths != null ? Math.max(1, Number(l.usefulLifeMonths) || 0) : null,
    salvageValue:      l.purchaseType === 'fixedAsset' ? Math.max(0, money(l.salvageValue)) : 0,
    // Only stock lines point at an inventory item.
    invId:             l.purchaseType && l.purchaseType !== 'inventory' ? null
                       : (l.invId && mongoose.Types.ObjectId.isValid(l.invId) ? l.invId : null),
    itemName:          String(l.itemName || '').slice(0, 200),
    itemCode:          String(l.itemCode || '').slice(0, 60),
    unit:              String(l.unit || '').slice(0, 20),
    packSize:          l.packSize != null && l.packSize !== '' ? Math.max(0, Number(l.packSize) || 0) : null,
    orderedQty:        Math.max(0, Number(l.orderedQty) || 0),
    unitCost:          Math.max(0, money(l.unitCost)),
    expiryDate:        l.expiryDate ? new Date(l.expiryDate) : null,
    productionDate:    l.productionDate ? new Date(l.productionDate) : null,
    expiryWarnDays:    l.expiryWarnDays != null ? Math.max(1, Number(l.expiryWarnDays) || 7) : null,
    lowStockThreshold: l.lowStockThreshold != null ? Math.max(0, Number(l.lowStockThreshold) || 0) : null,
    stockLocation:     l.stockLocation ? String(l.stockLocation).slice(0, 100) : null,
    stockCategory:     l.stockCategory ? String(l.stockCategory).slice(0, 100) : null,
    creditAccount:     l.creditAccount ? String(l.creditAccount).slice(0, 50) : null,
    receivedQty:       null,
  });

  // A non-stock line has to name an account the receipt can actually post to.
  // Without this the PO saves happily, the goods are received, and
  // postNonInventoryReceipt quietly returns null on an unroutable code - the
  // delivery lands with nothing whatsoever in the books.
  const lineRoutingError = (l) => {
    if (l.purchaseType === 'fixedAsset') {
      if (!FIXED_ASSET_CLASSES[l.assetAccountCode]) {
        return `"${l.itemName || 'A line'}" is equipment, so it needs an asset account (${Object.keys(FIXED_ASSET_CLASSES).join(', ')}).`;
      }
    } else if (l.purchaseType === 'expense') {
      const meta = acctMeta(l.expenseAccountCode);
      if (!meta || meta.type !== 'expense' || meta.isParent) {
        return `"${l.itemName || 'A line'}" is a service, so it needs an expense account to charge it to.`;
      }
    }
    return null;
  };

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
      const {
        supplier = '', supplierId = null, expectedDate = null, notes = '', lines = [],
        prepaid = false, prepaidAmount, prepaidDate, prepaidFromAccount,
      } = req.body || {};
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
      for (const l of clean) {
        const problem = lineRoutingError(l);
        if (problem) return res.status(400).json({ success: false, error: problem });
      }

      const poNumber = await mkSeqRef('PO');
      const po = await PurchaseOrder.create({
        poNumber,
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

      // Paid before delivery: book a supplier ADVANCE, not a payable. Nothing
      // is owed - the supplier owes us goods - so crediting A/P would overstate
      // what we owe while the cash has already gone out.
      let advance = null;
      if (prepaid) {
        const amt = money(prepaidAmount ?? po.estTotal);
        if (amt > 0) {
          advance = await createSupplierAdvanceForPO(req, po, amt, prepaidDate, prepaidFromAccount);
          po.prepaid = true;
          po.prepaidAmount = amt;
          po.prepaidDate = advance.date;
          po.prepaidFromAccount = advance.sourceAccount;
          po.advanceId = advance._id;
          po.advanceNumber = advance.advanceNumber;
          await po.save();
        }
      }

      logAudit?.(req, { action: 'create', entity: 'purchase_order', entityId: poNumber, after: { lines: clean.length, estTotal: po.estTotal, prepaid: !!advance } });
      res.status(201).json({ success: true, purchaseOrder: po.toObject(), advance: advance ? { _id: advance._id, advanceNumber: advance.advanceNumber, amount: advance.amount } : null });
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

      const { supplier, expectedDate, notes, status, lines } = req.body || {};
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
        for (const l of clean) {
          const problem = lineRoutingError(l);
          if (problem) return res.status(400).json({ success: false, error: problem });
        }
        po.lines = clean;
        po.estTotal = estTotalOf(clean);
      }
      await po.save();
      logAudit?.(req, { action: 'update', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status } });
      res.json({ success: true, purchaseOrder: po.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // A PO paid before delivery becomes a supplier advance (170200), not a
  // payable. It is an ASSET while it stands - the supplier owes us goods - and
  // receiving liquidates it rather than crediting A/P a second time.
  //
  //   pay now   DR 170200 Advances to Suppliers   CR cash
  //   receive   DR 130000 Inventory               CR 170200  (liquidation)
  //
  // Booking it as a payable instead would show money owed on an order already
  // settled, and once the cash also left, understate what we hold.
  const createSupplierAdvanceForPO = async (req, po, amount, when, fromAccount) => {
    const isCashLike = (c) => /^(111|112|113|114)/.test(String(c || ''));
    const srcCode = (acctMeta(fromAccount) && isCashLike(fromAccount)) ? fromAccount : '111000';
    const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';
    const txnDate = when ? dayStart(when) : new Date();

    const advanceNumber = await mkSeqRef('ADV');
    const reference = await mkSeqRef('ADV-JE');
    const lines = [
      { accountCode: '170200', accountName: acctMeta('170200')?.name || 'Advances to Suppliers', debit: amount, credit: 0 },
      { accountCode: srcCode, accountName: srcName, debit: 0, credit: amount },
    ];
    assertBalanced(lines, reference);
    await JournalEntry.create({
      date: txnDate, reference,
      description: `Prepayment on ${po.poNumber}${po.supplier ? ` to ${po.supplier}` : ''}`,
      supplierId: po.supplierId ? String(po.supplierId) : null,
      supplierName: po.supplier || '',
      lines, totalDebit: amount, totalCredit: amount,
    });

    const voucher = await issueCheckVoucher(req, {
      payeeType: 'supplier', payeeId: String(po.supplierId || ''), payeeName: po.supplier || 'Supplier',
      amount, purpose: 'advance', date: txnDate,
      sourceAccount: srcCode,
      referenceNumber: po.poNumber || '',
      notes: `Prepayment on ${po.poNumber}`,
      journalEntryRef: reference,
    });
    const voucherNumber = voucher?.voucherNumber || '';

    return Advance.create({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      advanceNumber, branchCode: await currentBranchCode(),
      type: 'supplier', payeeName: po.supplier || 'Supplier',
      payeeId: String(po.supplierId || ''),
      amount, purpose: `Prepayment on ${po.poNumber}`,
      account: '170200', sourceAccount: srcCode, sourceAccountName: srcName,
      referenceNumber: po.poNumber || '', journalEntryRef: reference,
      checkVoucherRef: voucherNumber, date: txnDate,
      issuedBy: req.user?.name || '',
    });
  };

  // Receiving something that is NOT stock.
  //
  //   fixedAsset  DR 1401xx asset            CR 225100 non-trade payable
  //               and the asset register entry is created here, so equipment
  //               bought on a PO is depreciable from day one instead of being
  //               re-keyed by hand later (or forgotten).
  //   expense     DR the expense account     CR 225200 non-trade payable
  //
  // Both credit a NON-TRADE payable. 220000 is what we owe for goods to sell
  // or consume; owing for a machine is a different obligation and the balance
  // sheet should not merge them.
  const postNonInventoryReceipt = async (req, line, kind, lineCost, delta, po, { fromAdvance = 0, lineVat = 0 } = {}) => {
    const rcvRef = await mkSeqRef('PO-RCV');
    const nameOf = (c, f) => acctMeta(c)?.name || f || c;
    const label = line.itemName || line.itemCode || 'item';

    let debitCode;
    let credCode;
    if (kind === 'fixedAsset') {
      debitCode = line.assetAccountCode;
      if (!FIXED_ASSET_CLASSES[debitCode]) return null;   // unroutable: leave it PO-only
      credCode = '225100';
    } else {
      debitCode = line.expenseAccountCode;
      const meta = acctMeta(debitCode);
      if (!meta || meta.type !== 'expense' || meta.isParent) return null;
      credCode = '225200';
    }
    // What the supplier is actually owed for this line - the cost plus any VAT
    // being claimed back. Crediting only the net would understate the debt by
    // exactly the VAT, and the input VAT would be claimed against nothing.
    const lineGross = money(lineCost + lineVat);
    // A prepayment settles the obligation up front, so what clears is the
    // advance - but only as far as the advance actually reaches. Anything
    // beyond it is a real payable the supplier can still invoice for.
    const advanceShare = Math.min(money(fromAdvance), lineGross);
    const payableShare = money(lineGross - advanceShare);

    const lines = [
      { accountCode: debitCode, accountName: nameOf(debitCode), debit: lineCost, credit: 0 },
      ...(lineVat > 0 ? [{ accountCode: INPUT_VAT.code, accountName: INPUT_VAT.name, debit: lineVat, credit: 0 }] : []),
      ...(advanceShare > 0 ? [{ accountCode: '170200', accountName: nameOf('170200', 'Advances to Suppliers'), debit: 0, credit: advanceShare }] : []),
      ...(payableShare > 0 ? [{ accountCode: credCode, accountName: nameOf(credCode), debit: 0, credit: payableShare }] : []),
    ];
    assertBalanced(lines, rcvRef);
    await JournalEntry.create({
      reference: rcvRef,
      description: `Received ${delta} x ${label} on ${po?.poNumber || 'PO'}${po?.supplier ? ` from ${po.supplier}` : ''} (${kind === 'fixedAsset' ? 'fixed asset' : 'expense'})`,
      supplierId: po?.supplierId ? String(po.supplierId) : null,
      supplierName: po?.supplier || '',
      lines, totalDebit: lineGross, totalCredit: lineGross,
    });

    if (kind === 'fixedAsset' && FixedAsset) {
      const assetCode = await mkSeqRef('FA');
      await FixedAsset.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        assetCode, branchCode: await currentBranchCode(),
        name: label, description: `Received on ${po?.poNumber || 'PO'}`,
        accountCode: debitCode,
        acquisitionDate: new Date(), acquisitionCost: lineCost,
        salvageValue: Math.max(0, Number(line.salvageValue) || 0),
        // A sensible default beats leaving it null and silently never
        // depreciating; it is editable on the asset afterwards.
        usefulLifeMonths: Number(line.usefulLifeMonths) > 0 ? Number(line.usefulLifeMonths) : 60,
        supplierName: po?.supplier || '', referenceNumber: po?.poNumber || '',
        journalEntryRef: rcvRef, createdBy: req.user?.name || '',
      });
    }
    return { rcvRef };
  };

  // ── RECEIPT POSTING ───────────────────────────────────────────────────────────
  // Moves a delivery's quantities into Inventory (weighted-average cost) and
  // books the matching journal entry. Only lines linked to a real Inventory item
  // (invId set) post - unlinked lines stay PO-only tracking, by design.
  //
  // Unit model: a PO line is priced and counted in PACKS, while Inventory holds
  // BASE units (ml/g/pcs). basePerPack = line.packSize × item.unitMultiplier, so
  // 10 packs of 1L milk with unitMultiplier 1000 posts 10,000 ml at ₱0.08/ml.
  //
  // A line is routed by its purchaseType. Only `inventory` touches stock; the
  // other two never should - an espresso machine in Inventory is both an
  // overstated stock figure and something a recipe could consume.
  const postReceiptToStock = async (req, deltas, po, { claimInputVat = false } = {}) => {
    const poVatCfg = await loadVatConfig(Settings);
    let totalCost = 0;
    // How much of this delivery the prepayment still covers. A PO prepaid for
    // less than it delivered is normal - the rest is owed - so the advance is
    // consumed line by line and whatever it no longer reaches becomes a genuine
    // payable rather than driving the advance account negative.
    let advanceLeft = 0;
    let advanceDoc = null;
    if (po?.prepaid && po.advanceId && Advance) {
      advanceDoc = await Advance.findById(po.advanceId);
      if (advanceDoc && advanceDoc.status !== 'Cancelled') {
        advanceLeft = money((advanceDoc.amount || 0) - (advanceDoc.liquidatedAmount || 0));
      }
    }
    let advanceUsed = 0;
    let payableTotal = 0;
    for (const { line, delta, expiryDate, productionDate } of deltas) {
      const kind = line.purchaseType || 'inventory';

      // What the supplier charges for this line, VAT included.
      const lineGross = money(delta * (Number(line.unitCost) || 0));
      // Creditable VAT is not part of what the goods cost: it is split out and
      // held in 170300, so stock is never carried at a VAT-inclusive price.
      const lineVat = claimInputVat && poVatCfg.enabled ? money(lineGross - lineGross / (1 + poVatCfg.rate)) : 0;
      const lineCost = money(lineGross - lineVat);

      if (kind !== 'inventory') {
        if (lineCost <= 0) continue;
        const share = Math.min(advanceLeft, lineGross);
        const out = await postNonInventoryReceipt(req, line, kind, lineCost, delta, po, { fromAdvance: share, lineVat });
        if (out) {
          advanceLeft = money(advanceLeft - share);
          advanceUsed = money(advanceUsed + share);
          payableTotal = money(payableTotal + (lineGross - share));
          totalCost = money(totalCost + lineGross);
        }
        continue;
      }

      if (!line.invId || !mongoose.Types.ObjectId.isValid(String(line.invId))) continue;
      const item = await Inventory.findById(line.invId);
      if (!item) continue;

      const basePerPack = (Number(line.packSize) || 1) * (Number(item.unitMultiplier) || 1);
      const baseQty = delta * basePerPack;
      if (baseQty <= 0) continue;

      const rcvRef = await mkSeqRef('PO-RCV');

      // WAC (GAAP/IFRS): blend the incoming batch into the existing holding.
      const currentValue = (Number(item.stockQty) || 0) * (Number(item.unitCost) || 0);
      const newStockQty = (Number(item.stockQty) || 0) + baseQty;
      item.unitCost = newStockQty > 0 ? (currentValue + lineCost) / newStockQty : 0;
      item.stockQty = newStockQty;

      // Expiry (FEFO), or production date for goods with no real expiry (roasted
      // beans, etc.): the actual delivery's date, entered at receiving time - may
      // differ from whatever was planned on the PO line at draft time.
      if (expiryDate || productionDate) {
        item.expiryBatches = addBatch(item.expiryBatches || [], {
          qty: baseQty,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          productionDate: productionDate ? new Date(productionDate) : null,
          receivedAt: new Date(),
          reference: rcvRef,
          unitCost: baseQty > 0 ? lineCost / baseQty : 0,
        });
        item.expiryDate = soonestExpiry(item.expiryBatches);
      }
      await item.save();

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
        // What the prepayment still covers on this line, and what is left owing.
        const fromAdvance = Math.min(advanceLeft, lineGross);
        const owedNow = money(lineGross - fromAdvance);
        // Credit A/P: a PO is a purchase on account. Paying the supplier is a
        // separate A/P settlement, not part of receiving the goods.
        await JournalEntry.create({
          reference: rcvRef,
          description: `Received ${delta} × ${line.itemName || item.itemName} on ${po?.poNumber || 'PO'}${po?.supplier ? ` from ${po.supplier}` : ''}`,
          // Attributed so the A/P view can answer "how much do we owe this
          // supplier?" without parsing descriptions.
          supplierId: po?.supplierId ? String(po.supplierId) : null,
          supplierName: po?.supplier || '',
          // On a PREPAID order the money already left and sits as a supplier
          // advance, so receiving clears that advance rather than creating a
          // payable - crediting A/P here would show money owed on an order
          // already settled.
          lines: [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: lineCost, credit: 0 },
            ...(lineVat > 0 ? [{ accountCode: INPUT_VAT.code, accountName: INPUT_VAT.name, debit: lineVat, credit: 0 }] : []),
            ...(fromAdvance > 0 ? [{ accountCode: '170200', accountName: acctMeta('170200')?.name || 'Advances to Suppliers', debit: 0, credit: fromAdvance }] : []),
            ...(owedNow > 0 ? [{ accountCode: '220000', accountName: 'Accounts Payable', debit: 0, credit: owedNow }] : []),
          ],
          totalDebit: lineGross,
          totalCredit: lineGross,
        });
        advanceLeft = money(advanceLeft - fromAdvance);
        advanceUsed = money(advanceUsed + fromAdvance);
        payableTotal = money(payableTotal + owedNow);
        totalCost = money(totalCost + lineGross);
      }
    }
    // The advance record must track the ledger exactly: it is liquidated by
    // what the entries above actually credited to 170200, no more. Applying
    // the whole delivery here - as this once did - would mark a prepayment
    // fully used up by a delivery it only partly covered.
    if (advanceDoc && advanceUsed > 0) {
      advanceDoc.liquidatedAmount = money((advanceDoc.liquidatedAmount || 0) + advanceUsed);
      advanceDoc.status = advanceDoc.liquidatedAmount >= advanceDoc.amount - 0.005 ? 'Liquidated' : 'Partially Liquidated';
      advanceDoc.liquidations.push({
        amount: advanceUsed, method: 'bill', reference: po.poNumber || '',
        note: `Goods received on ${po.poNumber}`, by: req.user?.name || '',
      });
      await advanceDoc.save();
    }
    // `payableTotal` is what the supplier can still invoice for - the part the
    // prepayment did not reach. It is what a bill may be raised for; billing
    // the whole delivery would demand money that has already left.
    return { totalCost, payableTotal };
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
      // expiryDate/productionDate (both optional) is the actual delivery's date for
      // that line, entered at receiving time - independent of whatever was planned
      // on the PO draft. productionDate is for goods with no real expiry (beans, etc.).
      const byId = new Map();
      received.forEach((r, i) => {
        const key = r.lineId != null ? String(r.lineId) : (r.index != null ? `#${r.index}` : `#${i}`);
        byId.set(key, { receivedQty: Math.max(0, Number(r.receivedQty) || 0), expiryDate: r.expiryDate || null, productionDate: r.productionDate || null });
      });
      // Collect this delivery's deltas per line BEFORE mutating, so stock posting
      // moves only what arrived now - a top-up delivery must not re-post the
      // quantities an earlier delivery already put into inventory.
      const deltas = [];
      po.lines.forEach((line, idx) => {
        let entry;
        if (byId.has(String(line._id))) entry = byId.get(String(line._id));
        else if (byId.has(`#${idx}`)) entry = byId.get(`#${idx}`);
        // Lines omitted from this delivery's payload are left untouched - NOT reset to 0.
        if (entry == null) return;
        const delta = entry.receivedQty;
        line.receivedQty = (Number(line.receivedQty) || 0) + delta;
        if (delta > 0) deltas.push({ line, delta, expiryDate: entry.expiryDate, productionDate: entry.productionDate });
      });

      const allFull = po.lines.every(l => (l.receivedQty ?? 0) >= (l.orderedQty || 0));
      po.status = allFull ? 'Complete' : 'Incomplete';
      po.actualTotal = money(po.lines.reduce((s, l) => s + (Number(l.receivedQty) || 0) * (Number(l.unitCost) || 0), 0));
      po.receivedAt = new Date();
      po.receivedBy = req.user?.name || '';
      if (req.body?.claimInputVat === true) po.inputVatClaimed = true;
      if (req.body?.notes !== undefined) po.notes = String(req.body.notes).slice(0, 1000);
      await po.save();

      // Post the delivery into stock and the books. Without this the PO flips to
      // Complete while inventory never moves - goods marked received that the
      // stock ledger never hears about.
      const posted = await postReceiptToStock(req, deltas, po, { claimInputVat: req.body?.claimInputVat === true });

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
      // A bill is a demand for payment. Raising one for a delivery already paid
      // for in advance asks for the money twice - approve and pay it and the
      // supplier is paid twice over, with A/P driven negative.
      if (posted.payableTotal > 0 && po.supplierId) {
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
          description: po.prepaid
            ? `Delivery received on ${po.poNumber} (balance beyond the prepayment)`
            : `Delivery received on ${po.poNumber}`,
          amount: posted.payableTotal,
          createdBy: req.user?.name || '',
        }).catch((err) => { captureError(req, err); return null; }); // a bill-creation failure shouldn't roll back a receipt that already posted
      }

      logAudit?.(req, { action: 'receive', entity: 'purchase_order', entityId: po.poNumber, after: { status: po.status, actualTotal: po.actualTotal, stockPosted: posted.totalCost, billNumber: bill?.billNumber } });
      if (posted.totalCost > 0) emitToMgr?.('erpUpdated');
      res.json({ success: true, purchaseOrder: po.toObject(), bill });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // -- RETURN TO SUPPLIER (debit memo) -------------------------------------------
  // POST /api/purchase-orders/:id/return  { lines: [{ lineId?, index?, qty }], reason }
  //
  // Goods arrive damaged, short, off-spec, or simply wrong, and go back. Until
  // now the only way to record that was an inventory adjustment, which takes the
  // stock out but leaves the supplier's invoice standing at the full amount - so
  // the business ends up paying for goods it returned, and the stock loss shows
  // up as shrinkage it never suffered.
  //
  // A return is the mirror of the receipt it reverses: stock leaves at the cost
  // it came in at, the creditable VAT claimed on it is given back, and the money
  // side lands wherever the money actually is - against the supplier's still-open
  // invoice first, and only the remainder as credit they hold for us, because a
  // debit memo against an invoice already paid does not un-pay it.
  app.post('/api/purchase-orders/:id/return', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
      if (!po) return res.status(404).json({ success: false, error: 'Not found' });
      if (!po.receivedAt) return res.status(409).json({ success: false, error: 'Nothing has been received on this PO yet, so there is nothing to send back.' });

      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ success: false, error: 'Say why the goods are going back - a return with no reason cannot be explained to the supplier or to an examiner.' });

      const wanted = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (!wanted.length) return res.status(400).json({ success: false, error: 'Pick at least one line to return.' });

      // Resolve each requested line against the PO, and check it against what
      // was actually received and not already sent back.
      const picks = [];
      for (const w of wanted) {
        const idx = w.lineId != null
          ? po.lines.findIndex(l => String(l._id) === String(w.lineId))
          : Number(w.index);
        const line = po.lines[idx];
        if (!line) return res.status(400).json({ success: false, error: 'One of the lines is not on this PO.' });
        const qty = Number(w.qty) || 0;
        if (qty <= 0) continue;
        if ((line.purchaseType || 'inventory') !== 'inventory') {
          return res.status(400).json({ success: false, error: 'Only stock lines can be returned here. Reverse a service or an asset through its own record.' });
        }
        const returnable = (Number(line.receivedQty) || 0) - (Number(line.returnedQty) || 0);
        if (qty > returnable + 1e-9) {
          return res.status(400).json({ success: false, error: `Only ${returnable} of ${line.itemName || 'that line'} can still be returned.` });
        }
        picks.push({ line, qty });
      }
      if (!picks.length) return res.status(400).json({ success: false, error: 'Pick at least one line to return.' });

      const vatCfg = await loadVatConfig(Settings);
      const rate = po.inputVatClaimed && vatCfg.enabled ? vatCfg.rate : 0;

      const retRef = await mkSeqRef('PO-RET');
      let grossTotal = 0, vatTotal = 0, costTotal = 0;
      const memoLines = [];

      for (const { line, qty } of picks) {
        const gross = money(qty * (Number(line.unitCost) || 0));
        const vat = rate > 0 ? money(gross - gross / (1 + rate)) : 0;
        const cost = money(gross - vat);

        if (line.invId && mongoose.Types.ObjectId.isValid(String(line.invId))) {
          const item = await Inventory.findById(line.invId);
          if (item) {
            const basePerPack = (Number(line.packSize) || 1) * (Number(item.unitMultiplier) || 1);
            const baseQty = qty * basePerPack;
            // Goods can only go back if they are still on the shelf. Letting the
            // count go negative would hide the real problem: stock recorded as
            // returned that had already been sold or consumed.
            if (baseQty > (Number(item.stockQty) || 0) + 1e-9) {
              return res.status(409).json({
                success: false,
                error: `Only ${item.stockQty} ${item.unit || ''} of ${item.itemName} is on hand - less than this return.`.replace(/\s+/g, ' '),
              });
            }
            item.stockQty = Number(((Number(item.stockQty) || 0) - baseQty).toFixed(6));
            // The batches leave oldest-first, the same way any other issue does.
            const consumed = consumeBatches(item.expiryBatches || [], baseQty);
            item.expiryBatches = consumed.batches;
            item.expiryDate = soonestExpiry(item.expiryBatches);
            await item.save();

            await StockCard.create({
              inventoryId: item._id,
              itemName: item.itemName,
              type: 'Adjustment',
              reference: retRef,
              qtyChange: -baseQty,
              unitCost: baseQty > 0 ? cost / baseQty : 0,
              balanceAfter: item.stockQty,
              remarks: `Returned to ${po.supplier || 'supplier'} on ${po.poNumber}: ${reason}`,
            });
          }
        }

        line.returnedQty = Number(((Number(line.returnedQty) || 0) + qty).toFixed(6));
        grossTotal = money(grossTotal + gross);
        vatTotal = money(vatTotal + vat);
        costTotal = money(costTotal + cost);
        memoLines.push({ itemName: line.itemName || '', qty, amount: gross });
      }

      if (grossTotal <= 0) return res.status(400).json({ success: false, error: 'The returned lines carry no cost, so there is nothing to credit.' });

      // Where the money side lands, in the order the money actually moved.
      //
      // A prepayment comes first: if this delivery was paid for up front, goods
      // going back mean the supplier is once again holding our money against a
      // delivery still owed - which is the advance, restored. Recording that as
      // a reduction of A/P would credit back a debt that never existed, and
      // recording it as supplier credit would quietly write the advance off.
      let restoredToAdvance = 0;
      let left = grossTotal;
      let advanceDoc = null;
      if (po.prepaid && po.advanceId && Advance) {
        advanceDoc = await Advance.findById(po.advanceId);
        if (advanceDoc && advanceDoc.status !== 'Cancelled') {
          // Never more than this PO actually consumed - the rest of the
          // prepayment is still sitting there untouched.
          restoredToAdvance = Math.min(money(advanceDoc.liquidatedAmount || 0), left);
          if (restoredToAdvance > 0) {
            advanceDoc.liquidatedAmount = money((advanceDoc.liquidatedAmount || 0) - restoredToAdvance);
            advanceDoc.status = advanceDoc.liquidatedAmount <= 0.005
              ? 'Open'
              : (advanceDoc.liquidatedAmount >= advanceDoc.amount - 0.005 ? 'Liquidated' : 'Partially Liquidated');
            advanceDoc.liquidations.push({
              amount: -restoredToAdvance, method: 'bill', reference: retRef,
              note: `Goods returned on ${po.poNumber}: ${reason}`, by: req.user?.name || '',
            });
            await advanceDoc.save();
            left = money(left - restoredToAdvance);
          }
        }
      }

      // Then an unpaid invoice simply gets smaller; once it is paid, the
      // supplier is holding our money and the balance becomes credit we can
      // spend on the next delivery.
      let appliedToBills = 0;
      const openBills = po.supplierId
        ? await Bill.find({ purchaseOrderId: po._id, status: { $nin: ['Paid', 'Rejected', 'Cancelled'] } }).sort({ createdAt: 1 })
        : [];
      for (const bill of openBills) {
        if (left <= 0) break;
        // Never below what has already been paid on it - that money really left.
        const reducible = money(bill.amount - (bill.paidAmount || 0));
        const cut = Math.min(reducible, left);
        if (cut <= 0) continue;
        bill.amount = money(bill.amount - cut);
        bill.description = `${bill.description || ''} (less ${retRef} returned)`.trim();
        if ((bill.paidAmount || 0) > 0 && bill.amount <= (bill.paidAmount || 0) + 0.01) {
          bill.status = 'Paid';
          bill.paidAt = bill.paidAt || new Date();
        }
        await bill.save();
        appliedToBills = money(appliedToBills + cut);
        left = money(left - cut);
      }
      const creditToSupplier = money(left);
      if (creditToSupplier > 0 && po.supplierId && Supplier) {
        await Supplier.updateOne({ _id: po.supplierId }, {
          $inc: { creditBalance: creditToSupplier },
          $push: { creditHistory: { type: 'adjusted', amount: creditToSupplier, reference: retRef, note: `Goods returned on ${po.poNumber}: ${reason}`, by: req.user?.name || '' } },
        });
      }

      // The books. Stock leaves at what it was carried at, the input VAT claimed
      // on it goes back, and the debit sits wherever the claim against the
      // supplier now lives.
      const debitLines = [];
      if (restoredToAdvance > 0) debitLines.push({ accountCode: '170200', accountName: acctMeta('170200')?.name || 'Advances to Suppliers', debit: restoredToAdvance, credit: 0 });
      if (appliedToBills > 0) debitLines.push({ accountCode: '220000', accountName: 'Accounts Payable', debit: appliedToBills, credit: 0 });
      if (creditToSupplier > 0) debitLines.push({ accountCode: '160100', accountName: acctMeta('160100')?.name || 'Supplier Credit Balance', debit: creditToSupplier, credit: 0 });

      await JournalEntry.create({
        reference: retRef,
        description: `Returned goods to ${po.supplier || 'supplier'} on ${po.poNumber}: ${reason}`,
        supplierId: po.supplierId ? String(po.supplierId) : null,
        supplierName: po.supplier || '',
        lines: [
          ...debitLines,
          { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: costTotal },
          ...(vatTotal > 0 ? [{ accountCode: INPUT_VAT.code, accountName: INPUT_VAT.name, debit: 0, credit: vatTotal }] : []),
        ],
        totalDebit: grossTotal,
        totalCredit: grossTotal,
      });

      po.returns.push({
        returnNumber: retRef, reason, amount: grossTotal, vatAmount: vatTotal,
        restoredToAdvance, appliedToBills, creditToSupplier, reference: retRef, lines: memoLines,
        by: req.user?.name || '',
      });
      // What we are actually keeping, and paying for.
      po.actualTotal = money(po.lines.reduce((sum, l) => sum + ((Number(l.receivedQty) || 0) - (Number(l.returnedQty) || 0)) * (Number(l.unitCost) || 0), 0));
      await po.save();

      logAudit?.(req, { action: 'return', entity: 'purchase_order', entityId: po.poNumber, after: { returnNumber: retRef, amount: grossTotal, restoredToAdvance, appliedToBills, creditToSupplier, reason } });
      emitToMgr?.('erpUpdated');
      res.json({ success: true, purchaseOrder: po.toObject(), debitMemo: { returnNumber: retRef, amount: grossTotal, vatAmount: vatTotal, restoredToAdvance, appliedToBills, creditToSupplier } });
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
      const { name, contactPerson = '', phone = '', email = '', address = '', notes = '', tin = '', registeredName = '', isVatRegistered } = req.body || {};
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
        tin: squish(tin).slice(0, 30),
        registeredName: freeText(registeredName).slice(0, 200),
        isVatRegistered: isVatRegistered === true,
        ...tenantScope(req),
      });
      logAudit?.(req, { action: 'create', entity: 'supplier', entityId: supplierCode });
      res.status(201).json({ success: true, supplier: supplier.toObject() });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Bulk onboarding from the downloaded template. A supplier list is the first
  // thing a business already has on paper, and typing forty of them one at a
  // time is the reason people give up on a new system in week one.
  //
  // A row that fails is reported and skipped rather than aborting the batch:
  // one bad email should not lose thirty-nine good suppliers. Existing names
  // are skipped rather than overwritten - re-importing a corrected sheet is a
  // normal thing to do, and clobbering a supplier someone has since edited by
  // hand would quietly undo their work.
  const SUPPLIER_IMPORT_MAX_ROWS = 500;
  app.post('/api/suppliers/import', verifyToken, ...canManageProc, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) return res.status(400).json({ success: false, error: 'No rows to import.' });
      if (rows.length > SUPPLIER_IMPORT_MAX_ROWS) {
        return res.status(400).json({ success: false, error: `Too many rows (${rows.length}) - import at most ${SUPPLIER_IMPORT_MAX_ROWS} at a time.` });
      }

      // One read instead of a findOne per row: a 500-row sheet was otherwise
      // 500 sequential round trips before a single supplier was written.
      const existing = await Supplier.find(tenantScope(req), { name: 1 }).lean();
      const seen = new Set(existing.map(s => String(s.name || '').toLowerCase()));

      const created = [];
      const skipped = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          // Accept the template's own column headings as well as the field
          // names, because the person filling it in reads the heading.
          const cleanName = title(r.name ?? r.Name ?? r['Supplier Name']);
          if (!cleanName) throw new Error('Supplier name is required.');
          if (seen.has(cleanName.toLowerCase())) throw new Error(`"${cleanName}" already exists.`);
          seen.add(cleanName.toLowerCase());

          const supplierCode = await mkSeqRef('SUP');
          await Supplier.create({
            supplierCode, name: cleanName,
            contactPerson: title(r.contactPerson ?? r.Contact ?? '').slice(0, 200),
            phone: squish(r.phone ?? r.Phone ?? '').slice(0, 40),
            email: lower(r.email ?? r.Email ?? '').slice(0, 200),
            address: freeText(r.address ?? r.Address ?? '').slice(0, 300),
            paymentTerms: freeText(r.paymentTerms ?? r.Terms ?? '').slice(0, 100),
            notes: freeText(r.notes ?? r.Notes ?? '').slice(0, 1000),
            ...tenantScope(req),
          });
          created.push({ row: i + 1, supplierCode, name: cleanName });
        } catch (e) {
          skipped.push({ row: i + 1, error: e.message, data: r });
        }
      }

      logAudit?.(req, { action: 'import', entity: 'supplier', entityId: 'bulk', after: { created: created.length, skipped: skipped.length } });
      res.json({ success: true, created: created.length, skipped, suppliers: created });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.patch('/api/suppliers/:id', verifyToken, ...canManageProc, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { name, contactPerson, phone, email, address, notes, isActive, tin, registeredName, isVatRegistered } = req.body || {};
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
      if (tin !== undefined) update.tin = squish(tin).slice(0, 30);
      if (registeredName !== undefined) update.registeredName = freeText(registeredName).slice(0, 200);
      if (typeof isVatRegistered === 'boolean') update.isVatRegistered = isVatRegistered;
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
