// Inter-business hub: invite handshake + cross-tenant stock transfers.
// All routes that accept calls FROM partner APIs use x-link-token auth
// (requireLinkToken), not JWT - each tenant has its own JWT_SECRET so
// partner JWTs are never valid here.
import crypto from 'node:crypto';

const TENANT = (() => {
  const m = (process.env.MONGO_URI || '').match(/\/semivra_([^?/]+)/);
  return m ? m[1] : 'unknown';
})();
const SELF_URL = `http://${TENANT}-api:5002`;

export default function registerHub(ctx) {
  const {
    app, BUSINESS_TYPE,
    LinkedBusiness, HubInvite, CrossTransfer,
    Inventory, StockCard, JournalEntry,
    verifyToken,
    requireStaff: requireAuth, requireSuperAdmin,
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

    const hubUrl = `http://${hubSlug}-api:5002`;
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
      { role: 'hub', partnerName: clientSlug, partnerUrl: clientUrl || `http://${clientSlug}-api:5002`, linkToken, status: 'active', linkedAt: new Date() },
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

  // Send transfer - multi-item shipment.
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
        note: String(note || '').trim(),
        reference,
        shipmentRef,
        batchInfo,
        status: 'Pending',
      });
      created.push(transfer);
    }

    if (created.length === 0) return res.status(400).json({ error: errors.join('; ') });

    let warning;
    try {
      await partnerCall(link, '/api/hub/internal/transfer-notify', {
        shipmentRef,
        fromSlug: TENANT,
        fromName: TENANT,
        items: created.map(t => ({
          reference: t.reference,
          itemName:  t.itemName,
          unit:      t.unit,
          qtyBase:   t.qtyBase,
          note:      t.note,
        })),
      });
    } catch (e) {
      warning = `Transfers saved but could not notify partner: ${e.message}`;
    }

    res.json({ ok: true, shipmentRef, transfers: created, errors: errors.length ? errors : undefined, ...(warning ? { warning } : {}) });
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
    let targetItem;
    if (itemId) {
      targetItem = await Inventory.findOne({ _id: itemId, businessType: BUSINESS_TYPE });
      if (!targetItem) return res.status(404).json({ error: 'Target inventory item not found.' });
    } else if (createNew) {
      targetItem = await Inventory.create({
        businessType: BUSINESS_TYPE,
        itemName: transfer.itemName,
        unit: transfer.unit,
        stockQty: 0,
        unitCost: 0,
      });
    } else {
      return res.status(400).json({ error: 'Provide itemId to receive into, or set createNew:true to auto-create.' });
    }

    const receivedValue = (targetItem.unitCost || 0) * transfer.qtyBase;

    targetItem.stockQty += transfer.qtyBase;
    await targetItem.save();

    await StockCard.create([{
      businessType: BUSINESS_TYPE,
      itemId: targetItem._id,
      itemName: targetItem.itemName,
      movementType: 'Transfer In',
      qty: transfer.qtyBase,
      unit: targetItem.unit,
      reference: transfer.reference,
      note: `Received from ${transfer.partnerName}`,
      ordered: true,
    }], { ordered: true });

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

      await StockCard.create([{
        businessType: BUSINESS_TYPE,
        itemId: item._id,
        itemName: item.itemName,
        movementType: 'Transfer Out',
        qty: transfer.qtyBase,
        unit: item.unit,
        reference: transfer.reference,
        note: `Sent to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
        ordered: true,
      }], { ordered: true });

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

  // Cancel outbound transfer (before partner accepts)
  app.post('/api/hub/transfers/:id/cancel', verifyToken, requireAuth, async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'outbound', status: 'Pending',
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found or already processed.' });

    transfer.status = 'Rejected';
    await transfer.save();

    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-status', { reference: transfer.reference, status: 'Rejected' }); } catch {}
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
