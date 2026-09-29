// Price tiers from a sheet: Code | Product | List Price | <one column per tier>.
//
// The same layout Pricing Control exports, so a price list can go out, be
// edited and come back - and the same sheet sits in the setup workbook. Each
// tier column creates the tier (or updates the one with that name, any case)
// as a per-product price list; each row is matched to a product by its code
// first (a name can be edited in the sheet without breaking the match), then
// by name. List Price is for reading only - the product's own price stays
// where it is (Catalog Setup / the Inventory sheet's SRP).
//
// In the setup workbook the products do not exist yet when this sheet is read:
// they are made from the Inventory sheet, which opens as a preview and is
// confirmed afterwards. So a price whose product is not there yet is kept
// (Settings: pendingTierPrices) and applied the moment products are created -
// see applyPendingTierPrices, called after an inventory import.

const PENDING_KEY = 'pendingTierPrices';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

// Rows (objects keyed by the sheet's headers) -> [{ tier, code, name, price }]
export function readTierRows(rows = []) {
  const entries = [];
  const problems = [];
  if (!rows.length) return { entries, problems, tierNames: [] };
  const headers = Object.keys(rows.find((r) => r && Object.keys(r).length) || {});
  const codeKey = headers.find((h) => norm(h) === 'code' || norm(h).startsWith('code'));
  const nameKey = headers.find((h) => norm(h).includes('product'));
  const tierKeys = headers.filter((h) => h !== codeKey && h !== nameKey && norm(h) !== 'listprice' && String(h).trim());
  rows.forEach((r, i) => {
    if (!r) return;
    const code = String(r[codeKey] ?? '').trim();
    const name = String(r[nameKey] ?? '').trim();
    if (!code && !name) return;
    for (const t of tierKeys) {
      const price = money(r[t]);
      if (price === null) continue;                  // blank: this tier has no price for it
      if (Number.isNaN(price)) { problems.push(`Row ${i + 1}: "${r[t]}" under ${t} is not a price.`); continue; }
      entries.push({ tier: String(t).trim(), code, name, price });
    }
  });
  return { entries, problems, tierNames: tierKeys.map((t) => String(t).trim()) };
}

// Put prices onto their tiers. Entries whose product cannot be found yet are
// returned as `waiting` rather than dropped.
export async function applyTierEntries(entries, { PriceTier, Product, scope }) {
  const products = await Product.find({}, { _id: 1, name: 1, productCode: 1 }).lean();
  const byCode = new Map(products.filter((p) => p.productCode).map((p) => [norm(p.productCode), p]));
  const byName = new Map(products.map((p) => [norm(p.name), p]));
  const find = (e) => (e.code && byCode.get(norm(e.code))) || (e.name && byName.get(norm(e.name))) || null;

  const byTier = new Map();
  const waiting = [];
  for (const e of entries) {
    const product = find(e);
    if (!product) { waiting.push(e); continue; }
    if (!byTier.has(e.tier)) byTier.set(e.tier, new Map());
    byTier.get(e.tier).set(String(product._id), e.price);
  }

  const results = [];
  for (const [tierName, prices] of byTier) {
    let tier = await PriceTier.findOne({ ...scope, name: { $regex: `^${escapeRe(tierName)}$`, $options: 'i' } });
    let created = false;
    if (!tier) {
      tier = await PriceTier.create({ ...scope, name: tierName.slice(0, 60), pricingMode: 'per_product', percent: 0 });
      created = true;
    }
    // Explicit prices only mean something in per-product mode; a percent
    // tier would ignore them silently.
    const merged = new Map(tier.pricingMode === 'per_product'
      ? (tier.productPrices || []).map((p) => [String(p.productId), p.price])
      : []);
    for (const [pid, price] of prices) merged.set(pid, price);
    tier.pricingMode = 'per_product';
    tier.productPrices = [...merged].map(([productId, price]) => ({ productId, price }));
    await tier.save();
    results.push({ tier: tier.name, prices: prices.size, created });
  }
  return { results, waiting };
}

// Remember prices whose products do not exist yet. A later sheet for the same
// tier and product replaces the earlier one.
export async function holdTierEntries(waiting, { Settings }) {
  if (!waiting.length) return 0;
  const row = await Settings.findOne({ key: PENDING_KEY }).lean();
  const keyOf = (e) => `${norm(e.tier)}|${norm(e.code) || norm(e.name)}`;
  const all = new Map((row?.value || []).map((e) => [keyOf(e), e]));
  for (const e of waiting) all.set(keyOf(e), e);
  await Settings.findOneAndUpdate({ key: PENDING_KEY }, { key: PENDING_KEY, value: [...all.values()] }, { upsert: true });
  return all.size;
}

// Apply whatever is waiting now that products may exist. Safe to call often:
// with nothing waiting it is one read.
export async function applyPendingTierPrices({ PriceTier, Product, Settings, scope }) {
  const row = await Settings.findOne({ key: PENDING_KEY }).lean();
  const pending = row?.value || [];
  if (!pending.length) return { applied: 0, stillWaiting: 0 };
  const { results, waiting } = await applyTierEntries(pending, { PriceTier, Product, scope });
  await Settings.findOneAndUpdate({ key: PENDING_KEY }, { key: PENDING_KEY, value: waiting }, { upsert: true });
  return { applied: results.reduce((s, r) => s + r.prices, 0), stillWaiting: waiting.length, results };
}
