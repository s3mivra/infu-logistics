// Inter-business hub: invite handshake + cross-tenant stock transfers.
// All routes that accept calls FROM partner APIs use x-link-token auth
// (requireLinkToken), not JWT - each tenant has its own JWT_SECRET so
// partner JWTs are never valid here.
import crypto from 'node:crypto';

const TENANT = (() => {
  const m = (process.env.MONGO_URI || '').match(/\/semivra_([^?/]+)/);
  return m ? m[1] : 'unknown';
})();
// HUB_URL_PATTERN: override in .env for non-Docker deployments.
// Use {slug} as the placeholder, e.g. https://{slug}.semivra.app
const HUB_URL_PATTERN = process.env.HUB_URL_PATTERN || 'http://{slug}-api:5002';
const hubUrlFor = (slug) => HUB_URL_PATTERN.replace('{slug}', slug);
const SELF_URL = hubUrlFor(TENANT);

export default function registerHub(ctx) {
  const {
    app, BUSINESS_TYPE, mongoose,
    LinkedBusiness, HubInvite, CrossTransfer,
    TransferRequest, TRANSFER_REQUEST_STATUSES,
    Inventory, StockCard, JournalEntry, Order,
    verifyToken,
    requireStaff: requireAuth, requireSuperAdmin,
    logAudit,
    mkSeqRef,
  } = ctx;

  // Internal auth: partner calls use a shared linkToken
  async function requireLinkToken(req, res, next) {
    const token = req.get('x-link-token');
    if (!token) return res.status(401).json({ error: 'Missing link token.' });
    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, linkToken: token, status: 'active' }).lean();
    if (!link) return res.status(403).json({ error: 'Invalid link token.' });
    req.linkedPartner = link;
    next();
  }

  async function partnerCall(link, path, body) {
    const res = await fetch(`${link.partnerUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-link-token': link.linkToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Partner returned ${res.status}`);
    return data;
  }

  // Double-entry journal entry for hub stock movements.
  async function postHubJE({ reference, description, debitCode, debitName, creditCode, creditName, amount }) {
    if (!(amount > 0)) return;
    await JournalEntry.create({
      date: new Date(),
      reference,
      description,
      lines: [
        { accountCode: debitCode,  accountName: debitName,  debit: amount, credit: 0 },
        { accountCode: creditCode, accountName: creditName, debit: 0, credit: amount },
      ],
      totalDebit: amount,
      totalCredit: amount,
    });
  }

  // Hub info
  app.get('/api/hub/info', verifyToken, requireAuth, async (req, res) => {
    const links = await LinkedBusiness.find({ businessType: BUSINESS_TYPE }).sort({ createdAt: -1 }).lean();
    res.json({ tenant: TENANT, selfUrl: SELF_URL, links });
  });

  // ── Network Overview (#12): unified inventory + branch comparison + central
  // reporting across every linked business. Each business is a fully separate
  // deployment/database (see partnerUrl/HUB_URL_PATTERN above) - there is no
  // shared DB to query, so this works the same way transfers do: call each
  // active partner's own API for a read-only snapshot, using the same
  // link-token trust already established for transfers, and merge the results
  // here. Best-effort per partner - one unreachable partner doesn't blank out
  // the rest of the network.
  const ownSnapshot = async () => {
    const [items, todayAgg, monthAgg] = await Promise.all([
      Inventory.find({ businessType: BUSINESS_TYPE }, { itemName: 1, stockQty: 1, unit: 1 }).lean(),
      Order.aggregate([
        { $match: { businessType: BUSINESS_TYPE, status: 'Completed', createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { businessType: BUSINESS_TYPE, status: 'Completed', createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]),
    ]);
    return {
      tenant: TENANT,
      inventory: items.map(i => ({ itemName: i.itemName, stockQty: i.stockQty, unit: i.unit })),
      today: { revenue: todayAgg[0]?.revenue || 0, orders: todayAgg[0]?.orders || 0 },
      month: { revenue: monthAgg[0]?.revenue || 0, orders: monthAgg[0]?.orders || 0 },
    };
  };

  // What a linked partner calls to pull OUR snapshot for THEIR network view.
  app.get('/api/hub/internal/summary', requireLinkToken, async (req, res) => {
    try {
      res.json(await ownSnapshot());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // What the current business's own dashboard calls to build the unified view:
  // its own snapshot plus every active partner's (pulled live, in parallel).
  app.get('/api/hub/network-summary', verifyToken, requireAuth, async (req, res) => {
    try {
      const links = await LinkedBusiness.find({ businessType: BUSINESS_TYPE, status: 'active' }).lean();
      const own = await ownSnapshot();
      const partners = await Promise.all(links.map(async (link) => {
        try {
          const r = await fetch(`${link.partnerUrl}/api/hub/internal/summary`, {
            headers: { 'x-link-token': link.linkToken },
            signal: AbortSignal.timeout(8_000),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || `Partner returned ${r.status}`);
          return { partnerSlug: link.partnerSlug, partnerName: link.partnerName, dashboardUrl: link.partnerUrl, ok: true, ...data };
        } catch (err) {
          return { partnerSlug: link.partnerSlug, partnerName: link.partnerName, dashboardUrl: link.partnerUrl, ok: false, error: err.message };
        }
      }));
      res.json({ own, partners });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate invite code (superadmin only)
  app.post('/api/hub/invite', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    const code = `${TENANT}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await HubInvite.create({ businessType: BUSINESS_TYPE, code, expiresAt });
    res.json({ code, expiresAt });
  });

  // Redeem partner's invite code (this business becomes the client)
  app.post('/api/hub/redeem', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    const { code } = req.body || {};
    if (!String(code || '').trim()) return res.status(400).json({ error: 'code is required.' });

    const parts = String(code).trim().split('-');
    if (parts.length < 2) return res.status(400).json({ error: 'Invalid code format. Paste the full code your hub gave you.' });
    const hubSlug = parts[0];
    if (hubSlug === TENANT) return res.status(400).json({ error: 'Cannot link to yourself.' });

    const hubUrl = hubUrlFor(hubSlug);
    const linkToken = crypto.randomBytes(32).toString('hex');

    let hubData;
    try {
      hubData = await fetch(`${hubUrl}/api/hub/internal/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(code).trim(), clientSlug: TENANT, clientUrl: SELF_URL, linkToken }),
        signal: AbortSignal.timeout(20_000),
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Hub returned ${r.status}`);
        return d;
      });
    } catch (e) {
      return res.status(502).json({ error: `Could not reach hub (${hubSlug}): ${e.message}` });
    }

    await LinkedBusiness.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, partnerSlug: hubSlug },
      { role: 'client', partnerName: hubData.hubName || hubSlug, partnerUrl: hubUrl, linkToken, status: 'active', linkedAt: new Date() },
      { upsert: true, new: true },
    );

    res.json({ ok: true, hubSlug, hubName: hubData.hubName });
  });

  // Internal: hub confirms handshake (called by client during redeem)
  app.post('/api/hub/internal/handshake', async (req, res) => {
    const { code, clientSlug, clientUrl, linkToken } = req.body || {};
    if (!code || !clientSlug || !linkToken) return res.status(400).json({ error: 'Missing fields.' });

    const invite = await HubInvite.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, code, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invite code.' });

    await LinkedBusiness.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, partnerSlug: clientSlug },
      { role: 'hub', partnerName: clientSlug, partnerUrl: clientUrl || hubUrlFor(clientSlug), linkToken, status: 'active', linkedAt: new Date() },
      { upsert: true, new: true },
    );

    res.json({ ok: true, hubName: TENANT });
  });

  // Disconnect a partner
  app.delete('/api/hub/links/:partnerSlug', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    await LinkedBusiness.deleteOne({ businessType: BUSINESS_TYPE, partnerSlug: req.params.partnerSlug });
    res.json({ ok: true });
  });

  // Cross-transfer list
  app.get('/api/hub/transfers', verifyToken, requireAuth, async (req, res) => {
    const transfers = await CrossTransfer.find({ businessType: BUSINESS_TYPE })
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json({ transfers });
  });

  // Request an outbound shipment - multi-item stock transfer slip.
  //
  // This is NOT the same thing as the Transfer tab inside Inventory. That one
  // shuffles stock between two locations of the SAME business (one set of
  // books, one inventory - see /api/stock-transfers). This one moves stock to
  // a DIFFERENT business in the hub network, so it leaves our books entirely
  // and lands on theirs.
  //
  // Because of that, it goes through the same gate as an internal stock
  // transfer or a requisition: the slip is filed here as 'Requested', and the
  // partner is only notified once it has been approved. Nothing crosses a
  // business boundary on one person's say-so.
  //
  // Body: { partnerSlug, items: [{itemId, qty, batchIdx?, note?}] }
  app.post('/api/hub/transfers/send', verifyToken, requireAuth, async (req, res) => {
    const { partnerSlug, items } = req.body || {};
    if (!partnerSlug || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'partnerSlug and items[] are required.' });
    }

    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug, status: 'active' }).lean();
    if (!link) return res.status(404).json({ error: 'No active link with that partner.' });

    const shipmentRef = `HT-${Date.now().toString(36).toUpperCase()}`;
    const created = [];
    const errors  = [];

    for (const line of items) {
      const { itemId, qty, batchIdx, note } = line;
      if (!itemId || !(Number(qty) > 0)) { errors.push(`Invalid line`); continue; }

      const item = await Inventory.findOne({ _id: itemId, businessType: BUSINESS_TYPE }).lean();
      if (!item) { errors.push(`Item not found.`); continue; }
      if (item.stockQty < Number(qty)) {
        errors.push(`Insufficient stock for ${item.itemName}. On hand: ${item.stockQty} ${item.unit}.`);
        continue;
      }

      let batchInfo;
      if (batchIdx != null && item.expiryBatches?.[batchIdx]) {
        const b = item.expiryBatches[batchIdx];
        batchInfo = { expiryDate: b.expiryDate, batchIdx: Number(batchIdx) };
      }

      const reference = `${shipmentRef}-L${created.length + 1}`;
      const transfer = await CrossTransfer.create({
        businessType: BUSINESS_TYPE,
        direction: 'outbound',
        partnerSlug,
        partnerName: link.partnerName || partnerSlug,
        itemId: item._id,
        itemName: item.itemName,
        unit: item.unit,
        qtyBase: Number(qty),
        // Snapshot what the goods are and what they are worth, so the receiving
        // business books them at real value instead of creating a zero-cost item.
        unitCost: Number(item.unitCost) || 0,
        displayUnit: item.displayUnit || '',
        unitMultiplier: Number(item.unitMultiplier) || 1,
        packSize: item.packSize ?? null,
        itemCode: item.itemCode || '',
        stockCategory: item.stockCategory || '',
        note: String(note || '').trim(),
        reference,
        shipmentRef,
        batchInfo,
        status: 'Requested',
        requestedBy: req.user?.name || '',
      });
      created.push(transfer);
    }

    if (created.length === 0) return res.status(400).json({ error: errors.join('; ') });

    try {
      await logAudit?.(req, {
        action: 'create', entity: 'CrossTransfer', entityId: shipmentRef,
        after: { partnerSlug, lines: created.length, status: 'Requested' },
      });
    } catch { /* audit is non-fatal */ }

    res.json({
      ok: true, shipmentRef, transfers: created,
      status: 'Requested',
      message: 'Transfer slip filed - awaiting approval before the partner is notified.',
      errors: errors.length ? errors : undefined,
    });
  });

  // ── APPROVE an outbound transfer slip ──────────────────────────────────────
  // Approving is what actually sends: stock availability is re-checked here
  // (it can have been sold or transferred away since the slip was filed), the
  // lines flip to 'Pending', and only then is the partner told to expect them.
  // If the partner can't be reached the slip stays 'Requested' so approving
  // again retries cleanly - a half-sent shipment is worse than an unsent one.
  app.post('/api/hub/transfers/approve', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    const { shipmentRef } = req.body || {};
    if (!shipmentRef) return res.status(400).json({ error: 'shipmentRef is required.' });

    const lines = await CrossTransfer.find({
      businessType: BUSINESS_TYPE, shipmentRef, direction: 'outbound', status: 'Requested',
    });
    if (!lines.length) return res.status(404).json({ error: 'No pending transfer request found for that slip.' });

    const link = await LinkedBusiness.findOne({
      businessType: BUSINESS_TYPE, partnerSlug: lines[0].partnerSlug, status: 'active',
    }).lean();
    if (!link) return res.status(404).json({ error: 'No active link with that partner.' });

    // Re-validate stock at approval time, not just at request time.
    const shortages = [];
    for (const t of lines) {
      const item = await Inventory.findOne({ _id: t.itemId, businessType: BUSINESS_TYPE }, { itemName: 1, stockQty: 1, unit: 1 }).lean();
      if (!item) { shortages.push(`${t.itemName}: item no longer exists.`); continue; }
      if (item.stockQty < t.qtyBase) shortages.push(`${item.itemName}: need ${t.qtyBase}${t.unit}, only ${item.stockQty}${item.unit} on hand.`);
    }
    if (shortages.length) return res.status(409).json({ error: `Cannot approve - stock changed since this slip was filed. ${shortages.join(' ')}` });

    try {
      await partnerCall(link, '/api/hub/internal/transfer-notify', {
        shipmentRef,
        fromSlug: TENANT,
        fromName: TENANT,
        items: lines.map(t => ({
          reference: t.reference,
          itemName:  t.itemName,
          unit:      t.unit,
          qtyBase:   t.qtyBase,
          note:      t.note,
          // Descriptors travel with the shipment - see the snapshot comment on
          // CrossTransferSchema. A partner running an older build simply
          // ignores the extra fields.
          unitCost:       t.unitCost,
          displayUnit:    t.displayUnit,
          unitMultiplier: t.unitMultiplier,
          packSize:       t.packSize,
          itemCode:       t.itemCode,
          stockCategory:  t.stockCategory,
        })),
      });
    } catch (e) {
      return res.status(502).json({ error: `Approved nothing - could not notify partner: ${e.message}. The slip is still awaiting approval; try again.` });
    }

    const approvedAt = new Date();
    await CrossTransfer.updateMany(
      { businessType: BUSINESS_TYPE, shipmentRef, direction: 'outbound', status: 'Requested' },
      { $set: { status: 'Pending', approvedBy: req.user?.name || '', approvedAt } },
    );

    try {
      await logAudit?.(req, {
        action: 'approve', entity: 'CrossTransfer', entityId: shipmentRef,
        after: { partnerSlug: lines[0].partnerSlug, lines: lines.length, approvedAt },
      });
    } catch { /* audit is non-fatal */ }

    const transfers = await CrossTransfer.find({ businessType: BUSINESS_TYPE, shipmentRef, direction: 'outbound' }).lean();
    res.json({ ok: true, shipmentRef, transfers });
  });

  // ── REJECT an outbound transfer slip (before it is sent) ───────────────────
  // No stock or ledger movement has happened yet at 'Requested', so this only
  // closes the slip. The partner was never told about it, so nobody to notify.
  app.post('/api/hub/transfers/reject', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    const { shipmentRef, reason } = req.body || {};
    if (!shipmentRef) return res.status(400).json({ error: 'shipmentRef is required.' });

    const result = await CrossTransfer.updateMany(
      { businessType: BUSINESS_TYPE, shipmentRef, direction: 'outbound', status: 'Requested' },
      { $set: { status: 'Rejected', rejectedBy: req.user?.name || '', rejectionReason: String(reason || '').trim().slice(0, 500) } },
    );
    if (!result.modifiedCount) return res.status(404).json({ error: 'No pending transfer request found for that slip.' });

    try {
      await logAudit?.(req, { action: 'reject', entity: 'CrossTransfer', entityId: shipmentRef, after: { lines: result.modifiedCount, reason: reason || '' } });
    } catch { /* audit is non-fatal */ }

    res.json({ ok: true, shipmentRef, rejected: result.modifiedCount });
  });

  // Internal: partner notifies us of inbound transfers
  app.post('/api/hub/internal/transfer-notify', requireLinkToken, async (req, res) => {
    const { shipmentRef, fromSlug, fromName, items } = req.body || {};
    const lines = Array.isArray(items) ? items : [];
    for (const line of lines) {
      await CrossTransfer.create({
        businessType: BUSINESS_TYPE,
        direction: 'inbound',
        partnerSlug: fromSlug,
        partnerName: fromName || fromSlug,
        itemName: line.itemName,
        unit: line.unit,
        qtyBase: Number(line.qtyBase),
        // Defaults keep a partner on an older build (which sends none of these)
        // working - it just receives at zero cost, exactly as before.
        unitCost: Number(line.unitCost) || 0,
        displayUnit: line.displayUnit || '',
        unitMultiplier: Number(line.unitMultiplier) || 1,
        packSize: line.packSize ?? null,
        itemCode: line.itemCode || '',
        stockCategory: line.stockCategory || '',
        note: String(line.note || '').trim(),
        reference: line.reference,
        shipmentRef,
        status: 'Pending',
      });
    }
    res.json({ ok: true });
  });

  // Accept inbound transfer - receive stock + post ledger JE
  app.post('/api/hub/transfers/:id/accept', verifyToken, requireAuth, async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Pending',
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found or not pending.' });

    const { itemId, createNew } = req.body || {};
    // What the goods were worth when they left the sending business. Falls back
    // to the receiving item's own cost only when the sender told us nothing
    // (a partner on an older build), so a shipment is never valued at zero
    // just because the target item is new.
    const incomingUnitCost = Number(transfer.unitCost) || 0;

    let targetItem;
    if (itemId) {
      targetItem = await Inventory.findOne({ _id: itemId, businessType: BUSINESS_TYPE });
      if (!targetItem) return res.status(404).json({ error: 'Target inventory item not found.' });
    } else if (createNew) {
      // Carry the sender's descriptors through, so the new item arrives fully
      // formed - named, priced, and with its display unit and pack size - not
      // as a zero-cost stub someone has to go and fix by hand.
      targetItem = await Inventory.create({
        businessType: BUSINESS_TYPE,
        itemName: transfer.itemName,
        unit: transfer.unit,
        stockQty: 0,
        unitCost: incomingUnitCost,
        displayUnit: transfer.displayUnit || transfer.unit || '',
        unitMultiplier: Number(transfer.unitMultiplier) || 1,
        ...(transfer.packSize != null ? { packSize: transfer.packSize } : {}),
        ...(transfer.stockCategory ? { stockCategory: transfer.stockCategory } : {}),
      });
    } else {
      return res.status(400).json({ error: 'Provide itemId to receive into, or set createNew:true to auto-create.' });
    }

    // Value the receipt at the incoming cost; only fall back to the target's
    // own carrying cost if the sender sent none.
    const costBasis = incomingUnitCost > 0 ? incomingUnitCost : (targetItem.unitCost || 0);
    const receivedValue = costBasis * transfer.qtyBase;

    // Weighted average cost, the same rule the restock path uses - receiving
    // 100 units at PHP 12 into 100 units carried at PHP 10 must move the
    // average to PHP 11, not silently keep the old cost or overwrite it.
    const priorValue = (targetItem.stockQty || 0) * (targetItem.unitCost || 0);
    targetItem.stockQty += transfer.qtyBase;
    if (targetItem.stockQty > 0 && costBasis > 0) {
      targetItem.unitCost = (priorValue + receivedValue) / targetItem.stockQty;
    }
    // A brand-new item auto-created above has no display unit of its own yet.
    if (!targetItem.displayUnit && transfer.displayUnit) {
      targetItem.displayUnit = transfer.displayUnit;
      targetItem.unitMultiplier = Number(transfer.unitMultiplier) || 1;
    }
    await targetItem.save();

    // StockCardSchema fields are inventoryId/type/qtyChange/balanceAfter/remarks.
    // This used to write itemId/movementType/qty/note, which mongoose's strict
    // mode silently DROPPED - leaving a card with no item and no quantity, so a
    // hub transfer never showed up under the item's History action even though
    // the stock and the ledger had both moved.
    await StockCard.create([{
      inventoryId: targetItem._id,
      itemName: targetItem.itemName,
      type: 'Transfer In',
      reference: transfer.reference,
      qtyChange: transfer.qtyBase,
      balanceAfter: targetItem.stockQty,
      unitCost: costBasis,
      remarks: `Hub transfer in from ${transfer.partnerName || transfer.partnerSlug}`,
    }]);

    // DR Inventory Asset / CR Hub Transfer Clearing
    await postHubJE({
      reference: transfer.reference,
      description: `Hub transfer in: ${transfer.qtyBase}${transfer.unit} of ${transfer.itemName} from ${transfer.partnerName}`,
      debitCode: '130000', debitName: 'Inventory Asset',
      creditCode: '540900', creditName: 'Hub Transfer Clearing',
      amount: receivedValue,
    });

    transfer.status = 'Received';
    transfer.targetItemId = targetItem._id;
    transfer.receivedAt = new Date();
    await transfer.save();

    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-release', { reference: transfer.reference }); } catch {}
    }

    res.json({ ok: true, transfer });
  });

  // Internal: sender decrements stock after receiver accepted + posts JE
  app.post('/api/hub/internal/transfer-release', requireLinkToken, async (req, res) => {
    const { reference } = req.body || {};
    const transfer = await CrossTransfer.findOne({ businessType: BUSINESS_TYPE, reference, direction: 'outbound' });
    if (!transfer || transfer.status === 'Released') return res.json({ ok: true });

    const item = await Inventory.findById(transfer.itemId);
    if (item) {
      const releasedValue = (item.unitCost || 0) * transfer.qtyBase;

      item.stockQty = Math.max(0, item.stockQty - transfer.qtyBase);
      await item.save();

      // Same schema fix as the inbound card above - and negative, because
      // stock is LEAVING. A stock card that doesn't sign its movement makes
      // the running balance in the item's history meaningless.
      await StockCard.create([{
        inventoryId: item._id,
        itemName: item.itemName,
        type: 'Transfer Out',
        reference: transfer.reference,
        qtyChange: -transfer.qtyBase,
        balanceAfter: item.stockQty,
        unitCost: item.unitCost || 0,
        remarks: `Hub transfer out to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
      }]);

      // DR Hub Transfer Clearing / CR Inventory Asset
      await postHubJE({
        reference: transfer.reference,
        description: `Hub transfer out: ${transfer.qtyBase}${item.unit} of ${item.itemName} to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
        debitCode: '540900', debitName: 'Hub Transfer Clearing',
        creditCode: '130000', creditName: 'Inventory Asset',
        amount: releasedValue,
      });
    }

    transfer.status = 'Released';
    await transfer.save();
    res.json({ ok: true });
  });

  // Reject inbound transfer
  app.post('/api/hub/transfers/:id/reject', verifyToken, requireAuth, async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Pending',
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found.' });

    transfer.status = 'Rejected';
    await transfer.save();

    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-status', { reference: transfer.reference, status: 'Rejected' }); } catch {}
    }

    res.json({ ok: true, transfer });
  });

  // Cancel outbound transfer - either withdrawing a slip that was never
  // approved, or pulling back an approved one before the partner accepts.
  app.post('/api/hub/transfers/:id/cancel', verifyToken, requireAuth, async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'outbound',
      status: { $in: ['Requested', 'Pending'] },
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found or already processed.' });

    // A slip still awaiting approval was never announced to the partner, so
    // there is nothing on their side to retract.
    const wasAnnounced = transfer.status === 'Pending';
    transfer.status = 'Cancelled';
    transfer.rejectedBy = req.user?.name || '';
    await transfer.save();

    if (wasAnnounced) {
      const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
      if (link) {
        try { await partnerCall(link, '/api/hub/internal/transfer-status', { reference: transfer.reference, status: 'Rejected' }); } catch {}
      }
    }

    res.json({ ok: true, transfer });
  });

  // Internal: partner updates transfer status on our outbound record
  app.post('/api/hub/internal/transfer-status', requireLinkToken, async (req, res) => {
    const { reference, status } = req.body || {};
    await CrossTransfer.updateOne(
      { businessType: BUSINESS_TYPE, reference, direction: 'outbound' },
      { $set: { status } },
    );
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HUB TRANSFER REQUESTS - negotiated stock asks between businesses
  // ══════════════════════════════════════════════════════════════════════════
  // Distinct from the "New Transfer" (Send) flow above, which is always US
  // pushing stock we already have to a partner. A Transfer Request is an ASK -
  // either business can initiate one, so `fromSlug`/`toSlug` are NOT locked to
  // "us" on one side the way CrossTransfer's `direction` is. See the state
  // machine and field comments on TransferRequestSchema (server.js) for the
  // full negotiation shape; this is the routing layer on top of it.

  const genRequestRef = () => `TRQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  // Sync the OTHER business's mirror copy of a negotiation after any state
  // change on ours - same partnerCall/requireLinkToken pattern CrossTransfer
  // already uses for cross-tenant sync. Non-fatal: our own copy is already
  // saved by the time this runs, so a delivery failure here is a "the other
  // side is stale, they'll see it next poll" problem, not a data-loss one.
  async function syncTransferRequest(link, doc) {
    try {
      await partnerCall(link, '/api/hub/internal/transfer-request-sync', {
        requestRef: doc.requestRef,
        fromSlug: doc.fromSlug, fromName: doc.fromName,
        toSlug: doc.toSlug, toName: doc.toName,
        filedBySlug: doc.filedBySlug,
        status: doc.status,
        lines: doc.lines,
        originalLines: doc.originalLines,
        round: doc.round,
        history: doc.history,
        respondedBy: doc.respondedBy,
        linkedShipmentRef: doc.linkedShipmentRef,
      });
    } catch (e) {
      return `Saved here, but could not notify the partner: ${e.message}`;
    }
  }

  async function linkFor(partnerSlug) {
    return LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug, status: 'active' }).lean();
  }

  // ── FILE a new ask ───────────────────────────────────────────────────────
  // Body: { partnerSlug, weAreAskingThemToSend: bool, items: [{itemId?, itemName, unit, qty, note}] }
  // weAreAskingThemToSend true  -> fromSlug = partner, toSlug = us (we're asking to RECEIVE)
  // weAreAskingThemToSend false -> fromSlug = us, toSlug = partner (we're asking THEM to let us send / offering)
  app.post('/api/hub/transfer-requests', verifyToken, requireAuth, async (req, res) => {
    const { partnerSlug, weAreAskingThemToSend = true, items } = req.body || {};
    if (!partnerSlug || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'partnerSlug and items[] are required.' });
    }
    const link = await linkFor(partnerSlug);
    if (!link) return res.status(404).json({ error: 'No active link with that partner.' });

    const lines = items
      .filter(l => l && String(l.itemName || '').trim() && Number(l.qty) > 0)
      .map(l => ({ itemId: l.itemId ? String(l.itemId) : '', itemName: String(l.itemName).trim(), unit: String(l.unit || '').trim(), qty: Number(l.qty), note: String(l.note || '').trim() }));
    if (!lines.length) return res.status(400).json({ error: 'No valid line items.' });

    const requestRef = genRequestRef();
    const fromSlug = weAreAskingThemToSend ? partnerSlug : TENANT;
    const fromName = weAreAskingThemToSend ? (link.partnerName || partnerSlug) : TENANT;
    const toSlug = weAreAskingThemToSend ? TENANT : partnerSlug;
    const toName = weAreAskingThemToSend ? TENANT : (link.partnerName || partnerSlug);

    const mine = await TransferRequest.create({
      businessType: BUSINESS_TYPE, requestRef, side: 'filed',
      fromSlug, fromName, toSlug, toName, filedBySlug: TENANT,
      status: 'Pending', lines, originalLines: lines, round: 1,
      history: [{ by: req.user?.name || '', slug: TENANT, action: 'filed', note: '', at: new Date() }],
      requestedBy: req.user?.name || '',
    });

    let warning;
    try {
      await partnerCall(link, '/api/hub/internal/transfer-request-notify', {
        requestRef, fromSlug, fromName, toSlug, toName, filedBySlug: TENANT,
        lines, requestedBy: req.user?.name || '',
      });
    } catch (e) {
      warning = `Filed, but could not notify the partner: ${e.message}. They won't see it until you retry.`;
    }

    try { await logAudit?.(req, { action: 'create', entity: 'TransferRequest', entityId: requestRef, after: { partnerSlug, lines: lines.length } }); } catch { /* non-fatal */ }
    res.json({ ok: true, request: mine, warning });
  });

  // ── LIST ours (both what we filed and what's been asked of us) ──────────
  app.get('/api/hub/transfer-requests', verifyToken, requireAuth, async (req, res) => {
    const rows = await TransferRequest.find({ businessType: BUSINESS_TYPE }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ ok: true, requests: rows });
  });

  // Who is allowed to act right now, and what the resulting status is. Single
  // source of truth for the state machine so the route handlers below don't
  // each re-derive it slightly differently.
  function nextActor(doc) {
    // The requester is whoever filed it; the "other side" is whichever of
    // fromSlug/toSlug isn't them.
    const otherSlug = doc.filedBySlug === doc.fromSlug ? doc.toSlug : doc.fromSlug;
    if (doc.status === 'Pending') return otherSlug;              // awaiting first response
    if (doc.status === 'CounterPending') return doc.filedBySlug;  // awaiting requester's accept/decline
    if (doc.status === 'AwaitingFinal') return otherSlug;         // awaiting fulfilling side's final sign-off
    return null; // terminal
  }

  async function loadMine(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(404).json({ error: 'Not found.' }); return null; }
    const doc = await TransferRequest.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE });
    if (!doc) { res.status(404).json({ error: 'Not found.' }); return null; }
    return doc;
  }

  function guardActor(req, res, doc) {
    const actor = nextActor(doc);
    if (actor !== TENANT) {
      res.status(409).json({ error: actor ? `Waiting on ${actor === doc.filedBySlug ? 'the requester' : 'the other business'} - not your turn.` : `This request is already ${doc.status}.` });
      return false;
    }
    return true;
  }

  // ── DECLINE (either party, any non-terminal state) ───────────────────────
  app.post('/api/hub/transfer-requests/:id/decline', verifyToken, requireAuth, async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (!guardActor(req, res, doc)) return;

    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    doc.status = 'Declined';
    doc.respondedBy = req.user?.name || '';
    doc.history.push({ by: req.user?.name || '', slug: TENANT, action: 'declined', note: reason, at: new Date() });
    await doc.save();

    const link = await linkFor(doc.fromSlug === TENANT ? doc.toSlug : doc.fromSlug);
    const warning = link ? await syncTransferRequest(link, doc) : 'No active link with the partner to notify.';
    try { await logAudit?.(req, { action: 'decline', entity: 'TransferRequest', entityId: doc.requestRef, after: { reason } }); } catch { /* non-fatal */ }
    res.json({ ok: true, request: doc, warning });
  });

  // ── COUNTER (the party being asked proposes different quantities/lines) ──
  // Body: { lines: [{itemId?, itemName, unit, qty, note}], note }
  // Only reducing/dropping is meaningful here - this is "what we can actually
  // give", not a chance to ask for something different. Not enforced strictly
  // server-side (staff judgment), but the UI only offers adjust-down/remove.
  app.post('/api/hub/transfer-requests/:id/counter', verifyToken, requireAuth, async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (doc.status !== 'Pending') return res.status(409).json({ error: `Can only counter a Pending request (currently ${doc.status}).` });
    if (!guardActor(req, res, doc)) return;

    const items = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const lines = items
      .filter(l => l && String(l.itemName || '').trim() && Number(l.qty) > 0)
      .map(l => ({ itemId: l.itemId ? String(l.itemId) : '', itemName: String(l.itemName).trim(), unit: String(l.unit || '').trim(), qty: Number(l.qty), note: String(l.note || '').trim() }));
    if (!lines.length) return res.status(400).json({ error: 'Counter-offer needs at least one line item.' });

    const note = String(req.body?.note || '').trim().slice(0, 500);
    doc.lines = lines;
    doc.round = 2;
    doc.status = 'CounterPending';
    doc.respondedBy = req.user?.name || '';
    doc.history.push({ by: req.user?.name || '', slug: TENANT, action: 'countered', note, at: new Date() });
    await doc.save();

    const link = await linkFor(doc.fromSlug === TENANT ? doc.toSlug : doc.fromSlug);
    const warning = link ? await syncTransferRequest(link, doc) : 'No active link with the partner to notify.';
    res.json({ ok: true, request: doc, warning });
  });

  // ── ACCEPT the counter-offer (original requester only) ───────────────────
  // Does NOT create the shipment yet - the fulfilling side gets one more look
  // (AwaitingFinal) before real stock actually commits. Accepting a counter
  // is "yes, those numbers work for me", not "ship it now".
  app.post('/api/hub/transfer-requests/:id/accept-counter', verifyToken, requireAuth, async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (doc.status !== 'CounterPending') return res.status(409).json({ error: `No counter-offer to accept (currently ${doc.status}).` });
    if (!guardActor(req, res, doc)) return;

    doc.status = 'AwaitingFinal';
    doc.respondedBy = req.user?.name || '';
    doc.history.push({ by: req.user?.name || '', slug: TENANT, action: 'accepted-counter', note: '', at: new Date() });
    await doc.save();

    const link = await linkFor(doc.fromSlug === TENANT ? doc.toSlug : doc.fromSlug);
    const warning = link ? await syncTransferRequest(link, doc) : 'No active link with the partner to notify.';
    res.json({ ok: true, request: doc, warning });
  });

  // ── APPROVE the ORIGINAL ask as-is (no negotiation needed) ────────────────
  // Skips straight to Approved/shipment creation - nothing was countered, so
  // there is nothing left for a second round to confirm.
  app.post('/api/hub/transfer-requests/:id/approve-as-is', verifyToken, requireAuth, async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (doc.status !== 'Pending') return res.status(409).json({ error: `Only a Pending request can be approved as-is (currently ${doc.status}).` });
    if (!guardActor(req, res, doc)) return;
    return finalizeTransferRequest(req, res, doc);
  });

  // ── FINAL APPROVAL after a negotiated counter (fulfilling side only) ─────
  app.post('/api/hub/transfer-requests/:id/finalize', verifyToken, requireAuth, async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (doc.status !== 'AwaitingFinal') return res.status(409).json({ error: `Nothing awaiting final approval (currently ${doc.status}).` });
    if (!guardActor(req, res, doc)) return;
    return finalizeTransferRequest(req, res, doc);
  });

  // Shared by approve-as-is and finalize: both end the negotiation the same
  // way - lock in `lines` as the agreed shipment and create the real
  // CrossTransfer(s) FROM whoever fromSlug is. The fulfilling business's own
  // financial sign-off already happened by way of this negotiation (they
  // approved or countered-then-finalized it themselves), so this posts
  // straight to 'Pending' (already agreed + notified) rather than re-entering
  // the internal pre-approval queue the plain "New Transfer" flow uses -
  // that queue exists to gate an UNPREPARED send; this one was prepared here.
  async function finalizeTransferRequest(req, res, doc) {
    // finalize only ever runs on the FULFILLING side's own server (fromSlug),
    // since only they hold the stock and only they were the "other side"
    // asked to act at AwaitingFinal/Pending. Guard it explicitly so a stray
    // call against the requester's mirror copy can't fabricate a shipment.
    if (doc.fromSlug !== TENANT) {
      return res.status(409).json({ error: 'Only the business that would ship the stock can approve this.' });
    }

    const shipmentRef = `HT-${Date.now().toString(36).toUpperCase()}`;
    const created = [];
    const errors = [];
    for (const line of doc.lines) {
      let item = null;
      if (line.itemId && mongoose.Types.ObjectId.isValid(line.itemId)) {
        item = await Inventory.findOne({ _id: line.itemId, businessType: BUSINESS_TYPE }).lean();
      }
      if (!item) { errors.push(`${line.itemName}: no matching inventory item selected - drop or re-pick this line before approving.`); continue; }
      if (item.stockQty < line.qty) { errors.push(`${item.itemName}: need ${line.qty}${line.unit}, only ${item.stockQty}${item.unit} on hand.`); continue; }

      const reference = `${shipmentRef}-L${created.length + 1}`;
      const t = await CrossTransfer.create({
        businessType: BUSINESS_TYPE, direction: 'outbound',
        partnerSlug: doc.toSlug, partnerName: doc.toName,
        itemId: item._id, itemName: item.itemName, unit: item.unit, qtyBase: line.qty,
        unitCost: item.unitCost || 0, displayUnit: item.displayUnit || '', unitMultiplier: item.unitMultiplier || 1,
        packSize: item.packSize ?? null, itemCode: item.itemCode || '', stockCategory: item.stockCategory || '',
        note: line.note || `Via negotiated request ${doc.requestRef}`,
        reference, shipmentRef, status: 'Pending',
        requestedBy: doc.requestedBy, approvedBy: req.user?.name || '', approvedAt: new Date(),
      });
      created.push(t);
    }

    if (!created.length) return res.status(409).json({ error: `Could not create the shipment. ${errors.join(' ')}` });

    const link = await linkFor(doc.toSlug);
    if (link) {
      try {
        await partnerCall(link, '/api/hub/internal/transfer-notify', {
          shipmentRef, fromSlug: TENANT, fromName: TENANT,
          items: created.map(t => ({
            reference: t.reference, itemName: t.itemName, unit: t.unit, qtyBase: t.qtyBase, note: t.note,
            unitCost: t.unitCost, displayUnit: t.displayUnit, unitMultiplier: t.unitMultiplier,
            packSize: t.packSize, itemCode: t.itemCode, stockCategory: t.stockCategory,
          })),
        });
      } catch { /* the shipment rows already exist locally; partner will still see them once reachable */ }
    }

    doc.status = 'Approved';
    doc.linkedShipmentRef = shipmentRef;
    doc.respondedBy = req.user?.name || '';
    doc.history.push({ by: req.user?.name || '', slug: TENANT, action: 'approved', note: errors.length ? `${errors.length} line(s) skipped: ${errors.join(' ')}` : '', at: new Date() });
    await doc.save();

    const warning = link ? await syncTransferRequest(link, doc) : 'No active link with the partner to notify.';
    try { await logAudit?.(req, { action: 'approve', entity: 'TransferRequest', entityId: doc.requestRef, after: { shipmentRef, lines: created.length } }); } catch { /* non-fatal */ }
    res.json({ ok: true, request: doc, shipmentRef, transfers: created, errors: errors.length ? errors : undefined, warning });
  }

  // ── CANCEL (filer withdraws before any response) ─────────────────────────
  app.post('/api/hub/transfer-requests/:id/cancel', verifyToken, requireAuth, async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (doc.filedBySlug !== TENANT) return res.status(403).json({ error: 'Only the business that filed this can withdraw it.' });
    if (doc.status !== 'Pending') return res.status(409).json({ error: `Can only withdraw a request nobody has responded to yet (currently ${doc.status}).` });

    doc.status = 'Cancelled';
    doc.history.push({ by: req.user?.name || '', slug: TENANT, action: 'cancelled', note: '', at: new Date() });
    await doc.save();

    const link = await linkFor(doc.fromSlug === TENANT ? doc.toSlug : doc.fromSlug);
    const warning = link ? await syncTransferRequest(link, doc) : undefined;
    res.json({ ok: true, request: doc, warning });
  });

  // ── INTERNAL: partner filed a new ask against us ──────────────────────────
  app.post('/api/hub/internal/transfer-request-notify', requireLinkToken, async (req, res) => {
    const { requestRef, fromSlug, fromName, toSlug, toName, filedBySlug, lines, requestedBy } = req.body || {};
    if (!requestRef) return res.status(400).json({ error: 'requestRef is required.' });
    // The caller must actually be one of the two parties they're claiming
    // this request is between - requireLinkToken only proves "you're SOME
    // linked partner of ours", not that you're THIS negotiation's other
    // side. Without this, any linked partner could inject a fake "ask" that
    // claims to be from a different business entirely (even from us).
    if (req.linkedPartner.partnerSlug !== fromSlug && req.linkedPartner.partnerSlug !== toSlug) {
      return res.status(403).json({ error: 'fromSlug/toSlug must include the authenticated partner.' });
    }
    await TransferRequest.updateOne(
      { businessType: BUSINESS_TYPE, requestRef, side: 'received' },
      { $setOnInsert: {
        businessType: BUSINESS_TYPE, requestRef, side: 'received',
        fromSlug, fromName, toSlug, toName, filedBySlug,
        status: 'Pending', lines: lines || [], originalLines: lines || [], round: 1,
        history: [{ by: requestedBy || '', slug: filedBySlug, action: 'filed', note: '', at: new Date() }],
        requestedBy: requestedBy || '',
      } },
      { upsert: true },
    );
    res.json({ ok: true });
  });

  // ── INTERNAL: partner's copy changed (decline/counter/accept/finalize) ───
  // One generic sync route rather than one per action - the caller's local
  // document is already the source of truth for the new state, this just
  // mirrors it onto our copy of the SAME negotiation.
  app.post('/api/hub/internal/transfer-request-sync', requireLinkToken, async (req, res) => {
    const { requestRef, status, lines, originalLines, round, history, respondedBy, linkedShipmentRef } = req.body || {};
    if (!requestRef || !TRANSFER_REQUEST_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid payload.' });

    // Load first so the caller's identity can be checked against THIS
    // record's actual two parties before anything is written - matching by
    // requestRef alone (as this used to) let ANY linked partner overwrite
    // the status/lines/history of a negotiation they're not even part of,
    // including forging the "agreed" quantities our own staff would then
    // ship on Finalize.
    const existing = await TransferRequest.findOne({ businessType: BUSINESS_TYPE, requestRef });
    if (!existing) return res.status(404).json({ error: 'Unknown request on this side.' });
    if (req.linkedPartner.partnerSlug !== existing.fromSlug && req.linkedPartner.partnerSlug !== existing.toSlug) {
      return res.status(403).json({ error: 'Not a party to this request.' });
    }

    const result = await TransferRequest.updateOne(
      { _id: existing._id },
      { $set: {
        status,
        ...(lines ? { lines } : {}),
        ...(originalLines ? { originalLines } : {}),
        ...(round ? { round } : {}),
        ...(history ? { history } : {}),
        ...(respondedBy !== undefined ? { respondedBy } : {}),
        ...(linkedShipmentRef ? { linkedShipmentRef } : {}),
      } },
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'Unknown request on this side.' });
    res.json({ ok: true });
  });

}