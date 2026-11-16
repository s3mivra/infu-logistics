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
//   - existing journal entries (the books' history); new ones are in capitals.

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
  JournalEntry: { fields: ['description', 'supplierName', 'changeReason'] },
  ManualJournal: { fields: ['description', 'rejectionReason'] },
  RequisitionSlip: { fields: ['description', 'payee', 'supplier', 'notes', 'rejectionReason'], arrays: { lines: ['itemName'] } },
  Quotation: { fields: ['clientName', 'clientNotes', 'quoteNotes', 'declineReason'], arrays: { lines: ['name', 'note'] } },
  Reservation: { fields: ['clientName', 'note', 'closeReason'], arrays: { items: ['itemName'] } },
  StockCard: { fields: ['itemName', 'remarks'] },
  Advance: { fields: ['payeeName', 'purpose', 'cancelReason'], arrays: { liquidations: ['note'] } },
};

// Existing records the one-time migration leaves alone (see above).
export const CAPS_MIGRATION_SKIP = new Set(['JournalEntry']);

export const toCaps = (v) => (typeof v === 'string' ? v.toUpperCase() : v);

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
    const r = await model.collection.updateMany({}, capsPipeline(spec));
    changed[modelName] = r.modifiedCount || 0;
  }
  return changed;
}
