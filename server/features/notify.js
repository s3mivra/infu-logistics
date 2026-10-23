// What the app sends by email, once a mail account is set up (lib/mailer.js):
//
//   a statement of account    to one client, when someone presses Send
//   the day's summary         to the owner, each evening
//   low stock                 to the owner, when something has run low
//   payment reminders         to clients, before and after an invoice is due
//   the week in review        to the owner, Monday evening, for last Mon-Sun
//   the month in review       to the owner, on the 1st, for last month
//
// The three that send on their own are OFF until switched on in Settings, and
// none of them can run without a mail account. A client is only ever written
// to at the email address on their own record - this is not a way to send
// anything to an address someone types in.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { businessDateStr } from '../lib/businessTime.js';
import { businessClock } from '../lib/salePricing.js';
import { RECEIVABLE_STATUSES, arBalance } from '../lib/credit.js';
import { AR_PAYMENT_METHOD_FILTER } from '../lib/ledger.js';
import { mailConfigured, sendMail, isEmail, mailFrom } from '../lib/mailer.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const peso = (n) => `PHP ${r2(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SETTINGS_KEY = 'mailSettings';
const DEFAULTS = { ownerEmail: '', dailySummary: false, lowStock: false, reminders: false, weeklyReport: false, monthlyReport: false, reminderDaysBefore: 3, sendHour: 20 };
// Calendar arithmetic on YYYY-MM-DD business dates (noon UTC dodges DST edges).
const addDays = (str, n) => new Date(Date.parse(`${str}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const pct = (now, before) => (before > 0 ? `${now >= before ? '+' : ''}${(((now - before) / before) * 100).toFixed(1)}%` : 'n/a');
// Last Monday-to-Sunday, and last calendar month, as of `today` (weekday 0=Sun).
// Each returns [from, to, previousFrom, previousTo].
export const lastWeek = (today, weekday) => { const end = addDays(today, -((weekday + 6) % 7) - 1); return [addDays(end, -6), end, addDays(end, -13), addDays(end, -7)]; };
export const lastMonth = (today) => {
  const end = addDays(`${today.slice(0, 8)}01`, -1); const from = `${end.slice(0, 8)}01`;
  const prevEnd = addDays(from, -1); return [from, end, `${prevEnd.slice(0, 8)}01`, prevEnd];
};
// The same client is not reminded again within this many days.
const REMINDER_GAP_DAYS = 7;

export default function registerNotify(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, Order, Inventory, ClientAccount, Settings, logAudit, log,
    verifyToken, requireStaff, requirePermission,
  } = ctx;
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const businessName = () => process.env.BUSINESS_NAME || process.env.VITE_BUSINESS_NAME || 'Your business';

  const readSettings = async () => {
    const v = (await Settings.findOne({ key: SETTINGS_KEY }).lean())?.value || {};
    const days = Math.round(Number(v.reminderDaysBefore));
    const hour = Math.round(Number(v.sendHour));
    return {
      ownerEmail: isEmail(v.ownerEmail) ? String(v.ownerEmail).trim() : '',
      dailySummary: v.dailySummary === true, lowStock: v.lowStock === true, reminders: v.reminders === true,
      weeklyReport: v.weeklyReport === true, monthlyReport: v.monthlyReport === true,
      reminderDaysBefore: days >= 0 && days <= 30 ? days : DEFAULTS.reminderDaysBefore,
      sendHour: hour >= 0 && hour <= 23 ? hour : DEFAULTS.sendHour,
    };
  };
  const canSet = [verifyToken, requireStaff, requirePermission('settings.manage')];

  app.get('/api/mail/status', ...canSet, async (req, res) => {
    try { res.json({ success: true, configured: mailConfigured(), from: mailConfigured() ? mailFrom() : '', settings: await readSettings() }); }
    catch (err) { fail(req, res, err); }
  });

  app.put('/api/mail/settings', ...canSet, async (req, res) => {
    try {
      const b = req.body || {};
      const current = await readSettings();
      const next = { ...current };
      if (b.ownerEmail !== undefined) {
        const e = String(b.ownerEmail || '').trim();
        if (e && !isEmail(e)) return res.status(400).json({ success: false, error: 'The owner email is not an email address.' });
        next.ownerEmail = e;
      }
      for (const k of ['dailySummary', 'lowStock', 'reminders', 'weeklyReport', 'monthlyReport']) if (typeof b[k] === 'boolean') next[k] = b[k];
      if (b.reminderDaysBefore !== undefined) {
        const d = Math.round(Number(b.reminderDaysBefore));
        if (!(d >= 0 && d <= 30)) return res.status(400).json({ success: false, error: 'Remind between 0 and 30 days before the due date.' });
        next.reminderDaysBefore = d;
      }
      if (b.sendHour !== undefined) {
        const h = Math.round(Number(b.sendHour));
        if (!(h >= 0 && h <= 23)) return res.status(400).json({ success: false, error: 'The hour must be between 0 and 23.' });
        next.sendHour = h;
      }
      if ((next.dailySummary || next.lowStock || next.weeklyReport || next.monthlyReport) && !next.ownerEmail) return res.status(400).json({ success: false, error: 'Give the owner email first - that is where the summary and the low-stock list go.' });
      await Settings.findOneAndUpdate({ key: SETTINGS_KEY }, { key: SETTINGS_KEY, value: next }, { upsert: true });
      try { await logAudit?.(req, { action: 'update', entity: 'MailSettings', entityId: 'mail', before: current, after: next }); } catch { /* non-fatal */ }
      res.json({ success: true, settings: next });
    } catch (err) { fail(req, res, err); }
  });

  // Proves the mail account works, to the owner's own address.
  app.post('/api/mail/test', ...canSet, async (req, res) => {
    try {
      const s = await readSettings();
      if (!s.ownerEmail) return res.status(400).json({ success: false, error: 'Save the owner email first.' });
      const sent = await sendMail({ to: s.ownerEmail, subject: `${businessName()}: email is working`, text: `This is a test from ${businessName()}.\n\nIf you are reading it, the app can send email.` });
      if (!sent.ok) return res.status(502).json({ success: false, error: sent.error });
      res.json({ success: true, to: s.ownerEmail });
    } catch (err) { fail(req, res, err); }
  });

  // ── A STATEMENT, TO THE CLIENT ─────────────────────────────────────────────
  // The statement is written on the Clients screen (the same one that prints);
  // this sends that text to the address on the client's record - never to one
  // given in the request.
  app.post('/api/clients/:id/statement/email', verifyToken, requireStaff, requirePermission('clients.edit'), async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, error: 'Client not found.' });
      const client = await ClientAccount.findOne({ _id: id, ...tenantScope(req) }, { name: 1, email: 1, clientCode: 1 }).lean();
      if (!client) return res.status(404).json({ success: false, error: 'Client not found.' });
      if (!isEmail(client.email)) return res.status(400).json({ success: false, error: `${client.name} has no email address on file. Add one under Edit details.` });
      const text = String(req.body?.text || '').trim();
      const subject = String(req.body?.subject || '').trim() || `Statement of account - ${client.name}`;
      if (text.length < 20) return res.status(400).json({ success: false, error: 'The statement is empty.' });
      const sent = await sendMail({ to: client.email, subject, text });
      if (!sent.ok) return res.status(mailConfigured() ? 502 : 409).json({ success: false, error: sent.error, notSetUp: !mailConfigured() });
      try { await logAudit?.(req, { action: 'email', entity: 'ClientAccount', entityId: client._id, after: { statement: true, to: client.email } }); } catch { /* non-fatal */ }
      res.json({ success: true, to: client.email });
    } catch (err) { fail(req, res, err); }
  });

  // ── THE THREE THAT SEND ON THEIR OWN ───────────────────────────────────────
  const scope = { businessType: BUSINESS_TYPE };
  const openReceivables = () => Order.find({ ...scope, status: { $in: RECEIVABLE_STATUSES }, paymentMethod: AR_PAYMENT_METHOD_FILTER, isComplimentary: { $ne: true }, arSettled: { $ne: true } },
    { orderNumber: 1, customerName: 1, total: 1, arPaidAmount: 1, refundedAmount: 1, arDueDate: 1, clientId: 1, clientAccountId: 1, createdAt: 1 }).limit(5000).lean();
  const lowStockItems = async () => (await Inventory.find({ ...scope, lowStockThreshold: { $gt: 0 } }, { itemName: 1, itemCode: 1, stockQty: 1, lowStockThreshold: 1, unit: 1 }).lean())
    .filter(i => (i.stockQty || 0) <= i.lowStockThreshold).sort((a, b) => (a.stockQty || 0) - (b.stockQty || 0));

  async function summaryText(now) {
    const today = businessDateStr(now);
    const [sales, month, owed, low] = await Promise.all([
      Order.aggregate([{ $match: { ...scope, status: 'Completed', isComplimentary: { $ne: true }, createdAt: { $gte: dayStart(today), $lte: dayEnd(today) } } }, { $group: { _id: null, total: { $sum: '$total' }, orders: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { ...scope, status: 'Completed', isComplimentary: { $ne: true }, createdAt: { $gte: dayStart(`${today.slice(0, 8)}01`), $lte: dayEnd(today) } } }, { $group: { _id: null, total: { $sum: '$total' }, orders: { $sum: 1 } } }]),
      openReceivables(), lowStockItems(),
    ]);
    const owedTotal = owed.reduce((t, o) => t + arBalance(o), 0);
    const overdue = owed.filter(o => o.arDueDate && new Date(o.arDueDate) < now);
    return [
      `${businessName()} - ${today}`, '',
      `Sales today: ${peso(sales[0]?.total)} from ${sales[0]?.orders || 0} order(s)`,
      `This month so far: ${peso(month[0]?.total)} from ${month[0]?.orders || 0} order(s)`, '',
      `Customers owe: ${peso(owedTotal)} on ${owed.length} invoice(s)`,
      `Of that, overdue: ${peso(overdue.reduce((t, o) => t + arBalance(o), 0))} on ${overdue.length} invoice(s)`, '',
      low.length ? `Running low: ${low.length} item(s) - ${low.slice(0, 8).map(i => i.itemName).join(', ')}${low.length > 8 ? ', ...' : ''}` : 'Stock: nothing is below its alert level.',
      '', 'Open Owner Overview in the app for the rest.',
    ].join('\n');
  }

  // ── THE WEEK / MONTH IN REVIEW ─────────────────────────────────────────────
  // A closed period beside the one before it: what came in, what went out as
  // discounts and refunds, the best sellers, and what customers still owe.
  async function periodStats(from, to) {
    const match = { ...scope, status: 'Completed', isComplimentary: { $ne: true }, createdAt: { $gte: dayStart(from), $lte: dayEnd(to) } };
    const [tot, top] = await Promise.all([
      Order.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$total' }, gross: { $sum: '$subtotal' }, discount: { $sum: '$discount' }, refunded: { $sum: { $ifNull: ['$refundedAmount', 0] } }, orders: { $sum: 1 } } }]),
      Order.aggregate([{ $match: match }, { $unwind: '$items' },
        { $group: { _id: '$items.name', qty: { $sum: { $ifNull: ['$items.quantity', { $ifNull: ['$items.qty', 1] }] } }, sales: { $sum: { $multiply: [{ $ifNull: ['$items.price', 0] }, { $ifNull: ['$items.quantity', { $ifNull: ['$items.qty', 1] }] }] } } } },
        { $sort: { sales: -1 } }, { $limit: 5 }]),
    ]);
    const t = tot[0] || {};
    return { total: t.total || 0, gross: t.gross || 0, discount: t.discount || 0, refunded: t.refunded || 0, orders: t.orders || 0, top };
  }

  async function reviewText(label, from, to, prevFrom, prevTo, now) {
    const [cur, prev, owed] = await Promise.all([periodStats(from, to), periodStats(prevFrom, prevTo), openReceivables()]);
    const avg = (p) => (p.orders ? p.total / p.orders : 0);
    const overdue = owed.filter(o => o.arDueDate && new Date(o.arDueDate) < now);
    return [
      `${businessName()} - ${label}, ${from} to ${to}`, '',
      `Sales: ${peso(cur.total)} from ${cur.orders} order(s)  (${pct(cur.total, prev.total)} vs the period before)`,
      `Average order: ${peso(avg(cur))}  (was ${peso(avg(prev))})`,
      `Discounts given: ${peso(cur.discount)}   Refunds: ${peso(cur.refunded)}`, '',
      cur.top.length ? 'Best sellers:' : 'No sales in this period.',
      ...cur.top.map((p, i) => `  ${i + 1}. ${p._id || '(unnamed)'} - ${peso(p.sales)} (${r2(p.qty)} sold)`), '',
      `Customers owe: ${peso(owed.reduce((t, o) => t + arBalance(o), 0))} on ${owed.length} invoice(s), ${overdue.length} overdue`, '',
      'Open Owner Overview in the app for the full books.',
    ].join('\n');
  }

  // One send per period, even across restarts or two servers (same trick as the daily claim).
  const claim = (key, period) => Settings.updateOne({ key, value: { $ne: period } }, { $set: { key, value: period } }, { upsert: true })
    .then(r => (r.modifiedCount || r.upsertedCount) > 0, () => false);

  async function lowStockText() {
    const low = await lowStockItems();
    if (!low.length) return null;
    // Who it was last bought from and at what cost, from the newest PO line for
    // the item - so the email is a ready shopping list, grouped by supplier.
    const shown = low.slice(0, 100);
    const lastBuy = new Map();
    try {
      const pos = await mongoose.model('PurchaseOrder').find({ ...scope, 'lines.invId': { $in: shown.map(i => i._id) } }, { supplier: 1, lines: 1, createdAt: 1 })
        .sort({ createdAt: -1 }).limit(500).lean();
      for (const po of pos) for (const l of po.lines || []) {
        const k = String(l.invId || '');
        if (k && !lastBuy.has(k)) lastBuy.set(k, { supplier: po.supplier || '', unitCost: Number(l.unitCost) || 0, qty: Number(l.orderedQty) || 0 });
      }
    } catch { /* the list still goes out without supplier hints */ }
    const groups = new Map();
    for (const i of shown) {
      const lb = lastBuy.get(String(i._id));
      // Back up to twice the alert level, or the last order size if that is bigger.
      const suggest = Math.max(0, Math.ceil(Math.max(i.lowStockThreshold * 2 - (i.stockQty || 0), lb?.qty || 0)));
      const key = lb?.supplier || 'No previous supplier';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(`  - ${i.itemName}${i.itemCode ? ` (${i.itemCode})` : ''}: ${i.stockQty || 0} ${i.unit || ''} left, alert at ${i.lowStockThreshold} -> order about ${suggest}${lb?.unitCost ? ` at ~${peso(lb.unitCost)}` : ''}`);
    }
    return [`${businessName()} - ${low.length} item(s) are at or below their alert level.`, 'Suggested order, by last supplier:', '',
      ...[...groups].flatMap(([sup, lines]) => [`${sup}:`, ...lines, '']),
      ...(low.length > 100 ? [`...and ${low.length - 100} more.`, ''] : []),
      'Procurement -> New PO to place it. Reports -> Reorder Forecast has quantities based on actual usage.'].join('\n');
  }

  // One email per client with something due soon or overdue, to the address on
  // their record, and not again within a week.
  async function sendReminders(now, settings) {
    const horizon = new Date(now.getTime() + settings.reminderDaysBefore * 86400000);
    const due = (await openReceivables()).filter(o => o.arDueDate && new Date(o.arDueDate) <= horizon && arBalance(o) > 0);
    const byClient = new Map();
    for (const o of due) {
      const id = String(o.clientAccountId || o.clientId || '');
      if (!mongoose.Types.ObjectId.isValid(id)) continue;                 // a walk-in name has no address to write to
      if (!byClient.has(id)) byClient.set(id, []);
      byClient.get(id).push(o);
    }
    if (!byClient.size) return { sent: 0, skipped: 0 };
    const clients = await ClientAccount.find({ _id: { $in: [...byClient.keys()] }, isActive: { $ne: false } }, { name: 1, email: 1 }).lean();
    const sentRow = (await Settings.findOne({ key: 'mailRemindersSent' }).lean())?.value || {};
    const today = businessDateStr(now);
    let sent = 0, skipped = 0;
    for (const c of clients) {
      const last = sentRow[String(c._id)];
      const tooSoon = last && (dayStart(today).getTime() - dayStart(last).getTime()) < REMINDER_GAP_DAYS * 86400000;
      if (!isEmail(c.email) || tooSoon) { skipped++; continue; }
      const list = byClient.get(String(c._id)).sort((a, b) => new Date(a.arDueDate) - new Date(b.arDueDate));
      const total = list.reduce((t, o) => t + arBalance(o), 0);
      const anyLate = list.some(o => new Date(o.arDueDate) < now);
      const text = [`Dear ${c.name},`, '',
        anyLate ? 'A friendly reminder that the following is now due:' : 'A friendly reminder of what falls due soon:', '',
        ...list.slice(0, 40).map(o => `- ${o.orderNumber}: ${peso(arBalance(o))}, due ${businessDateStr(new Date(o.arDueDate))}${new Date(o.arDueDate) < now ? ' (overdue)' : ''}`),
        '', `Total: ${peso(total)}`, '', 'If you have already paid, please disregard this and thank you. Tell us if anything here does not match your records.', '', businessName()].join('\n');
      const r = await sendMail({ to: c.email, subject: `${businessName()}: payment reminder - ${peso(total)}`, text });
      if (r.ok) { sent++; sentRow[String(c._id)] = today; } else skipped++;
    }
    if (sent) await Settings.findOneAndUpdate({ key: 'mailRemindersSent' }, { key: 'mailRemindersSent', value: sentRow }, { upsert: true });
    return { sent, skipped };
  }

  // Everything that is switched on, once for the business day. `force` is for
  // "Send now" and the tests; the timer goes through the once-a-day guard.
  async function runDailyMail(now = new Date(), { force = false } = {}) {
    const out = { ran: false, summary: null, lowStock: null, reminders: null, weekly: null, monthly: null };
    if (!mailConfigured()) return { ...out, reason: 'Email is not set up on this server.' };
    const s = await readSettings();
    const today = businessDateStr(now);
    if (!force) {
      if (businessClock(now).minutes < s.sendHour * 60) return { ...out, reason: 'Not time yet.' };
      // Claim the day before sending: two servers, or a restart mid-run, must not send twice.
      // The key is unique: when today is already written, the filter matches
      // nothing, the upsert tries to insert a second row and is refused.
      const claimed = await Settings.updateOne({ key: 'mailLastRun', value: { $ne: today } }, { $set: { key: 'mailLastRun', value: today } }, { upsert: true })
        .then(r => (r.modifiedCount || r.upsertedCount) > 0, () => false);
      if (!claimed) return { ...out, reason: 'Already sent today.' };
    }
    out.ran = true;
    if (s.dailySummary && s.ownerEmail) out.summary = await sendMail({ to: s.ownerEmail, subject: `${businessName()}: ${today} summary`, text: await summaryText(now) });
    if (s.lowStock && s.ownerEmail) {
      const text = await lowStockText();
      out.lowStock = text ? await sendMail({ to: s.ownerEmail, subject: `${businessName()}: stock running low`, text }) : { ok: true, nothing: true };
    }
    if (s.reminders) out.reminders = await sendReminders(now, s);
    const clock = businessClock(now);
    if (s.weeklyReport && s.ownerEmail && (force || clock.weekday === 1)) {
      const [from, to, pf, pt] = lastWeek(today, clock.weekday);
      if (force || await claim('mailLastWeekly', to)) out.weekly = await sendMail({ to: s.ownerEmail, subject: `${businessName()}: week of ${from}`, text: await reviewText('Week in review', from, to, pf, pt, now) });
    }
    if (s.monthlyReport && s.ownerEmail && (force || today.endsWith('-01'))) {
      const [from, to, pf, pt] = lastMonth(today);
      if (force || await claim('mailLastMonthly', to.slice(0, 7))) out.monthly = await sendMail({ to: s.ownerEmail, subject: `${businessName()}: ${to.slice(0, 7)} month in review`, text: await reviewText('Month in review', from, to, pf, pt, now) });
    }
    return out;
  }

  // "Send now": the owner checks what tonight's emails will look like.
  app.post('/api/mail/run-now', ...canSet, async (req, res) => {
    try {
      const out = await runDailyMail(new Date(), { force: true });
      if (!out.ran) return res.status(409).json({ success: false, error: out.reason });
      res.json({ success: true, ...out });
    } catch (err) { fail(req, res, err); }
  });

  // Looked at every half hour; sends once, after the hour set. Not in tests -
  // a timer must not outlive them.
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    const tick = () => { if (mongoose.connection.readyState === 1) runDailyMail().catch(err => log?.error?.({ err }, 'Daily email run failed')); };
    setInterval(tick, 30 * 60 * 1000).unref?.();
  }

  return { runDailyMail };
}
