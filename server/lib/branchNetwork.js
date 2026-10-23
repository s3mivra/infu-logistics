// The shared product catalog: one branch keeps a master list of SKUs, and each
// linked branch syncs it into its own products, keeping any price it has set
// for itself. Branches find each other through the hub's links (features/hub.js).
//
// Stock transfers and the consolidated books are NOT here - the hub already
// does both (/api/hub/transfers, /api/hub/network-financials), and a second
// copy would only give two answers to the same question.
//
// Everything takes its models and connection as arguments, so the same code
// runs against this branch's database in the app and against a second
// database in the tests.
import { withOptionalTransaction } from './txn.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const httpError = (status, message) => Object.assign(new Error(message), { httpStatus: status });
const txn = (env, work) => withOptionalTransaction(env.conn, work);

// ── Models ───────────────────────────────────────────────────────────────────
// Defined per connection (the app's, or a test's second branch database).
export function defineBranchModels(conn) {
  const { Schema } = conn.base;
  if (conn.models.CatalogItem) return { CatalogItem: conn.models.CatalogItem, CatalogLink: conn.models.CatalogLink };

  // The master catalog, kept on whichever branch acts as head office.
  const CatalogItemSchema = new Schema({
    businessType: { type: String, required: true, index: true },
    sku:       { type: String, required: true },
    name:      { type: String, required: true },
    category:  { type: String, default: '' },
    unit:      { type: String, default: '' },
    basePrice: { type: Number, required: true, min: 0 },
    active:    { type: Boolean, default: true },
    version:   { type: Number, default: 1 },
  }, { timestamps: true });
  CatalogItemSchema.index({ businessType: 1, sku: 1 }, { unique: true });

  // A branch's tie between a master SKU and its own Product, plus its own price.
  const CatalogLinkSchema = new Schema({
    businessType:  { type: String, required: true, index: true },
    sku:           { type: String, required: true },
    sourceSlug:    { type: String, default: '' },
    productId:     { type: Schema.Types.ObjectId, default: null },
    masterName:    { type: String, default: '' },
    masterPrice:   { type: Number, default: 0 },
    masterVersion: { type: Number, default: 0 },
    // null = follow the master price.
    overridePrice: { type: Number, default: null },
    active:        { type: Boolean, default: true },
    lastSyncedAt:  Date,
  }, { timestamps: true });
  CatalogLinkSchema.index({ businessType: 1, sku: 1 }, { unique: true });

  return {
    CatalogItem:    conn.model('CatalogItem', CatalogItemSchema),
    CatalogLink:    conn.model('CatalogLink', CatalogLinkSchema),
  };
}

// ── Catalog ──────────────────────────────────────────────────────────────────
// env.models: { CatalogLink, Product }

// Bring this branch's products in line with the master catalog. Prices follow
// the master unless the branch has set its own, which a sync never touches.
export async function applyCatalog(env, sourceSlug, items) {
  const { CatalogLink, Product } = env.models;
  const out = { created: 0, updated: 0, deactivated: 0, unchanged: 0 };
  await txn(env, async (session) => {
    Object.assign(out, { created: 0, updated: 0, deactivated: 0, unchanged: 0 });
    for (const it of (Array.isArray(items) ? items : []).slice(0, 5000)) {
      const sku = str(it?.sku, 60);
      const price = Number(it?.basePrice);
      if (!sku || !str(it?.name) || !Number.isFinite(price) || price < 0) continue;
      const q = { businessType: env.businessType };
      let link = await CatalogLink.findOne({ ...q, sku }).session(session || null);
      if (!link) [link] = await CatalogLink.create([{ ...q, sku, sourceSlug }], { session });

      if (it.active === false) {
        if (link.active) { link.active = false; out.deactivated++; }
        else out.unchanged++;
        link.masterVersion = Number(it.version) || 0;
        link.lastSyncedAt = new Date();
        await link.save({ session });
        continue;
      }

      const effective = link.overridePrice ?? price;
      let product = link.productId ? await Product.findOne({ ...q, _id: link.productId }).session(session || null) : null;
      if (!product) product = await Product.findOne({ ...q, productCode: sku }).session(session || null);
      if (!product) {
        [product] = await Product.create([{ ...q, productCode: sku, name: str(it.name), category: str(it.category, 80), basePrice: effective }], { session });
        out.created++;
      } else if (product.name !== str(it.name) || (product.category || '') !== str(it.category, 80) || product.basePrice !== effective) {
        product.name = str(it.name);
        product.category = str(it.category, 80);
        product.basePrice = effective;
        await product.save({ session });
        out.updated++;
      } else out.unchanged++;

      Object.assign(link, {
        productId: product._id, sourceSlug, masterName: str(it.name), masterPrice: price,
        masterVersion: Number(it.version) || 0, active: true, lastSyncedAt: new Date(),
      });
      await link.save({ session });
    }
  });
  return out;
}

// Set (or clear, with null) this branch's own price for a catalog SKU.
export async function setPriceOverride(env, sku, price) {
  const { CatalogLink, Product } = env.models;
  const clear = price === null || price === '' || price === undefined;
  const n = Number(price);
  if (!clear && (!Number.isFinite(n) || n < 0)) throw httpError(400, 'Price must be zero or more.');
  return txn(env, async (session) => {
    const link = await CatalogLink.findOne({ businessType: env.businessType, sku: str(sku, 60) }).session(session || null);
    if (!link) throw httpError(404, 'That SKU has not been synced to this branch.');
    link.overridePrice = clear ? null : r2(n);
    await link.save({ session });
    if (link.productId) {
      await Product.updateOne({ _id: link.productId }, { $set: { basePrice: link.overridePrice ?? link.masterPrice } }, { session });
    }
    return link;
  });
}
