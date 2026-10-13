// Three everyday things for whoever runs the place:
//
//   Store checklist      the steps to open and to close, ticked off each day,
//                        with who ticked what
//   Supplier statement   our own account with one supplier - each bill, each
//                        payment, the balance after it - to set beside the
//                        statement they send and find what differs
//   Client record        everything held about one client in one file, for
//                        when they ask for it
//
// None of them posts to the ledger or moves stock.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr } from '../lib/businessTime.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const KINDS = ['opening', 'closing'];
const DEFAULT_LISTS = {
  opening: ['Count the opening cash', 'Check the fridge and chiller temperatures', 'Check stock that expires today', 'Turn on and test the printer and the till', 'Clean and set up the front'],
  closing: ['Count the cash and close the shift', 'Record spoilage and waste', 'Put away and cover the stock', 'Clean the equipment and the floor', 'Lock up, lights and appliances off'],
};

export default function registerOpsExtras(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, Settings, Bill, Supplier, ClientAccount, Order, Advance, logAudit,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  // ── STORE CHECKLIST ────────────────────────────────────────────────────────
  // One list for opening and one for closing, the same every day until someone
  // changes it. Each day keeps its own ticks. Changing the list does not
  // rewrite the days already done - a tick remembers the words it was for.
  const checklistSchema = new mongoose.Schema({
    businessType: { type: String, index: true },
    date: { type: String, required: true },          // YYYY-MM-DD, the business's day
    kind: { type: String, enum: KINDS, required: true },
    ticks: [{ item: String, by: String, at: { type: Date, default: Date.now } }],
  }, { timestamps: true });
  // One record per day per list - declared before the model is made, or the
  // index is never built and two first ticks at once would make two records.
  checklistSchema.index({ businessType: 1, date: 1, kind: 1 }, { unique: true });
  const ChecklistDay = model('ChecklistDay', checklistSchema);
  const listsKey = 'storeChecklists';
  const readLists = async () => {
    const v = (await Settings.findOne({ key: listsKey }).lean())?.value;
    const clean = (list, fallback) => (Array.isArray(list) ? list.map(x => text(x, 120)).filter(Boolean).slice(0, 40) : fallback);
    return { opening: clean(v?.opening, DEFAULT_LISTS.opening), closing: clean(v?.closing, DEFAULT_LISTS.closing) };
  };
  const canSee = [verifyToken, requireStaff, requirePermission('shifts.view')];

  app.get('/api/store-checklist', ...canSee, async (req, res) => {
    try {
      const date = isDay(req.query.date) ? String(req.query.date) : businessDateStr(new Date());
      const [lists, days] = await Promise.all([readLists(), ChecklistDay.find({ businessType: BUSINESS_TYPE, date }).lean()]);
      const view = (kind) => {
        const ticks = days.find(d => d.kind === kind)?.ticks || [];
        const items = lists[kind].map(item => {
          const t = ticks.find(x => x.item === item);
          return { item, done: !!t, by: t?.by || '', at: t?.at || null };
        });
        return { items, done: items.filter(i => i.done).length, total: items.length };
      };
      res.json({ success: true, date, today: businessDateStr(new Date()), opening: view('opening'), closing: view('closing') });
    } catch (err) { fail(req, res, err); }
  });

  // Tick or untick one step. Only today's: a checklist filled in afterwards
  // says nothing about whether the step was done.
  app.post('/api/store-checklist/tick', ...canSee, async (req, res) => {
    try {
      const kind = String(req.body?.kind || '');
      const item = text(req.body?.item, 120);
      const done = req.body?.done !== false;
      if (!KINDS.includes(kind) || !item) return res.status(400).json({ success: false, error: 'Which step?' });
      const lists = await readLists();
      if (!lists[kind].includes(item)) return res.status(400).json({ success: false, error: 'That step is no longer on the list - refresh the page.' });
      const date = businessDateStr(new Date());
      const where = { businessType: BUSINESS_TYPE, date, kind };
      // Start the day's record if this is its first tick; two tills doing so at once must not make two.
      await ChecklistDay.updateOne(where, { $setOnInsert: { ...where, ticks: [] } }, { upsert: true }).catch((e) => { if (e?.code !== 11000) throw e; });
      await ChecklistDay.updateOne(where, { $pull: { ticks: { item } } });
      if (done) await ChecklistDay.updateOne(where, { $push: { ticks: { item, by: req.user?.name || '', at: new Date() } } });
      res.json({ success: true });
    } catch (err) { fail(req, res, err); }
  });

  app.put('/api/store-checklist/lists', verifyToken, requireStaff, requirePermission('settings.manage'), async (req, res) => {
    try {
      const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map(x => text(x, 120)).filter(Boolean))].slice(0, 40);
      const value = { opening: clean(req.body?.opening), closing: clean(req.body?.closing) };
      if (!value.opening.length && !value.closing.length) return res.status(400).json({ success: false, error: 'Give at least one step.' });
      await Settings.findOneAndUpdate({ key: listsKey }, { key: listsKey, value }, { upsert: true });
      try { await logAudit?.(req, { action: 'update', entity: 'StoreChecklist', entityId: 'lists', after: { opening: value.opening.length, closing: value.closing.length } }); } catch { /* non-fatal */ }
      res.json({ success: true, ...value });
    } catch (err) { fail(req, res, err); }
  });

  // ── SUPPLIER STATEMENT ─────────────────────────────────────────────────────
  // Our side of the account with one supplier over a period: what we owed at
  // the start, each bill and each payment in date order with the balance
  // after it, and what we owe at the end. Bills not yet approved, and rejected
  // ones, are not owed and are left out (and counted, so they are not a
  // mystery). `theirBalance` is what their statement says; the difference is
  // what to look for - usually a bill they sent that is not here, or a payment
  // they have not applied yet.
  app.get('/api/reports/supplier-statement', verifyToken, requireStaff, requirePermission('reports.view'), requirePermission('screen.reports.supplierstatement'), async (req, res) => {
    try {
      const id = String(req.query.supplierId || '');
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, error: 'Choose a supplier.' });
      const supplier = await Supplier.findOne({ _id: id, ...tenantScope(req) }, { name: 1, creditBalance: 1 }).lean();
      if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found.' });
      const today = businessDateStr(new Date());
      const startKey = isDay(req.query.start) ? String(req.query.start) : `${today.slice(0, 8)}01`;
      const endKey = isDay(req.query.end) ? String(req.query.end) : today;
      const from = dayStart(startKey), to = dayEnd(endKey);

      const all = await Bill.find({ businessType: BUSINESS_TYPE, ...tenantScope(req), supplierId: supplier._id },
        { billNumber: 1, supplierInvoiceNo: 1, description: 1, amount: 1, status: 1, createdAt: 1, dueDate: 1, payments: 1, poNumber: 1 }).limit(5000).lean();
      const owed = all.filter(b => ['Approved', 'Partially Paid', 'Paid'].includes(b.status));
      const events = [];
      for (const b of owed) {
        events.push({ at: new Date(b.createdAt), kind: 'bill', reference: b.supplierInvoiceNo || b.billNumber, ours: b.billNumber, description: b.description || '', charge: r2(b.amount), payment: 0, due: b.dueDate || null });
        for (const p of b.payments || []) {
          events.push({ at: new Date(p.at), kind: 'payment', reference: p.referenceNumber || p.checkVoucherRef || '', ours: b.billNumber, description: `Payment for ${b.supplierInvoiceNo || b.billNumber}`, charge: 0, payment: r2(p.amount) });
        }
      }
      events.sort((x, y) => x.at - y.at || (x.kind === 'bill' ? -1 : 1));
      const opening = r2(events.filter(e => e.at < from).reduce((t, e) => t + e.charge - e.payment, 0));
      let balance = opening;
      const rows = events.filter(e => e.at >= from && e.at <= to).map((e) => { balance = r2(balance + e.charge - e.payment); return { ...e, balance }; });
      const closing = balance;
      const their = req.query.theirBalance === undefined || req.query.theirBalance === '' ? null : r2(req.query.theirBalance);
      res.json({
        success: true, supplier: { _id: String(supplier._id), name: supplier.name, creditBalance: r2(supplier.creditBalance) },
        start: startKey, end: endKey, openingBalance: opening, rows, closingBalance: closing,
        totals: { charges: r2(rows.reduce((t, e) => t + e.charge, 0)), payments: r2(rows.reduce((t, e) => t + e.payment, 0)) },
        notCounted: { pending: all.filter(b => b.status === 'Pending').length, pendingAmount: r2(all.filter(b => b.status === 'Pending').reduce((t, b) => t + b.amount, 0)), rejected: all.filter(b => b.status === 'Rejected').length },
        theirBalance: their, difference: their === null ? null : r2(their - closing),
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── ONE CLIENT'S RECORD ────────────────────────────────────────────────────
  // Everything held about one client, for when they ask what is kept about
  // them: their details, their orders, their deposits. Never their password
  // or any sign-in token. Taking it is written to the audit trail.
  app.get('/api/client-accounts/:id/record', verifyToken, requireStaff, requirePermission('clients.edit'), async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, error: 'Client account not found.' });
      const c = await ClientAccount.findOne({ _id: id, ...tenantScope(req) }, { password: 0, onboardingToken: 0, onboardingTokenExpiresAt: 0 }).lean();
      if (!c) return res.status(404).json({ success: false, error: 'Client account not found.' });
      const [orders, deposits] = await Promise.all([
        Order.find({ businessType: BUSINESS_TYPE, $or: [{ clientId: id }, { clientAccountId: id }] },
          { orderNumber: 1, createdAt: 1, status: 1, table: 1, paymentMethod: 1, subtotal: 1, discount: 1, total: 1, arPaidAmount: 1, refundedAmount: 1, deliveryAddress: 1, orderNotes: 1, items: 1 })
          .sort({ createdAt: -1 }).limit(5000).lean(),
        Advance ? Advance.find({ businessType: BUSINESS_TYPE, clientId: id }, { advanceNumber: 1, date: 1, amount: 1, liquidatedAmount: 1, purpose: 1, status: 1 }).sort({ date: -1 }).limit(1000).lean() : [],
      ]);
      try { await logAudit?.(req, { action: 'export', entity: 'ClientAccount', entityId: c._id, after: { clientCode: c.clientCode, orders: orders.length } }); } catch { /* non-fatal */ }
      res.json({
        success: true, takenAt: new Date(),
        client: {
          clientCode: c.clientCode, name: c.name, username: String(c.username || '').startsWith('_') ? '' : c.username, phone: c.phone || '', email: c.email || '',
          registeredName: c.registeredName || '', tin: c.tin || '', registeredAddress: c.registeredAddress || '', contactNotes: c.contactNotes || '',
          paymentMethod: c.paymentMethod, creditLimit: c.creditLimit ?? null, creditTermsDays: c.creditTermsDays ?? null, creditBalance: r2(c.creditBalance),
          priceTier: (c.segments || []).join(', '), isActive: c.isActive !== false, isAffiliate: c.isAffiliate === true, createdAt: c.createdAt,
        },
        orders: orders.map(o => ({
          orderNumber: o.orderNumber, date: o.createdAt, status: o.status, type: o.table, paymentMethod: o.paymentMethod,
          subtotal: r2(o.subtotal), discount: r2(o.discount), total: r2(o.total), paid: r2(o.arPaidAmount), refunded: r2(o.refundedAmount),
          deliveryAddress: o.deliveryAddress || '', note: o.orderNotes || '', items: (o.items || []).map(i => `${i.quantity} x ${i.name}`).join('; '),
        })),
        deposits: deposits.map(d => ({ number: d.advanceNumber, date: d.date, amount: r2(d.amount), used: r2(d.liquidatedAmount), purpose: d.purpose || '', status: d.status })),
      });
    } catch (err) { fail(req, res, err); }
  });
}
