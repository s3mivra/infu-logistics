// Exception report: the things that need a person, on one page.
//
//   overdue receivables     invoices past their due date, still unpaid
//   overdue payables        approved supplier bills past their due date
//   credit-limit breaches   clients owing more than their limit, and sales
//                           released over a limit by an approver
//   inventory variances     stock counts that did not match the system
//   cash variances          drawers that closed short or over
//   unmatched               supplier bills whose invoice is missing or does
//                           not match, journal entries awaiting approval,
//                           receipts nobody has assigned to a customer
//
// Every section is a count, a total and the first rows, each naming where it
// is fixed.
import { captureError } from '../lib/errorLog.js';
import { roundMoney } from '../lib/money.js';
import { resolveCreditLimit, arBalance, isReceivableStatus } from '../lib/credit.js';
import { AR_PAYMENT_METHOD_FILTER } from '../lib/ledger.js';

const LIST = 25;

export default function registerExceptions(ctx) {
  const {
    app, IS_PROD, BUSINESS_TYPE, tenantScope, Order, Bill, ClientAccount, Settings, InventoryMovement, Shift,
    ManualJournal, JournalEntry, verifyToken, requireStaff, requirePermission,
  } = ctx;

  app.get('/api/reports/exceptions', verifyToken, requireStaff, requirePermission('reports.view'), requirePermission('screen.reports.exceptions'), async (req, res) => {
    try {
      const now = new Date();
      const since = new Date(now.getTime() - 30 * 86400_000);
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const [modeRow, globalRow, thresholdRow] = await Promise.all([
        Settings.findOne({ key: 'creditLimitMode' }).lean(),
        Settings.findOne({ key: 'globalCreditLimit' }).lean(),
        Settings.findOne({ key: 'varianceThreshold' }).lean(),
      ]);
      const cashThreshold = Math.max(0, Number(thresholdRow?.value) || 50);

      // Open receivables (everything still owed on account).
      const openAr = await Order.find({
        ...scope, paymentMethod: AR_PAYMENT_METHOD_FILTER, isComplimentary: { $ne: true }, arSettled: { $ne: true },
        status: { $nin: ['Cancelled', 'Voided', 'Refunded', 'Parked'] },
      }, { orderNumber: 1, customerName: 1, clientId: 1, clientAccountId: 1, total: 1, arPaidAmount: 1, refundedAmount: 1, arDueDate: 1, createdAt: 1, status: 1 }).lean();
      const overdueAr = openAr
        .filter(o => isReceivableStatus(o.status) && o.arDueDate && new Date(o.arDueDate) < now && arBalance(o) > 0.004)
        .map(o => ({ orderNumber: o.orderNumber, customerName: o.customerName, dueDate: o.arDueDate, daysOverdue: Math.floor((now - new Date(o.arDueDate)) / 86400_000), balance: roundMoney(arBalance(o)) }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      const overdueApRows = await Bill.find({ ...scope, status: { $in: ['Approved', 'Partially Paid'] }, dueDate: { $lt: now } },
        { billNumber: 1, supplierName: 1, dueDate: 1, amount: 1, paidAmount: 1 }).sort({ dueDate: 1 }).lean();
      const overdueAp = overdueApRows.map(b => ({ billNumber: b.billNumber, supplierName: b.supplierName, dueDate: b.dueDate, daysOverdue: Math.floor((now - new Date(b.dueDate)) / 86400_000), balance: roundMoney((b.amount || 0) - (b.paidAmount || 0)) }));

      // Clients owing more than their limit.
      const owing = new Map();
      for (const o of openAr) {
        const id = String(o.clientAccountId || o.clientId || '');
        if (id) owing.set(id, (owing.get(id) || 0) + arBalance(o));
      }
      const ids = [...owing.keys()].filter(id => /^[a-f0-9]{24}$/i.test(id));
      const clients = ids.length ? await ClientAccount.find({ _id: { $in: ids } }, { name: 1, clientCode: 1, creditLimit: 1 }).lean() : [];
      const overLimit = clients.map(c => {
        const limit = resolveCreditLimit({ mode: modeRow?.value, globalLimit: globalRow?.value, clientLimit: c.creditLimit });
        const owed = roundMoney(owing.get(String(c._id)) || 0);
        return limit !== null && owed > limit + 0.004 ? { clientCode: c.clientCode, name: c.name, limit, owed, over: roundMoney(owed - limit) } : null;
      }).filter(Boolean).sort((a, b) => b.over - a.over);
      const overrides = await Order.find({ ...scope, 'creditOverride.approvedBy': { $nin: ['', null] }, createdAt: { $gte: since } },
        { orderNumber: 1, customerName: 1, total: 1, creditOverride: 1 }).sort({ createdAt: -1 }).limit(LIST).lean();

      const [stockVar, cashVar, billsUnmatched, journalsWaiting, unassigned] = await Promise.all([
        InventoryMovement.find({ date: { $gte: since }, isClosed: true, variance: { $ne: 0 } }, { date: 1, itemName: 1, unit: 1, variance: 1, systemEndingBalance: 1, actualPhysicalCount: 1 }).sort({ date: -1 }).limit(200).lean(),
        Shift.find({ createdAt: { $gte: since }, variance: { $ne: null } }, { cashierName: 1, createdAt: 1, expectedCash: 1, actualCash: 1, variance: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
        Bill.find({ ...scope, source: 'PO', status: 'Pending', 'match.status': { $in: ['Unmatched', 'Exception', null] } }, { billNumber: 1, supplierName: 1, amount: 1, match: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(),
        ManualJournal.find({ ...scope, status: 'Pending' }, { draftNumber: 1, description: 1, totalDebit: 1, preparedBy: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(),
        JournalEntry.aggregate([
          { $match: { 'lines.accountCode': '118000' } }, { $unwind: '$lines' }, { $match: { 'lines.accountCode': '118000' } },
          { $group: { _id: null, dr: { $sum: '$lines.debit' }, cr: { $sum: '$lines.credit' } } },
        ]),
      ]);
      const bigCash = cashVar.filter(s => Math.abs(Number(s.variance) || 0) >= cashThreshold)
        .map(s => ({ cashierName: s.cashierName, date: s.createdAt, expected: roundMoney(s.expectedCash), counted: roundMoney(s.actualCash), variance: roundMoney(s.variance) }));
      const unassignedReceipts = roundMoney((unassigned[0]?.dr || 0) - (unassigned[0]?.cr || 0));

      const section = (key, title, rows, total, where) => ({ key, title, count: rows.length, total: total == null ? null : roundMoney(total), rows: rows.slice(0, LIST), where });
      const sections = [
        section('overdueAr', 'Overdue receivables', overdueAr, overdueAr.reduce((s, r) => s + r.balance, 0), 'Ledger → AR & AP'),
        section('overdueAp', 'Overdue payables', overdueAp, overdueAp.reduce((s, r) => s + r.balance, 0), 'Ledger → Bills (AP)'),
        section('overLimit', 'Clients over their credit limit', overLimit, overLimit.reduce((s, r) => s + r.over, 0), 'Clients'),
        section('creditOverrides', 'Sales released over a credit limit (30 days)', overrides.map(o => ({ orderNumber: o.orderNumber, customerName: o.customerName, total: o.total, approvedBy: o.creditOverride?.approvedBy })), null, 'Orders'),
        section('stockVariance', 'Stock count variances (30 days)', stockVar.map(v => ({ date: v.date, itemName: v.itemName, unit: v.unit, system: v.systemEndingBalance, counted: v.actualPhysicalCount, variance: v.variance })), null, 'Inventory → End-of-day count'),
        section('cashVariance', `Drawer variances of ₱${cashThreshold} or more (30 days)`, bigCash, bigCash.reduce((s, r) => s + r.variance, 0), 'Reports → Cashier Variance'),
        section('billsUnmatched', 'Supplier bills waiting on their invoice match', billsUnmatched.map(b => ({ billNumber: b.billNumber, supplierName: b.supplierName, amount: b.amount, status: b.match?.status || 'Unmatched', issues: (b.match?.issues || []).map(i => i.text).join(' ') })), billsUnmatched.reduce((s, b) => s + (b.amount || 0), 0), 'Ledger → Bills (AP)'),
        section('journalsWaiting', 'Manual journal entries awaiting approval', journalsWaiting.map(j => ({ draftNumber: j.draftNumber, description: j.description, amount: j.totalDebit, preparedBy: j.preparedBy })), journalsWaiting.reduce((s, j) => s + (j.totalDebit || 0), 0), 'Ledger → General Ledger'),
      ];
      if (Math.abs(unassignedReceipts) >= 0.01) sections.push(section('unassigned', 'Receipts not yet assigned to a customer', [{ account: '118000 Unassigned Receipts', balance: unassignedReceipts }], unassignedReceipts, 'Ledger → AR & AP'));
      res.json({ success: true, generatedAt: now, sections, attention: sections.reduce((s, x) => s + x.count, 0) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
