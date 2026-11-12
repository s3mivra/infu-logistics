// Field-level encryption for sensitive personal information (2026-11 audit,
// M73): government ID numbers, SC/PWD card numbers and two-step secrets were
// stored as plain strings, readable by anyone who reached the database or a
// backup of it.
//
// A Mongoose plugin, so no route has to remember to call anything:
//   - every write path encrypts: a setter on each field (document assignment,
//     create, insertMany, and update queries - Mongoose runs setters on query
//     casting), and a value that is already sealed is left as it is;
//   - every read path decrypts: post hooks on find/findOne/findOneAnd* open the
//     sealed values in the results, lean or hydrated, so routes keep reading
//     plain text exactly as before.
//
// Not covered: aggregation pipelines (none read these fields today) and
// direct driver access. Data written before this existed is plain text; it is
// read as is (open() returns null for a non-sealed value, and the plain value
// is kept) and sealed the next time it is saved, or by the startup migration.
//
// The key: FIELD_ENCRYPTION_KEY when set - so rotating the JWT secret does
// not make these unreadable - else derived from JWT_SECRET, as secretBox does.
import { seal, open } from './secretBox.js';

const keyMaterial = () => process.env.FIELD_ENCRYPTION_KEY || undefined;
const isSealed = (v) => typeof v === 'string' && v.startsWith('v1.');

export const encryptValue = (v) => {
  if (v === null || v === undefined || v === '') return v;
  if (isSealed(v)) return v;
  return seal(String(v), keyMaterial());
};
export const decryptValue = (v) => {
  if (!isSealed(v)) return v;
  const plain = open(v, keyMaterial());
  return plain === null ? '' : plain;
};

const READ_HOOKS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete'];

// A hydrated document: write the plain value into the raw store without
// marking it modified, so a later save() re-seals it only if the route
// actually changes it. A lean object is just assigned.
const openField = (holder, key) => {
  if (!holder || !isSealed(holder[key])) return;
  const plain = decryptValue(holder[key]);
  if (holder.$__ && holder._doc) holder._doc[key] = plain;
  else holder[key] = plain;
};

// `arrays` seals fields inside an array of subdocuments, e.g. the government
// numbers copied into every payroll run line ({ lines: ['tin', ...] }). Those
// snapshots are kept for years as payroll records, so they are sealed like the
// staff profile they were copied from (2026-11 audit, M73/M76).
export function fieldCryptPlugin(schema, { fields = [], arrays = {} } = {}) {
  for (const f of fields) {
    if (!schema.path(f)) continue;
    schema.path(f).set(encryptValue);
  }
  for (const [arr, subFields] of Object.entries(arrays)) {
    const sub = schema.path(arr)?.schema;
    if (!sub) continue;
    for (const f of subFields) if (sub.path(f)) sub.path(f).set(encryptValue);
  }
  const openDoc = (d) => {
    if (!d || typeof d !== 'object') return;
    for (const f of fields) {
      const parts = f.split('.');
      let holder = d;
      for (let i = 0; i < parts.length - 1 && holder; i++) holder = holder[parts[i]];
      openField(holder, parts[parts.length - 1]);
    }
    for (const [arr, subFields] of Object.entries(arrays)) {
      const items = d[arr];
      if (!Array.isArray(items)) continue;
      for (const item of items) for (const f of subFields) openField(item, f);
    }
  };
  for (const hook of READ_HOOKS) {
    schema.post(hook, function (res) {
      if (Array.isArray(res)) res.forEach(openDoc);
      else openDoc(res);
    });
  }
  // After a save, the document in hand holds what the setter sealed; open it
  // again so the route that saved it can keep using plain values.
  schema.post('save', function (doc) { openDoc(doc); });
}
