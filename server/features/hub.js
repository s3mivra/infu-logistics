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
    app, BUSINESS_TYPE,
    LinkedBusiness, HubInvite, CrossTransfer,
    Inventory, StockCard, JournalEntry, Order,
    verifyToken,
    requireStaff: requireAuth, requireSuperAdmin,
    logAudit,
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
}
