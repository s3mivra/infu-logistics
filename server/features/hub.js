// Inter-business hub: invite handshake + cross-tenant stock transfers.
// All routes that accept calls FROM partner APIs use x-link-token auth
// (requireLinkToken), not JWT - each tenant has its own JWT_SECRET so
// partner JWTs are never valid here.
import { positiveQty } from '../lib/normalize.js';
import { atomic } from '../lib/atomicRoute.js';
import crypto from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { businessDateStr } from '../lib/businessTime.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { mergeTrialBalances, buildPnl, buildBalanceSheet, unknownCodes } from '../lib/consolidate.js';
import { rollUpByLocation, parseBranchCode } from '../lib/branchCode.js';
// Action permissions. Each route below changes data, and was guarded only by
// "is staff" - so a plain staff account could, through the API, do what the
// permission catalogue reserves for a role that holds the matching
// .manage key (see lib/authz.js PERMISSIONS). `permit` is the same
// requirePermission the context hands out, imported under a short name so
// it reads the same in every file.
import { requirePermission as permit, requireAnyPermission as permitAny } from '../lib/authz.js';

const TENANT = (() => {
  const m = (process.env.MONGO_URI || '').match(/\/semivra_([^?/]+)/);
  return m ? m[1] : 'unknown';
})();
// HUB_URL_PATTERN: override in .env for non-Docker deployments.
// Use {slug} as the placeholder, e.g. https://{slug}.semivra.app
const HUB_URL_PATTERN = process.env.HUB_URL_PATTERN || 'http://{slug}-api:5002';
// Inter-branch clearing account. Declared in lib/chartOfAccounts.js.
export const HUB_CLEARING_CODE = '160200';
const hubUrlFor = (slug) => HUB_URL_PATTERN.replace('{slug}', slug);

