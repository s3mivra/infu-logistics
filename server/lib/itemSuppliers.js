// Who each stock item comes from - one answer for Analytics -> Stock movement
// and for the Suggested PO, so the supplier a draft goes to and the delivery
// time its quantity was worked out with are the same supplier's.
//
//   1. The cheapest quote in a supplier's catalog (price list) for the item.
//   2. Failing that, whoever it was last bought from: the newest purchase order
//      with a line for it. A PO may name its supplier by text only (no saved
//      supplier), and then that name is the answer.
//
// Each answer carries the supplier's own delivery time (Supplier.leadTimeDays)
// when one is recorded; null means "use the business-wide default".

const leadOf = (s) => {
  const n = Number(s?.leadTimeDays);
  return s && s.leadTimeDays !== null && s.leadTimeDays !== undefined && s.leadTimeDays !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

export async function itemSuppliers({ Supplier, PurchaseOrder, tenant = {} }) {
  const out = new Map();   // invId -> { supplierId, supplierName, unitCost, packSize, leadTimeDays, source }
  const suppliers = await Supplier.find({ ...tenant, isActive: { $ne: false } }, { name: 1, catalog: 1, leadTimeDays: 1 }).lean();
  const byId = new Map(suppliers.map(s => [String(s._id), s]));
  const byName = new Map(suppliers.map(s => [String(s.name || '').trim().toUpperCase(), s]));

  for (const s of suppliers) {
    for (const c of s.catalog || []) {
      if (!c.invId) continue;
      const key = String(c.invId);
      const cur = out.get(key);
      if (!cur || (Number(c.unitCost) || 0) < (Number(cur.unitCost) || 0)) {
        out.set(key, { supplierId: String(s._id), supplierName: s.name, unitCost: c.unitCost, packSize: c.packSize, leadTimeDays: leadOf(s), source: 'catalog' });
      }
    }
  }

  if (PurchaseOrder) {
    const pos = await PurchaseOrder.find({ ...tenant, status: { $ne: 'Cancelled' }, 'lines.invId': { $ne: null } }, { supplier: 1, supplierId: 1, lines: 1, createdAt: 1 })
      .sort({ createdAt: -1 }).limit(500).lean();
    for (const po of pos) {
      const name = String(po.supplier || '').trim();
      if (!po.supplierId && !name) continue;
      const saved = (po.supplierId && byId.get(String(po.supplierId))) || byName.get(name.toUpperCase()) || null;
      for (const l of po.lines || []) {
        const key = l.invId ? String(l.invId) : null;
        if (!key || out.has(key)) continue;
        out.set(key, {
          supplierId: saved ? String(saved._id) : (po.supplierId ? String(po.supplierId) : null),
          supplierName: saved?.name || name, unitCost: l.unitCost, packSize: null,
          leadTimeDays: leadOf(saved), source: 'lastPo',
        });
      }
    }
  }
  return out;
}

// A supplier's delivery time as typed: whole days 0-90, or blank for "not set".
export function cleanLeadTime(v) {
  if (v === null || v === undefined || String(v).trim() === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 90 || Math.round(n) !== n) return { ok: false, error: 'Lead time must be a whole number of days, 0 to 90 (or blank).' };
  return { ok: true, value: n };
}
