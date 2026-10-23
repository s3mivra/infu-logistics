// Multi-branch: consolidated reports, branch-to-branch stock transfers and the
// shared product catalog, on top of the hub's existing links.
//
// Branches find and trust each other exactly as the rest of the hub does - a
// LinkedBusiness row and its link token (see features/hub.js). The bookkeeping
// lives in lib/branchNetwork.js; this file is the routes, the calls between
// branches, and the retry sweep for a partner that was out of reach.
import { AsyncResource } from 'node:async_hooks';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr } from '../lib/businessTime.js';
import { requirePermission as permit } from '../lib/authz.js';
import {
  defineBranchModels, createTransfer, approveTransfer, shipTransfer, receiveTransfer, closeTransfer,
  applyPartnerState, syncPayload, applyCatalog, setPriceOverride, branchReport, mergeBranchReports, httpError,
} from '../lib/branchNetwork.js';

const TENANT = (() => {
  const m = (process.env.MONGO_URI || '').match(/\/semivra_([^?/]+)/);
  return m ? m[1] : 'unknown';
})();

export default function registerBranchNetwork(ctx) {
  const {
    app, BUSINESS_TYPE, mongoose,
    LinkedBusiness, Inventory, StockCard, JournalEntry, Order, Product, Settings,
    verifyToken, requireStaff: requireAuth, requireSuperAdmin,
    logAudit, acctMeta, log,
  } = ctx;
  const { BranchTransfer, CatalogItem, CatalogLink } = defineBranchModels(mongoose.connection);
  const env = {
    conn: mongoose.connection, businessType: BUSINESS_TYPE, self: TENANT,
    models: { BranchTransfer, CatalogItem, CatalogLink, Inventory, StockCard, JournalEntry, Order, Product: Product || mongoose.model('Product') },
  };

  const fail = (res, err) => {
    if (err?.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
    log?.error?.({ err }, 'branch network route failed');
    return res.status(500).json({ error: err?.message || 'Internal server error' });
  };
  const audit = async (req, entry) => { try { await logAudit?.(req, entry); } catch { /* non-fatal */ } };

  async function requireLinkToken(req, res, next) {
    const token = req.get('x-link-token');
    if (!token) return res.status(401).json({ error: 'Missing link token.' });
    const link = await LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, linkToken: token, status: 'active' }).lean();
    if (!link) return res.status(403).json({ error: 'Invalid link token.' });
    req.linkedPartner = link;
    next();
  }
  const linkFor = (slug) => LinkedBusiness.findOne({ businessType: BUSINESS_TYPE, partnerSlug: slug, status: 'active' }).lean();

  async function partnerFetch(link, path, { method = 'GET', body, timeout = 15_000 } = {}) {
    const r = await fetch(`${link.partnerUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-link-token': link.linkToken },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeout),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Partner returned ${r.status}`), { status: r.status });
    return data;
  }

  // ── Transfers ──────────────────────────────────────────────────────────────

  // Tell the partner our copy's state. Our own step is already committed, so
  // a failure here only means they are behind: the flag stays up and the
  // sweep tries again. A partner that answers "no" will not change its mind.
  async function pushToPartner(doc) {
    const link = await linkFor(doc.partnerSlug);
    if (!link) return 'Saved here - the link to that branch is not active, so it has not been told.';
    try {
      await partnerFetch(link, '/api/hub/internal/branch-transfer', { method: 'POST', body: syncPayload(doc) });
      await BranchTransfer.updateOne({ _id: doc._id }, { $set: { partnerSync: false } });
    } catch (err) {
      if (err.status >= 400 && err.status < 500) {
        await BranchTransfer.updateOne({ _id: doc._id }, { $set: { partnerSync: false } });
        return `Saved here, but ${doc.partnerSlug} did not accept it: ${err.message}`;
      }
      scheduleSweep(60_000);
      return `Saved here. ${doc.partnerSlug} could not be reached (${err.message}) - it will be sent again automatically.`;
    }
  }

  const sweepAll = async () => {
    const behind = await BranchTransfer.find({ businessType: BUSINESS_TYPE, partnerSync: true }).limit(200);
    for (const doc of behind) await pushToPartner(doc);
  };
  // Started outside any request, so it does not inherit a finished transaction.
  const outside = new AsyncResource('branch-transfer-sweep');
  let sweepTimer = null;
  const scheduleSweep = (delayMs) => {
    if (sweepTimer) return;
    outside.runInAsyncScope(() => {
      sweepTimer = setTimeout(() => {
        sweepTimer = null;
        if (mongoose.connection.readyState !== 1) return;
        sweepAll().catch(err => log?.error?.({ err }, 'Branch transfer sweep failed'));
      }, delayMs);
      sweepTimer.unref?.();
    });
  };
  setInterval(() => scheduleSweep(0), 10 * 60 * 1000).unref?.();

  app.get('/api/hub/branch-transfers', verifyToken, requireAuth, async (req, res) => {
    const transfers = await BranchTransfer.find({ businessType: BUSINESS_TYPE }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ self: TENANT, transfers });
  });

  // Body: { partnerSlug, direction: 'send'|'receive', items: [{itemId?|itemCode?|itemName, unit?, qty}], note }
  app.post('/api/hub/branch-transfers', verifyToken, requireAuth, permit('inventory.manage'), async (req, res) => {
    try {
      const { partnerSlug, direction, items, note } = req.body || {};
      if (!partnerSlug || !(await linkFor(partnerSlug))) throw httpError(404, 'No active link with that branch.');
      const doc = await createTransfer(env, { partnerSlug, direction, items, note, by: req.user?.name });
      const warning = await pushToPartner(doc);
      await audit(req, { action: 'create', entity: 'BranchTransfer', entityId: doc.transferRef, after: { partnerSlug, direction, lines: doc.lines.length } });
      res.json({ ok: true, transfer: await BranchTransfer.findById(doc._id).lean(), warning });
    } catch (err) { fail(res, err); }
  });

  const step = (name, fn, guards) => app.post(`/api/hub/branch-transfers/:ref/${name}`, verifyToken, requireAuth, ...guards, async (req, res) => {
    try {
      const doc = await fn(req);
      const warning = doc.partnerSync ? await pushToPartner(doc) : undefined;
      await audit(req, { action: name, entity: 'BranchTransfer', entityId: doc.transferRef, after: { status: doc.status, totalValue: doc.totalValue } });
      res.json({ ok: true, transfer: await BranchTransfer.findById(doc._id).lean(), warning });
    } catch (err) { fail(res, err); }
  });
  const by = (req) => req.user?.name || '';
  step('approve', (req) => approveTransfer(env, req.params.ref, { by: by(req) }), [requireSuperAdmin]);
  step('ship', (req) => shipTransfer(env, req.params.ref, { by: by(req) }), [permit('inventory.manage')]);
  step('receive', (req) => receiveTransfer(env, req.params.ref, { by: by(req), targets: req.body?.targets || {} }), [permit('inventory.manage')]);
  step('reject', (req) => closeTransfer(env, req.params.ref, { action: 'reject', by: by(req), reason: req.body?.reason }), [requireSuperAdmin]);
  step('cancel', (req) => closeTransfer(env, req.params.ref, { action: 'cancel', by: by(req), reason: req.body?.reason }), [permit('inventory.manage')]);

  // The partner's copy moved on; mirror it. Who is calling comes from the link
  // token, never the body.
  app.post('/api/hub/internal/branch-transfer', requireLinkToken, async (req, res) => {
    try {
      const out = await applyPartnerState(env, req.linkedPartner.partnerSlug, req.body || {});
      res.json({ ok: true, status: out.doc?.status, ignored: out.ignored });
    } catch (err) { fail(res, err); }
  });

  // ── Consolidated reports ───────────────────────────────────────────────────

  const parseRange = (q) => {
    const start = q.start ? dayStart(String(q.start).slice(0, 10)) : dayStart(businessDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
    const end = dayEnd(q.end ? String(q.end).slice(0, 10) : businessDateStr(new Date()));
    return { start, end };
  };
  const ownBranchCode = async () => String((await Settings.findOne({ key: 'branchCode' }).lean())?.value || '').trim().toUpperCase();

  app.get('/api/hub/internal/branch-report', requireLinkToken, async (req, res) => {
    try {
      res.json({ tenant: TENANT, branchCode: await ownBranchCode(), ...(await branchReport(env, parseRange(req.query), acctMeta)) });
    } catch (err) { fail(res, err); }
  });

  // Sales, P&L and stock value for every linked branch, with the breakdown.
  // As with the consolidated books, a branch that cannot be reached is named,
  // never quietly left out of a total presented as complete.
  app.get('/api/hub/consolidated-report', verifyToken, requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const range = parseRange(req.query);
      const qs = `start=${businessDateStr(range.start)}&end=${businessDateStr(range.end)}`;
      const links = await LinkedBusiness.find({ businessType: BUSINESS_TYPE, status: 'active' }).lean();
      const own = { slug: TENANT, name: 'This Business', self: true, branchCode: await ownBranchCode(), ...(await branchReport(env, range, acctMeta)) };
      const fetched = await Promise.all(links.map(async (link) => {
        try {
          const data = await partnerFetch(link, `/api/hub/internal/branch-report?${qs}`);
          return { slug: link.partnerSlug, name: link.partnerName || link.partnerSlug, ok: true, branchCode: data.branchCode || '', sales: data.sales, pnl: data.pnl, stock: data.stock };
        } catch (err) {
          return { slug: link.partnerSlug, name: link.partnerName || link.partnerSlug, ok: false, error: err.message };
        }
      }));
      const unreachable = fetched.filter(b => !b.ok).map(({ slug, name, error }) => ({ slug, name, error }));
      const merged = mergeBranchReports([own, ...fetched.filter(b => b.ok).map(({ ok: _ok, ...b }) => b)]);
      res.json({ success: true, complete: unreachable.length === 0, unreachable, period: range, ...merged });
    } catch (err) { fail(res, err); }
  });

  // ── Shared catalog ─────────────────────────────────────────────────────────

  const cleanCatalogItem = (b) => {
    const sku = String(b?.sku || '').trim().toUpperCase().slice(0, 60);
    const name = String(b?.name || '').trim().slice(0, 200);
    const basePrice = Number(b?.basePrice);
    if (!sku || !name) throw httpError(400, 'sku and name are required.');
    if (!Number.isFinite(basePrice) || basePrice < 0) throw httpError(400, 'basePrice must be zero or more.');
    return {
      sku, name, basePrice,
      category: String(b.category || '').trim().slice(0, 80),
      unit: String(b.unit || '').trim().slice(0, 40),
      ...(b.active !== undefined ? { active: !!b.active } : {}),
    };
  };

  app.get('/api/hub/catalog', verifyToken, requireAuth, async (req, res) => {
    const items = await CatalogItem.find({ businessType: BUSINESS_TYPE }).sort({ sku: 1 }).lean();
    res.json({ items });
  });

  // Create or update a master catalog entry (by SKU). Each change bumps its
  // version, which branches record when they sync.
  app.post('/api/hub/catalog', verifyToken, requireAuth, permit('products.manage'), async (req, res) => {
    try {
      const it = cleanCatalogItem(req.body);
      const { sku, ...rest } = it;
      const item = await CatalogItem.findOneAndUpdate(
        { businessType: BUSINESS_TYPE, sku },
        { $set: rest, $inc: { version: 1 }, $setOnInsert: { businessType: BUSINESS_TYPE, sku } },
        { upsert: true, returnDocument: 'after' },
      ).lean();
      await audit(req, { action: 'update', entity: 'CatalogItem', entityId: sku, after: rest });
      res.json({ ok: true, item });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/hub/internal/catalog', requireLinkToken, async (req, res) => {
    const items = await CatalogItem.find({ businessType: BUSINESS_TYPE }, { _id: 0, sku: 1, name: 1, category: 1, unit: 1, basePrice: 1, active: 1, version: 1 }).lean();
    res.json({ source: TENANT, items });
  });

  // Pull the master catalog from a linked branch (or this one's own, with
  // sourceSlug 'self') into this branch's products.
  app.post('/api/hub/catalog/sync', verifyToken, requireAuth, permit('products.manage'), async (req, res) => {
    try {
      const sourceSlug = String(req.body?.sourceSlug || '').trim();
      if (!sourceSlug) throw httpError(400, 'sourceSlug is required.');
      let items;
      if (sourceSlug === 'self' || sourceSlug === TENANT) {
        items = await CatalogItem.find({ businessType: BUSINESS_TYPE }).lean();
      } else {
        const link = await linkFor(sourceSlug);
        if (!link) throw httpError(404, 'No active link with that branch.');
        try { items = (await partnerFetch(link, '/api/hub/internal/catalog')).items; }
        catch (err) { throw httpError(502, `Could not fetch the catalog from ${sourceSlug}: ${err.message}`); }
      }
      const result = await applyCatalog(env, sourceSlug === 'self' ? TENANT : sourceSlug, items);
      await audit(req, { action: 'sync', entity: 'CatalogLink', entityId: sourceSlug, after: result });
      res.json({ ok: true, ...result });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/hub/catalog/links', verifyToken, requireAuth, async (req, res) => {
    const links = await CatalogLink.find({ businessType: BUSINESS_TYPE }).sort({ sku: 1 }).lean();
    res.json({ links: links.map(l => ({ ...l, effectivePrice: l.overridePrice ?? l.masterPrice })) });
  });

  // Body: { price: number | null } - null goes back to following the master.
  app.put('/api/hub/catalog/links/:sku/override', verifyToken, requireAuth, permit('products.manage'), async (req, res) => {
    try {
      const link = await setPriceOverride(env, req.params.sku, req.body?.price ?? null);
      await audit(req, { action: 'update', entity: 'CatalogLink', entityId: link.sku, after: { overridePrice: link.overridePrice } });
      res.json({ ok: true, link: { ...link.toObject(), effectivePrice: link.overridePrice ?? link.masterPrice } });
    } catch (err) { fail(res, err); }
  });
}
