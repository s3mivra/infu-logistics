// The shared product catalog across linked branches (see lib/branchNetwork.js).
// Branches find and trust each other exactly as the rest of the hub does - a
// LinkedBusiness row and its link token (see features/hub.js), which already
// covers transfers and the consolidated books.
import { requirePermission as permit } from '../lib/authz.js';
import { defineBranchModels, applyCatalog, setPriceOverride, httpError } from '../lib/branchNetwork.js';

const TENANT = (() => {
  const m = (process.env.MONGO_URI || '').match(/\/semivra_([^?/]+)/);
  return m ? m[1] : 'unknown';
})();

export default function registerBranchNetwork(ctx) {
  const {
    app, BUSINESS_TYPE, mongoose,
    LinkedBusiness, Product,
    verifyToken, requireStaff: requireAuth,
    logAudit, log,
  } = ctx;
  const { CatalogItem, CatalogLink } = defineBranchModels(mongoose.connection);
  const env = {
    conn: mongoose.connection, businessType: BUSINESS_TYPE, self: TENANT,
    models: { CatalogItem, CatalogLink, Product: Product || mongoose.model('Product') },
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
