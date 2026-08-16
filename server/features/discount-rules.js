// discount-rules routes - configurable order-level conditional discount rules
// + an evaluation endpoint. See the DiscountRuleSchema comment in server.js:
// this decides WHICH percent to suggest; it never touches how a discount is
// booked (the POS applies the result through the existing order-level
// discountPercent field).
import { captureError } from '../lib/errorLog.js';

export default function registerDiscountRules(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    BUSINESS_TYPE,
    tenantScope,
    logAudit,
    DiscountRule,
    ClientAccount,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  // Managing promo rules is a settings-level, business-config action.
  const canManage = [requireStaff, requirePermission('settings.manage')];
  // Any staff running the POS needs to evaluate rules to ring up a sale.
  const canUse = [requireStaff];

  const clean = (b) => {
    const out = {};
    if (b.name !== undefined) out.name = String(b.name).trim().slice(0, 120);
    if (b.percent !== undefined) out.percent = Math.max(0, Math.min(100, Number(b.percent) || 0));
    if (b.active !== undefined) out.active = !!b.active;
    if (b.priority !== undefined) out.priority = Number(b.priority) || 0;
    if (b.minSubtotal !== undefined) out.minSubtotal = b.minSubtotal === null || b.minSubtotal === '' ? null : Math.max(0, Number(b.minSubtotal) || 0);
    if (b.daysOfWeek !== undefined) out.daysOfWeek = Array.isArray(b.daysOfWeek) ? [...new Set(b.daysOfWeek.map(Number).filter(d => d >= 0 && d <= 6))] : [];
    if (b.startDate !== undefined) out.startDate = b.startDate ? new Date(b.startDate) : null;
    if (b.endDate !== undefined) out.endDate = b.endDate ? new Date(b.endDate) : null;
    if (b.segment !== undefined) out.segment = String(b.segment || '').trim().slice(0, 60);
    return out;
  };

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/discount-rules', verifyToken, ...canUse, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.active === 'true') q.active = true;
      const rules = await DiscountRule.find(q).sort({ priority: -1, percent: -1 }).lean();
      res.json({ success: true, rules });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CREATE ───────────────────────────────────────────────────────────────────
  app.post('/api/discount-rules', verifyToken, ...canManage, async (req, res) => {
    try {
      const data = clean(req.body || {});
      if (!data.name) return res.status(400).json({ success: false, error: 'name is required.' });
      if (data.percent === undefined) return res.status(400).json({ success: false, error: 'percent is required.' });
      if (data.startDate && data.endDate && data.endDate < data.startDate) {
        return res.status(400).json({ success: false, error: 'endDate must be on or after startDate.' });
      }
      const rule = await DiscountRule.create({ businessType: BUSINESS_TYPE, ...tenantScope(req), ...data, createdBy: req.user?.name || '' });
      await logAudit(req, { action: 'create', entity: 'DiscountRule', entityId: rule._id, after: { name: rule.name, percent: rule.percent } });
      res.json({ success: true, rule });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────────
  app.patch('/api/discount-rules/:id', verifyToken, ...canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const rule = await DiscountRule.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!rule) return res.status(404).json({ success: false, error: 'Not found' });
      Object.assign(rule, clean(req.body || {}));
      if (rule.startDate && rule.endDate && rule.endDate < rule.startDate) {
        return res.status(400).json({ success: false, error: 'endDate must be on or after startDate.' });
      }
      await rule.save();
      await logAudit(req, { action: 'update', entity: 'DiscountRule', entityId: rule._id, after: { name: rule.name, percent: rule.percent, active: rule.active } });
      res.json({ success: true, rule });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────
  app.delete('/api/discount-rules/:id', verifyToken, ...canManage, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const rule = await DiscountRule.findOneAndDelete({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!rule) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── EVALUATE ─────────────────────────────────────────────────────────────────
  // POST /api/discount-rules/evaluate { subtotal, clientId?, segment?, at? }
  // Returns the single best applicable rule (highest percent, priority breaks
  // ties) plus every match for transparency. "Best single rule wins" - rules
  // do NOT stack, the clearest and safest default for a promo engine; the POS
  // then applies bestPercent through the order's existing discountPercent field.
  app.post('/api/discount-rules/evaluate', verifyToken, ...canUse, async (req, res) => {
    try {
      const subtotal = Number(req.body?.subtotal) || 0;
      const at = req.body?.at ? new Date(req.body.at) : new Date();
      // Day-of-week in Manila (the business's operating timezone), matching how
      // every other date bucket in this app is computed.
      const manilaDow = new Date(at.toLocaleString('en-US', { timeZone: 'Asia/Manila' })).getDay();

      // Resolve the buyer's segments: an explicit `segment`, or every segment on
      // the given clientId's account. A segment-scoped rule needs one of these.
      let segments = [];
      if (req.body?.segment) segments = [String(req.body.segment)];
      else if (req.body?.clientId && mongoose.Types.ObjectId.isValid(req.body.clientId)) {
        const client = await ClientAccount.findById(req.body.clientId).lean();
        segments = client?.segments || [];
      }

      const rules = await DiscountRule.find({ businessType: BUSINESS_TYPE, ...tenantScope(req), active: true }).lean();
      const applicable = rules.filter((r) => {
        if (r.minSubtotal != null && subtotal < r.minSubtotal) return false;
        if (Array.isArray(r.daysOfWeek) && r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(manilaDow)) return false;
        if (r.startDate && at < new Date(r.startDate)) return false;
        // endDate is inclusive of the whole day it names.
        if (r.endDate) { const end = new Date(r.endDate); end.setHours(23, 59, 59, 999); if (at > end) return false; }
        if (r.segment && !segments.includes(r.segment)) return false;
        return true;
      });

      // Best = highest percent, then highest priority.
      const best = applicable.slice().sort((a, b) => (b.percent - a.percent) || (b.priority - a.priority))[0] || null;
      res.json({
        success: true,
        bestPercent: best ? best.percent : 0,
        bestRule: best ? { _id: best._id, name: best.name, percent: best.percent } : null,
        applicable: applicable.map((r) => ({ _id: r._id, name: r.name, percent: r.percent })),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
