// Names and typed text are kept in CAPITALS, as the business writes them on
// paper (product, stock, supplier and client names; notes, descriptions,
// reasons and addresses on transactions). Client and supplier names already
// were (lib/partyNames.js); this extends it to everything typed.
//
// Applied as a Mongoose setter on each listed field, so every way a record is
// written - create, save, update, import - stores capitals without a route
// having to remember. A one-time migration converts what is already stored.
//
// Left exactly as typed, on purpose:
//   - codes, references, statuses, account codes, ids, keys, tokens, links,
//     images, e-mails, usernames and passwords;
//   - staff account names and the "who did it" fields that copy them
//     (cashier, createdBy, approvedBy...). Staff sign in by their name as
//     typed and it is copied as text across sales, shifts and payroll -
//     changing it needs every copy changed together, not a setter;
//   - stock location and stock category names (matched to their own lists);
//   - journal entries and stock-card remarks: the app writes that wording
//     itself and finds its own entries by it (a sale's entry, an expense, a
//     carried-in P&L), so it stays exactly as written.

// { model: { fields: [...], arrays: { arrayPath: [subfields] } } }
export const CAPS_FIELDS = {
  Product: { fields: ['name', 'description', 'category', 'baseSize'], arrays: { sizes: ['name'], addOns: ['name'], baseRecipe: ['name'] } },
  Category: { fields: ['name'] },
  Inventory: { fields: ['itemName'], arrays: { productionRecipe: ['itemName'] } },
  Supplier: { fields: ['name', 'contactPerson', 'address', 'notes', 'registeredName'], arrays: { catalog: ['itemName', 'notes'] } },
  ClientAccount: { fields: ['name', 'contactNotes', 'registeredName', 'registeredAddress'] },
  Combo: { fields: ['name', 'description'], arrays: { items: ['name'] } },
  Sale: { fields: ['name', 'description'] },
  FixedAsset: { fields: ['name', 'description', 'location', 'supplierName', 'disposalNote'] },
  RevolvingFund: { fields: ['name', 'description'] },
  Order: {
    fields: ['customerName', 'deliveryAddress', 'orderNotes', 'voidReason', 'complimentaryReasonNote', 'arSettledNote', 'scPwdName', 'employeeName'],
    arrays: { items: ['name', 'printName'], refundHistory: ['reason'], arPayments: ['note'] },
  },
  Bill: { fields: ['supplierName', 'description'] },
  PurchaseOrder: { fields: ['supplier', 'notes'], arrays: { lines: ['itemName'], returns: ['reason'] } },
  PurchaseRecord: { fields: ['supplier', 'notes'] },
  ManualJournal: { fields: ['description', 'rejectionReason'] },
  RequisitionSlip: { fields: ['description', 'payee', 'supplier', 'notes', 'rejectionReason'], arrays: { lines: ['itemName'] } },
  Quotation: { fields: ['clientName', 'clientNotes', 'quoteNotes', 'declineReason'], arrays: { lines: ['name', 'note'] } },
  Reservation: { fields: ['clientName', 'note', 'closeReason'], arrays: { items: ['itemName'] } },
  StockCard: { fields: ['itemName'] },
  Advance: { fields: ['payeeName', 'purpose', 'cancelReason'], arrays: { liquidations: ['note'] } },
  // The other side of a name match: an add-on or option is matched to the copy
  // a product carries by name, sales counts are kept by product name, and
  // movements, transfers and production carry the stock item's name.
  AddOn: { fields: ['name', 'category'], arrays: { recipe: ['name'] } },
  ModifierGroup: { fields: ['name'], arrays: { options: ['name'] } },
  ProductStats: { fields: ['productName'] },
  InventoryMovement: { fields: ['itemName'] },
  ProductionOrder: { fields: ['outputName'], arrays: { materials: ['itemName'] } },
  StockTransfer: { fields: ['itemName'] },
  CrossTransfer: { fields: ['itemName'] },
  TransferRequest: { arrays: { lines: ['itemName'], originalLines: ['itemName'] } },
  BackdateQueueItem: { fields: ['client'], arrays: { items: ['name'] } },
  RecurringBill: { fields: ['supplierName', 'description'] },
  CheckVoucher: { fields: ['payeeName'] },
  CostingSheet: { fields: ['name', 'notes'], arrays: { lines: ['name'] } },
  // Filed under the client's name, which the overdue list now shows in capitals.
  CollectionReminder: { fields: ['clientKey', 'note'] },
};

