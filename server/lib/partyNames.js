// One-time: names of parties saved before they were kept in capitals.
//
// Client and supplier names are now stored in ALL CAPS (normalize.partyName).
// Records saved before that still read "Kasa Lokal". Some of these are matched
// as text, not by id - A/R ageing keys an order by its client's name, falling
// back to the typed customer name, and collection reminders store that same
// key - so every copy of the name is converted together, or one client would
// show up twice ("Kasa Lokal" and "KASA LOKAL").
//
// Journal entries are left as written: they are the books' history, and A/P
// balances are grouped by supplier id, not by the name printed on them.

const upperField = (field) => ({ [field]: { $toUpper: { $trim: { input: `$${field}` } } } });

// { model name: [fields] } - every field is a plain string on the document.
export const PARTY_NAME_FIELDS = {
  ClientAccount: ['name'],
  Supplier: ['name', 'contactPerson'],
  Order: ['customerName'],
  CollectionReminder: ['clientKey'],
  Quotation: ['clientName'],
  Reservation: ['clientName'],
  PurchaseOrder: ['supplier'],
  Bill: ['supplierName'],
};

export async function uppercasePartyNames(mongoose) {
  const changed = {};
  for (const [modelName, fields] of Object.entries(PARTY_NAME_FIELDS)) {
    let Model;
    try { Model = mongoose.model(modelName); } catch { continue; }   // not in this build
    for (const field of fields) {
      // Only strings that are not already all caps.
      const filter = {
        [field]: { $type: 'string', $ne: '' },
        $expr: { $ne: [`$${field}`, { $toUpper: { $trim: { input: `$${field}` } } }] },
      };
      // The raw collection: no hooks, and nothing here is a ledger document.
      const r = await Model.collection.updateMany(filter, [{ $set: upperField(field) }]);
      if (r.modifiedCount) changed[`${modelName}.${field}`] = r.modifiedCount;
    }
  }
  return changed;
}
