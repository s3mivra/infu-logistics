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
    AuditLog,
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

      // "As of [date]" history for a percent-mode tier - one shared rate, so
      // logged once against the tier itself (not per product, unlike the
      // per_product branch below). Only fires when the rate actually moved.
      if (before.percent !== tier.percent) {
        await AuditLog.create({
          userId: req.user ? req.user.name : 'System',
          action: 'TIER_PERCENT_CHANGED',
          targetReference: String(tier._id),
          details: { tierName: tier.name, oldPercent: before.percent, newPercent: tier.percent },
        });
      }

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
      // Quantity breaks, scoped to THIS tier - optional, and independent of
      // `prices` above (a product can have a break with no flat rate, or vice
      // versa). Only validated/replaced when the caller actually sends the
      // key, so a plain flat-price save (the common case) never has to also
      // resend every break just to avoid wiping them out.
      let breaksClean = null;
      if (Array.isArray(req.body?.bulkBreaks)) {
        breaksClean = [];
        for (const r of req.body.bulkBreaks) {
          if (!r || !mongoose.Types.ObjectId.isValid(r.productId)) continue;
          const minQty = Number(r.minQty);
          const price = Number(r.price);
          if (!Number.isFinite(minQty) || minQty <= 0) continue;
          if (!Number.isFinite(price) || price < 0) continue;
          breaksClean.push({ productId: r.productId, minQty, price });
        }
      }

      // Confirm every productId is real and belongs to this business - a stray
      // id here would silently price a row nobody can ever see or buy.
      const ids = [...new Set([...clean.map(c => c.productId), ...(breaksClean || []).map(c => c.productId)])];
      const validIds = new Set((await Product.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map(p => String(p._id)));

      // Snapshot the price this tier charged for each product BEFORE the
      // replace below, so the "as of [date]" history can log only the rows
      // that actually moved - not all 300 products every time a sheet is
      // re-saved. Keyed by productId since that's what the UI's per-product
      // history view looks a change up by.
      const beforePrices = new Map((tier.productPrices || []).map(p => [String(p.productId), Number(p.price)]));

      tier.productPrices = clean.filter(c => validIds.has(String(c.productId)));
      if (breaksClean !== null) tier.productBulkBreaks = breaksClean.filter(c => validIds.has(String(c.productId)));

      await tier.save();
      await logAudit(req, { action: 'update', entity: 'PriceTier', entityId: tier._id, after: { name: tier.name, productPriceCount: tier.productPrices.length, bulkBreakCount: tier.productBulkBreaks.length } });

      // Per-product "as of [date]: price" trail - Market Segment Pricing's
      // counterpart to PRODUCT_PRICE_CHANGED. `targetReference` is
      // `<tierId>:<productId>` so a single history lookup can pull just one
      // cell's changes; covers rows that changed price, rows newly added
      // (oldPrice null), and rows removed from the sheet (newPrice null).
      const afterPrices = new Map(tier.productPrices.map(p => [String(p.productId), Number(p.price)]));
      const touched = new Set([...beforePrices.keys(), ...afterPrices.keys()]);
      const entries = [];
      for (const productId of touched) {
        const oldPrice = beforePrices.has(productId) ? beforePrices.get(productId) : null;
        const newPrice = afterPrices.has(productId) ? afterPrices.get(productId) : null;
        if (oldPrice === newPrice) continue;
        entries.push({
          userId: req.user ? req.user.name : 'System',
          action: 'TIER_PRICE_CHANGED',
          targetReference: `${tier._id}:${productId}`,
          details: { tierId: String(tier._id), tierName: tier.name, productId, oldPrice, newPrice },
        });
      }
      if (entries.length) await AuditLog.insertMany(entries);

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
        // productCode is the Excel import/export match key (see the client's
        // exportPriceTiersExcel / parsePriceTierExcel) - authoritative because a
        // product's NAME can be edited in the sheet without breaking the match.
        Product.find({}, { name: 1, category: 1, basePrice: 1, isAvailable: 1, productCode: 1 }).sort({ category: 1, name: 1 }).lean(),
      ]);
      const rows = tiers.map(t => ({
        _id: t._id, name: t.name, percent: t.percent, pricingMode: t.pricingMode, isActive: t.isActive,
        // qty defaults to 0 here (see resolveTierPrice), so this NEVER reflects
        // a quantity break - there is no cart quantity yet at this static
        // display. `bulkBreaks` is exposed separately so the UI can still show
        // "P550 at 20+" underneath, and edit it, without pretending it's the
        // flat price.
        prices: Object.fromEntries(products.map(p => [String(p._id), resolveTierPrice(p, t)])),
        bulkBreaks: (t.productBulkBreaks || []).map(b => ({ productId: String(b.productId), minQty: b.minQty, price: b.price })),
      }));
      res.json({ success: true, products, tiers: rows });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── HISTORY ──────────────────────────────────────────────────────────────────
  // Market Segment Pricing's "as of [date]: price" trail, mirroring
  // /api/products/:id/price-history. With ?productId=, returns that one
  // cell's price changes (per_product tiers); without it, returns the
  // tier's shared percent changes (percent tiers) - a per_product tier has
  // no single "tier price" to show without a product, and a percent tier
  // has no per-product rows at all, so the two never overlap for one call.
  app.get('/api/price-tiers/:id/history', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Tier not found.' });
      const tier = await PriceTier.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!tier) return res.status(404).json({ success: false, error: 'Tier not found.' });

      const productId = req.query.productId && mongoose.Types.ObjectId.isValid(req.query.productId) ? String(req.query.productId) : null;

      let rows;
      let type;
      if (productId) {
        type = 'price';
        rows = await AuditLog.find({
          action: 'TIER_PRICE_CHANGED',
          targetReference: `${tier._id}:${productId}`,
        }).sort({ timestamp: -1 }).limit(200).lean();
      } else {
        type = 'percent';
        rows = await AuditLog.find({
          action: 'TIER_PERCENT_CHANGED',
          targetReference: String(tier._id),
        }).sort({ timestamp: -1 }).limit(200).lean();
      }

      const history = rows.map(r => ({
        date: r.timestamp,
        type,
        oldValue: type === 'price' ? r.details?.oldPrice : r.details?.oldPercent,
        newValue: type === 'price' ? r.details?.newPrice : r.details?.newPercent,
        changedBy: r.userId || '',
      }));

      res.json({ success: true, tier: { _id: tier._id, name: tier.name, percent: tier.percent, pricingMode: tier.pricingMode }, history });
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