// Where a person opens that branch, which is NOT where this server calls it.
// HUB_URL_PATTERN points at the internal API - a container name on an internal
// port - and handing that to a browser opens a host it cannot resolve, at the
// API root. Set HUB_APP_URL_PATTERN to the address staff actually use, e.g.
// https://{slug}.semivra.app
const HUB_APP_URL_PATTERN = process.env.HUB_APP_URL_PATTERN || '';
// Without an explicit pattern, the best guess is the API address with the
// internal-only parts taken off: "infu-main-api:5002" is "infu-main" on the
// standard web port. A guess is still better than a link that cannot open, and
// it is only ever a fallback for a deployment that has not configured one.
const appUrlFor = (slug, apiUrl) => {
  if (HUB_APP_URL_PATTERN) return HUB_APP_URL_PATTERN.replace('{slug}', slug);
  const raw = String(apiUrl || hubUrlFor(slug));
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.replace(/-api$/, '');
    u.port = '';
    return u.origin;
  } catch { return raw; }
};
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
    acctMeta,
    Settings,
    requirePermission,
    log,
  } = ctx;

  // This deployment's own branch code ("AC-A001"), set in Settings. Two branches
  // can share a location and still be separate inventories, so the code - not
  // the address - is what a consolidated report groups on.
  const ownBranchCode = async () => {
    const row = await Settings.findOne({ key: 'branchCode' }).lean();
    return String(row?.value || '').trim().toUpperCase();
  };

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
    if (!res.ok) throw Object.assign(new Error(data.error || `Partner returned ${res.status}`), { status: res.status });
    return data;
  }
  // The partner answered and said no - asking again will not change that.
  const refusedByPartner = (err) => err?.status >= 400 && err?.status < 500;
  const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

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
    // Without the link token: it is the password the two servers use with each
    // other, and this list goes to every signed-in member of staff.
    const links = await LinkedBusiness.find({ businessType: BUSINESS_TYPE }, { linkToken: 0 }).sort({ createdAt: -1 }).lean();
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
          return { partnerSlug: link.partnerSlug, partnerName: link.partnerName, dashboardUrl: link.partnerAppUrl || appUrlFor(link.partnerSlug, link.partnerUrl), ok: true, ...data };
        } catch (err) {
          return { partnerSlug: link.partnerSlug, partnerName: link.partnerName, dashboardUrl: link.partnerAppUrl || appUrlFor(link.partnerSlug, link.partnerUrl), ok: false, error: err.message };
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

    // The code is "<hub's slug>-<random>", and a slug may itself contain
    // hyphens (infusion-logistics-AB12...), so the slug is everything before
    // the LAST hyphen. Taking the first piece sent "infusion-logistics" codes
    // to a business called "infusion", which does not exist.
    const clean = String(code).trim();
    const cut = clean.lastIndexOf('-');
    if (cut < 1 || cut === clean.length - 1) return res.status(400).json({ error: 'Invalid code format. Paste the full code your hub gave you.' });
    const hubSlug = clean.slice(0, cut);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(hubSlug)) return res.status(400).json({ error: 'Invalid code format. Paste the full code your hub gave you.' });
    if (hubSlug === TENANT) return res.status(400).json({ error: 'Cannot link to yourself.' });

    const hubUrl = hubUrlFor(hubSlug);
    const linkToken = crypto.randomBytes(32).toString('hex');

    let hubData;
    try {
      hubData = await fetch(`${hubUrl}/api/hub/internal/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean, clientSlug: TENANT, clientUrl: SELF_URL, linkToken }),
        signal: AbortSignal.timeout(20_000),
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        // The hub answered and said no (a used or expired code, say): that is
        // its answer to pass on, not a failure to reach it.
        if (!r.ok) throw Object.assign(new Error(d.error || `Hub returned ${r.status}`), { refused: r.status >= 400 && r.status < 500 });
        return d;
      });
    } catch (e) {
      if (e.refused) return res.status(400).json({ error: `${hubSlug} did not accept the code: ${e.message}` });
      return res.status(502).json({ error: `Could not reach hub (${hubSlug}): ${e.message}` });
    }

    await LinkedBusiness.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, partnerSlug: hubSlug },
      { role: 'client', partnerName: hubData.hubName || hubSlug, partnerUrl: hubUrl, partnerAppUrl: appUrlFor(hubSlug, hubUrl), linkToken, status: 'active', linkedAt: new Date() },
      { upsert: true, new: true },
    );

    res.json({ ok: true, hubSlug, hubName: hubData.hubName });
  });

  // Internal: hub confirms handshake (called by client during redeem)
  app.post('/api/hub/internal/handshake', async (req, res) => {
    const { code, clientSlug, linkToken } = req.body || {};
    // Strings only. This route is open by design - the invite code is the
    // secret - so an object here is somebody probing the query, not a client.
    const str = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
    if (!str(code) || !str(clientSlug) || !str(linkToken)) {
      return res.status(400).json({ error: 'Missing fields.' });
    }
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(clientSlug)) return res.status(400).json({ error: 'Invalid business slug.' });

    const invite = await HubInvite.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, code, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invite code.' });

    await LinkedBusiness.findOneAndUpdate(
      { businessType: BUSINESS_TYPE, partnerSlug: clientSlug },
      { role: 'hub', partnerName: clientSlug, partnerUrl: hubUrlFor(clientSlug), partnerAppUrl: appUrlFor(clientSlug, hubUrlFor(clientSlug)), linkToken, status: 'active', linkedAt: new Date() },
      { upsert: true, new: true },
    );

    res.json({ ok: true, hubName: TENANT });
  });

  // Disconnect a partner
  app.delete('/api/hub/links/:partnerSlug', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: req.params.partnerSlug }).lean();
    // Tell the other business, so it does not go on showing a live link whose
    // every call is then refused. Best effort: it may be the reason for leaving.
    if (link) { try { await partnerCall(link, '/api/hub/internal/unlink', {}); } catch { /* disconnect anyway */ } }
    await LinkedBusiness.deleteOne({ businessType: BUSINESS_TYPE, partnerSlug: req.params.partnerSlug });
    try { await logAudit?.(req, { action: 'delete', entity: 'LinkedBusiness', entityId: req.params.partnerSlug }); } catch { /* non-fatal */ }
    res.json({ ok: true });
  });

  // Internal: the partner disconnected. Their token stops working here at once.
  app.post('/api/hub/internal/unlink', requireLinkToken, async (req, res) => {
    await LinkedBusiness.updateOne({ _id: req.linkedPartner._id }, { $set: { status: 'suspended' } });
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
  app.post('/api/hub/transfers/send', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
      if (!itemId || Number.isNaN(positiveQty(qty))) { errors.push(`Invalid line`); continue; }

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
      await partnerCall(link, '/api/hub/internal/transfer-notify', shipmentPayload(shipmentRef, lines));
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

  // Internal: partner notifies us of inbound transfers.
  // Who it is from is whoever is calling - the link token says so. The body
  // used to be believed instead, so one linked business could file a shipment
  // in another's name. Every line is checked (a negative quantity would have
  // taken stock OUT on acceptance), and a line already here is skipped, so the
  // sender can safely announce the same shipment again after a dropped reply.
  app.post('/api/hub/internal/transfer-notify', requireLinkToken, async (req, res) => {
    const partner = req.linkedPartner;
    const shipmentRef = str(req.body?.shipmentRef, 80);
    const lines = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
    if (!shipmentRef || !lines.length) return res.status(400).json({ error: 'shipmentRef and items[] are required.' });
    for (const line of lines) {
      const qty = Number(line?.qtyBase);
      if (!str(line?.reference, 80) || !str(line?.itemName) || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Every line needs a reference, an item name and a quantity above zero.' });
      }
    }
    let added = 0;
    for (const line of lines) {
      const reference = str(line.reference, 80);
      const seen = await CrossTransfer.exists({ businessType: BUSINESS_TYPE, direction: 'inbound', partnerSlug: partner.partnerSlug, reference });
      if (seen) continue;
      await CrossTransfer.create({
        businessType: BUSINESS_TYPE,
        direction: 'inbound',
        partnerSlug: partner.partnerSlug,
        partnerName: partner.partnerName || partner.partnerSlug,
        itemName: str(line.itemName),
        unit: str(line.unit, 40),
        qtyBase: Number(line.qtyBase),
        // Defaults keep a partner on an older build (which sends none of these)
        // working - it just receives at zero cost, exactly as before.
        unitCost: Math.max(0, Number(line.unitCost) || 0),
        displayUnit: str(line.displayUnit, 40),
        unitMultiplier: Number(line.unitMultiplier) > 0 ? Number(line.unitMultiplier) : 1,
        packSize: Number(line.packSize) > 0 ? Number(line.packSize) : null,
        itemCode: str(line.itemCode, 60),
        stockCategory: str(line.stockCategory, 80),
        note: str(line.note, 500),
        reference,
        shipmentRef,
        status: 'Pending',
      });
      added++;
    }
    res.json({ ok: true, added });
  });

  // Accept inbound transfer - receive stock + post ledger JE
  app.post('/api/hub/transfers/:id/accept', verifyToken, requireAuth, permit('inventory.manage'), atomic(mongoose, async (req, res) => {
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
      // The same item code already here IS the item: receive into it rather
      // than make a second one with the same code, which costing by item code
      // could then not tell apart.
      const code = String(transfer.itemCode || '').trim();
      if (code) {
        targetItem = await Inventory.findOne({
          businessType: BUSINESS_TYPE,
          itemCode: { $regex: `^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        });
      }
      // Carry the sender's descriptors through, so the new item arrives fully
      // formed - named, coded, priced, and with its display unit and pack size -
      // not as a zero-cost stub someone has to go and fix by hand.
      if (!targetItem) targetItem = await Inventory.create({
        businessType: BUSINESS_TYPE,
        itemName: transfer.itemName,
        ...(code ? { itemCode: code } : {}),
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
      creditCode: HUB_CLEARING_CODE, creditName: 'Hub Transfer Clearing',
      amount: receivedValue,
    });

    transfer.status = 'Received';
    transfer.targetItemId = targetItem._id;
    transfer.receivedAt = new Date();
    await transfer.save();

    // The sender takes the goods off its stock once THIS side has committed
    // (the call used to run inside this transaction: a failed commit after it
    // left the goods gone from both ends). releasePending retries until the
    // sender confirms, so a dropped call no longer leaves them counted twice.
    scheduleReleaseSweep();

    res.json({ ok: true, transfer });
  }));

  // Everything the partner still has to hear from us, tried again. A call to
  // the other business can fail at any moment (it is another server); each of
  // these used to be attempted once and then forgotten, leaving the two sides
  // disagreeing for good. All of them are safe to repeat.
  //
  //   1. goods we received and the sender has not yet taken off its stock
  //   2. shipments we approved and the partner was never told about
  //   3. shipments we turned down and the sender was never told about
  //   4. transfer requests whose latest state the partner has not seen
  const shipmentPayload = (shipmentRef, rows) => ({
    shipmentRef, fromSlug: TENANT, fromName: TENANT,
    items: rows.map(t => ({
      reference: t.reference, itemName: t.itemName, unit: t.unit, qtyBase: t.qtyBase, note: t.note,
      // Descriptors travel with the shipment - see the snapshot comment on
      // CrossTransferSchema. A partner running an older build simply ignores
      // the extra fields.
      unitCost: t.unitCost, displayUnit: t.displayUnit, unitMultiplier: t.unitMultiplier,
      packSize: t.packSize, itemCode: t.itemCode, stockCategory: t.stockCategory,
    })),
  });
  const requestNotifyPayload = (doc) => ({
    requestRef: doc.requestRef, fromSlug: doc.fromSlug, fromName: doc.fromName, toSlug: doc.toSlug, toName: doc.toName,
    filedBySlug: doc.filedBySlug, lines: doc.originalLines?.length ? doc.originalLines : doc.lines, requestedBy: doc.requestedBy,
  });

  const releasePending = async () => {
    const links = new Map();
    const linkTo = async (slug) => {
      if (!links.has(slug)) links.set(slug, await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: slug, status: 'active' }).lean());
      return links.get(slug);
    };

    // 1. releases
    const pending = await CrossTransfer.find({
      businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Received', releaseConfirmedAt: null,
    }).limit(200);
    for (const t of pending) {
      const link = await linkTo(t.partnerSlug);
      if (!link) continue;
      try {
        const r = await partnerCall(link, '/api/hub/internal/transfer-release', { reference: t.reference });
        if (r && r.ok !== false) {
          await CrossTransfer.updateOne({ _id: t._id }, { $set: { releaseConfirmedAt: new Date() } });
        }
      } catch (err) {
        log?.warn?.({ err, reference: t.reference }, 'Hub transfer release not confirmed yet - will retry');
      }
    }

    // 2. shipments to announce, one call per slip
    const unannounced = await CrossTransfer.find({ businessType: BUSINESS_TYPE, direction: 'outbound', status: 'Pending', partnerTodo: 'notify' }).limit(400).lean();
    const slips = new Map();
    for (const t of unannounced) { if (!slips.has(t.shipmentRef)) slips.set(t.shipmentRef, []); slips.get(t.shipmentRef).push(t); }
    for (const [shipmentRef, rows] of slips) {
      const link = await linkTo(rows[0].partnerSlug);
      if (!link) continue;
      try {
        await partnerCall(link, '/api/hub/internal/transfer-notify', shipmentPayload(shipmentRef, rows));
        await CrossTransfer.updateMany({ _id: { $in: rows.map(r => r._id) } }, { $set: { partnerTodo: '' } });
      } catch (err) {
        log?.warn?.({ err, shipmentRef }, 'Hub shipment not announced to the partner yet - will retry');
      }
    }

    // 3. rejections to pass on
    const untold = await CrossTransfer.find({ businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Rejected', partnerTodo: 'reject' }).limit(200).lean();
    for (const t of untold) {
      const link = await linkTo(t.partnerSlug);
      if (!link) continue;
      try {
        await partnerCall(link, '/api/hub/internal/transfer-status', { reference: t.reference, status: 'Rejected' });
        await CrossTransfer.updateOne({ _id: t._id }, { $set: { partnerTodo: '' } });
      } catch (err) {
        if (refusedByPartner(err)) await CrossTransfer.updateOne({ _id: t._id }, { $set: { partnerTodo: '' } });
        else log?.warn?.({ err, reference: t.reference }, 'Hub rejection not passed on yet - will retry');
      }
    }

    // 4. transfer requests the partner is behind on
    const behind = await TransferRequest.find({ businessType: BUSINESS_TYPE, partnerSync: { $in: ['notify', 'sync'] } }).limit(200);
    for (const doc of behind) {
      const link = await linkTo(doc.fromSlug === TENANT ? doc.toSlug : doc.fromSlug);
      if (!link) continue;
      try {
        if (doc.partnerSync === 'notify') await partnerCall(link, '/api/hub/internal/transfer-request-notify', requestNotifyPayload(doc));
        if (doc.partnerSync === 'sync' || doc.status !== 'Pending') await partnerCall(link, '/api/hub/internal/transfer-request-sync', requestSyncPayload(doc));
        await TransferRequest.updateOne({ _id: doc._id }, { $set: { partnerSync: '' } });
      } catch (err) {
        // Refused outright (it moved on without us): asking again changes nothing.
        if (refusedByPartner(err)) await TransferRequest.updateOne({ _id: doc._id }, { $set: { partnerSync: '' } });
        else log?.warn?.({ err, requestRef: doc.requestRef }, 'Hub transfer request not synced to the partner yet - will retry');
      }
    }
  };
  let sweepTimer = null;
  // The sweep is often asked for from inside a request that is one database
  // transaction (receiving a shipment is). A timer set there carries that
  // transaction with it, and by the time it fires the transaction is over:
  // every query in the sweep then failed with "expired session", so the sender
  // was not told to release until the ten-minute sweep came round. Setting the
  // timer from here, outside any request, leaves the transaction behind.
  const outsideAnyRequest = new AsyncResource('hub-partner-sweep');
  const scheduleReleaseSweep = (delayMs = 1500) => {
    if (sweepTimer) return;
    outsideAnyRequest.runInAsyncScope(() => {
      sweepTimer = setTimeout(() => {
        sweepTimer = null;
        if (mongoose.connection.readyState !== 1) return;   // shutting down
        releasePending().catch(err => log?.error?.({ err }, 'Hub release sweep failed'));
      }, delayMs);
      sweepTimer.unref?.();
    });
  };
  // And periodically, for a partner that was offline at the time.
  const releaseInterval = setInterval(() => scheduleReleaseSweep(0), 10 * 60 * 1000);
  releaseInterval.unref?.();

  // Internal: sender decrements stock after receiver accepted + posts JE
  app.post('/api/hub/internal/transfer-release', requireLinkToken, atomic(mongoose, async (req, res) => {
    const reference = str(req.body?.reference, 80);
    // Only a shipment that was sent TO the business calling. The reference
    // alone used to be enough, so any linked business could take the stock of
    // a shipment meant for another off our shelves.
    const transfer = await CrossTransfer.findOne({
      businessType: BUSINESS_TYPE, reference, direction: 'outbound', partnerSlug: req.linkedPartner.partnerSlug,
    });
    if (!transfer) {
      log?.warn?.({ reference, partner: req.linkedPartner.partnerSlug }, 'Hub release asked for a shipment we never sent them');
      return res.json({ ok: true });
    }
    if (transfer.status === 'Released') return res.json({ ok: true });
    // Never approved here, so never announced: nothing of ours can have arrived.
    if (transfer.status === 'Requested') return res.status(409).json({ error: 'That shipment was never approved.' });

    const item = await Inventory.findById(transfer.itemId);
    if (item) {
      // At the cost the shipment carried, which is what the receiver booked it
      // at - so the two businesses' clearing entries cancel exactly, and the
      // consolidated books show nothing left between them. Only a shipment
      // sent with no cost falls back to today's carrying cost.
      const releasedValue = (Number(transfer.unitCost) > 0 ? Number(transfer.unitCost) : (item.unitCost || 0)) * transfer.qtyBase;

      // Exactly what left - the receiver already has it. Flooring this at zero
      // made the stock card say the whole shipment went while stock fell by
      // less; a negative balance now shows the shortfall to be counted.
      item.stockQty = +(item.stockQty - transfer.qtyBase).toFixed(6);
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
        debitCode: HUB_CLEARING_CODE, debitName: 'Hub Transfer Clearing',
        creditCode: '130000', creditName: 'Inventory Asset',
        amount: releasedValue,
      });
    }

    transfer.status = 'Released';
    await transfer.save();
    res.json({ ok: true });
  }));

  // Reject inbound transfer
  app.post('/api/hub/transfers/:id/reject', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Pending',
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found.' });

    transfer.status = 'Rejected';
    await transfer.save();

    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-status', { reference: transfer.reference, status: 'Rejected' }); }
      catch (err) {
        // The sender has not heard. Keep trying, or its slip waits for ever.
        if (!refusedByPartner(err)) { transfer.partnerTodo = 'reject'; await transfer.save(); scheduleReleaseSweep(60_000); }
      }
    }

    res.json({ ok: true, transfer });
  });

  // Cancel outbound transfer - either withdrawing a slip that was never
  // approved, or pulling back an approved one before the partner accepts.
  app.post('/api/hub/transfers/:id/cancel', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
    const transfer = await CrossTransfer.findOne({
      _id: req.params.id, businessType: BUSINESS_TYPE, direction: 'outbound',
      status: { $in: ['Requested', 'Pending'] },
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found or already processed.' });

    // A slip still awaiting approval was never announced to the partner, so
    // there is nothing on their side to retract.
    const wasAnnounced = transfer.status === 'Pending' && transfer.partnerTodo !== 'notify';
    // An announced shipment is on the partner's screen, waiting to be received.
    // It is withdrawn THERE first: cancelling only here left it receivable, and
    // the goods then arrived for a shipment these books called cancelled.
    if (wasAnnounced) {
      const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: transfer.partnerSlug, status: 'active' }).lean();
      if (link) {
        try { await partnerCall(link, '/api/hub/internal/transfer-status', { reference: transfer.reference, status: 'Cancelled' }); }
        catch (err) {
          if (err.status === 409) return res.status(409).json({ error: `${transfer.partnerName || transfer.partnerSlug} has already received this - it can no longer be withdrawn.` });
          return res.status(502).json({ error: `Not withdrawn - could not reach ${transfer.partnerName || transfer.partnerSlug}: ${err.message}. Try again.` });
        }
      }
    }
    transfer.status = 'Cancelled';
    transfer.partnerTodo = '';
    transfer.rejectedBy = req.user?.name || '';
    await transfer.save();

    res.json({ ok: true, transfer });
  });

  // Internal: the partner says what became of a shipment between us.
  //   Rejected   they turned down one we sent      -> our outbound slip closes
  //   Cancelled  they withdrew one they sent to us -> our inbound slip closes,
  //              unless it has already been received (then they are told so)
  // Only a shipment between us and the business calling, and only while it is
  // still waiting. This used to set ANY status on ANY outbound slip by its
  // reference alone, for any linked business.
  app.post('/api/hub/internal/transfer-status', requireLinkToken, async (req, res) => {
    const reference = str(req.body?.reference, 80);
    const status = str(req.body?.status, 20);
    const partnerSlug = req.linkedPartner.partnerSlug;
    if (!reference || !['Rejected', 'Cancelled'].includes(status)) return res.status(400).json({ error: 'Unsupported status.' });

    if (status === 'Rejected') {
      const r = await CrossTransfer.updateOne(
        { businessType: BUSINESS_TYPE, reference, direction: 'outbound', partnerSlug, status: 'Pending' },
        { $set: { status: 'Rejected' } },
      );
      if (r.matchedCount) return res.json({ ok: true });
      // A partner on an older build says "Rejected" when it withdraws - fall through.
    }
    const inbound = await CrossTransfer.findOne({ businessType: BUSINESS_TYPE, reference, direction: 'inbound', partnerSlug });
    if (!inbound) return res.json({ ok: true });
    if (inbound.status === 'Received') return res.status(409).json({ error: 'Already received.' });
    if (inbound.status === 'Pending') { inbound.status = 'Cancelled'; await inbound.save(); }
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
  function requestSyncPayload(doc) {
    return {
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
    };
  }
  async function syncTransferRequest(link, doc) {
    try {
      await partnerCall(link, '/api/hub/internal/transfer-request-sync', requestSyncPayload(doc));
    } catch (e) {
      if (refusedByPartner(e)) return `Saved here, but the partner's copy did not take it: ${e.message}`;
      // Unreachable: remember, and try again until their copy matches ours.
      if (doc.partnerSync !== 'notify') await TransferRequest.updateOne({ _id: doc._id }, { $set: { partnerSync: 'sync' } });
      scheduleReleaseSweep(60_000);
      return `Saved here. The partner could not be reached (${e.message}) - it will be sent again automatically.`;
    }
  }

  async function linkFor(partnerSlug) {
    return LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug, status: 'active' }).lean();
  }

  // ── FILE a new ask ───────────────────────────────────────────────────────
  // Body: { partnerSlug, weAreAskingThemToSend: bool, items: [{itemId?, itemName, unit, qty, note}] }
  // weAreAskingThemToSend true  -> fromSlug = partner, toSlug = us (we're asking to RECEIVE)
  // weAreAskingThemToSend false -> fromSlug = us, toSlug = partner (we're asking THEM to let us send / offering)
  app.post('/api/hub/transfer-requests', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
      await partnerCall(link, '/api/hub/internal/transfer-request-notify', requestNotifyPayload(mine));
    } catch (e) {
      if (refusedByPartner(e)) warning = `Filed here, but the partner did not accept it: ${e.message}`;
      else {
        await TransferRequest.updateOne({ _id: mine._id }, { $set: { partnerSync: 'notify' } });
        scheduleReleaseSweep(60_000);
        warning = `Filed. The partner could not be reached (${e.message}) - it will be sent again automatically.`;
      }
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
  app.post('/api/hub/transfer-requests/:id/decline', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
  app.post('/api/hub/transfer-requests/:id/counter', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
  app.post('/api/hub/transfer-requests/:id/accept-counter', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
  app.post('/api/hub/transfer-requests/:id/approve-as-is', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
    const doc = await loadMine(req, res);
    if (!doc) return;
    if (doc.status !== 'Pending') return res.status(409).json({ error: `Only a Pending request can be approved as-is (currently ${doc.status}).` });
    if (!guardActor(req, res, doc)) return;
    return finalizeTransferRequest(req, res, doc);
  });

  // ── FINAL APPROVAL after a negotiated counter (fulfilling side only) ─────
  app.post('/api/hub/transfer-requests/:id/finalize', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
      // A request filed by the OTHER business carries its own stock ids, which
      // mean nothing here: the same item is then found by its name.
      if (!item && String(line.itemName || '').trim()) {
        item = await Inventory.findOne({
          businessType: BUSINESS_TYPE,
          itemName: { $regex: `^${String(line.itemName).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        }).lean();
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
    let announced = false;
    if (link) {
      try { await partnerCall(link, '/api/hub/internal/transfer-notify', shipmentPayload(shipmentRef, created)); announced = true; }
      catch { /* remembered just below, and sent again until it gets through */ }
    }
    if (!announced) {
      await CrossTransfer.updateMany({ _id: { $in: created.map(t => t._id) } }, { $set: { partnerTodo: 'notify' } });
      scheduleReleaseSweep(60_000);
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
  app.post('/api/hub/transfer-requests/:id/cancel', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
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
    const partnerSlug = req.linkedPartner.partnerSlug;
    const between = [String(fromSlug), String(toSlug)].sort().join('|') === [partnerSlug, TENANT].sort().join('|');
    // ...between the caller and US, and filed by the caller. "Includes the
    // caller" alone let them file a request between themselves and a third
    // business onto our list, or one that claimed we had filed it.
    if (!between || filedBySlug !== partnerSlug) {
      return res.status(403).json({ error: 'A request must be between the calling business and this one, filed by the caller.' });
    }
    const clean = (Array.isArray(lines) ? lines : []).slice(0, 200)
      .filter(l => l && str(l.itemName) && Number(l.qty) > 0 && Number.isFinite(Number(l.qty)))
      .map(l => ({ itemId: str(l.itemId, 40), itemName: str(l.itemName), unit: str(l.unit, 40), qty: Number(l.qty), note: str(l.note, 500) }));
    if (!clean.length) return res.status(400).json({ error: 'No valid line items.' });
    await TransferRequest.updateOne(
      { businessType: BUSINESS_TYPE, requestRef, side: 'received' },
      { $setOnInsert: {
        businessType: BUSINESS_TYPE, requestRef, side: 'received',
        fromSlug, fromName: str(fromName), toSlug, toName: str(toName), filedBySlug,
        status: 'Pending', lines: clean, originalLines: clean, round: 1,
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
    const { requestRef, status, lines, history, respondedBy, linkedShipmentRef } = req.body || {};
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

    // The same state again (a retry of a call whose reply was lost): nothing to do.
    if (existing.status === status) return res.json({ ok: true });

    // And only the step that is theirs to take. Being a party was enough
    // before, so the business being asked could mark its own request
    // "Approved", or rewrite the quantities while it was our turn to answer.
    const partnerSlug = req.linkedPartner.partnerSlug;
    const filer = existing.filedBySlug;
    const other = filer === existing.fromSlug ? existing.toSlug : existing.fromSlug;
    const allowed = {
      Pending:        partnerSlug === other ? ['CounterPending', 'Declined', 'Approved'] : ['Cancelled'],
      CounterPending: partnerSlug === filer ? ['AwaitingFinal', 'Declined', 'Cancelled'] : [],
      AwaitingFinal:  partnerSlug === other ? ['Approved', 'Declined'] : [],
    }[existing.status] || [];
    if (!allowed.includes(status)) {
      return res.status(409).json({ error: `This request is ${existing.status} here - it cannot become ${status} from your side.` });
    }
    // Only the business that would ship can approve, and only a counter-offer changes the lines.
    if (status === 'Approved' && partnerSlug !== existing.fromSlug) return res.status(409).json({ error: 'Only the business that would ship the stock can approve this.' });
    const countered = status === 'CounterPending' && Array.isArray(lines)
      ? lines.slice(0, 200).filter(l => l && str(l.itemName) && Number(l.qty) > 0 && Number.isFinite(Number(l.qty)))
          .map(l => ({ itemId: str(l.itemId, 40), itemName: str(l.itemName), unit: str(l.unit, 40), qty: Number(l.qty), note: str(l.note, 500) }))
      : null;
    if (status === 'CounterPending' && !countered?.length) return res.status(400).json({ error: 'A counter-offer needs at least one line item.' });

    await TransferRequest.updateOne(
      { _id: existing._id },
      { $set: {
        status,
        ...(countered ? { lines: countered, round: 2 } : {}),
        ...(Array.isArray(history) ? { history: history.slice(-100) } : {}),
        ...(respondedBy !== undefined ? { respondedBy: str(respondedBy) } : {}),
        ...(status === 'Approved' && linkedShipmentRef ? { linkedShipmentRef: str(linkedShipmentRef, 80) } : {}),
      } },
    );
    res.json({ ok: true });
  });

  // ── CONSOLIDATED BOOKS ─────────────────────────────────────────────────────
  // One P&L / Balance Sheet across every linked branch. Each branch is its own
  // deployment and database, so this works the way transfers and the network
  // summary already do: call each active partner's API over the existing
  // link-token trust and merge the results here.
  //
  // What crosses the wire is a TRIAL BALANCE (debit/credit totals per account
  // code), not a finished report - see lib/consolidate.js for why.
  //
  // Unlike the inventory network view, an unreachable branch is NOT treated as
  // best-effort here. A consolidated P&L that quietly omits a branch is a wrong
  // financial statement, which is worse than no statement, so the response
  // always carries `complete` and `unreachable` and the UI must refuse to
  // present an incomplete set of books as final.
  // dayStart/dayEnd (lib/reportRange.js) read a plain YYYY-MM-DD as LOCAL
  // midnight. `new Date('2026-03-01')` is UTC midnight, and then setHours()
  // moved it in local time - mixing the two shifted the whole window by the
  // zone offset. Full ISO timestamps (what this branch forwards to partners)
  // pass through unchanged.
  const parseRange = (q) => {
    // dayStart reads a plain YYYY-MM-DD in the business zone. new Date('2026-03-01')
    // is UTC midnight, and setHours then moved it in the server's local time,
    // shifting the start of every consolidated period.
    const start = q.start ? dayStart(q.start) : new Date(new Date().getFullYear(), 0, 1);
    let end = q.end ? new Date(q.end) : new Date();
    end = dayEnd(businessDateStr(end));
    let asOf = q.asOf ? new Date(q.asOf) : end;
    asOf = dayEnd(businessDateStr(asOf));
    return { start, end, asOf };
  };

  const trialBalance = async (match) => {
    const agg = await JournalEntry.aggregate([
      { $match: match },
      { $unwind: '$lines' },
      { $group: {
        _id: '$lines.accountCode',
        name: { $first: '$lines.accountName' },
        debit: { $sum: { $ifNull: ['$lines.debit', 0] } },
        credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      } },
      { $sort: { _id: 1 } },
    ]);
    return agg.map(r => ({ code: r._id, name: r.name, debit: r.debit || 0, credit: r.credit || 0 }));
  };

  // This branch's own trial balances: one for the P&L window, one cumulative
  // as-of the balance-sheet date.
  const ownTrialBalances = async ({ start, end, asOf }) => ({
    tenant: TENANT,
    branchCode: await ownBranchCode(),
    period: await trialBalance({ date: { $gte: start, $lte: end } }),
    asOf: await trialBalance({ date: { $lte: asOf } }),
  });

  // What a linked partner calls to pull OUR trial balances for THEIR
  // consolidated books.
  app.get('/api/hub/internal/trial-balance', requireLinkToken, async (req, res) => {
    try {
      res.json(await ownTrialBalances(parseRange(req.query)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/hub/network-financials', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const range = parseRange(req.query);
      const qs = `start=${range.start.toISOString()}&end=${range.end.toISOString()}&asOf=${range.asOf.toISOString()}`;
      const links = await LinkedBusiness.find({ businessType: BUSINESS_TYPE, status: 'active' }).lean();

      const own = await ownTrialBalances(range);
      const fetched = await Promise.all(links.map(async (link) => {
        try {
          const r = await fetch(`${link.partnerUrl}/api/hub/internal/trial-balance?${qs}`, {
            headers: { 'x-link-token': link.linkToken },
            signal: AbortSignal.timeout(15_000),
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || `Partner returned ${r.status}`);
          return { slug: link.partnerSlug, name: link.partnerName || link.partnerSlug, ok: true, ...data };
        } catch (err) {
          return { slug: link.partnerSlug, name: link.partnerName || link.partnerSlug, ok: false, error: err.message };
        }
      }));

      const reachable = fetched.filter(b => b.ok);
      const unreachable = fetched.filter(b => !b.ok).map(b => ({ slug: b.slug, name: b.name, error: b.error }));

      const branches = [{ slug: TENANT, name: 'This Business', self: true, ...own }, ...reachable];
      const periodRows = mergeTrialBalances(branches.map(b => ({ rows: b.period })));
      const asOfRows = mergeTrialBalances(branches.map(b => ({ rows: b.asOf })));

      // The three figures an owner asks for before anything else: how much
      // money is there, who owes us, who do we owe. All three are already in
      // the trial balance that crossed the wire, so this adds no round trip
      // and needs no partner redeploy - it is arithmetic on data we hold.
      //
      // Cash is the whole 110000 Current Assets family EXCEPT the receivable
      // and unassigned holding accounts: on-hand, bank, e-wallet, petty cash
      // and undeposited cheques are all spendable-or-about-to-be. Summing the
      // parent by prefix rather than naming each child keeps a branch's own
      // custom sub-account (112001 "BPI Main") inside the total.
      const NON_CASH_CURRENT = new Set(['118000']);
      const r2 = (n) => +Number(n || 0).toFixed(2);
      const balanceOf = (rows, pred, sign) => r2(rows.reduce((t, r) => {
        if (!pred(String(r.code))) return t;
        const d = Number(r.debit || 0), c = Number(r.credit || 0);
        return t + (sign === 'debit' ? d - c : c - d);
      }, 0));
      const cashOf = (rows) => balanceOf(rows, (c) => c.startsWith('11') && !NON_CASH_CURRENT.has(c) && c !== '110000', 'debit');
      const arOf   = (rows) => balanceOf(rows, (c) => c.startsWith('12'), 'debit');
      const apOf   = (rows) => balanceOf(rows, (c) => c.startsWith('22'), 'credit');

      const branchRows = branches.map(b => {
        const code = String(b.branchCode || '').trim().toUpperCase();
        return {
          slug: b.slug, name: b.name, self: !!b.self,
          branchCode: code,
          // Surfaced so an un-coded branch is visibly un-coded rather than
          // quietly lumped in with everything else.
          branchCodeValid: parseBranchCode(code).valid,
          netIncome: buildPnl(b.period, acctMeta).totals.netIncome,
          totalAssets: buildBalanceSheet(b.asOf, acctMeta).totals.assets,
          cash: cashOf(b.asOf),
          receivables: arOf(b.asOf),
          payables: apOf(b.asOf),
        };
      });

      res.json({
        success: true,
        complete: unreachable.length === 0,
        unreachable,
        period: { start: range.start, end: range.end },
        asOf: range.asOf,
        // Per-branch bottom line, so a combined figure can be traced back.
        branches: branchRows,
        // The same branches grouped by LOCATION. Two inventories can share one
        // address (AC-A001 and AC-A002), so "how did the mall site do?" is a
        // real question the per-branch list alone cannot answer.
        byLocation: rollUpByLocation(branchRows, ['netIncome', 'totalAssets', 'cash', 'receivables', 'payables']),
        // Group position as of the balance-sheet date. Computed from the
        // MERGED rows rather than by adding the branch figures up, so it
        // cannot disagree with the consolidated balance sheet beside it.
        position: {
          cash: cashOf(asOfRows),
          receivables: arOf(asOfRows),
          payables: apOf(asOfRows),
          netIncome: buildPnl(periodRows, acctMeta).totals.netIncome,
        },
        // Inter-branch transfers should net to zero across the group: the
        // sender debits clearing, the receiver credits it. Whatever is left is
        // stock sent but not yet received, or a receipt valued differently from
        // its release. It is real money in the group's assets either way, so it
        // is surfaced rather than left for the owner to find in the detail.
        interBranch: {
          unmatched: balanceOf(asOfRows, (c) => c === HUB_CLEARING_CODE, 'debit'),
        },
        pnl: buildPnl(periodRows, acctMeta),
        balanceSheet: buildBalanceSheet(asOfRows, acctMeta),
        // Codes a branch posted to that this instance's chart doesn't know -
        // typically a custom sub-account added on one branch only. Surfaced
        // rather than silently dropped from the consolidated totals.
        unknownAccounts: unknownCodes(asOfRows, acctMeta),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

}