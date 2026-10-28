// "Needs your action": the decisions waiting on this person, in one list.
// The bell (features/notifications.js) warns about the state of things - low
// stock, overdue balances. This lists what someone has to approve, accept,
// pay or close, each with where to do it. Permission-aware like the bell: a
// row appears only for someone allowed to act on it.
import { captureError } from '../lib/errorLog.js';
import { businessDateStr } from '../lib/businessTime.js';

export default function registerActionItems(ctx) {
  const { app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, verifyToken, requireStaff, hasPermission } = ctx;
  const M = (n) => mongoose.models[n];
  const may = (req, perm) => { try { return hasPermission(req.user, perm); } catch { return false; } };

  app.get('/api/action-items', verifyToken, requireStaff, async (req, res) => {
    try {
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const now = new Date();
      const inAWeek = new Date(now.getTime() + 7 * 86400000);
      const count = (name, q) => (M(name) ? M(name).countDocuments(q) : Promise.resolve(0));
      const checks = [];
      const add = (perm, row, q) => { if (perm === true || may(req, perm)) checks.push(q.then((n) => ({ ...row, count: n }))); };

      add('requisitions.approve', { id: 'requisitions', label: 'Requisition slips to approve', tab: 'approvals' },
        count('RequisitionSlip', { ...scope, status: 'Pending' }));
      add('accounting.manage', { id: 'bills', label: 'Supplier bills to approve', tab: 'reports', sub: 'bills' },
        count('Bill', { ...scope, status: 'Pending' }));
      add('accounting.manage', { id: 'bills-due', label: 'Approved bills due within a week', tab: 'reports', sub: 'bills' },
        count('Bill', { ...scope, status: { $in: ['Approved', 'Partially Paid'] }, dueDate: { $lte: inAWeek } }));
      add('journal.approve', { id: 'journal', label: 'Journal entries waiting for approval', tab: 'ledger', sub: 'journal' },
        count('ManualJournal', { ...scope, status: 'Pending' }));
      add('inventory.approve', { id: 'transfers', label: 'Stock transfers to approve', tab: 'inventory', sub: 'transfers' },
        count('StockTransfer', { ...scope, status: 'Requested' }));
      add('inventory.manage', { id: 'hub-in', label: 'Shipments from linked businesses to accept', tab: 'hub' },
        count('CrossTransfer', { businessType: BUSINESS_TYPE, direction: 'inbound', status: 'Pending' }));
      add('inventory.approve', { id: 'hub-out', label: 'Shipments to linked businesses to approve', tab: 'hub' },
        count('CrossTransfer', { businessType: BUSINESS_TYPE, direction: 'outbound', status: 'Requested' }));
      add('inventory.manage', { id: 'hub-requests', label: 'Stock requests from linked businesses', tab: 'hub' },
        count('TransferRequest', { businessType: BUSINESS_TYPE, side: 'received', status: { $in: ['Pending', 'CounterPending', 'AwaitingFinal'] } }));
      add('scheduling.manage', { id: 'leave', label: 'Leave and overtime requests', tab: 'timeoff' },
        Promise.all([count('LeaveRequest', { ...scope, status: 'Pending' }), count('OvertimeRequest', { ...scope, status: 'Pending' })]).then(([a, b]) => a + b));
      add('payroll.manage', { id: 'payroll', label: 'Payroll runs to approve or pay', tab: 'payroll' },
        count('PayrollRun', { ...scope, status: { $in: ['Draft', 'Approved'] } }));
      add('accounting.view', { id: 'pdc', label: 'Post-dated checks due within a week', tab: 'reports', sub: 'arreport' },
        count('Order', { ...scope, paymentCheckDate: { $gte: new Date(now.getTime() - 86400000), $lte: inAWeek }, status: { $nin: ['Cancelled', 'Voided', 'Refunded'] } }));
      add('pricing.approve', { id: 'changes', label: 'Change requests to approve', tab: 'approvals' },
        count('ChangeRequest', { ...tenantScope(req), status: 'Pending' }));

      // Last month still open in the books, once this month is under way.
      if (may(req, 'accounting.manage') && M('ClosedPeriod')) {
        const [y, m] = businessDateStr(now).split('-').map(Number);
        const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
        const day = Number(businessDateStr(now).slice(8, 10));
        checks.push(M('ClosedPeriod').exists(prev).then((closed) => ({
          id: 'close', label: `Close ${prev.year}-${String(prev.month).padStart(2, '0')} in the books`, tab: 'ledger', sub: 'closing',
          count: !closed && day > 5 ? 1 : 0,
        })));
      }

      const items = (await Promise.all(checks)).filter((r) => r.count > 0);
      res.json({ success: true, items, total: items.reduce((s, r) => s + r.count, 0) });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // First-time setup: each step ticks itself off from the data, so the list
  // is never out of date and needs no "mark as done". Owners and the
  // superadmin see it on Home until every step is done.
  app.get('/api/setup-progress', verifyToken, requireStaff, async (req, res) => {
    try {
      if (!(String(req.user?.role || '').toLowerCase() === 'superadmin' || may(req, 'owner.view'))) return res.json({ success: true, steps: [] });
      const scope = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      const has = (name, q) => (M(name) ? M(name).exists(q).then(Boolean) : Promise.resolve(false));
      const [settings, products, stock, staff, opening, sale] = await Promise.all([
        has('Settings', { key: 'vatEnabled' }),
        has('Product', {}),
        has('Inventory', scope),
        M('User') ? M('User').countDocuments({}).then((n) => n > 1) : false,
        has('JournalEntry', { reference: /^OPEN-/ }),
        has('Order', { ...scope, status: 'Completed' }),
      ]);
      const steps = [
        { id: 'settings', label: 'Tax and receipt settings', hint: 'VAT or non-VAT, receipt numbering', done: settings, tab: 'settings' },
        { id: 'products', label: 'Add your products', hint: 'What you sell, with prices', done: products, tab: 'products' },
        { id: 'stock', label: 'Add your stock items', hint: 'What you keep on hand, with costs', done: stock, tab: 'inventory' },
        { id: 'staff', label: 'Add your staff', hint: 'One account per person, with what they may do', done: staff, tab: 'admin-panel' },
        { id: 'opening', label: 'Enter opening balances', hint: 'Cash, bank, what clients owe you and what you owe', done: opening, tab: 'ledger', sub: 'accperiods' },
        { id: 'sale', label: 'Record your first sale', hint: 'At the till, or a backdated one', done: sale, tab: 'orders' },
      ];
      res.json({ success: true, steps });
    } catch (err) {
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
