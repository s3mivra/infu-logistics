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

// Fallback: the internal Docker alias (http://{slug}-api:5002) only resolves
// while both tenants sit on the same semivra-net network with a healthy
// container. If that's flaky (container mid-restart, not yet attached, DNS
// cache hiccup), fall back to the tenant's public URL - same Caddy/nginx path
// every browser already uses to reach the API, so it works from anywhere.
const PUBLIC_HUB_URL_PATTERN = process.env.PUBLIC_HUB_URL_PATTERN
  || (process.env.DOMAIN ? `${process.env.LOCAL_MODE === '1' ? 'http' : 'https'}://{slug}.${process.env.DOMAIN}` : null);
const hubUrlCandidatesFor = (slug) => {
  const primary = hubUrlFor(slug);
  const fallback = PUBLIC_HUB_URL_PATTERN ? PUBLIC_HUB_URL_PATTERN.replace('{slug}', slug) : null;
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
};

export default function registerHub(ctx) {
  const {
    app, BUSINESS_TYPE,
    LinkedBusiness, HubInvite, CrossTransfer,
    Inventory, StockCard, JournalEntry,
    verifyToken,
    requireStaff: requireAuth, requireSuperAdmin,
    emitToMgr,
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
    // link.partnerUrl is whichever URL worked at handshake time - try it first,
    // then fall back to the other candidate for that slug in case the network
    // path that worked then doesn't work now (container restart, IP change).
    const candidates = [link.partnerUrl, ...hubUrlCandidatesFor(link.partnerSlug)]
      .filter((v, i, arr) => v && arr.indexOf(v) === i);
    let lastErr;
    for (const url of candidates) {
      try {
        const res = await fetch(`${url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-link-token': link.linkToken },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Partner returned ${res.status}`);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
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

    // Codes are `${slug}-${10 hex chars}` (see /api/hub/invite below). Slugs
    // themselves can contain hyphens (e.g. "infu-main"), so splitting on '-'
    // and taking parts[0] would truncate them - strip the fixed-width hex
    // suffix instead and keep everything before it as the slug.
    const codeMatch = String(code).trim().match(/^(.+)-([0-9A-Fa-f]{10})$/);
    if (!codeMatch) return res.status(400).json({ error: 'Invalid code format. Paste the full code your hub gave you.' });
    const hubSlug = codeMatch[1];
    if (hubSlug === TENANT) return res.status(400).json({ error: 'Cannot link to yourself.' });

    const linkToken = crypto.randomBytes(32).toString('hex');

    let hubData, hubUrl;
    const attempts = [];
    for (const candidateUrl of hubUrlCandidatesFor(hubSlug)) {
      try {
        hubData = await fetch(`${candidateUrl}/api/hub/internal/handshake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: String(code).trim(), clientSlug: TENANT, clientUrl: SELF_URL, linkToken }),
          signal: AbortSignal.timeout(20_000),
        }).then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || `Hub returned ${r.status}`);
          return d;
        });
        hubUrl = candidateUrl;
        break;
      } catch (e) {
        attempts.push(`${candidateUrl} -> ${e.message}`);
      }
    }
    if (!hubData) {
      return res.status(502).json({ error: `Could not reach hub (${hubSlug}). Tried: ${attempts.join('; ')}` });
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
        unitCost: item.unitCost || 0,
        displayUnit: item.displayUnit || '',
        unitMultiplier: item.unitMultiplier || 1,
        packSize: item.packSize,
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
          unitCost:       t.unitCost,
          displayUnit:    t.displayUnit,
          unitMultiplier: t.unitMultiplier,
          packSize:       t.packSize,
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
        unitCost: line.unitCost || 0,
        displayUnit: line.displayUnit || '',
        unitMultiplier: line.unitMultiplier || 1,
        packSize: line.packSize,
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
      // Backfill unit cost / pack size on an existing item that was never
      // properly set up (e.g. auto-created by an older version of this
      // handler, or a manually-added placeholder) - never overwrite values
      // the operator already configured.
      if (!targetItem.unitCost && transfer.unitCost) targetItem.unitCost = transfer.unitCost;
      if (!targetItem.packSize && transfer.packSize) targetItem.packSize = transfer.packSize;
      if (!targetItem.displayUnit && transfer.displayUnit) targetItem.displayUnit = transfer.displayUnit;
      if ((!targetItem.unitMultiplier || targetItem.unitMultiplier === 1) && transfer.unitMultiplier > 1) targetItem.unitMultiplier = transfer.unitMultiplier;
    } else if (createNew) {
      targetItem = await Inventory.create({
        businessType: BUSINESS_TYPE,
        itemName: transfer.itemName,
        unit: transfer.unit,
        stockQty: 0,
        unitCost: transfer.unitCost || 0,
        displayUnit: transfer.displayUnit || '',
        unitMultiplier: transfer.unitMultiplier || 1,
        packSize: transfer.packSize,
      });
    } else {
      return res.status(400).json({ error: 'Provide itemId to receive into, or set createNew:true to auto-create.' });
    }

    const receivedValue = (targetItem.unitCost || 0) * transfer.qtyBase;

    targetItem.stockQty += transfer.qtyBase;
    await targetItem.save();

    await StockCard.create([{
      inventoryId: targetItem._id,
      itemName: targetItem.itemName,
      type: 'Transfer In',
      reference: transfer.reference,
      qtyChange: transfer.qtyBase,
      balanceAfter: targetItem.stockQty,
      unitCost: targetItem.unitCost,
      remarks: `Received from ${transfer.partnerName}`,
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
    emitToMgr('erpUpdated');

    // Tell the sender to decrement their stock + log "Transfer Out" now that
    // we've received it. If this call fails (partner offline, bad URL, etc.)
    // the sender is left holding stock they've already shipped and gets no
    // history entry for it - surface that instead of swallowing it, so the
    // operator knows to retry (see /retry-release below) rather than assuming
    // everything reconciled.
    let releaseWarning;
    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-release', { reference: transfer.reference }); }
      catch (e) { releaseWarning = `Received here, but could not notify ${transfer.partnerName} to release their stock: ${e.message}. Retry from the Transfers list.`; }
    }

    res.json({ ok: true, transfer, ...(releaseWarning ? { warning: releaseWarning } : {}) });
  });

  // Retry notifying the sender to release stock for an already-received
  // transfer, in case the first attempt (right after accept) failed.
  app.post('/api/hub/transfers/:id/retry-release', verifyToken, requireAuth, async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Received',
    });
    if (!transfer) return res.status(404).json({ error: 'Received transfer not found.' });

    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (!link) return res.status(404).json({ error: 'No active link with that partner.' });

    try {
      await partnerCall(link, '/api/hub/internal/transfer-release', { reference: transfer.reference });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: `Still could not reach ${transfer.partnerName}: ${e.message}` });
    }
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
        inventoryId: item._id,
        itemName: item.itemName,
        type: 'Transfer Out',
        reference: transfer.reference,
        qtyChange: -transfer.qtyBase,
        balanceAfter: item.stockQty,
        unitCost: item.unitCost,
        remarks: `Sent to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
      }], { ordered: true });

      // DR Hub Transfer Clearing / CR Inventory Asset
      await postHubJE({
        reference: transfer.reference,
        description: `Hub transfer out: ${transfer.qtyBase}${item.unit} of ${item.itemName} to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
        debitCode: '540900', debitName: 'Hub Transfer Clearing',
        creditCode: '130000', creditName: 'Inventory Asset',
        amount: releasedValue,
      });
      emitToMgr('erpUpdated');
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
