// Payroll: what the work cost, and what each person actually took home.
//
// The two are not the same number, and the gap is the whole reason this module
// exists. Gross pay is the expense - it is what the business owed for the work
// done. The statutory deductions come out of the EMPLOYEE's money, and the
// business holds them until each agency is paid. Recording only the net would
// understate wages and make three separate liabilities disappear.
//
//   run approved   DR 610000 Salaries & Wages   gross
//                  CR 240100/240200/240300      SSS / PhilHealth / Pag-IBIG
//                  CR 230200                    tax withheld on compensation
//                  CR 240400 Net Pay Payable    what is still owed to staff
//
//   run paid       DR 240400 Net Pay Payable    the obligation is discharged
//                  CR cash / bank               the money that actually left
//
// Two steps, not one, for the same reason purchase orders separate receiving
// from paying: approving the payroll and handing over the money happen on
// different days, and a payroll approved on the 28th but paid on the 3rd is a
// liability in between. Collapsing them would put the wages in the wrong month
// or the cash outflow in the wrong one.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { requireModule } from '../lib/optionalModules.js';

export default function registerPayroll(ctx) {
  const {
    app, mongoose, IS_PROD, log, BUSINESS_TYPE, tenantScope, logAudit,
    PayrollRun, JournalEntry, Settings,
    assertBalanced, acctMeta, mkSeqRef, currentBranchCode, periodLockFor,
    verifyToken, requireStaff, requirePermission,
  } = ctx;

  const enabled = requireModule(Settings, 'payroll');
  const canView = [enabled, requireStaff, requirePermission('accounting.view')];
  const canPost = [enabled, requireStaff, requirePermission('accounting.manage')];

  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const isCashLike = (c) => /^(111|112|113|114)/.test(String(c || ''));
  const nameOf = (code, fallback) => acctMeta(code)?.name || fallback || code;

  // Where each deduction is held between being withheld and being remitted.
  const DEDUCTION_ACCOUNTS = {
    sss: '240100',
    philhealth: '240200',
    pagibig: '240300',
    withholdingTax: '230200',
  };

  // One employee's line, with the arithmetic done once and stored.
  function buildLine(raw) {
    const gross = money(raw?.grossPay);
    if (!(gross > 0)) throw new Error(`${raw?.employeeName || 'A line'} needs a gross pay above zero.`);
    if (!String(raw?.employeeName || '').trim()) throw new Error('Every line needs an employee name.');

    const sss = Math.max(0, money(raw.sss));
    const philhealth = Math.max(0, money(raw.philhealth));
    const pagibig = Math.max(0, money(raw.pagibig));
    const withholdingTax = Math.max(0, money(raw.withholdingTax));
    const otherDeductions = Math.max(0, money(raw.otherDeductions));
    const deductions = money(sss + philhealth + pagibig + withholdingTax + otherDeductions);

    // Nobody takes home a negative amount. A run where the deductions exceed
    // the pay is a data-entry error, and posting it would credit the employee
    // with owing the business money through the payroll account.
    if (deductions > gross) {
      throw new Error(`${raw.employeeName}: deductions (${deductions.toFixed(2)}) exceed gross pay (${gross.toFixed(2)}).`);
    }

    return {
      employeeName: String(raw.employeeName).trim(),
      employeeId: String(raw.employeeId || '').trim(),
      grossPay: gross, sss, philhealth, pagibig, withholdingTax, otherDeductions,
      netPay: money(gross - deductions),
      notes: String(raw.notes || '').slice(0, 200),
    };
  }

  const sum = (lines, field) => money(lines.reduce((s, l) => s + (l[field] || 0), 0));
  const totalsFor = (lines) => ({
    gross: sum(lines, 'grossPay'),
    sss: sum(lines, 'sss'),
    philhealth: sum(lines, 'philhealth'),
    pagibig: sum(lines, 'pagibig'),
    withholdingTax: sum(lines, 'withholdingTax'),
    otherDeductions: sum(lines, 'otherDeductions'),
    net: sum(lines, 'netPay'),
  });

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get('/api/payroll-runs', verifyToken, ...canView, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status) q.status = req.query.status;
      if (req.query.start || req.query.end) {
        q.periodEnd = {};
        if (req.query.start) q.periodEnd.$gte = dayStart(req.query.start);
        if (req.query.end) q.periodEnd.$lte = dayEnd(req.query.end);
      }
      const runs = await PayrollRun.find(q).sort({ periodEnd: -1 }).limit(200).lean();
      res.json({
        success: true, runs,
        totals: {
          gross: money(runs.reduce((s, r) => s + (r.totals?.gross || 0), 0)),
          net: money(runs.reduce((s, r) => s + (r.totals?.net || 0), 0)),
          unpaid: money(runs.filter(r => r.status === 'Approved').reduce((s, r) => s + (r.totals?.net || 0), 0)),
        },
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.get('/api/payroll-runs/:id', verifyToken, ...canView, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const run = await PayrollRun.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!run) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, run });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── DRAFT ─────────────────────────────────────────────────────────────────
  // Nothing posts here. A draft is a working document - the figures get
  // checked against timesheets before anyone commits them to the books.
  app.post('/api/payroll-runs', verifyToken, ...canPost, async (req, res) => {
    try {
      const { periodStart, periodEnd, payDate, lines, notes } = req.body || {};
      if (!periodStart || !periodEnd) return res.status(400).json({ success: false, error: 'The pay period start and end are required.' });
      const start = dayStart(periodStart);
      const end = dayEnd(periodEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return res.status(400).json({ success: false, error: 'Invalid pay period.' });
      if (end < start) return res.status(400).json({ success: false, error: 'The pay period ends before it starts.' });

      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, error: 'Add at least one employee.' });
      }

      let built;
      try { built = lines.map(buildLine); }
      catch (e) { return res.status(400).json({ success: false, error: e.message }); }

      const run = await PayrollRun.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
        reference: await mkSeqRef('PAY'),
        periodStart: start, periodEnd: end,
        payDate: payDate ? dayStart(payDate) : end,
        lines: built, totals: totalsFor(built),
        notes: notes || '', createdBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'PayrollRun', entityId: run._id, after: { reference: run.reference, employees: built.length, gross: run.totals.gross } });
      res.json({ success: true, run });
    } catch (err) {
      log.error?.({ err }, 'POST /api/payroll-runs failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── EDIT A DRAFT ──────────────────────────────────────────────────────────
  app.put('/api/payroll-runs/:id', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const run = await PayrollRun.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!run) return res.status(404).json({ success: false, error: 'Not found' });
      // Once it has posted, the payslips are records of what was actually paid.
      if (run.status !== 'Draft') return res.status(409).json({ success: false, error: `Only a draft can be edited (this one is ${run.status}).` });

      if (Array.isArray(req.body?.lines)) {
        try { run.lines = req.body.lines.map(buildLine); }
        catch (e) { return res.status(400).json({ success: false, error: e.message }); }
        run.totals = totalsFor(run.lines);
      }
      if (req.body?.payDate) run.payDate = dayStart(req.body.payDate);
      if (req.body?.notes !== undefined) run.notes = String(req.body.notes).slice(0, 500);
      await run.save();
      res.json({ success: true, run });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── APPROVE: the wages hit the books ──────────────────────────────────────
  app.post('/api/payroll-runs/:id/approve', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const run = await PayrollRun.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!run) return res.status(404).json({ success: false, error: 'Not found' });
      if (run.status !== 'Draft') return res.status(409).json({ success: false, error: `Only a draft can be approved (this one is ${run.status}).` });

      // The wages belong to the period worked, so that is the date that has to
      // be open - approving a March payroll in April still moves March.
      const lock = await periodLockFor(run.periodEnd);
      if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed. Reopen the period first.` });

      const t = run.totals;
      const reference = await mkSeqRef('PAY-JE');
      const lines = [
        { accountCode: '610000', accountName: nameOf('610000', 'Salaries & Wages'), debit: t.gross, credit: 0 },
      ];
      for (const [field, code] of Object.entries(DEDUCTION_ACCOUNTS)) {
        if (t[field] > 0) lines.push({ accountCode: code, accountName: nameOf(code), debit: 0, credit: t[field] });
      }
      // Anything else held back (a cash advance being repaid, a uniform) is
      // still the employee's money not yet handed over, so it sits with the
      // rest of the net pay obligation rather than reducing the wage expense.
      const owedToStaff = money(t.net + t.otherDeductions);
      if (owedToStaff > 0) {
        lines.push({ accountCode: '240400', accountName: nameOf('240400', 'Net Pay Payable'), debit: 0, credit: owedToStaff });
      }

      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: run.periodEnd, reference,
        description: `Payroll ${run.reference} for ${run.lines.length} employee(s), period ending ${run.periodEnd.toISOString().slice(0, 10)}`,
        lines,
        totalDebit: money(lines.reduce((s, l) => s + l.debit, 0)),
        totalCredit: money(lines.reduce((s, l) => s + l.credit, 0)),
      });

      run.status = 'Approved';
      run.journalEntryRef = reference;
      run.approvedBy = req.user?.name || '';
      run.approvedAt = new Date();
      await run.save();

      await logAudit(req, { action: 'approve', entity: 'PayrollRun', entityId: run._id, after: { reference: run.reference, journalEntryRef: reference, gross: t.gross, net: t.net } });
      res.json({ success: true, run, reference });
    } catch (err) {
      log.error?.({ err }, 'POST /api/payroll-runs/:id/approve failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── PAY: the money actually leaves ────────────────────────────────────────
  app.post('/api/payroll-runs/:id/pay', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const run = await PayrollRun.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!run) return res.status(404).json({ success: false, error: 'Not found' });
      if (run.status !== 'Approved') {
        return res.status(409).json({ success: false, error: `Only an approved run can be paid (this one is ${run.status}). Approving it first is what puts the wages in the books.` });
      }

      const { paidFromAccount, payDate } = req.body || {};
      const cashCode = (acctMeta(paidFromAccount) && isCashLike(paidFromAccount)) ? paidFromAccount : '111000';
      const when = payDate ? dayStart(payDate) : (run.payDate || new Date());
      const lock = await periodLockFor(when);
      if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed. Reopen the period first.` });

      // Only the take-home is handed over. Anything withheld under
      // "other deductions" was never going to the employee, so it stays on the
      // books until whoever it belongs to is settled.
      const paying = money(run.totals.net);
      if (!(paying > 0)) return res.status(400).json({ success: false, error: 'There is nothing to pay out on this run.' });

      const reference = await mkSeqRef('PAY-CV');
      const lines = [
        { accountCode: '240400', accountName: nameOf('240400', 'Net Pay Payable'), debit: paying, credit: 0 },
        { accountCode: cashCode, accountName: nameOf(cashCode), debit: 0, credit: paying },
      ];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: when, reference,
        description: `Payroll ${run.reference} paid out to ${run.lines.length} employee(s)`,
        lines, totalDebit: paying, totalCredit: paying,
      });

      run.status = 'Paid';
      run.paymentJournalRef = reference;
      run.paidFromAccount = cashCode;
      run.paidAt = new Date();
      await run.save();

      await logAudit(req, { action: 'update', entity: 'PayrollRun', entityId: run._id, after: { reference: run.reference, paid: paying, from: cashCode } });
      res.json({ success: true, run, reference, paid: paying });
    } catch (err) {
      log.error?.({ err }, 'POST /api/payroll-runs/:id/pay failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── ONE PERSON'S PAYSLIP ──────────────────────────────────────────────────
  app.get('/api/payroll-runs/:id/payslip/:index', verifyToken, ...canView, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const run = await PayrollRun.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!run) return res.status(404).json({ success: false, error: 'Not found' });
      const line = run.lines?.[parseInt(req.params.index, 10)];
      if (!line) return res.status(404).json({ success: false, error: 'No such line on this run.' });

      res.json({
        success: true,
        payslip: {
          reference: run.reference, status: run.status,
          periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate,
          ...line,
          totalDeductions: money(line.sss + line.philhealth + line.pagibig + line.withholdingTax + line.otherDeductions),
        },
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── WHAT IS STILL OWED TO THE AGENCIES ────────────────────────────────────
  app.get('/api/payroll-runs/liabilities/summary', verifyToken, ...canView, async (req, res) => {
    try {
      const codes = [...Object.values(DEDUCTION_ACCOUNTS), '240400'];
      const rows = await JournalEntry.aggregate([
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': { $in: codes } } },
        { $group: {
          _id: '$lines.accountCode',
          credited: { $sum: { $ifNull: ['$lines.credit', 0] } },
          debited: { $sum: { $ifNull: ['$lines.debit', 0] } },
        } },
      ]);
      const byCode = new Map(rows.map(r => [r._id, r]));
      const liabilities = codes.map(code => {
        const r = byCode.get(code);
        return {
          accountCode: code, accountName: nameOf(code),
          withheld: money(r?.credited || 0),
          remitted: money(r?.debited || 0),
          outstanding: money((r?.credited || 0) - (r?.debited || 0)),
        };
      });
      res.json({
        success: true, liabilities,
        totalOutstanding: money(liabilities.reduce((s, l) => s + l.outstanding, 0)),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
