// Bank reconciliation: explaining the difference between the ledger and the bank.
//
// The two never agree on the day, and they are not supposed to. A cheque
// written on the 28th clears on the 3rd; a deposit dropped after cut-off lands
// tomorrow; a bank charge appears that nobody has booked. Reconciling is
// accounting for every peso of that gap, and the value is not the tick marks -
// it is the residual. When the difference cannot be explained, something is
// actually wrong: an entry posted twice, an entry never posted, or money gone.
//
//   statement balance
//     - deposits in transit   (in our books, not yet at the bank)
//     + outstanding payments  (in our books, not yet cleared)
//     = the ledger balance, if everything is accounted for
//
// This module deliberately does NOT adjust the ledger to match the bank. A
// reconciliation is a statement of fact about a difference, not a licence to
// force the books; a charge the bank made and we never booked has to be
// entered as its own expense, so it lands in the P&L where it belongs.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import { requireModule } from '../lib/optionalModules.js';

export default function registerBankReconciliation(ctx) {
  const {
    app, mongoose, IS_PROD, log, BUSINESS_TYPE, tenantScope, logAudit,
    BankReconciliation, JournalEntry, Settings,
    acctMeta, mkSeqRef, currentBranchCode, periodLockFor,
    verifyToken, requireStaff, requirePermission,
  } = ctx;

  const enabled = requireModule(Settings, 'bankReconciliation');
  const canView = [enabled, requireStaff, requirePermission('accounting.view')];
  const canPost = [enabled, requireStaff, requirePermission('accounting.manage')];

  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  // Only cash and bank accounts can be reconciled - reconciling Sales Revenue
  // against a bank statement is a category error, not a report.
  const isBankLike = (c) => /^(111|112|113|114)/.test(String(c || ''));
  const nameOf = (code, fallback) => acctMeta(code)?.name || fallback || code;

  // The ledger's balance for one account as at a date. Cash accounts are
  // debit-normal, so debits less credits is what the business thinks it holds.
  async function ledgerBalanceAt(accountCode, asOf) {
    const [row] = await JournalEntry.aggregate([
      { $match: { date: { $lte: asOf } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': accountCode } },
      { $group: {
        _id: null,
        debit: { $sum: { $ifNull: ['$lines.debit', 0] } },
        credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      } },
    ]);
    return money((row?.debit || 0) - (row?.credit || 0));
  }

  // Every posting that touched the account up to the statement date, flattened
  // to one row per line so the operator ticks off what the statement shows.
  async function ledgerLines(accountCode, asOf) {
    const entries = await JournalEntry.find({
      date: { $lte: asOf }, 'lines.accountCode': accountCode,
    }, { reference: 1, description: 1, date: 1, lines: 1 }).sort({ date: 1 }).lean();

    const rows = [];
    for (const e of entries) {
      for (const l of (e.lines || [])) {
        if (l.accountCode !== accountCode) continue;
        rows.push({
          journalEntryId: String(e._id), reference: e.reference,
          description: e.description, date: e.date,
          debit: money(l.debit), credit: money(l.credit),
        });
      }
    }
    return rows;
  }

  // The whole point of the module, in one function.
  //
  // Money we have recorded that the bank has not seen goes BOTH ways: a
  // deposit in transit is a debit we have booked and the bank has not, an
  // outstanding payment is a credit we have booked and the bank has not.
  // Netting them into one "unreconciled" number would hide a cheque nobody
  // ever presented behind a deposit that landed the next morning.
  function summarise(rec, lines) {
    const clearedIds = new Set((rec.clearedLines || []).map(c => `${c.journalEntryId}:${c.debit}:${c.credit}`));
    const key = (l) => `${l.journalEntryId}:${l.debit}:${l.credit}`;

    const outstanding = lines.filter(l => !clearedIds.has(key(l)));
    const depositsInTransit = money(outstanding.reduce((s, l) => s + l.debit, 0));
    const outstandingPayments = money(outstanding.reduce((s, l) => s + l.credit, 0));

    // What the statement balance becomes once the timing differences are
    // applied. If the books are complete this equals the ledger balance.
    const adjustedStatement = money(rec.statementBalance + depositsInTransit - outstandingPayments);
    const difference = money(adjustedStatement - rec.ledgerBalance);

    return {
      statementBalance: money(rec.statementBalance),
      ledgerBalance: money(rec.ledgerBalance),
      depositsInTransit, outstandingPayments,
      adjustedStatement,
      difference,
      // A centavo of slack, because money is stored to two places and a sum of
      // many rounded numbers can land a hair off.
      reconciles: Math.abs(difference) <= 0.01,
      clearedCount: (rec.clearedLines || []).length,
      outstandingCount: outstanding.length,
    };
  }

  // ── WHICH ACCOUNTS CAN BE RECONCILED ──────────────────────────────────────
  app.get('/api/bank-reconciliations/accounts', verifyToken, ...canView, async (req, res) => {
    try {
      const codes = await JournalEntry.distinct('lines.accountCode');
      const asOf = new Date();
      const accounts = [];
      for (const code of codes.filter(isBankLike).sort()) {
        accounts.push({ code, name: nameOf(code), balance: await ledgerBalanceAt(code, asOf) });
      }
      res.json({ success: true, accounts });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get('/api/bank-reconciliations', verifyToken, ...canView, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.accountCode) q.accountCode = req.query.accountCode;
      if (req.query.status) q.status = req.query.status;
      const rows = await BankReconciliation.find(q).sort({ statementDate: -1 }).limit(200).lean();
      res.json({
        success: true,
        reconciliations: rows.map(r => ({
          ...r,
          summary: summarise(r, []),   // counts only; the full view opens one
        })),
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── OPEN ONE ──────────────────────────────────────────────────────────────
  app.get('/api/bank-reconciliations/:id', verifyToken, ...canView, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const rec = await BankReconciliation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!rec) return res.status(404).json({ success: false, error: 'Not found' });

      const lines = await ledgerLines(rec.accountCode, dayEnd(rec.statementDate));
      const clearedIds = new Set((rec.clearedLines || []).map(c => `${c.journalEntryId}:${c.debit}:${c.credit}`));
      const marked = lines.map(l => ({ ...l, cleared: clearedIds.has(`${l.journalEntryId}:${l.debit}:${l.credit}`) }));

      res.json({ success: true, reconciliation: rec, lines: marked, summary: summarise(rec, lines) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── START ONE ─────────────────────────────────────────────────────────────
  app.post('/api/bank-reconciliations', verifyToken, ...canPost, async (req, res) => {
    try {
      const { accountCode, statementDate, statementBalance, notes } = req.body || {};
      if (!isBankLike(accountCode) || !acctMeta(accountCode)) {
        return res.status(400).json({ success: false, error: 'Pick a cash or bank account to reconcile.' });
      }
      if (!statementDate) return res.status(400).json({ success: false, error: 'The statement date is required.' });
      const asOf = dayEnd(statementDate);
      if (Number.isNaN(asOf.getTime())) return res.status(400).json({ success: false, error: 'Invalid statement date.' });
      const balance = Number(statementBalance);
      if (!Number.isFinite(balance)) return res.status(400).json({ success: false, error: 'Enter the closing balance from the statement.' });

      // Two open reconciliations for the same account and month would each show
      // half the ticks, and neither would ever balance.
      const clash = await BankReconciliation.findOne({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        accountCode, statementDate: { $gte: dayStart(statementDate), $lte: asOf },
      }).lean();
      if (clash) {
        return res.status(409).json({ success: false, error: `A reconciliation for ${nameOf(accountCode)} on that date already exists (${clash.reference}).` });
      }

      const rec = await BankReconciliation.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        branchCode: await currentBranchCode(),
        reference: await mkSeqRef('BREC'),
        accountCode, accountName: nameOf(accountCode),
        statementDate: asOf, statementBalance: money(balance),
        ledgerBalance: await ledgerBalanceAt(accountCode, asOf),
        notes: notes || '', createdBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'BankReconciliation', entityId: rec._id, after: { reference: rec.reference, accountCode, statementBalance: rec.statementBalance } });
      res.json({ success: true, reconciliation: rec });
    } catch (err) {
      log.error?.({ err }, 'POST /api/bank-reconciliations failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── TICK LINES OFF ────────────────────────────────────────────────────────
  app.post('/api/bank-reconciliations/:id/clear', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const rec = await BankReconciliation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!rec) return res.status(404).json({ success: false, error: 'Not found' });
      if (rec.status === 'Reconciled') return res.status(409).json({ success: false, error: 'This reconciliation is already closed. Reopen it to change what is ticked.' });

      const wanted = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const lines = await ledgerLines(rec.accountCode, dayEnd(rec.statementDate));
      const byKey = new Map(lines.map(l => [`${l.journalEntryId}:${l.debit}:${l.credit}`, l]));

      // Replace rather than append: the client sends the full set of ticks, so
      // un-ticking works without a second endpoint.
      const cleared = [];
      for (const w of wanted) {
        const key = `${w.journalEntryId}:${money(w.debit)}:${money(w.credit)}`;
        const hit = byKey.get(key);
        if (!hit) continue;   // a line that is not on this account or is after the date
        cleared.push({
          journalEntryId: hit.journalEntryId, reference: hit.reference, date: hit.date,
          debit: hit.debit, credit: hit.credit,
          clearedAt: new Date(), clearedBy: req.user?.name || '',
        });
      }
      rec.clearedLines = cleared;
      await rec.save();

      res.json({ success: true, reconciliation: rec, summary: summarise(rec.toObject(), lines) });
    } catch (err) {
      log.error?.({ err }, 'POST /api/bank-reconciliations/:id/clear failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── CLOSE IT ──────────────────────────────────────────────────────────────
  app.post('/api/bank-reconciliations/:id/finish', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const rec = await BankReconciliation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!rec) return res.status(404).json({ success: false, error: 'Not found' });
      if (rec.status === 'Reconciled') return res.status(409).json({ success: false, error: 'Already reconciled.' });

      const lines = await ledgerLines(rec.accountCode, dayEnd(rec.statementDate));
      const summary = summarise(rec.toObject(), lines);

      // The refusal that gives the module its worth. Closing a reconciliation
      // that does not reconcile would record a lie, and the difference - which
      // is the actual finding - would be lost.
      if (!summary.reconciles) {
        return res.status(409).json({
          success: false,
          error: `Still out by ${summary.difference.toFixed(2)}. Every difference has to be accounted for before this can be closed - tick the items the statement shows, and book anything the bank charged that is not in the ledger yet.`,
          summary,
        });
      }

      rec.status = 'Reconciled';
      rec.reconciledAt = new Date();
      rec.reconciledBy = req.user?.name || '';
      if (req.body?.notes) rec.notes = String(req.body.notes).slice(0, 500);
      await rec.save();

      await logAudit(req, { action: 'update', entity: 'BankReconciliation', entityId: rec._id, after: { reference: rec.reference, reconciled: true, ...summary } });
      res.json({ success: true, reconciliation: rec, summary });
    } catch (err) {
      log.error?.({ err }, 'POST /api/bank-reconciliations/:id/finish failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── REOPEN ────────────────────────────────────────────────────────────────
  app.post('/api/bank-reconciliations/:id/reopen', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const rec = await BankReconciliation.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) });
      if (!rec) return res.status(404).json({ success: false, error: 'Not found' });

      // A reconciled month that has since been closed is signed-off history.
      const lock = await periodLockFor(rec.statementDate);
      if (lock) return res.status(423).json({ success: false, error: `Period ${lock.year}-${String(lock.month).padStart(2, '0')} is closed. Reopen the period first.` });

      rec.status = 'Open';
      rec.reconciledAt = null;
      rec.reconciledBy = '';
      await rec.save();
      await logAudit(req, { action: 'update', entity: 'BankReconciliation', entityId: rec._id, after: { reference: rec.reference, reopened: true } });
      res.json({ success: true, reconciliation: rec });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
