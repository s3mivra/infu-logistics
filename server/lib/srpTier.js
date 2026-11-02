// An SRP tier: a price tier whose price for each product is that product's
// stock item's SRP (Inventory.srp, matched by item code), read at the time of
// sale - so it follows every SRP change with nothing to re-enter. It is turned
// into an ordinary per-product tier here, and everything downstream (checkout,
// the menu, the pricing table) treats it as one. A product with no SRP on its
// stock item has no rate in this tier and stays at list price.
import mongoose from 'mongoose';

export async function expandSrpTiers(tiers = []) {
  if (!tiers.some((t) => t?.pricingMode === 'srp')) return tiers;
  let byCode = [];
  try {
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');
    const items = await Inventory.find({ srp: { $gt: 0 }, itemCode: { $nin: [null, ''] } }, { itemCode: 1, srp: 1 }).lean();
    const srpByCode = new Map(items.map((i) => [String(i.itemCode), Number(i.srp)]));
    const prods = srpByCode.size
      ? await Product.find({ productCode: { $in: [...srpByCode.keys()] } }, { productCode: 1 }).lean()
      : [];
    byCode = prods.map((p) => ({ productId: p._id, price: srpByCode.get(String(p.productCode)) }));
  } catch { byCode = []; }
  return tiers.map((t) => (t?.pricingMode === 'srp'
    ? { ...t, pricingMode: 'per_product', srpMode: true, productPrices: byCode, productBulkBreaks: t.productBulkBreaks || [] }
    : t));
}
