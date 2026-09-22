// A Google Sheet linked to Inventory.
//
// Pulling it is always by hand and always goes through the ordinary import
// preview: an import is a stock COUNT, replacing quantities and booking the
// difference as a gain or loss, so applying a sheet on a timer would undo every
// sale made since the sheet was last edited. The timed part only LOOKS - once a
// day it checks whether the sheet changed since the last pull, and if so says
// so in the notifications bell. Nothing is applied without a person.
import { captureError } from '../lib/errorLog.js';
import { businessDateStr, businessTimeZone } from '../lib/businessTime.js';
import { parseSheetLink, exportUrl, fetchSheet, hashContent, SheetError, isCheckTime, isCheckDue } from '../lib/googleSheet.js';

const KEY = 'inventorySheet';

export default function registerInventorySheet(ctx) {
  const { app, IS_PROD, Settings, verifyToken, requireSuperAdmin, logAudit, emitToAll, log } = ctx;

  const load = async () => (await Settings.findOne({ key: KEY }).lean())?.value || {};
  const store = (value) => Settings.findOneAndUpdate({ key: KEY }, { value }, { upsert: true, returnDocument: 'after' });
  const fail = (req, res, err) => {
    if (err instanceof SheetError) return res.status(400).json({ success: false, error: err.message });
    captureError(req, err);
    return res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  };
  // What the screen shows - never the stored fingerprint.
  const view = (s) => ({
    url: s.url || '', checkTime: s.checkTime || '',
    lastPulledAt: s.lastPulledAt || null, lastCheckedAt: s.lastCheckedAt || null,
    changedAt: s.changedAt || null, lastCheckError: s.lastCheckError || '',
  });
  const fingerprint = async (url) => hashContent(await fetchSheet(exportUrl(parseSheetLink(url), 'csv')));

  // Compares the sheet with what was last pulled. Records the outcome and says
  // whether it changed; a failure is recorded too, so the bell can say why.
  async function runCheck({ scheduled = false } = {}) {
    const s = await load();
    if (!s.url) return { checked: false };
    const at = new Date().toISOString();
    // Only the timed run marks the day as done, so a "Check now" at 5 am does
    // not cancel the 6 am check.
    const day = scheduled ? { lastCheckDate: businessDateStr() } : {};
    try {
      const hash = await fingerprint(s.url);
      const changed = !!s.seenHash && hash !== s.seenHash;
      const next = { ...s, lastCheckedAt: at, ...day, lastCheckError: '',
        changedAt: changed ? (s.changedAt || at) : null };
      await store(next);
      if (changed && !s.changedAt) emitToAll('inventorySheetChanged', { changedAt: next.changedAt });
      return { checked: true, changed };
    } catch (err) {
      const message = err instanceof SheetError ? err.message : 'The check failed unexpectedly.';
      if (!(err instanceof SheetError)) log.error({ err }, 'Inventory sheet check failed');
      await store({ ...s, lastCheckedAt: at, ...day, lastCheckError: message });
      return { checked: true, error: message };
    }
  }

  app.get('/api/inventory-sheet', verifyToken, requireSuperAdmin, async (req, res) => {
    try { res.json({ success: true, sheet: view(await load()) }); } catch (err) { fail(req, res, err); }
  });

  // Save the link and check time. The link is read once on save, so a sheet
  // that is not shared is caught now rather than at 6 am tomorrow, and what it
  // holds today becomes the baseline the daily check compares with.
  app.put('/api/inventory-sheet', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      const checkTime = String(req.body?.checkTime || '').trim();
      if (checkTime && !isCheckTime(checkTime)) return res.status(400).json({ success: false, error: 'The check time must be a time of day, like 06:00.' });
      const s = await load();
      if (!url) {
        await store({});
        try { await logAudit(req, { action: 'update', entity: 'Settings', entityId: KEY, after: { url: '' } }); } catch { /* best-effort */ }
        return res.json({ success: true, sheet: view({}) });
      }
      if (!parseSheetLink(url)) return res.status(400).json({ success: false, error: 'Paste the link of a Google Sheet - it starts with https://docs.google.com/spreadsheets/.' });
      const sameLink = s.url === url;
      const next = sameLink
        ? { ...s, checkTime }
        : { url, checkTime, seenHash: await fingerprint(url), lastPulledAt: null, changedAt: null, lastCheckError: '', lastCheckedAt: new Date().toISOString() };
      await store(next);
      try { await logAudit(req, { action: 'update', entity: 'Settings', entityId: KEY, after: { url, checkTime } }); } catch { /* best-effort */ }
      res.json({ success: true, sheet: view(next) });
    } catch (err) { fail(req, res, err); }
  });

  // The workbook itself, for the browser to open in the import preview.
  // Pulling counts as reviewing it, so the "changed" flag clears.
  app.post('/api/inventory-sheet/pull', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      const s = await load();
      if (!s.url) return res.status(400).json({ success: false, error: 'No sheet is linked yet.' });
      const link = parseSheetLink(s.url);
      const [workbook, csv] = await Promise.all([fetchSheet(exportUrl(link, 'xlsx')), fetchSheet(exportUrl(link, 'csv'))]);
      await store({ ...s, seenHash: hashContent(csv), lastPulledAt: new Date().toISOString(), changedAt: null, lastCheckError: '' });
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Cache-Control', 'no-store');
      res.send(workbook);
    } catch (err) { fail(req, res, err); }
  });

  app.post('/api/inventory-sheet/check', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
      const result = await runCheck();
      res.json({ success: true, ...result, sheet: view(await load()) });
    } catch (err) { fail(req, res, err); }
  });

  // Once a minute, see whether the daily check is due (lib/googleSheet.js).
  if (process.env.NODE_ENV !== 'test') {
    const tick = async () => {
      try {
        if (!isCheckDue(await load(), new Date(), businessTimeZone(), businessDateStr())) return;
        await runCheck({ scheduled: true });
      } catch (err) { log.error({ err }, 'Inventory sheet scheduler failed'); }
    };
    setInterval(tick, 60 * 1000).unref();
  }
}
