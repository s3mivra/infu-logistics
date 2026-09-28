// Budgets and Budget vs Actual.
//
// A budget is an amount per account per month - what rent should cost, what
// sales should bring in. Actuals come from the ledger, like every other
// financial report, so the comparison can never drift from the books. A
// requisition is checked against what is left of its account's month when it
// is filed (checkSlipBudget, used by features/requisitions.js).
import { captureError } from '../lib/errorLog.js';
import { budgetRow, budgetAvailability, slipCharges, naturalAmount } from '../lib/budget.js';
import { roundMoney } from '../lib/money.js';
import { MONEY_MAX } from '../lib/normalize.js';

export default function registerBudgets(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, Budget, JournalEntry, RequisitionSlip,
    acctMeta, logAudit, verifyToken, requireStaff, requirePermission,
  } = ctx;
  const canView = [requireStaff, requirePermission('accounting.view')];
  const canSet = [requireStaff, requirePermission('accounting.manage')];
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));

  // Month boundaries on the business's own calendar (the process runs in the
  // business time zone - the server refuses to start otherwise).
  const monthRange = (year, fromMonth, toMonth = fromMonth) => [
    new Date(year, fromMonth - 1, 1, 0, 0, 0, 0),
    new Date(year, toMonth, 0, 23, 59, 59, 999),
  ];
  // Does `code` sit under `root` in the chart (or is it root)?
  const rollsUp = (code, root) => {
    for (let c = code, guard = 0; c && guard < 10; guard++) { if (c === root) return true; c = acctMeta(c)?.parent; }
    return false;
  };
  // Debits and credits per account over a period, straight from the ledger.
  const ledgerTotals = async (from, to) => {
    const rows = await JournalEntry.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.accountCode', dr: { $sum: { $ifNull: ['$lines.debit', 0] } }, cr: { $sum: { $ifNull: ['$lines.credit', 0] } } } },
    ]);
    return rows.map(r => ({ code: r._id, dr: r.dr, cr: r.cr }));
  };
  const actualFor = (totals, code) => {
    const type = acctMeta(code)?.type;
    let dr = 0, cr = 0;
    for (const t of totals) if (rollsUp(t.code, code)) { dr += t.dr; cr += t.cr; }
    return roundMoney(naturalAmount(type, dr, cr));
  };

  app.get('/api/budgets', verifyToken, ...canView, async (req, res) => {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const rows = await Budget.find({ businessType: BUSINESS_TYPE, ...tenantScope(req), year }).sort({ accountCode: 1, month: 1 }).lean();
      res.json({ success: true, year, rows });
    } catch (err) { fail(req, res, err); }
  });

  // Set a year's budget: rows of { accountCode, month (1-12), amount }. An
  // amount left blank removes that month's figure.
  app.put('/api/budgets', verifyToken, ...canSet, async (req, res) => {
    try {
      const year = Number(req.body?.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ success: false, error: 'Give the budget year.' });
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length || rows.length > 2400) return res.status(400).json({ success: false, error: 'Give between 1 and 2,400 budget rows.' });
      const problems = [];
      const ops = [];
      rows.forEach((r, i) => {
        const code = String(r?.accountCode || '').trim();
        const month = Number(r?.month);
        const meta = acctMeta(code);
        if (!meta) return problems.push(`Row ${i + 1}: "${code}" is not an account.`);
        if (!Number.isInteger(month) || month < 1 || month > 12) return problems.push(`Row ${i + 1}: month must be 1 to 12.`);
        const key = { businessType: BUSINESS_TYPE, ...tenantScope(req), year, month, accountCode: code };
        if (r.amount === '' || r.amount === null || r.amount === undefined) { ops.push({ deleteOne: { filter: key } }); return; }
        const amount = Number(r.amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > MONEY_MAX) return problems.push(`Row ${i + 1}: amount must be a positive number.`);
        ops.push({ updateOne: { filter: key, update: { $set: { amount: roundMoney(amount), setBy: req.user?.name || '' } }, upsert: true } });
      });
      if (problems.length) return res.status(400).json({ success: false, error: `Nothing was saved. ${problems.length} problem(s).`, problems: problems.slice(0, 50) });
      if (ops.length) await Budget.bulkWrite(ops);
      await logAudit(req, { action: 'set', entity: 'Budget', entityId: String(year), after: { rows: rows.length } });
      res.json({ success: true, saved: ops.length });
    } catch (err) { fail(req, res, err); }
  });

  // Budget vs Actual for a month or a run of months in one year.
  app.get('/api/reports/budget-vs-actual', verifyToken, requireStaff, requirePermission('reports.view'), requirePermission('screen.reports.budget'), async (req, res) => {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const fromMonth = Math.min(12, Math.max(1, Number(req.query.fromMonth) || 1));
      const toMonth = Math.min(12, Math.max(fromMonth, Number(req.query.toMonth) || fromMonth));
      const [from, to] = monthRange(year, fromMonth, toMonth);
      const [budgets, totals] = await Promise.all([
        Budget.aggregate([
          { $match: { businessType: BUSINESS_TYPE, ...tenantScope(req), year, month: { $gte: fromMonth, $lte: toMonth } } },
          { $group: { _id: '$accountCode', amount: { $sum: '$amount' } } },
        ]),
        ledgerTotals(from, to),
      ]);
      const rows = budgets.map(b => {
        const meta = acctMeta(b._id) || {};
        return budgetRow({ accountCode: b._id, accountName: meta.name || b._id, type: meta.type || 'expense', budget: b.amount, actual: actualFor(totals, b._id) });
      }).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      const sum = (pred, key) => roundMoney(rows.filter(pred).reduce((s, r) => s + r[key], 0));
      const isRev = (r) => r.type === 'revenue';
      const isExp = (r) => r.type === 'expense';
      res.json({
        success: true, year, fromMonth, toMonth, rows,
        totals: {
          revenueBudget: sum(isRev, 'budget'), revenueActual: sum(isRev, 'actual'),
          expenseBudget: sum(isExp, 'budget'), expenseActual: sum(isExp, 'actual'),
          overBudget: rows.filter(r => r.over).length,
        },
      });
    } catch (err) { fail(req, res, err); }
  });

  // What is left of each account's month for this slip. Stored on the slip
  // when it is filed and shown to the approver.
  ctx.checkSlipBudget = async (req, slip, { excludeId = null } = {}) => {
    const charges = slipCharges(slip);
    if (!charges.length) return [];
    const when = slip.createdAt ? new Date(slip.createdAt) : new Date();
    const year = when.getFullYear(), month = when.getMonth() + 1;
    const [from, to] = monthRange(year, month);
    const [budgets, totals, pending] = await Promise.all([
      Budget.find({ businessType: BUSINESS_TYPE, ...tenantScope(req), year, month, accountCode: { $in: charges.map(c => c.accountCode) } }).lean(),
      ledgerTotals(from, to),
      RequisitionSlip.find({
        businessType: BUSINESS_TYPE, ...tenantScope(req), status: 'Pending',
        createdAt: { $gte: from, $lte: to }, ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      }, { type: 1, amount: 1, categoryCode: 1, lines: 1 }).lean(),
    ]);
    const budgetBy = new Map(budgets.map(b => [b.accountCode, b.amount]));
    return charges.map(c => {
      const committed = pending.flatMap(slipCharges).filter(x => x.accountCode === c.accountCode).reduce((s, x) => s + x.amount, 0);
      const spent = actualFor(totals, c.accountCode);
      const a = budgetAvailability({ budget: budgetBy.has(c.accountCode) ? budgetBy.get(c.accountCode) : null, spent, committed, requested: c.amount });
      return { accountCode: c.accountCode, accountName: acctMeta(c.accountCode)?.name || c.accountCode, ...a };
    });
  };
  void mongoose;
}
