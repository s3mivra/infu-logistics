// collections routes - AR collection reminders (contact log + follow-up
// worklist over the existing aging data). See the CollectionReminderSchema
// comment in server.js: this logs manual contact, it never sends anything.
import { ageingByClient, resolveClientKey } from '../lib/credit.js';
import { captureError } from '../lib/errorLog.js';

export default function registerCollections(ctx) {
  const {
    app,
    IS_PROD,
    mongoose,
    BUSINESS_TYPE,
    tenantScope,
    Order,
    ClientAccount,
    CollectionReminder,
    verifyToken,
    requireStaff,
    requirePermission,
  } = ctx;

  // Reading aggregate AR exposure matches ar-ageing's own gate (finance.js).
  const canViewAcct = [requireStaff, requirePermission('accounting.view')];
  // Logging that a call/text/email went out is not a books-posting action -
  // any staff who can see a client's orders (orders.view, the same bar
  // clients.js uses) can log a follow-up. The amount snapshot is always
  // computed server-side, never trusted from the caller, so this doesn't leak
  // more financial detail than that.
  const canLogContact = [requireStaff, requirePermission('orders.view')];

  // Shared with finance.js's ar-ageing route (server/lib/credit.js) - the same
  // grouping key both A/R views must agree on, or they'd disagree about who
  // owes what.
  async function resolveClientKeys() {
    const clients = await ClientAccount.find({}, { name: 1, creditLimit: 1 }).lean();
    const { byName, keyOf } = resolveClientKey(clients);
    return { byName, keyOf };
  }

  async function overdueRows(req) {
    return Order.find({
      businessType: BUSINESS_TYPE, ...tenantScope(req),
      status: 'Completed', paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true }, arSettled: { $ne: true },
    }, { customerName: 1, total: 1, createdAt: 1, clientAccountId: 1, clientId: 1 }).lean();
  }

  // ── OVERDUE WORKLIST ─────────────────────────────────────────────────────────
  // Every client with a >30-day-aged balance, each annotated with their most
  // recent logged reminder (if any) - "who's overdue and have we already
  // reached out" in one call, same shape ar-ageing already returns plus the
  // reminder layer on top.
  app.get('/api/collections/overdue', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const rows = await overdueRows(req);
      const { byName, keyOf } = await resolveClientKeys();
      const perClient = ageingByClient(rows, keyOf)
        .filter(r => (r.d31_60 + r.d61_90 + r.d90_plus) > 0.01); // "collection-worthy" = something aged past current

      const lastReminders = await CollectionReminder.aggregate([
        { $match: { businessType: BUSINESS_TYPE, clientKey: { $in: perClient.map(r => r.client) } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$clientKey', doc: { $first: '$$ROOT' } } },
      ]);
      const lastByKey = new Map(lastReminders.map(r => [r._id, r.doc]));

      const out = perClient.map(row => {
        const last = lastByKey.get(row.client);
        return {
          ...row,
          clientAccountId: byName.get(row.client)?._id ? String(byName.get(row.client)._id) : null,
          lastReminder: last ? {
            method: last.method, note: last.note, loggedBy: last.loggedBy,
            createdAt: last.createdAt, nextFollowUpDate: last.nextFollowUpDate,
          } : null,
        };
      }).sort((a, b) => b.total - a.total);

      res.json({ success: true, clients: out });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── FOLLOW-UPS DUE ───────────────────────────────────────────────────────────
  // The actionable worklist: clients whose most recent reminder has a
  // nextFollowUpDate today or earlier (or who are overdue and have NEVER been
  // contacted at all).
  app.get('/api/collections/due', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const rows = await overdueRows(req);
      const { byName, keyOf } = await resolveClientKeys();
      const perClient = ageingByClient(rows, keyOf)
        .filter(r => (r.d31_60 + r.d61_90 + r.d90_plus) > 0.01);

      const lastReminders = await CollectionReminder.aggregate([
        { $match: { businessType: BUSINESS_TYPE, clientKey: { $in: perClient.map(r => r.client) } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$clientKey', doc: { $first: '$$ROOT' } } },
      ]);
      const lastByKey = new Map(lastReminders.map(r => [r._id, r.doc]));

      const today = new Date(); today.setHours(23, 59, 59, 999);
      const due = perClient
        .map(row => ({ row, last: lastByKey.get(row.client) }))
        .filter(({ last }) => !last || (last.nextFollowUpDate && new Date(last.nextFollowUpDate) <= today))
        .map(({ row, last }) => ({
          ...row,
          clientAccountId: byName.get(row.client)?._id ? String(byName.get(row.client)._id) : null,
          neverContacted: !last,
          lastReminder: last ? { method: last.method, createdAt: last.createdAt, nextFollowUpDate: last.nextFollowUpDate } : null,
        }))
        .sort((a, b) => b.total - a.total);

      res.json({ success: true, clients: due });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── HISTORY for one client ───────────────────────────────────────────────────
  app.get('/api/collections/reminders', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const clientKey = String(req.query.client || '').trim();
      if (!clientKey) return res.status(400).json({ success: false, error: 'client is required.' });
      const reminders = await CollectionReminder.find({ businessType: BUSINESS_TYPE, clientKey }).sort({ createdAt: -1 }).lean();
      res.json({ success: true, reminders });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── LOG A REMINDER ───────────────────────────────────────────────────────────
  // POST /api/collections/reminders { client, method, note, nextFollowUpDate }
  app.post('/api/collections/reminders', verifyToken, ...canLogContact, async (req, res) => {
    try {
      const { client, method, note, nextFollowUpDate } = req.body || {};
      const clientKey = String(client || '').trim();
      if (!clientKey) return res.status(400).json({ success: false, error: 'client is required.' });
      const METHODS = ['Call', 'SMS', 'Email', 'In-person', 'Letter', 'Other'];
      if (!METHODS.includes(method)) return res.status(400).json({ success: false, error: `method must be one of: ${METHODS.join(', ')}.` });

      // Snapshot what's actually owed right now - never trust a client-sent amount.
      const rows = await overdueRows(req);
      const { byName, keyOf } = await resolveClientKeys();
      const matchRow = ageingByClient(rows, keyOf).find(r => r.client === clientKey);
      const amountOwedAtTime = matchRow?.total || 0;

      const reminder = await CollectionReminder.create({
        businessType: BUSINESS_TYPE,
        ...tenantScope(req),
        clientKey,
        clientAccountId: byName.get(clientKey)?._id || null,
        method,
        note: String(note || '').trim().slice(0, 1000),
        amountOwedAtTime,
        loggedBy: req.user?.name || '',
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      });

      res.json({ success: true, reminder });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
