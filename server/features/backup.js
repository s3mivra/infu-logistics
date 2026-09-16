// Full backup and restore.
//
// The dataset exports (lib/dataSets.js) are REPORTS: chosen columns, derived
// figures, formatted for a person or an accountant. They cannot rebuild the
// system, because the numbers in them are not the records - a client's row has
// no id, a sale's row has no journal reference, and nothing carries the
// settings, users or counters the app needs to behave the way it did.
//
// This is the other thing: every document of every collection, exactly as
// stored, so a purged or lost database can be put back as it was. It travels as
// one workbook - a sheet per collection, a row per document, with the document
// itself in a __doc column that restore reads - so the same file is both a
// readable archive and a restorable one.
//
// Deliberately excluded: login sessions and QR ordering sessions. Both are
// short-lived tokens; restoring them would hand back sessions that should have
// died with the old database.
import { captureError } from '../lib/errorLog.js';

const EXCLUDED = new Set(['RefreshSession', 'QRSession']);

export default function registerBackup(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    log,
    BUSINESS_TYPE,
    tenantScope,
    logAudit,
    emitToMgr,
    verifyToken,
    requireSuperAdmin,
  } = ctx;

  // Every model the app has registered, minus the transient ones. Derived at
  // call time rather than listed, so a collection added later is backed up
  // without anyone remembering to add it here - the failure mode of a
  // hand-maintained list is a backup that silently misses the newest data.
  const backupModels = () => Object.keys(mongoose.models)
    .filter(name => !EXCLUDED.has(name))
    .sort();

  // Business-type scoping, where the model has it. A backup taken on a cafe
  // must not carry a logistics deployment's rows out with it.
  const scopeFor = (Model, req) => {
    const paths = Model.schema.paths;
    const q = {};
    if (paths.businessType) q.businessType = BUSINESS_TYPE;
    if (paths.tenantId) Object.assign(q, tenantScope(req));
    return q;
  };

  // ── SNAPSHOT ────────────────────────────────────────────────────────────────
  // One collection at a time, in pages, so neither this process nor the browser
  // ever holds the whole database at once:
  //
  //   /api/backup/snapshot?collection=Order&skip=0&limit=1000
  //
  // Asking for everything in one response still works for a small system, and
  // is refused past FULL_MAX rather than quietly building a response big enough
  // to run the server out of memory - the caller pages instead.
  const FULL_MAX = 20000;
  const PAGE_MAX = 5000;

  app.get('/api/backup/snapshot', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      // A page of one collection.
      if (req.query.collection) {
        const name = String(req.query.collection);
        if (!backupModels().includes(name)) {
          return res.status(400).json({ success: false, error: `"${name}" is not part of a backup.` });
        }
        const Model = mongoose.model(name);
        const scope = scopeFor(Model, req);
        const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
        const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(req.query.limit, 10) || 1000));
        // Sorted by _id so paging is stable: an insert during a long backup
        // cannot shuffle a document from one page into another and lose it.
        const [docs, total] = await Promise.all([
          Model.find(scope).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
          Model.countDocuments(scope),
        ]);
        return res.json({
          success: true, businessType: BUSINESS_TYPE, format: 1,
          collection: name, skip, limit, total, docs,
          done: skip + docs.length >= total,
        });
      }

      const collections = [];
      let documents = 0;
      for (const name of backupModels()) {
        const Model = mongoose.model(name);
        const scope = scopeFor(Model, req);
        const count = await Model.countDocuments(scope);
        documents += count;
        if (documents > FULL_MAX) {
          return res.status(413).json({
            success: false, tooLarge: true, limit: FULL_MAX,
            error: `This database holds more than ${FULL_MAX.toLocaleString()} records - take the backup a collection at a time (?collection=&skip=&limit=).`,
          });
        }
        collections.push({ name, count, docs: await Model.find(scope).sort({ _id: 1 }).lean() });
      }
      await logAudit(req, { action: 'snapshot', entity: 'Backup', entityId: 'full', after: { collections: collections.length, documents } });
      res.json({
        success: true,
        takenAt: new Date(),
        businessType: BUSINESS_TYPE,
        // Stamped so a restore can refuse a backup from the other business type
        // before it writes a single document.
        format: 1,
        documents,
        collections,
      });
    } catch (err) {
      log.error?.({ err }, 'GET /api/backup/snapshot failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── RESTORE ─────────────────────────────────────────────────────────────────
  // One collection at a time, so a large backup goes back in pieces the browser
  // can actually send, and a failure names the collection it happened in.
  //
  // Body: { collection, docs, replace, businessType, confirm }
  // `replace` clears this deployment's existing rows in that collection first -
  // restoring on top of live data would otherwise duplicate everything.
  app.post('/api/backup/restore', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      const { collection, docs, replace = true, businessType, confirm } = req.body || {};
      if (confirm !== 'RESTORE') {
        return res.status(400).json({ success: false, error: 'Restoring overwrites what is here now. Send confirm: "RESTORE".' });
      }
      if (businessType && String(businessType).toLowerCase() !== BUSINESS_TYPE) {
        return res.status(400).json({ success: false, error: `That backup came from a ${businessType} deployment; this one is ${BUSINESS_TYPE}. Restore it onto the matching system.` });
      }
      if (!backupModels().includes(collection)) {
        return res.status(400).json({ success: false, error: `"${collection}" is not part of a backup.` });
      }
      if (!Array.isArray(docs)) return res.status(400).json({ success: false, error: 'Nothing to restore for that collection.' });

      const Model = mongoose.model(collection);
      const scope = scopeFor(Model, req);
      let cleared = 0;
      if (replace) {
        const del = await Model.deleteMany(scope);
        cleared = del.deletedCount || 0;
      }

      // Insert with the original _id so every reference between collections -
      // an order's client, a journal entry's supplier - still points at the
      // same document afterwards. ordered:false so one bad row does not stop
      // the rest, and the count says how many actually landed.
      let restored = 0;
      const failures = [];
      const BATCH = 500;
      for (let i = 0; i < docs.length; i += BATCH) {
        const slice = docs.slice(i, i + BATCH).map(d => ({ ...d, ...scope }));
        try {
          const done = await Model.insertMany(slice, { ordered: false });
          restored += done.length;
        } catch (err) {
          restored += err?.insertedDocs?.length || err?.result?.nInserted || 0;
          for (const e of (err?.writeErrors || []).slice(0, 5)) {
            failures.push(e?.err?.errmsg || e?.errmsg || String(e));
          }
          if (!err?.writeErrors?.length) failures.push(err?.message || String(err));
        }
      }

      await logAudit(req, {
        action: 'restore', entity: 'Backup', entityId: collection,
        after: { collection, cleared, restored, failed: docs.length - restored },
      });
      emitToMgr('erpUpdated');
      res.json({ success: true, collection, cleared, restored, failed: docs.length - restored, failures: failures.slice(0, 5) });
    } catch (err) {
      log.error?.({ err }, 'POST /api/backup/restore failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // What a backup would contain, without building one - so the screen can say
  // "12,480 documents across 34 collections" before anyone waits for a file.
  app.get('/api/backup/summary', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      const rows = [];
      for (const name of backupModels()) {
        const Model = mongoose.model(name);
        rows.push({ name, count: await Model.countDocuments(scopeFor(Model, req)) });
      }
      res.json({
        success: true, businessType: BUSINESS_TYPE,
        collections: rows.sort((a, b) => b.count - a.count),
        documents: rows.reduce((s, r) => s + r.count, 0),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
