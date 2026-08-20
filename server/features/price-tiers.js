// price-tier routes - the canonical registry of customer classes (Dealer,
// Satellite, Wholesale, ...) behind ClientAccount.segments and
// Product.segmentDiscounts. See the PriceTierSchema comment in server.js for
// why this exists: the two sides are matched by exact string, so the tag list
// has to be pickable rather than retyped.
//
// Reading is staff-wide (the product editor and client editor both populate
// dropdowns from it); mutating is superadmin, same bar as stock locations and
// categories, because renaming a tier changes what every tagged client pays.
import { captureError } from '../lib/errorLog.js';
import { resolveTierPrice } from '../lib/priceTiers.js';

export default function registerPriceTiers(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    BUSINESS_TYPE,
    tenantScope,
    logAudit,
    PriceTier,
    ClientAccount,
    Product,
    verifyToken,
    requireStaff,
    requireSuperAdmin,
  } = ctx;

  const cleanName = (v) => String(v == null ? '' : v).trim().slice(0, 60);
  const cleanPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/price-tiers', verifyToken, requireStaff, async (req, res) => {
    try {
      const tiers = await PriceTier.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).sort({ name: 1 }).lean();
      res.json({ success: true, tiers });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ───────────────────────────────────────────────────────────────────
  app.post('/api/price-tiers', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      const name = cleanName(req.body?.name);
      if (!name) return res.status(400).json({ success: false, error: 'Tier name is required.' });
      // Case-insensitive duplicate check. The unique index is exact-match only,
      // so without this "Dealer" and "dealer" would both be storable - exactly
      // the ambiguity this collection exists to remove.
      const clash = await PriceTier.findOne({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      }).lean();
      if (clash) return res.status(400).json({ success: false, error: `A tier named "${clash.name}" already exists.` });

      const pricingMode = req.body?.pricingMode === 'per_product' ? 'per_product' : 'percent';
      const tier = await PriceTier.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        name,
        percent: cleanPct(req.body?.percent),
        pricingMode,
        note: String(req.body?.note || '').trim().slice(0, 200),
        isActive: req.body?.isActive === undefined ? true : !!req.body.isActive,
      });
      await logAudit(req, { action: 'create', entity: 'PriceTier', entityId: tier._id, after: { name: tier.name, percent: tier.percent } });
      res.json({ success: true, tier });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────────
  // Renaming a tier re-tags every client carrying the old name, so the tag on the
  // account keeps matching the overrides on products. Without that cascade a
  // rename would silently strip the discount from every client in the tier.
  app.put('/api/price-tiers/:id', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Tier not found.' });
      const tier = await PriceTier.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!tier) return res.status(404).json({ success: false, error: 'Tier not found.' });

      const before = { name: tier.name, percent: tier.percent, isActive: tier.isActive };
      const oldName = tier.name;

      if (req.body?.name !== undefined) {
        const name = cleanName(req.body.name);
        if (!name) return res.status(400).json({ success: false, error: 'Tier name is required.' });
        if (name.toLowerCase() !== oldName.toLowerCase()) {
          const clash = await PriceTier.findOne({
            _id: { $ne: tier._id },
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
          }).lean();
          if (clash) return res.status(400).json({ success: false, error: `A tier named "${clash.name}" already exists.` });
        }
        tier.name = name;
      }
      if (req.body?.percent !== undefined) tier.percent = cleanPct(req.body.percent);
      if (req.body?.pricingMode !== undefined) tier.pricingMode = req.body.pricingMode === 'per_product' ? 'per_product' : 'percent';
      if (req.body?.note !== undefined) tier.note = String(req.body.note || '').trim().slice(0, 200);
      if (req.body?.isActive !== undefined) tier.isActive = !!req.body.isActive;
      await tier.save();

      let retagged = 0;
      if (tier.name !== oldName) {
        // Move the tag on every client that carried the old name, and on every
        // product override keyed to it.
        const clients = await ClientAccount.find({ segments: oldName }, { segments: 1 });
        for (const c of clients) {
          c.segments = [...new Set((c.segments || []).map(s => (s === oldName ? tier.name : s)))];
          await c.save();
          retagged++;
        }
        await Product.updateMany(
          { 'segmentDiscounts.segment': oldName },
          { $set: { 'segmentDiscounts.$[el].segment': tier.name } },
          { arrayFilters: [{ 'el.segment': oldName }] },
        );
      }

      await logAudit(req, { action: 'update', entity: 'PriceTier', entityId: tier._id, before, after: { name: tier.name, percent: tier.percent, isActive: tier.isActive } });
      res.json({ success: true, tier, retagged });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── SET PER-PRODUCT PRICES ──────────────────────────────────────────────────
  // Replaces this tier's ENTIRE product price list in one call - the UI sends
  // every row every time (a dealer sheet is edited as a whole page, not
  // patched one row at a time), so a full replace is simpler and can't leave
  // stale rows behind from a product that's since been removed from the form.
  // Only meaningful in 'per_product' mode; storing it either way costs nothing
  // and means switching modes later doesn't lose work already typed in.
  app.put('/api/price-tiers/:id/products', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Tier not found.' });
      const tier = await PriceTier.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!tier) return res.status(404).json({ success: false, error: 'Tier not found.' });

      const rows = Array.isArray(req.body?.prices) ? req.body.prices : [];
      const clean = [];
      for (const r of rows) {
        if (!r || !mongoose.Types.ObjectId.isValid(r.productId)) continue;
        const price = Number(r.price);
        if (!Number.isFinite(price) || price < 0) continue;
        clean.push({ productId: r.productId, price });
      }
      // Confirm every productId is real and belongs to this business - a stray
      // id here would silently price a row nobody can ever see or buy.
      const ids = clean.map(c => c.productId);
      const validIds = new Set((await Product.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map(p => String(p._id)));
      tier.productPrices = clean.filter(c => validIds.has(String(c.productId)));

      await tier.save();
      await logAudit(req, { action: 'update', entity: 'PriceTier', entityId: tier._id, after: { name: tier.name, productPriceCount: tier.productPrices.length } });
      res.json({ success: true, tier });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── PRICING TABLE ────────────────────────────────────────────────────────────
  // The full tier x product matrix - what every tier actually charges for
  // every product, in one call. Powers the "dealer/satellite price list" view;
  // the per-product-tier edit screen reuses the same shape pre-filled.
  app.get('/api/price-tiers/pricing-table', verifyToken, requireStaff, async (req, res) => {
    try {
      const [tiers, products] = await Promise.all([
        PriceTier.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) }).sort({ name: 1 }).lean(),
        Product.find({}, { name: 1, category: 1, basePrice: 1, isAvailable: 1 }).sort({ category: 1, name: 1 }).lean(),
      ]);
      const rows = tiers.map(t => ({
        _id: t._id, name: t.name, percent: t.percent, pricingMode: t.pricingMode, isActive: t.isActive,
        prices: Object.fromEntries(products.map(p => [String(p._id), resolveTierPrice(p, t)])),
      }));
      res.json({ success: true, products, tiers: rows });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────
  // Refused while clients still carry the tag - deleting would silently drop
  // their rate. Deactivate instead (isActive:false) to retire a tier gradually.
  app.delete('/api/price-tiers/:id', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Tier not found.' });
      const tier = await PriceTier.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!tier) return res.status(404).json({ success: false, error: 'Tier not found.' });

      const inUse = await ClientAccount.countDocuments({ segments: tier.name });
      if (inUse > 0) {
        return res.status(400).json({ success: false, error: `${inUse} client account${inUse === 1 ? '' : 's'} still assigned to "${tier.name}". Reassign them, or deactivate the tier instead.` });
      }
      await tier.deleteOne();
      await logAudit(req, { action: 'delete', entity: 'PriceTier', entityId: tier._id, before: { name: tier.name, percent: tier.percent } });
      res.json({ success: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
