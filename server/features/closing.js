// Month-end closing checklist.
//
// The steps a month goes through before it is closed, each checked against
// the records themselves where it can be:
//   cut-off      sales and purchases for the month are finished, not open
//   inventory    the month's stock counts were closed
//   AR / AP      every supplier bill has its invoice matched
//   bank         each bank account has a reconciliation at the month's end
//   accruals     percentage tax accrued (non-VAT); prepayments reviewed
//   depreciation every active asset was depreciated through the month
//   journals     no manual entry is still waiting for approval
//   trial balance debits equal credits through the month's end
//   review       finance has looked it over
// Steps the records cannot prove (prepayments, the finance review) are ticked
// by a person, and who ticked them is kept. Closing then locks the month
// (POST /api/periods/close); reopening needs an approver.
import { captureError } from '../lib/errorLog.js';
import { roundMoney, toCentavos } from '../lib/money.js';

const MANUAL = { prepayments: 'Accruals and prepayments reviewed', review: 'Finance review of the month' };
const ticksKey = (y, m) => `closeChecklist:${y}-${String(m).padStart(2, '0')}`;

export default function registerClosing(ctx) {
  const {
    app, IS_PROD, BUSINESS_TYPE, tenantScope, Order, PurchaseOrder, Bill, InventoryMovement, BankReconciliation,
    FixedAsset, ManualJournal, JournalEntry, Settings, ClosedPeriod, logAudit, verifyToken, requireStaff, requirePermission,
  } = ctx;
  const canView = [requireStaff, requirePermission('accounting.view')];
  const canPost = [requireStaff, requirePermission('accounting.manage')];
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const readMonth = (q) => {
    const year = Number(q.year), month = Number(q.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month, from: new Date(year, month - 1, 1, 0, 0, 0, 0), to: new Date(year, month, 0, 23, 59, 59, 999) };
  };

  const buildChecklist = async (req, { year, month, from, to }) => {
    const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
    const [openOrders, openPOs, unmatchedBills, countedDays, bankAccounts, recs, assets, waitingJournals, tb, vatRow, pctEntries, ticksRow, closed] = await Promise.all([
      Order.countDocuments({ ...scope, createdAt: { $gte: from, $lte: to }, status: { $in: ['Pending', 'Preparing', 'Ready', 'Reserved', 'Partially Fulfilled'] } }),
      PurchaseOrder.countDocuments({ createdAt: { $lte: to }, status: { $in: ['Ordered', 'Processing'] } }),
      Bill.countDocuments({ ...scope, source: 'PO', status: 'Pending', createdAt: { $lte: to }, 'match.status': { $nin: ['Matched', 'Accepted'] } }),
      InventoryMovement.distinct('date', { date: { $gte: from, $lte: to }, isClosed: true }),
      JournalEntry.distinct('lines.accountCode', { date: { $lte: to }, 'lines.accountCode': /^112/ }),
      BankReconciliation.find({ statementDate: { $gte: from, $lte: to }, status: 'Reconciled' }, { accountCode: 1 }).lean(),
      FixedAsset.find({ status: 'Active', acquisitionDate: { $lte: to } }, { name: 1, lastDepreciationDate: 1 }).lean(),
      ManualJournal.countDocuments({ ...scope, status: 'Pending', createdAt: { $lte: to } }),
      JournalEntry.aggregate([{ $match: { date: { $lte: to } } }, { $unwind: '$lines' }, { $group: { _id: null, dr: { $sum: '$lines.debit' }, cr: { $sum: '$lines.credit' } } }]),
      Settings.findOne({ key: 'vatEnabled' }).lean(),
      JournalEntry.countDocuments({ reference: { $regex: `^PCT-${year}-${String(month).padStart(2, '0')}` } }),
      Settings.findOne({ key: ticksKey(year, month) }).lean(),
      ClosedPeriod.findOne({ year, month }).lean(),
    ]);
    const ticks = ticksRow?.value || {};
    const reconciled = new Set(recs.map(r => r.accountCode));
    const unreconciled = bankAccounts.filter(c => !reconciled.has(c));
    const notDepreciated = assets.filter(a => !a.lastDepreciationDate || new Date(a.lastDepreciationDate) < new Date(year, month - 1, 28));
    const dr = roundMoney(tb[0]?.dr || 0), cr = roundMoney(tb[0]?.cr || 0);
    const vatOn = vatRow?.value === true || vatRow?.value === 'true';
    const item = (key, label, ok, detail, blocking = false) => ({ key, label, status: ok ? 'done' : 'open', detail, blocking, manual: false });
    const items = [
      item('sales', 'All sales for the month finished', openOrders === 0, openOrders ? `${openOrders} order(s) taken this month are still open - complete or cancel them.` : 'No open orders.'),
      item('purchases', 'Purchases received and recorded', openPOs === 0, openPOs ? `${openPOs} purchase order(s) still awaiting delivery.` : 'No open purchase orders.'),
      item('inventory', 'Stock counts closed', countedDays.length > 0, countedDays.length ? `${countedDays.length} day(s) counted this month.` : 'No end-of-day stock count was closed this month.'),
      item('arap', 'Supplier invoices matched (AP)', unmatchedBills === 0, unmatchedBills ? `${unmatchedBills} bill(s) for received goods are waiting on their invoice match.` : 'Every bill is matched. Check Books Health for AR and AP against the ledger.'),
      item('bank', 'Bank accounts reconciled', unreconciled.length === 0, unreconciled.length ? `No finished reconciliation this month for: ${unreconciled.join(', ')}.` : (bankAccounts.length ? 'Every bank account is reconciled.' : 'No bank accounts in use.')),
      ...(vatOn ? [] : [item('pcttax', 'Percentage tax accrued', pctEntries > 0, pctEntries ? 'Accrued for the month.' : 'Accrue the 3% percentage tax (Reports → Percentage Tax).')]),
      item('depreciation', 'Depreciation posted', notDepreciated.length === 0, notDepreciated.length ? `${notDepreciated.length} asset(s) not yet depreciated through this month.` : 'Every active asset is depreciated.'),
      item('journals', 'Manual journal entries approved', waitingJournals === 0, waitingJournals ? `${waitingJournals} manual entry(ies) still waiting for approval.` : 'None waiting.', true),
      item('trial', 'Trial balance balances', toCentavos(dr) === toCentavos(cr), `Debits ₱${dr.toFixed(2)} · Credits ₱${cr.toFixed(2)}`, true),
      ...Object.entries(MANUAL).map(([key, label]) => ({
        key, label, manual: true, blocking: false,
        status: ticks[key] ? 'done' : 'open',
        detail: ticks[key] ? `Confirmed by ${ticks[key].by} on ${new Date(ticks[key].at).toLocaleDateString('en-PH')}.` : 'Tick once done.',
      })),
    ];
    return {
      year, month, closed: !!(closed && !closed.isOpen), closedBy: closed && !closed.isOpen ? closed.closedBy : '',
      items, openCount: items.filter(i => i.status !== 'done').length,
      blocking: items.filter(i => i.blocking && i.status !== 'done').map(i => i.label),
    };
  };
  ctx.closingChecklist = buildChecklist;

  app.get('/api/periods/checklist', verifyToken, ...canView, async (req, res) => {
    try {
      const m = readMonth(req.query);
      if (!m) return res.status(400).json({ success: false, error: 'Give the year and month.' });
      res.json({ success: true, ...(await buildChecklist(req, m)) });
    } catch (err) { fail(req, res, err); }
  });

  // Tick (or untick) a step the records cannot prove.
  app.post('/api/periods/checklist/tick', verifyToken, ...canPost, async (req, res) => {
    try {
      const m = readMonth(req.body || {});
      if (!m) return res.status(400).json({ success: false, error: 'Give the year and month.' });
      const key = String(req.body?.key || '');
      if (!MANUAL[key]) return res.status(400).json({ success: false, error: 'That step is checked automatically.' });
      const field = `value.${key}`;
      await Settings.findOneAndUpdate({ key: ticksKey(m.year, m.month) },
        req.body?.done === false ? { $unset: { [field]: '' } } : { $set: { [field]: { by: req.user?.name || '', at: new Date() } } },
        { upsert: true });
      await logAudit(req, { action: req.body?.done === false ? 'untick' : 'tick', entity: 'CloseChecklist', entityId: `${m.year}-${m.month}`, after: { step: MANUAL[key] } });
      res.json({ success: true, ...(await buildChecklist(req, m)) });
    } catch (err) { fail(req, res, err); }
  });
}
