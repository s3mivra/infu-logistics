// Costing sheets: what one unit of a product costs to make or buy, and the
// selling price that calls for. The arithmetic lives in the client
// (shared/costing.js) and works from live stock costs; a sheet saved here is the
// recipe of the costing - its lines and pricing rule - so it can be opened
// again later and re-priced against whatever stock costs by then.
//
// Applying a sheet's price to a product does NOT happen here: it goes through
// PUT /api/products/:id like any other price change, so the price-approval gate
// (lib/changeApproval.js) and the price-change audit trail apply unchanged.
import { captureError } from '../lib/errorLog.js';

const KINDS = ['stock', 'amount', 'percent'];
const METHODS = ['markup', 'margin'];
const num = (v, lo, hi, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};

// Keep only what a sheet is made of, bounded, so nothing odd is stored.
export function cleanSheet(body = {}) {
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) return { error: 'Give the costing a name.' };
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 100).map(l => ({
    kind: KINDS.includes(l?.kind) ? l.kind : 'amount',
    invId: l?.kind === 'stock' && l?.invId ? String(l.invId).slice(0, 40) : null,
    name: String(l?.name || '').trim().slice(0, 120),
    qty: num(l?.qty, 0, 1e9),
    unit: String(l?.unit || '').trim().slice(0, 10),
    amount: num(l?.amount, 0, 1e9),
    percent: num(l?.percent, 0, 1000),
  }));
  const method = METHODS.includes(body.method) ? body.method : 'markup';
  const rate = num(body.rate, 0, method === 'margin' ? 99.99 : 10000);
  return {
    sheet: {
      name, lines, method, rate,
      vatRate: num(body.vatRate, 0, 100),
      rounding: num(body.rounding, 0, 100000),
      productId: body.productId ? String(body.productId).slice(0, 40) : null,
      sizeIndex: Number.isInteger(Number(body.sizeIndex)) ? num(body.sizeIndex, -1, 50, -1) : -1,
      notes: String(body.notes || '').trim().slice(0, 500),
      // What it came to when saved, for the list - recomputed live on opening.
      lastCost: num(body.lastCost, 0, 1e9),
      lastSrp: num(body.lastSrp, 0, 1e9),
    },
  };
}

export default function registerCosting(ctx) {
  const { app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, verifyToken, requireStaff, requirePermission, logAudit } = ctx;
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));

  const LineSchema = new mongoose.Schema({
    kind: { type: String, enum: KINDS, default: 'amount' },
    invId: { type: String, default: null },
    name: { type: String, default: '' },
    qty: { type: Number, default: 0 },
    unit: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    percent: { type: Number, default: 0 },
  }, { _id: false });
  const CostingSheetSchema = new mongoose.Schema({
    businessType: { type: String, default: () => BUSINESS_TYPE, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    name: { type: String, required: true },
    productId: { type: String, default: null, index: true },
    sizeIndex: { type: Number, default: -1 },
    lines: [LineSchema],
    method: { type: String, enum: METHODS, default: 'markup' },
    rate: { type: Number, default: 0 },
    vatRate: { type: Number, default: 0 },
    rounding: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    lastCost: { type: Number, default: 0 },
    lastSrp: { type: Number, default: 0 },
    updatedBy: { type: String, default: '' },
    // When this sheet's price was last sent to the product, and what it was.
    appliedAt: { type: Date, default: null },
    appliedPrice: { type: Number, default: null },
  }, { timestamps: true });
  const CostingSheet = mongoose.models.CostingSheet || mongoose.model('CostingSheet', CostingSheetSchema);

  const scope = (req) => ({ businessType: BUSINESS_TYPE, ...tenantScope(req) });
  const canView = [verifyToken, requireStaff, requirePermission('products.view')];
  const canEdit = [verifyToken, requireStaff, requirePermission('products.manage')];
  const validId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

  app.get('/api/costing/sheets', ...canView, async (req, res) => {
    try {
      const sheets = await CostingSheet.find(scope(req)).sort({ updatedAt: -1 }).limit(500).lean();
      res.json({ success: true, sheets });
    } catch (err) { fail(req, res, err); }
  });

  app.post('/api/costing/sheets', ...canEdit, async (req, res) => {
    try {
      const { sheet, error } = cleanSheet(req.body);
      if (error) return res.status(400).json({ success: false, error });
      const applied = req.body?.appliedPrice != null && Number(req.body.appliedPrice) > 0
        ? { appliedAt: new Date(), appliedPrice: Number(req.body.appliedPrice) } : {};
      const doc = await CostingSheet.create({ ...sheet, ...applied, ...scope(req), updatedBy: req.user?.name || '' });
      try { await logAudit?.(req, { action: 'create', entity: 'CostingSheet', entityId: doc._id, after: { name: doc.name } }); } catch { /* non-fatal */ }
      res.json({ success: true, sheet: doc.toObject() });
    } catch (err) { fail(req, res, err); }
  });

  app.put('/api/costing/sheets/:id', ...canEdit, async (req, res) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const { sheet, error } = cleanSheet(req.body);
      if (error) return res.status(400).json({ success: false, error });
      const set = { ...sheet, updatedBy: req.user?.name || '' };
      // Recorded by the client after a price was sent to the product.
      if (req.body?.appliedPrice != null && Number(req.body.appliedPrice) > 0) { set.appliedAt = new Date(); set.appliedPrice = Number(req.body.appliedPrice); }
      const doc = await CostingSheet.findOneAndUpdate({ _id: req.params.id, ...scope(req) }, { $set: set }, { returnDocument: 'after' }).lean();
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, sheet: doc });
    } catch (err) { fail(req, res, err); }
  });

  app.delete('/api/costing/sheets/:id', ...canEdit, async (req, res) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const r = await CostingSheet.deleteOne({ _id: req.params.id, ...scope(req) });
      if (!r.deletedCount) return res.status(404).json({ success: false, error: 'Not found' });
      try { await logAudit?.(req, { action: 'delete', entity: 'CostingSheet', entityId: req.params.id }); } catch { /* non-fatal */ }
      res.json({ success: true });
    } catch (err) { fail(req, res, err); }
  });
}
