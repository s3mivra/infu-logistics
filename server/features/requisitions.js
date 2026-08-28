// requisitions routes - Requisition Slips gate two kinds of movement that used
// to happen immediately: a petty-cash/revolving-fund disbursement, and a new
// purchase order. Staff files a slip (Pending); only once it's Approved does
// the real movement happen (fund balance actually drops / a real PurchaseOrder
// is actually created). Mirrors the existing Bill approve/reject shape.
import { captureError } from '../lib/errorLog.js';

export default function registerRequisitions(ctx) {
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
    emitToAll,
    mkSeqRef,
    generateNextSequence,
    assertBalanced,
    acctMeta,
    JournalEntry,
    RevolvingFund,
    RevolvingFundTx,
    PurchaseOrder,
    RequisitionSlip,
    REQ_SLIP_STATUSES,
  } = ctx;

  // Dedicated permissions (#11) - decoupled from accounting.view/manage so
  // granting someone the general ledger doesn't silently also hand them the
  // Approvals queue, and vice versa.
  const canViewReq = [requireStaff, requirePermission('requisitions.view')];
  const canApproveReq = [requireStaff, requirePermission('requisitions.approve')];

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get('/api/requisition-slips', verifyToken, ...canViewReq, async (req, res) => {
    try {
      const filter = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status && REQ_SLIP_STATUSES.includes(req.query.status)) filter.status = req.query.status;
      if (req.query.type && ['petty-cash', 'procurement'].includes(req.query.type)) filter.type = req.query.type;
      const slips = await RequisitionSlip.find(filter).sort({ createdAt: -1 }).limit(500).lean();
      res.json({ success: true, slips });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.get('/api/requisition-slips/:id', verifyToken, ...canViewReq, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const slip = await RequisitionSlip.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!slip) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, slip });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ────────────────────────────────────────────────────────────────
  // Any staff can file a slip - they don't get to move money/create the PO
  // themselves, that's the whole point. Nothing here posts anything yet.
  app.post('/api/requisition-slips', verifyToken, requireStaff, async (req, res) => {
    try {
      const { type } = req.body || {};
      if (!['petty-cash', 'procurement', 'new-fund'].includes(type)) return res.status(400).json({ success: false, error: 'type must be "petty-cash", "procurement", or "new-fund".' });

      const year = new Date().getFullYear();
      const slipNumber = await generateNextSequence(RequisitionSlip, `REQ-${year}`, 'slipNumber');
      const preparedBy = req.user?.name || '';

      if (type === 'new-fund') {
        const { fundName, amount, description, sourceAccount } = req.body;
        const name = String(fundName || '').trim();
        if (!name) return res.status(400).json({ success: false, error: 'Fund name is required.' });
        const amt = Number(amount);
        if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Opening amount must be a positive number.' });
        const dup = await RevolvingFund.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, isActive: true });
        if (dup) return res.status(400).json({ success: false, error: `A fund named "${name}" already exists.` });

        const slip = await RequisitionSlip.create({
          slipNumber, type: 'new-fund', status: 'Pending',
          fundName: name, amount: amt, description: String(description || '').trim(),
          categoryCode: sourceAccount || '111000', // funding source account
          preparedBy,
        });
        await logAudit(req, { action: 'create', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber, type, amount: amt } });
        return res.json({ success: true, slip });
      }

      if (type === 'petty-cash') {
        const { fundId, amount, description, categoryCode } = req.body;
        if (!mongoose.Types.ObjectId.isValid(fundId || '')) return res.status(400).json({ success: false, error: 'A valid fund is required.' });
        const fund = await RevolvingFund.findOne({ _id: fundId, isActive: true });
        if (!fund) return res.status(404).json({ success: false, error: 'Fund not found.' });
        const amt = Number(amount);
        if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be a positive number.' });
        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description is required.' });
        // Balance is re-checked at approval time too (it can move between
        // filing and approval) - this is just an early, friendly reject.
        if (amt > fund.currentBalance) return res.status(400).json({ success: false, error: `Exceeds fund balance. Available: ₱${fund.currentBalance.toFixed(2)}` });

        const slip = await RequisitionSlip.create({
          slipNumber, type: 'petty-cash', status: 'Pending',
          fundId: fund._id, fundName: fund.name, amount: amt,
          description: description.trim(), categoryCode: categoryCode || '760000',
          preparedBy,
        });
        await logAudit(req, { action: 'create', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber, type, amount: amt } });
        return res.json({ success: true, slip });
      }

      // type === 'procurement'
      const { supplier, supplierId, expectedDate, lines, notes } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ success: false, error: 'At least one line item is required.' });
      const cleanLines = [];
      for (const l of lines) {
        const qty = Number(l.orderedQty), cost = Number(l.unitCost);
        if (!l.itemName?.trim() || !Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, error: 'Each line needs an item name and a positive quantity.' });
        cleanLines.push({
          invId: l.invId || null, itemName: String(l.itemName).trim(), itemCode: l.itemCode || '',
          unit: l.unit || '', packSize: l.packSize || null, orderedQty: qty, unitCost: Number.isFinite(cost) ? cost : 0,
          expiryDate: l.expiryDate ? new Date(l.expiryDate) : null, productionDate: l.productionDate ? new Date(l.productionDate) : null,
          expiryWarnDays: l.expiryWarnDays != null && l.expiryWarnDays !== '' ? Number(l.expiryWarnDays) || null : null,
          lowStockThreshold: l.lowStockThreshold != null && l.lowStockThreshold !== '' ? Number(l.lowStockThreshold) || null : null,
          stockLocation: l.stockLocation || null, stockCategory: l.stockCategory || null, creditAccount: l.creditAccount || null,
        });
      }
      const estTotal = +cleanLines.reduce((s, l) => s + l.orderedQty * l.unitCost, 0).toFixed(2);

      const slip = await RequisitionSlip.create({
        slipNumber, type: 'procurement', status: 'Pending',
        supplier: supplier || '', supplierId: mongoose.Types.ObjectId.isValid(supplierId || '') ? supplierId : null,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        lines: cleanLines, estTotal, notes: notes || '',
        preparedBy,
      });
      await logAudit(req, { action: 'create', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber, type, estTotal } });
      res.json({ success: true, slip });
    } catch (err) {
      log.error?.({ err }, 'POST /api/requisition-slips failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── APPROVE ───────────────────────────────────────────────────────────────
  // Executes the underlying movement, THEN marks the slip Approved with who
  // approved it - if the movement fails (e.g. fund balance moved since
  // filing), the slip stays Pending and nothing is half-done.
  app.post('/api/requisition-slips/:id/approve', verifyToken, ...canApproveReq, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const slip = await RequisitionSlip.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!slip) return res.status(404).json({ success: false, error: 'Not found' });
      if (slip.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending slip can be approved (this one is ${slip.status}).` });

      if (slip.type === 'new-fund') {
        const dup = await RevolvingFund.findOne({ name: { $regex: `^${slip.fundName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, isActive: true });
        if (dup) return res.status(400).json({ success: false, error: `A fund named "${slip.fundName}" already exists - reject this slip instead.` });

        // Mirrors POST /api/revolving-funds exactly (finance.js), just gated
        // behind approval instead of being immediate.
        const isCashLike = (c) => /^(111|112|113)/.test(String(c || ''));
        const srcCode = (acctMeta(slip.categoryCode) && isCashLike(slip.categoryCode)) ? slip.categoryCode : '111000';
        const srcName = acctMeta(srcCode)?.name || 'Cash on Hand';
        const amt = slip.amount;

        const fund = await RevolvingFund.create({
          name: slip.fundName, initialAmount: amt, currentBalance: amt,
          description: slip.description || '', createdBy: req.user?.name,
        });

        const reference = await mkSeqRef('RF-OPEN');
        const je = await JournalEntry.create({
          date: new Date(), description: `Revolving Fund established: ${slip.fundName} (from ${srcName}) [${slip.slipNumber}]`,
          lines: [
            { accountCode: '114000', accountName: 'Petty Cash / Revolving Fund', debit: amt, credit: 0 },
            { accountCode: srcCode, accountName: srcName, debit: 0, credit: amt },
          ],
          totalDebit: amt, totalCredit: amt, reference,
        });
        await RevolvingFundTx.create({
          fundId: fund._id, type: 'replenishment', amount: amt,
          description: `Fund opened: initial amount [${slip.slipNumber}]`,
          performedBy: slip.preparedBy, balanceAfter: amt, journalRef: je._id,
        });

        slip.resultRefId = String(fund._id);
        slip.resultRefLabel = reference;
        slip.status = 'Approved';
        slip.approvedBy = req.user?.name || '';
        slip.approvedAt = new Date();
        await slip.save();

        await logAudit(req, { action: 'approve', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber: slip.slipNumber, approvedBy: slip.approvedBy, fundId: fund._id } });
        emitToMgr('erpUpdated');
        return res.json({ success: true, slip, fund });
      }

      if (slip.type === 'petty-cash') {
        const fund = await RevolvingFund.findById(slip.fundId);
        if (!fund || !fund.isActive) return res.status(404).json({ success: false, error: 'Fund no longer exists or was closed.' });
        if (slip.amount > fund.currentBalance) return res.status(400).json({ success: false, error: `Insufficient fund balance. Available: ₱${fund.currentBalance.toFixed(2)}` });

        const { ACCOUNTS } = await import('../lib/chartOfAccounts.js');
        const expCode = slip.categoryCode || '760000';
        const expName = ACCOUNTS[expCode]?.name || acctMeta(expCode)?.name || 'Other Operating Expenses';

        fund.currentBalance = +(fund.currentBalance - slip.amount).toFixed(2);
        await fund.save();

        const reference = await mkSeqRef('RF-OUT');
        const je = await JournalEntry.create({
          date: new Date(), description: `Revolving Fund disbursement (${fund.name}): ${slip.description} [${slip.slipNumber}]`,
          lines: [
            { accountCode: expCode, accountName: expName, debit: slip.amount, credit: 0 },
            { accountCode: '114000', accountName: 'Petty Cash / Revolving Fund', debit: 0, credit: slip.amount },
          ],
          totalDebit: slip.amount, totalCredit: slip.amount,
          reference,
        });
        const tx = await RevolvingFundTx.create({
          fundId: fund._id, type: 'disbursement', amount: slip.amount,
          description: slip.description, categoryCode: expCode,
          performedBy: slip.preparedBy, balanceAfter: fund.currentBalance,
          journalRef: je._id,
        });

        slip.resultRefId = String(tx._id);
        slip.resultRefLabel = reference;
        slip.status = 'Approved';
        slip.approvedBy = req.user?.name || '';
        slip.approvedAt = new Date();
        await slip.save();

        await logAudit(req, { action: 'approve', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber: slip.slipNumber, approvedBy: slip.approvedBy } });
        emitToMgr('erpUpdated');
        return res.json({ success: true, slip, fund });
      }

      // type === 'procurement' - approval creates the real Purchase Order.
      const year = new Date(slip.expectedDate || Date.now()).getFullYear();
      const poNumber = await generateNextSequence(PurchaseOrder, `PO-${year}`, 'poNumber');
      const estTotal = +slip.lines.reduce((s, l) => s + l.orderedQty * l.unitCost, 0).toFixed(2);
      const po = await PurchaseOrder.create({
        poNumber, supplier: slip.supplier, supplierId: slip.supplierId || null,
        status: 'Ordered', expectedDate: slip.expectedDate,
        notes: `${slip.notes || ''}${slip.notes ? ' — ' : ''}Requisition ${slip.slipNumber}`.trim(),
        lines: slip.lines.map(l => ({
          invId: l.invId, itemName: l.itemName, itemCode: l.itemCode, unit: l.unit, packSize: l.packSize,
          orderedQty: l.orderedQty, unitCost: l.unitCost, expiryDate: l.expiryDate, productionDate: l.productionDate,
          expiryWarnDays: l.expiryWarnDays, lowStockThreshold: l.lowStockThreshold,
          stockLocation: l.stockLocation, stockCategory: l.stockCategory, creditAccount: l.creditAccount,
          receivedQty: null,
        })),
        estTotal, actualTotal: 0,
      });

      slip.resultRefId = String(po._id);
      slip.resultRefLabel = poNumber;
      slip.status = 'Approved';
      slip.approvedBy = req.user?.name || '';
      slip.approvedAt = new Date();
      await slip.save();

      await logAudit(req, { action: 'approve', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber: slip.slipNumber, approvedBy: slip.approvedBy, poNumber } });
      emitToAll('menuUpdated');
      emitToMgr('erpUpdated');
      res.json({ success: true, slip, purchaseOrder: po });
    } catch (err) {
      log.error?.({ err }, 'POST /api/requisition-slips/:id/approve failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── REJECT ────────────────────────────────────────────────────────────────
  app.post('/api/requisition-slips/:id/reject', verifyToken, ...canApproveReq, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { reason } = req.body || {};
      if (!reason?.trim()) return res.status(400).json({ success: false, error: 'A reason is required to reject a slip.' });
      const slip = await RequisitionSlip.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!slip) return res.status(404).json({ success: false, error: 'Not found' });
      if (slip.status !== 'Pending') return res.status(409).json({ success: false, error: `Only a Pending slip can be rejected (this one is ${slip.status}).` });

      slip.status = 'Rejected';
      slip.rejectedBy = req.user?.name || '';
      slip.rejectedAt = new Date();
      slip.rejectionReason = reason.trim().slice(0, 500);
      await slip.save();

      await logAudit(req, { action: 'reject', entity: 'RequisitionSlip', entityId: slip._id, after: { slipNumber: slip.slipNumber, reason: slip.rejectionReason } });
      res.json({ success: true, slip });
    } catch (err) {
      log.error?.({ err }, 'POST /api/requisition-slips/:id/reject failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
