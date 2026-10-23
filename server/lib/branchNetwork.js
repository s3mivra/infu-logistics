// Multi-branch core: stock transfers between linked branches, the shared
// product catalog, and the per-branch report a consolidated view merges.
//
// Each branch is its own deployment with its own database, so nothing here
// can be one transaction across two branches. What it guarantees instead:
//
//   * every step that moves stock or money is ONE transaction on the branch
//     taking it - stock, stock cards, the journal entry and the status flip
//     commit together or not at all;
//   * every step is idempotent - shipping or receiving twice, or the partner's
//     state arriving twice, changes nothing the second time;
//   * both sides post the SAME amount through inter-branch clearing (160200):
//     the sender values the goods at ship time and that value travels with
//     the transfer, so the receiver's entry is its exact mirror and the group's
//     clearing balance returns to zero once the goods arrive.
//
// Everything takes its models and connection as arguments, so the same code
// runs against this branch's database in the app and against a second
// database in the tests that check both sides of a transfer.
import { withOptionalTransaction } from './txn.js';
import { buildPnl } from './consolidate.js';

export const CLEARING_CODE = '160200';
export const INVENTORY_CODE = '130000';
export const TRANSFER_STATUSES = ['Requested', 'Approved', 'Shipped', 'Received', 'Rejected', 'Cancelled'];
const RANK = { Requested: 0, Approved: 1, Shipped: 2, Received: 3 };
const TERMINAL = new Set(['Received', 'Rejected', 'Cancelled']);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const httpError = (status, message) => Object.assign(new Error(message), { httpStatus: status });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Models ───────────────────────────────────────────────────────────────────
// Defined per connection (the app's, or a test's second branch database).
export function defineBranchModels(conn) {
  const { Schema } = conn.base;
  if (conn.models.BranchTransfer) {
    return { BranchTransfer: conn.models.BranchTransfer, CatalogItem: conn.models.CatalogItem, CatalogLink: conn.models.CatalogLink };
  }

  const LineSchema = new Schema({
    // Local to whichever branch holds this copy: the sender's item it ships
    // from, or the receiver's item it lands in. Never sent across.
    itemId:   { type: Schema.Types.ObjectId, default: null },
    itemCode: { type: String, default: '' },
    itemName: { type: String, required: true },
    unit:     { type: String, default: '' },
    qty:      { type: Number, required: true },
    // Set by the sender when it ships; the receiver books at exactly this.
    unitCost: { type: Number, default: 0 },
    value:    { type: Number, default: 0 },
  }, { _id: false });

  const BranchTransferSchema = new Schema({
    businessType: { type: String, required: true, index: true },
    transferRef:  { type: String, required: true },
    fromSlug:     { type: String, required: true },
    toSlug:       { type: String, required: true },
    // This copy's side of it. Each branch keeps its own copy of the transfer.
    role:         { type: String, enum: ['sender', 'receiver'], required: true },
    partnerSlug:  { type: String, required: true },
    status:       { type: String, enum: TRANSFER_STATUSES, default: 'Requested' },
    lines:        [LineSchema],
    totalValue:   { type: Number, default: 0 },
    note:         { type: String, default: '' },
    requestedBy:  { type: String, default: '' },
    approvedBy:   { type: String, default: '' },
    shippedBy:    { type: String, default: '' },
    receivedBy:   { type: String, default: '' },
    shippedAt:    Date,
    receivedAt:   Date,
    reason:       { type: String, default: '' },
    history:      [{ action: String, by: String, slug: String, at: Date, _id: false }],
    // Our latest state has not reached the partner yet; retried by a sweep.
    partnerSync:  { type: Boolean, default: false },
  }, { timestamps: true });
  BranchTransferSchema.index({ businessType: 1, transferRef: 1 }, { unique: true });
  BranchTransferSchema.index({ businessType: 1, partnerSync: 1 });

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
    BranchTransfer: conn.model('BranchTransfer', BranchTransferSchema),
    CatalogItem:    conn.model('CatalogItem', CatalogItemSchema),
    CatalogLink:    conn.model('CatalogLink', CatalogLinkSchema),
  };
}

// ── Transfers ────────────────────────────────────────────────────────────────
// env = { conn, businessType, self, models: { BranchTransfer, Inventory, StockCard, JournalEntry } }

const txn = (env, work) => withOptionalTransaction(env.conn, work);
const hist = (action, by, slug) => ({ action, by: by || '', slug, at: new Date() });

