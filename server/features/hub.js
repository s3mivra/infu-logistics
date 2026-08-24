// Inter-business hub: invite handshake + cross-tenant stock transfers.
// All routes that accept calls FROM partner APIs use x-link-token auth
// (requireLinkToken), not JWT - each tenant has its own JWT_SECRET so
// partner JWTs are never valid here.
import crypto from 'node:crypto';
import { captureError } from '../lib/errorLog.js';
import { withOptionalTransaction } from '../lib/txn.js';

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
    app, BUSINESS_TYPE, IS_PROD, mongoose,
    LinkedBusiness, HubInvite, CrossTransfer,
    Inventory, StockCard, JournalEntry,
    verifyToken,
    requireStaff: requireAuth, requireSuperAdmin,
    emitToMgr,
    computeUsage30d, enrichThresholds,
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

  // Double-entry journal entry for hub stock movements. Accepts an optional
  // session so it can be posted as part of the caller's own transaction (see
  // accept/transfer-release below) - previously always fired outside any
  // transaction, so a crash between the stock write and this JE could leave
  // one without the other.
  async function postHubJE({ reference, description, debitCode, debitName, creditCode, creditName, amount }, session) {
    if (!(amount > 0)) return;
    await JournalEntry.create([{
      date: new Date(),
      reference,
      description,
      lines: [
        { accountCode: debitCode,  accountName: debitName,  debit: amount, credit: 0 },
        { accountCode: creditCode, accountName: creditName, debit: 0, credit: amount },
      ],
      totalDebit: amount,
      totalCredit: amount,
    }], { session });
  }

  // Hub info
  app.get('/api/hub/info', verifyToken, requireAuth, async (req, res) => {
    try {
      const links = await LinkedBusiness.find({ businessType: BUSINESS_TYPE }).sort({ createdAt: -1 }).lean();
      res.json({ tenant: TENANT, selfUrl: SELF_URL, links });
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Generate invite code (superadmin only)
  app.post('/api/hub/invite', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const code = `${TENANT}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await HubInvite.create({ businessType: BUSINESS_TYPE, code, expiresAt });
      res.json({ code, expiresAt });
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Redeem partner's invite code (this business becomes the client)
  app.post('/api/hub/redeem', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    try {
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Internal: hub confirms handshake (called by client during redeem)
  app.post('/api/hub/internal/handshake', async (req, res) => {
    try {
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Disconnect a partner
  app.delete('/api/hub/links/:partnerSlug', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      await LinkedBusiness.deleteOne({ businessType: BUSINESS_TYPE, partnerSlug: req.params.partnerSlug });
      res.json({ ok: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── Host visibility into a client business's inventory ─────────────────────
  // Read-only, and one-directional by design: a host can see a client's stock
  // (qty, unit, sell-through velocity); a client never sees the host's, and
  // never sees another client's. Both ends enforce that independently -
  // requireSuperAdmin here (only the host's owner can pull this), and the
  // role==='client' check on the receiving end below (so this route only ever
  // answers a caller I've recorded myself as a *client* of, i.e. my hub -
  // a business I host has role:'hub' on my side and gets nothing from this).

  // Host side: pull a linked client's inventory snapshot.
  app.get('/api/hub/partners/:partnerSlug/inventory', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: req.params.partnerSlug, role: 'hub', status: 'active' }).lean();
      if (!link) return res.status(404).json({ error: 'No client linked with that slug.' });
      const data = await partnerCall(link, '/api/hub/internal/inventory-snapshot', {});
      res.json({ ok: true, partnerSlug: link.partnerSlug, partnerName: link.partnerName, items: data.items || [] });
    } catch (e) {
      res.status(502).json({ error: `Could not reach ${req.params.partnerSlug}: ${e.message}` });
    }
  });

  // Internal: client answers its hub's snapshot request. Only stock, qty (in
  // both base units and the client's own display unit), and 30-day sell-
  // through velocity - never cost, supplier, or anything financial.
  app.post('/api/hub/internal/inventory-snapshot', requireLinkToken, async (req, res) => {
    try {
      if (req.linkedPartner.role !== 'client') {
        return res.status(403).json({ error: 'Only a business I am a client of can pull my inventory.' });
      }
      const bizScope = { businessType: BUSINESS_TYPE };
      const [items, usage] = await Promise.all([
        Inventory.find({ ...bizScope, isArchived: { $ne: true } }, {
          itemName: 1, itemCode: 1, stockQty: 1, unit: 1, displayUnit: 1, unitMultiplier: 1, packSize: 1,
        }).lean(),
        computeUsage30d(bizScope),
      ]);
      const enriched = enrichThresholds(items, usage);
      res.json({
        ok: true,
        items: enriched.map(i => ({
          itemName: i.itemName,
          itemCode: i.itemCode || '',
          stockQtyBase: i.stockQty,
          unit: i.unit,
          displayUnit: i.displayUnit || i.unit,
          unitMultiplier: i.unitMultiplier || 1,
          packSize: i.packSize || null,
          avgDailyUse: i.avgDailyUse,
        })),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Cross-transfer list
  app.get('/api/hub/transfers', verifyToken, requireAuth, async (req, res) => {
    try {
      const transfers = await CrossTransfer.find({ businessType: BUSINESS_TYPE })
        .sort({ createdAt: -1 }).limit(200).lean();
      res.json({ transfers });
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Send transfer - multi-item shipment.
  // Body: { partnerSlug, items: [{itemId, qty, batchIdx?, note?}] }
  app.post('/api/hub/transfers/send', verifyToken, requireAuth, async (req, res) => {
    try {
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

        // Atomic conditional decrement - two concurrent sends of the same
        // item (or this route racing the checkout deduction) can't both pass
        // a plain read-then-write and oversell stock that's already gone.
        const item = await Inventory.findOneAndUpdate(
          { _id: itemId, businessType: BUSINESS_TYPE, stockQty: { $gte: Number(qty) } },
          { $inc: { stockQty: -Number(qty) } },
          { new: false },
        );
        if (!item) {
          const check = await Inventory.findOne({ _id: itemId, businessType: BUSINESS_TYPE }).lean();
          errors.push(check ? `Insufficient stock for ${check.itemName}. On hand: ${check.stockQty} ${check.unit}.` : 'Item not found.');
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Internal: partner notifies us of inbound transfers
  app.post('/api/hub/internal/transfer-notify', requireLinkToken, async (req, res) => {
    try {
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Accept inbound transfer - receive stock + post ledger JE
  app.post('/api/hub/transfers/:id/accept', verifyToken, requireAuth, async (req, res) => {
   try {
    const { itemId, createNew } = req.body || {};
    if (!itemId && !createNew) return res.status(400).json({ error: 'Provide itemId to receive into, or set createNew:true to auto-create.' });

    // Whole local effect (stock + StockCard + JE + status flip) is one
    // transaction, claimed atomically as its first write - a double-click or
    // two concurrent accept requests for the same transfer used to both pass
    // a plain `status:'Pending'` read before either wrote back, so both could
    // receive the stock and post their own JE for one physical delivery.
    // withOptionalTransaction (not a bare session) because a document two
    // truly-simultaneous requests both write to inside a transaction doesn't
    // cleanly hand the loser `null` back - it throws a real WriteConflict,
    // which this retries once against the now-committed state (same fix
    // shifts.js's /end route needed after a real concurrency test caught it).
    const transfer = await withOptionalTransaction(mongoose, async (session) => {
      const claimed = await CrossTransfer.findOneAndUpdate(
        { _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Pending' },
        { $set: { status: 'Received', receivedAt: new Date() } },
        { session, new: false },
      );
      if (!claimed) throw Object.assign(new Error('Transfer not found or not pending.'), { httpStatus: 404 });

      let targetItem;
      if (itemId) {
        targetItem = await Inventory.findOne({ _id: itemId, businessType: BUSINESS_TYPE }).session(session ?? null);
        if (!targetItem) throw Object.assign(new Error('Target inventory item not found.'), { httpStatus: 404 });
        // Backfill unit cost / pack size on an existing item that was never
        // properly set up (e.g. auto-created by an older version of this
        // handler, or a manually-added placeholder) - never overwrite values
        // the operator already configured.
        if (!targetItem.unitCost && claimed.unitCost) targetItem.unitCost = claimed.unitCost;
        if (!targetItem.packSize && claimed.packSize) targetItem.packSize = claimed.packSize;
        if (!targetItem.displayUnit && claimed.displayUnit) targetItem.displayUnit = claimed.displayUnit;
        if ((!targetItem.unitMultiplier || targetItem.unitMultiplier === 1) && claimed.unitMultiplier > 1) targetItem.unitMultiplier = claimed.unitMultiplier;
      } else {
        targetItem = (await Inventory.create([{
          businessType: BUSINESS_TYPE,
          itemName: claimed.itemName,
          unit: claimed.unit,
          stockQty: 0,
          unitCost: claimed.unitCost || 0,
          displayUnit: claimed.displayUnit || '',
          unitMultiplier: claimed.unitMultiplier || 1,
          packSize: claimed.packSize,
        }], { session }))[0];
      }

      const receivedValue = (targetItem.unitCost || 0) * claimed.qtyBase;

      targetItem.stockQty += claimed.qtyBase;
      await targetItem.save({ session });

      await StockCard.create([{
        inventoryId: targetItem._id,
        itemName: targetItem.itemName,
        type: 'Transfer In',
        reference: claimed.reference,
        qtyChange: claimed.qtyBase,
        balanceAfter: targetItem.stockQty,
        unitCost: targetItem.unitCost,
        remarks: `Received from ${claimed.partnerName}`,
      }], { session, ordered: true });

      // DR Inventory Asset / CR Hub Transfer Clearing
      await postHubJE({
        reference: claimed.reference,
        description: `Hub transfer in: ${claimed.qtyBase}${claimed.unit} of ${claimed.itemName} from ${claimed.partnerName}`,
        debitCode: '130000', debitName: 'Inventory Asset',
        creditCode: '540900', creditName: 'Hub Transfer Clearing',
        amount: receivedValue,
      }, session);

      claimed.status = 'Received';
      claimed.targetItemId = targetItem._id;
      claimed.receivedAt = new Date();
      return claimed;
    });

    emitToMgr('erpUpdated');

    // Tell the sender to decrement their stock + log "Transfer Out" now that
    // we've received it. Deliberately AFTER the local transaction commits -
    // never hold a DB transaction open across an outbound network call. If
    // this call fails (partner offline, bad URL, etc.) the sender is left
    // holding stock they've already shipped and gets no history entry for it
    // - surface that instead of swallowing it, so the operator knows to retry
    // (see /retry-release below) rather than assuming everything reconciled.
    let releaseWarning;
    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-release', { reference: transfer.reference }); }
      catch (e) { releaseWarning = `Received here, but could not notify ${transfer.partnerName} to release their stock: ${e.message}. Retry from the Transfers list.`; }
    }

    res.json({ ok: true, transfer, ...(releaseWarning ? { warning: releaseWarning } : {}) });
   } catch (err) {
     if (err?.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
     (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message }));
   }
  });

  // Retry notifying the sender to release stock for an already-received
  // transfer, in case the first attempt (right after accept) failed.
  app.post('/api/hub/transfers/:id/retry-release', verifyToken, requireAuth, async (req, res) => {
    try {
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Internal: sender decrements stock after receiver accepted + posts JE
  app.post('/api/hub/internal/transfer-release', requireLinkToken, async (req, res) => {
    try {
      const { reference } = req.body || {};
      // withOptionalTransaction so a genuine simultaneous double-release
      // (partnerCall's own 15s-timeout retry landing alongside the partner's
      // own retry-on-timeout logic) retries against the now-committed status
      // instead of surfacing a raw WriteConflict - same reasoning as accept
      // above and the shifts.js /end fix.
      const hadItem = await withOptionalTransaction(mongoose, async (session) => {
        // Atomically claim this transfer for release - a read-then-later-write
        // on `status` used to leave a window where a retried call could pass
        // the same "not yet Released" check twice and double-post the stock
        // decrement + JE for one physical shipment. Idempotent no-op if it's
        // already Released or doesn't exist.
        const transfer = await CrossTransfer.findOneAndUpdate(
          { businessType: BUSINESS_TYPE, reference, direction: 'outbound', status: { $ne: 'Released' } },
          { $set: { status: 'Released' } },
          { session, new: false },
        );
        if (!transfer) return false;

        const item = await Inventory.findById(transfer.itemId).session(session ?? null);
        if (item) {
          const releasedValue = (item.unitCost || 0) * transfer.qtyBase;

          item.stockQty = Math.max(0, item.stockQty - transfer.qtyBase);
          await item.save({ session });

          await StockCard.create([{
            inventoryId: item._id,
            itemName: item.itemName,
            type: 'Transfer Out',
            reference: transfer.reference,
            qtyChange: -transfer.qtyBase,
            balanceAfter: item.stockQty,
            unitCost: item.unitCost,
            remarks: `Sent to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
          }], { session, ordered: true });

          // DR Hub Transfer Clearing / CR Inventory Asset
          await postHubJE({
            reference: transfer.reference,
            description: `Hub transfer out: ${transfer.qtyBase}${item.unit} of ${item.itemName} to ${req.linkedPartner.partnerName || req.linkedPartner.partnerSlug}`,
            debitCode: '540900', debitName: 'Hub Transfer Clearing',
            creditCode: '130000', creditName: 'Inventory Asset',
            amount: releasedValue,
          }, session);
        }
        return !!item;
      });

      if (hadItem) emitToMgr('erpUpdated');
      res.json({ ok: true });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // Reject inbound transfer
  app.post('/api/hub/transfers/:id/reject', verifyToken, requireAuth, async (req, res) => {
    try {
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Cancel outbound transfer (before partner accepts)
  app.post('/api/hub/transfers/:id/cancel', verifyToken, requireAuth, async (req, res) => {
    try {
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
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // Internal: partner updates transfer status on our outbound record
  app.post('/api/hub/internal/transfer-status', requireLinkToken, async (req, res) => {
    try {
      const { reference, status } = req.body || {};
      await CrossTransfer.updateOne(
        { businessType: BUSINESS_TYPE, reference, direction: 'outbound' },
        { $set: { status } },
      );
      res.json({ ok: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