// Kept by name under a unique key: rows that differ only by case are merged
// (their counts added) rather than upper-cased into a clash.
export const CAPS_MERGE = {
  ProductStats: { key: ['businessType', 'productName', 'shard'], sum: ['cumulativeQty', 'cumulativeRevenue'], name: 'productName' },
};

// Existing records the one-time migration leaves alone (see above).
export const CAPS_MIGRATION_SKIP = new Set(['JournalEntry']);

export const toCaps = (v) => (typeof v === 'string' ? v.toUpperCase() : v);

// Two names are the same name whatever their case or outer spaces: one may be
// stored in capitals and the other come from a till, a sheet or an older
// record. Use it wherever a stored name is compared with another name.
// The key for a map of records by name, matching sameName.
export const nameKeyOf = (s) => String(s ?? '').trim().toUpperCase();

export const sameName = (a, b) => {
  if (a == null || b == null) return false;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
};

// Adds the setter to every listed field of every model already compiled.
// Returns how many fields it reached (missing ones are skipped quietly: a
// field only some business types have, or a model not loaded).
export function applyCaps(mongoose) {
  let reached = 0;
  for (const [modelName, spec] of Object.entries(CAPS_FIELDS)) {
    let model;
    try { model = mongoose.model(modelName); } catch { continue; }
    for (const f of spec.fields || []) {
      const p = model.schema.path(f);
      if (p && p.instance === 'String') { p.set(toCaps); reached++; }
    }
    for (const [arr, subs] of Object.entries(spec.arrays || {})) {
      const sub = model.schema.path(arr)?.schema;
      if (!sub) continue;
      for (const f of subs) {
        const p = sub.path(f);
        if (p && p.instance === 'String') { p.set(toCaps); reached++; }
      }
    }
  }
  return reached;
}

// One update pipeline per model that upper-cases what is stored, in place.
// Only strings are touched; a missing field stays missing.
const upperIfString = (expr) => ({ $cond: [{ $eq: [{ $type: expr }, 'string'] }, { $toUpper: expr }, expr] });
export function capsPipeline({ fields = [], arrays = {} }) {
  const set = {};
  for (const f of fields) set[f] = upperIfString(`$${f}`);
  for (const [arr, subs] of Object.entries(arrays)) {
    set[arr] = {
      $cond: [{ $isArray: `$${arr}` }, {
        $map: {
          input: `$${arr}`, as: 'x',
          in: {
            $cond: [{ $eq: [{ $type: '$$x' }, 'object'] }, {
              $mergeObjects: ['$$x', Object.fromEntries(subs.map((s) => [s, {
                $cond: [{ $eq: [{ $type: `$$x.${s}` }, 'string'] }, { $toUpper: `$$x.${s}` }, `$$x.${s}`],
              }]))],
            }, '$$x'],
          },
        },
      }, `$${arr}`],
    };
  }
  return [{ $set: set }];
}

export async function capsExisting(mongoose) {
  const changed = {};
  for (const [modelName, spec] of Object.entries(CAPS_FIELDS)) {
    if (CAPS_MIGRATION_SKIP.has(modelName)) continue;
    let model;
    try { model = mongoose.model(modelName); } catch { continue; }
    if (CAPS_MERGE[modelName]) { changed[modelName] = await mergeByCapsName(model.collection, CAPS_MERGE[modelName]); continue; }
    const r = await model.collection.updateMany({}, capsPipeline(spec));
    changed[modelName] = r.modifiedCount || 0;
  }
  return changed;
}

// Rows whose name differs only by case become one row under the capitals,
// with their counts added. A row already alone keeps its _id and is renamed.
async function mergeByCapsName(col, { key, sum, name }) {
  let touched = 0;
  const groups = await col.aggregate([
    { $match: { [name]: { $type: 'string' } } },
    { $group: {
      _id: Object.fromEntries(key.map((k) => [k, k === name ? { $toUpper: `$${k}` } : `$${k}`])),
      ids: { $push: '$_id' }, names: { $push: `$${name}` },
      ...Object.fromEntries(sum.map((s) => [s, { $sum: `$${s}` }])),
    } },
  ]).toArray();
  for (const g of groups) {
    const upper = g._id[name];
    if (g.ids.length === 1 && g.names[0] === upper) continue;
    const [keep, ...drop] = g.ids;
    if (drop.length) await col.deleteMany({ _id: { $in: drop } });
    await col.updateOne({ _id: keep }, { $set: { [name]: upper, ...Object.fromEntries(sum.map((s) => [s, g[s]])) } });
    touched += g.ids.length;
  }
  return touched;
}
