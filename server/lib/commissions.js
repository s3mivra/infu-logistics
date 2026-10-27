// Seller commissions, worked out one way for the Commissions report and for
// payroll. For each sale, the order's total (after discounts) is spread over
// its lines by what each line was rung up at, and each line earns:
//   1. the product's own rate, if one is set; else
//   2. its category's rate, if one is set; else
//   3. the seller's rate: their own % (Admin Panel), or - when that is blank
//      or 0 - the tiers, if any are set.
// Tiers are marginal, like tax brackets, over the seller's sales in the range
// that fall to step 3: e.g. 2% on the first 50,000 and 4% on the rest.
// Complimentary orders earn nothing - no revenue came in.

export const COMMISSION_RULES_KEY = 'commissionRules';
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rateOk = (r) => Number.isFinite(Number(r)) && Number(r) >= 0 && Number(r) <= 100;

/** Cleans what a person sent; returns { rules } or { error }. */
export function readCommissionRules(body) {
  const productRates = [], categoryRates = [], tiers = [];
  for (const p of Array.isArray(body?.productRates) ? body.productRates : []) {
    const name = String(p?.name || '').trim(), productId = String(p?.productId || '').trim();
    if (!name && !productId) continue;
    if (!rateOk(p.rate)) return { error: `${name || productId}: a rate is a percent from 0 to 100.` };
    productRates.push({ productId, name, rate: Number(p.rate) });
  }
  for (const c of Array.isArray(body?.categoryRates) ? body.categoryRates : []) {
    const category = String(c?.category || '').trim();
    if (!category) continue;
    if (!rateOk(c.rate)) return { error: `${category}: a rate is a percent from 0 to 100.` };
    categoryRates.push({ category, rate: Number(c.rate) });
  }
  for (const t of Array.isArray(body?.tiers) ? body.tiers : []) {
    if (t?.from === '' || t?.from == null) continue;
    const from = Number(t.from);
    if (!Number.isFinite(from) || from < 0) return { error: 'A tier starts at an amount of 0 or more.' };
    if (!rateOk(t.rate)) return { error: `Tier from ${from}: a rate is a percent from 0 to 100.` };
    tiers.push({ from: money(from), rate: Number(t.rate) });
  }
  tiers.sort((a, b) => a.from - b.from);
  if (tiers.length && tiers[0].from !== 0) tiers.unshift({ from: 0, rate: 0 });
  if (new Set(tiers.map((t) => t.from)).size !== tiers.length) return { error: 'Two tiers start at the same amount.' };
  return { rules: { productRates, categoryRates, tiers } };
}

/** Commission on `amount` under marginal tiers. */
export function tieredCommission(amount, tiers) {
  let earned = 0;
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].from, hi = i + 1 < tiers.length ? tiers[i + 1].from : Infinity;
    if (amount <= lo) break;
    earned += (Math.min(amount, hi) - lo) * tiers[i].rate / 100;
  }
  return money(earned);
}

/**
 * Per seller: sales, orders, commission. `orders` are Completed,
 * non-complimentary orders; `users` carry name/userCode/commissionRate;
 * `categoryOf(productId)` gives a product's category.
 */
export function computeCommissions({ orders, users, rules, categoryOf }) {
  const r = rules || { productRates: [], categoryRates: [], tiers: [] };
  const byProductId = new Map(r.productRates.filter((p) => p.productId).map((p) => [p.productId, p.rate]));
  const byProductName = new Map(r.productRates.filter((p) => p.name).map((p) => [p.name.toLowerCase(), p.rate]));
  const byCategory = new Map(r.categoryRates.map((c) => [c.category.toLowerCase(), c.rate]));
  const userByName = new Map(users.map((u) => [u.name, u]));
  const acc = new Map();

  for (const o of orders) {
    const seller = String(o.salesperson || '').trim() || o.cashier;
    if (!seller || seller === 'System') continue;
    const a = acc.get(seller) || { salesTotal: 0, orderCount: 0, ruled: 0, base: 0 };
    a.salesTotal += Number(o.total) || 0; a.orderCount += 1;
    const lines = (o.items || []).map((it) => {
      const qty = Math.max(0, (Number(it.quantity) || 0) - (Number(it.refundedQty) || 0));
      return { it, gross: Math.max(0, (Number(it.price) || 0) * qty) };
    });
    const grossSum = lines.reduce((s, l) => s + l.gross, 0);
    if (!(grossSum > 0)) { a.base += Number(o.total) || 0; acc.set(seller, a); continue; }
    for (const { it, gross } of lines) {
      const share = (Number(o.total) || 0) * gross / grossSum;
      const cat = String(categoryOf?.(it.productId) || '').toLowerCase();
      const rate = byProductId.get(String(it.productId || ''))
        ?? byProductName.get(String(it.name || '').toLowerCase())
        ?? (cat ? byCategory.get(cat) : undefined);
      if (rate === undefined) a.base += share;
      else a.ruled += share * rate / 100;
    }
    acc.set(seller, a);
  }

  const sellers = [...acc.entries()].map(([name, a]) => {
    const u = userByName.get(name);
    const own = Number(u?.commissionRate) || 0;
    const baseEarned = own > 0 ? a.base * own / 100 : tieredCommission(a.base, r.tiers);
    const salesTotal = money(a.salesTotal);
    const commissionEarned = money(a.ruled + baseEarned);
    return {
      name, userCode: u?.userCode || null, salesTotal, orderCount: a.orderCount,
      // The person's own rate, as before; the effective rate shows what the
      // product, category and tier rules came to overall.
      commissionRate: own,
      rateSource: own > 0 ? 'own' : (r.tiers.length ? 'tiers' : 'none'),
      effectiveRate: salesTotal > 0 ? Math.round(commissionEarned / salesTotal * 10000) / 100 : 0,
      commissionEarned,
    };
  }).sort((x, y) => y.commissionEarned - x.commissionEarned);
  return { sellers, totalCommission: money(sellers.reduce((s, x) => s + x.commissionEarned, 0)) };
}

export const loadCommissionRulesFrom = async (Settings) =>
  readCommissionRules((await Settings.findOne({ key: COMMISSION_RULES_KEY }).lean())?.value || {}).rules;

/** The figures for the orders matching `match` - the report and payroll both use this. */
export async function commissionsFromDb(mongoose, match) {
  const { Order, User, Product, Settings } = mongoose.models;
  const [orders, users, rules] = await Promise.all([
    Order.find(match, { cashier: 1, salesperson: 1, total: 1, 'items.productId': 1, 'items.name': 1, 'items.price': 1, 'items.quantity': 1, 'items.refundedQty': 1 }).limit(200000).lean(),
    User.find({}, { name: 1, userCode: 1, commissionRate: 1 }).lean(),
    loadCommissionRulesFrom(Settings),
  ]);
  const ids = [...new Set(orders.flatMap((o) => (o.items || []).map((i) => i.productId)).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id))))];
  const cats = new Map((await Product.find({ _id: { $in: ids } }, { category: 1 }).lean()).map((p) => [String(p._id), p.category]));
  return computeCommissions({ orders, users, rules, categoryOf: (id) => cats.get(String(id)) });
}