export const genTransferRef = () => `BT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// What the partner sees of our copy. Item ids are ours alone, so they stay here.
export function syncPayload(doc) {
  return {
    transferRef: doc.transferRef, fromSlug: doc.fromSlug, toSlug: doc.toSlug,
    status: doc.status, note: doc.note, reason: doc.reason,
    totalValue: doc.totalValue,
    lines: doc.lines.map(l => ({ itemCode: l.itemCode, itemName: l.itemName, unit: l.unit, qty: l.qty, unitCost: l.unitCost, value: l.value })),
    requestedBy: doc.requestedBy, approvedBy: doc.approvedBy, shippedBy: doc.shippedBy, receivedBy: doc.receivedBy,
    shippedAt: doc.shippedAt, receivedAt: doc.receivedAt,
    history: (doc.history || []).slice(-50),
  };
}

// File a transfer. Either branch can: the receiver asking for stock, or the
// sender offering it. Nothing moves until the sender approves and ships.
export async function createTransfer(env, { partnerSlug, direction, items, note, by }) {
  const { BranchTransfer, Inventory } = env.models;
  if (!['send', 'receive'].includes(direction)) throw httpError(400, "direction must be 'send' or 'receive'.");
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'items[] is required.');
  const role = direction === 'send' ? 'sender' : 'receiver';

  const lines = [];
  for (const raw of items.slice(0, 200)) {
    const qty = Number(raw?.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw httpError(400, 'Every line needs a quantity above zero.');
    let item = null;
    if (raw.itemId) {
      item = await Inventory.findOne({ _id: raw.itemId, businessType: env.businessType }).lean();
      if (!item) throw httpError(404, 'Item not found.');
    }
    if (role === 'sender' && !item) throw httpError(400, 'Pick the item to send from your own stock.');
    const itemName = str(item?.itemName || raw.itemName);
    if (!itemName) throw httpError(400, 'Every line needs an item.');
    lines.push({
      itemId: item?._id || null,
      itemCode: str(item?.itemCode || raw.itemCode, 60),
      itemName, unit: str(item?.unit || raw.unit, 40), qty,
    });
  }

  return BranchTransfer.create({
    businessType: env.businessType, transferRef: genTransferRef(),
    fromSlug: role === 'sender' ? env.self : partnerSlug,
    toSlug: role === 'sender' ? partnerSlug : env.self,
    role, partnerSlug, status: 'Requested', lines,
    note: str(note, 500), requestedBy: by || '',
    history: [hist('requested', by, env.self)], partnerSync: true,
  });
}

const loadOwn = async (env, ref, session) => {
  const doc = await env.models.BranchTransfer.findOne({ businessType: env.businessType, transferRef: ref }).session(session || null);
  if (!doc) throw httpError(404, 'Transfer not found.');
  return doc;
};

// The sender agrees. Lines are tied to its own items here (a request from the
// receiver names them by code or name only) and stock is checked - though
// only shipping takes it, so a slip can be approved ahead of the goods.
export async function approveTransfer(env, ref, { by } = {}) {
  const { Inventory } = env.models;
  return txn(env, async (session) => {
    const doc = await loadOwn(env, ref, session);
    if (doc.role !== 'sender') throw httpError(403, 'Only the branch sending the stock can approve it.');
    if (doc.status === 'Approved') return doc;
    if (doc.status !== 'Requested') throw httpError(409, `This transfer is ${doc.status}.`);
    for (const line of doc.lines) {
      if (line.itemId) continue;
      const q = { businessType: env.businessType };
      const item = (line.itemCode && await Inventory.findOne({ ...q, itemCode: { $regex: `^${escapeRe(line.itemCode)}$`, $options: 'i' } }).session(session || null).lean())
        || await Inventory.findOne({ ...q, itemName: { $regex: `^${escapeRe(line.itemName)}$`, $options: 'i' } }).session(session || null).lean();
      if (!item) throw httpError(409, `No item here matches "${line.itemName}". Add it to inventory first.`);
      line.itemId = item._id;
      if (!line.itemCode) line.itemCode = item.itemCode || '';
    }
    doc.status = 'Approved';
    doc.approvedBy = by || '';
    doc.history.push(hist('approved', by, env.self));
    doc.partnerSync = true;
    await doc.save({ session });
    return doc;
  });
}

// The goods leave. One transaction: every line's stock comes off (refusing to
// go below zero), a stock card per line, one journal entry for the whole
// shipment - DR inter-branch clearing / CR inventory - and the status. A line
// that cannot ship rolls ALL of it back.
export async function shipTransfer(env, ref, { by } = {}) {
  const { Inventory, StockCard, JournalEntry } = env.models;
  return txn(env, async (session) => {
    const doc = await loadOwn(env, ref, session);
    if (doc.role !== 'sender') throw httpError(403, 'Only the sending branch ships.');
    if (doc.status === 'Shipped' || doc.status === 'Received') return doc;   // already done
    if (doc.status !== 'Approved') throw httpError(409, `Approve this transfer before shipping (it is ${doc.status}).`);

    let total = 0;
    for (const line of doc.lines) {
      const item = await Inventory.findOneAndUpdate(
        { _id: line.itemId, businessType: env.businessType, stockQty: { $gte: line.qty } },
        { $inc: { stockQty: -line.qty } },
        { returnDocument: 'after', session },
      );
      if (!item) {
        const have = await Inventory.findById(line.itemId, { stockQty: 1, unit: 1 }).session(session || null).lean();
        throw httpError(409, `Not enough ${line.itemName} to ship: need ${line.qty}, have ${have ? have.stockQty : 0}. Nothing was shipped.`);
      }
      line.unitCost = Number(item.unitCost) || 0;
      line.value = r2(line.unitCost * line.qty);
      total += line.value;
      await StockCard.create([{
        inventoryId: String(item._id), itemName: item.itemName, type: 'Transfer Out',
        reference: doc.transferRef, qtyChange: -line.qty, balanceAfter: item.stockQty,
        unitCost: line.unitCost, remarks: `Branch transfer to ${doc.toSlug}`,
      }], { session });
    }
    doc.totalValue = r2(total);

    if (doc.totalValue > 0) {
      await JournalEntry.create([{
        date: new Date(), reference: `${doc.transferRef}-SHIP`,
        description: `Branch transfer ${doc.transferRef} shipped to ${doc.toSlug}`,
        lines: [
          { accountCode: CLEARING_CODE, accountName: 'Hub Transfer Clearing', debit: doc.totalValue, credit: 0 },
          { accountCode: INVENTORY_CODE, accountName: 'Inventory Asset', debit: 0, credit: doc.totalValue },
        ],
        totalDebit: doc.totalValue, totalCredit: doc.totalValue,
      }], { session });
    }

    doc.status = 'Shipped';
    doc.shippedBy = by || '';
    doc.shippedAt = new Date();
    doc.history.push(hist('shipped', by, env.self));
    doc.partnerSync = true;
    await doc.save({ session });
    return doc;
  });
}

// The goods arrive. One transaction, the mirror of shipping: stock up at the
// sender's cost (weighted into the item's average), a stock card per line, and
// DR inventory / CR clearing for exactly the value the sender released.
// `targets` optionally maps line index -> one of our item ids to receive into.
export async function receiveTransfer(env, ref, { by, targets = {} } = {}) {
  const { Inventory, StockCard, JournalEntry } = env.models;
  return txn(env, async (session) => {
    const doc = await loadOwn(env, ref, session);
    if (doc.role !== 'receiver') throw httpError(403, 'Only the receiving branch can receive.');
    if (doc.status === 'Received') return doc;
    if (doc.status !== 'Shipped') throw httpError(409, `This transfer has not shipped yet (it is ${doc.status}).`);

    const q = { businessType: env.businessType };
    for (const [i, line] of doc.lines.entries()) {
      const wanted = targets[i] || line.itemId;
      let item = wanted ? await Inventory.findOne({ ...q, _id: wanted }).session(session || null) : null;
      if (wanted && !item) throw httpError(404, `Receiving item for ${line.itemName} not found.`);
      if (!item && line.itemCode) item = await Inventory.findOne({ ...q, itemCode: { $regex: `^${escapeRe(line.itemCode)}$`, $options: 'i' } }).session(session || null);
      if (!item) item = await Inventory.findOne({ ...q, itemName: { $regex: `^${escapeRe(line.itemName)}$`, $options: 'i' } }).session(session || null);
      if (!item) {
        [item] = await Inventory.create([{
          businessType: env.businessType, itemName: line.itemName,
          ...(line.itemCode ? { itemCode: line.itemCode } : {}),
          unit: line.unit, stockQty: 0, unitCost: line.unitCost,
        }], { session });
      }
      const prior = (item.stockQty || 0) * (item.unitCost || 0);
      item.stockQty = +((item.stockQty || 0) + line.qty).toFixed(6);
      if (item.stockQty > 0 && line.unitCost > 0) item.unitCost = (prior + line.value) / item.stockQty;
      await item.save({ session });
      line.itemId = item._id;
      await StockCard.create([{
        inventoryId: String(item._id), itemName: item.itemName, type: 'Transfer In',
        reference: doc.transferRef, qtyChange: line.qty, balanceAfter: item.stockQty,
        unitCost: line.unitCost, remarks: `Branch transfer from ${doc.fromSlug}`,
      }], { session });
    }

    if (doc.totalValue > 0) {
      await JournalEntry.create([{
        date: new Date(), reference: `${doc.transferRef}-RECV`,
        description: `Branch transfer ${doc.transferRef} received from ${doc.fromSlug}`,
        lines: [
          { accountCode: INVENTORY_CODE, accountName: 'Inventory Asset', debit: doc.totalValue, credit: 0 },
          { accountCode: CLEARING_CODE, accountName: 'Hub Transfer Clearing', debit: 0, credit: doc.totalValue },
        ],
        totalDebit: doc.totalValue, totalCredit: doc.totalValue,
      }], { session });
    }

    doc.status = 'Received';
    doc.receivedBy = by || '';
    doc.receivedAt = new Date();
    doc.history.push(hist('received', by, env.self));
    doc.partnerSync = true;
    await doc.save({ session });
    return doc;
  });
}

// Turn a transfer down (sender) or withdraw it (either side), only before it
// ships - once goods are on the road they are received, not cancelled.
export async function closeTransfer(env, ref, { action, by, reason }) {
  return txn(env, async (session) => {
    const doc = await loadOwn(env, ref, session);
    const status = action === 'reject' ? 'Rejected' : 'Cancelled';
    if (doc.status === status) return doc;
    if (!['Requested', 'Approved'].includes(doc.status)) throw httpError(409, `This transfer is ${doc.status} and can no longer be ${status.toLowerCase()}.`);
    if (status === 'Rejected' && doc.role !== 'sender') throw httpError(403, 'Only the branch asked to send can reject. Cancel it instead.');
    doc.status = status;
    doc.reason = str(reason, 500);
    doc.history.push(hist(action === 'reject' ? 'rejected' : 'cancelled', by, env.self));
    doc.partnerSync = true;
    await doc.save({ session });
    return doc;
  });
}

// The partner's copy changed; bring ours level. Only forward moves, and only
// the ones that side may make: the sender approves, ships or rejects, the
// receiver receives, either cancels before shipping. The same state arriving
// again is a no-op, so a retried delivery is always safe.
export async function applyPartnerState(env, partnerSlug, p) {
  const { BranchTransfer } = env.models;
  const ref = str(p?.transferRef, 80);
  if (!ref || !TRANSFER_STATUSES.includes(p?.status)) throw httpError(400, 'Invalid transfer payload.');
  if (p.fromSlug !== partnerSlug && p.toSlug !== partnerSlug) throw httpError(403, 'Not a party to this transfer.');
  if (![p.fromSlug, p.toSlug].includes(env.self)) throw httpError(400, 'This transfer is not for this branch.');
  const partnerRole = p.fromSlug === partnerSlug ? 'sender' : 'receiver';

  return txn(env, async (session) => {
    let doc = await BranchTransfer.findOne({ businessType: env.businessType, transferRef: ref }).session(session || null);
    if (!doc) {
      if (TERMINAL.has(p.status) && p.status !== 'Received') return { ok: true, ignored: 'closed before we heard of it' };
      [doc] = await BranchTransfer.create([{
        businessType: env.businessType, transferRef: ref, fromSlug: p.fromSlug, toSlug: p.toSlug,
        role: partnerRole === 'sender' ? 'receiver' : 'sender', partnerSlug, status: 'Requested',
        lines: (Array.isArray(p.lines) ? p.lines.slice(0, 200) : [])
          .filter(l => str(l?.itemName) && Number(l?.qty) > 0)
          .map(l => ({ itemCode: str(l.itemCode, 60), itemName: str(l.itemName), unit: str(l.unit, 40), qty: Number(l.qty) })),
        note: str(p.note, 500), requestedBy: str(p.requestedBy),
        history: Array.isArray(p.history) ? p.history.slice(-50) : [],
      }], { session });
      if (!doc.lines.length) throw httpError(400, 'A transfer needs at least one line.');
    }
    if (doc.partnerSlug !== partnerSlug) throw httpError(403, 'Not a party to this transfer.');
    if (doc.status === p.status) return { ok: true, doc };

    const allowed = partnerRole === 'sender' ? ['Approved', 'Shipped', 'Rejected', 'Cancelled'] : ['Received', 'Cancelled'];
    const forward = p.status in RANK ? RANK[p.status] > (RANK[doc.status] ?? 99) : !TERMINAL.has(doc.status) && (RANK[doc.status] ?? 99) < RANK.Shipped;
    if (!allowed.includes(p.status) || !forward) {
      throw httpError(409, `This transfer is ${doc.status} here - it cannot become ${p.status} from your side.`);
    }

    if (p.status === 'Shipped') {
      // The values the receiver books at. Lines line up by position: neither
      // side can change them after filing.
      const incoming = Array.isArray(p.lines) ? p.lines : [];
      if (incoming.length !== doc.lines.length) throw httpError(409, 'Shipped lines do not match the transfer.');
      doc.lines.forEach((l, i) => {
        l.qty = Number(incoming[i].qty) > 0 ? Number(incoming[i].qty) : l.qty;
        l.unitCost = Math.max(0, Number(incoming[i].unitCost) || 0);
        l.value = r2(l.unitCost * l.qty);
      });
      doc.totalValue = r2(doc.lines.reduce((t, l) => t + l.value, 0));
      if (Math.abs(doc.totalValue - r2(p.totalValue)) > 0.01) throw httpError(409, 'Shipped value does not add up.');
      doc.shippedAt = p.shippedAt ? new Date(p.shippedAt) : new Date();
      doc.shippedBy = str(p.shippedBy);
    }
    if (p.status === 'Approved') doc.approvedBy = str(p.approvedBy);
    if (p.status === 'Received') { doc.receivedAt = p.receivedAt ? new Date(p.receivedAt) : new Date(); doc.receivedBy = str(p.receivedBy); }
    if (p.status === 'Rejected' || p.status === 'Cancelled') doc.reason = str(p.reason, 500);
    doc.status = p.status;
    if (Array.isArray(p.history)) doc.history = p.history.slice(-50);
    await doc.save({ session });
    return { ok: true, doc };
  });
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

// ── Branch report ────────────────────────────────────────────────────────────
// What one branch contributes to the consolidated view: sales, P&L and the
// value of its stock. env.models: { Order, Inventory, JournalEntry }
export async function branchReport(env, { start, end }, acctMeta) {
  const { Order, Inventory, JournalEntry } = env.models;
  const bt = env.businessType;
  const [sales, stock, tb] = await Promise.all([
    Order.aggregate([
      { $match: { businessType: bt, status: 'Completed', createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]),
    Inventory.aggregate([
      { $match: { businessType: bt, stockQty: { $gt: 0 } } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$stockQty', { $ifNull: ['$unitCost', 0] }] } }, items: { $sum: 1 } } },
    ]),
    JournalEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.accountCode', name: { $first: '$lines.accountName' }, debit: { $sum: { $ifNull: ['$lines.debit', 0] } }, credit: { $sum: { $ifNull: ['$lines.credit', 0] } } } },
    ]),
  ]);
  const t = buildPnl(tb.map(r => ({ code: r._id, name: r.name, debit: r.debit, credit: r.credit })), acctMeta).totals;
  const orders = sales[0]?.orders || 0;
  const revenue = r2(sales[0]?.revenue);
  return {
    sales: { revenue, orders, avgTicket: orders ? r2(revenue / orders) : 0 },
    pnl: { netRevenue: t.netRevenue, cogs: t.cogs, grossProfit: t.grossProfit, opex: t.opex, netIncome: t.netIncome },
    stock: { value: r2(stock[0]?.value), items: stock[0]?.items || 0 },
  };
}

const REPORT_FIGURES = [['sales', 'revenue'], ['sales', 'orders'], ['pnl', 'netRevenue'], ['pnl', 'cogs'], ['pnl', 'grossProfit'], ['pnl', 'opex'], ['pnl', 'netIncome'], ['stock', 'value'], ['stock', 'items']];

// Add the reachable branches up. Each branch's share of the total is kept
// beside it, so a combined figure can always be traced to where it came from.
export function mergeBranchReports(branches) {
  const totals = { sales: {}, pnl: {}, stock: {} };
  for (const [g, k] of REPORT_FIGURES) totals[g][k] = r2(branches.reduce((s, b) => s + (Number(b[g]?.[k]) || 0), 0));
  totals.sales.avgTicket = totals.sales.orders ? r2(totals.sales.revenue / totals.sales.orders) : 0;
  const share = (part, whole) => (whole ? r2((part / whole) * 100) : 0);
  return {
    totals,
    branches: branches.map(b => ({
      ...b,
      share: {
        revenue: share(b.sales?.revenue || 0, totals.sales.revenue),
        netIncome: share(b.pnl?.netIncome || 0, totals.pnl.netIncome),
        stockValue: share(b.stock?.value || 0, totals.stock.value),
      },
    })),
  };
}
