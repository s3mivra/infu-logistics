// collections routes - AR collection reminders (contact log + follow-up
// worklist over the existing aging data). See the CollectionReminderSchema
// comment in server.js: this logs manual contact, it never sends anything.
import { ageingByClient, resolveClientKey, withArBalance, arBalance } from '../lib/credit.js';
import { dayStart } from '../lib/reportRange.js';
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
    JournalEntry,
    assertBalanced,
    accountForPaymentMethod,
    mkRef,
    logAudit,
    emitToMgr,
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
      // withArBalance restates `total` as the unpaid remainder, so a client who
      // has partly paid an aged invoice is chased for what is actually left.
    }, { customerName: 1, total: 1, createdAt: 1, clientAccountId: 1, clientId: 1, arPaidAmount: 1 }).lean()
      .then(withArBalance);
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
  // ══ CHECK REGISTER ═══════════════════════════════════════════════════════
  // A check is a promise of money, and the gap between receiving one and the
  // bank honouring it is where receivables quietly go wrong. Every check
  // collected against A/R lives here through its whole life:
  //
  //   On Hand   - received, sitting in the drawer (booked to 115000)
  //   Deposited - handed to the bank, not yet credited (still 115000: the
  //               bank has the paper, we do not have the money)
  //   Cleared   - the bank honoured it; 115000 -> the receiving account
  //   Bounced   - it never was money; the collection is REVERSED and the
  //               invoice reopens for the amount
  //
  // Only Cleared and Bounced post journal entries beyond the original receipt.
  // Depositing is deliberately a status step with no entry: nothing has moved
  // between accounts just because the paper changed hands.
  const canActCheck = [requireStaff, requirePermission('accounting.manage')];

  // Find one check line by order + payment id, or explain which it is.
  async function findCheck(req, res) {
    const { orderId, paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(paymentId)) {
      res.status(404).json({ success: false, error: 'Check not found.' });
      return null;
    }
    const order = await Order.findOne({ _id: orderId, businessType: BUSINESS_TYPE, ...tenantScope(req) });
    if (!order) { res.status(404).json({ success: false, error: 'Order not found.' }); return null; }
    const payment = order.arPayments?.id(paymentId);
    if (!payment || !payment.checkNumber) { res.status(404).json({ success: false, error: 'Check not found on that order.' }); return null; }
    return { order, payment };
  }

  // ── LIST ─────────────────────────────────────────────────────────────────
  // Every check ever taken in, newest first, with the derived flags an
  // operator actually acts on: is this post-dated check depositable yet, and
  // how long has a deposited one been sitting uncleared?
  app.get('/api/collections/checks', verifyToken, ...canViewAcct, async (req, res) => {
    try {
      const status = String(req.query.status || '').trim();
      const VALID = ['On Hand', 'Deposited', 'Cleared', 'Bounced'];

      const orders = await Order.find({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        // $elemMatch, not a dotted path: on an array field a dotted $nin
        // excludes the whole document if ANY element matches, so an invoice
        // paid partly in cash and partly by check would vanish from the
        // register entirely.
        arPayments: { $elemMatch: { checkNumber: { $nin: ['', null] } } },
      }, {
        orderNumber: 1, customerName: 1, total: 1, arPaidAmount: 1, arSettled: 1,
        arPayments: 1, clientAccountId: 1, clientId: 1, createdAt: 1,
      }).lean();

      const clients = await ClientAccount.find({}, { name: 1, creditLimit: 1 }).lean();
      const { keyOf } = resolveClientKey(clients);

      const today = new Date(); today.setHours(23, 59, 59, 999);
      const checks = [];
      for (const o of orders) {
        for (const p of (o.arPayments || [])) {
          if (!p.checkNumber) continue;
          const st = p.checkStatus || 'On Hand';
          if (status && VALID.includes(status) && st !== status) continue;
          const dated = p.checkDate ? new Date(p.checkDate) : null;
          checks.push({
            orderId: o._id,
            paymentId: p._id,
            orderNumber: o.orderNumber,
            client: keyOf(o),
            invoiceTotal: Math.round((Number(o.total) || 0) * 100) / 100,
            amount: Math.round((Number(p.amount) || 0) * 100) / 100,
            checkNumber: p.checkNumber,
            checkDate: dated,
            checkBank: p.checkBank || '',
            checkDrawer: p.checkDrawer || '',
            status: st,
            collectionDate: p.collectionDate || p.createdAt,
            collectedBy: p.collectedBy || '',
            recordedBy: p.recordedBy || '',
            depositedAt: p.checkDepositedAt || null,
            clearedAt: p.checkClearedAt || null,
            clearedTo: p.checkClearedTo || '',
            bouncedAt: p.checkBouncedAt || null,
            bounceReason: p.checkBounceReason || '',
            journalRef: p.journalRef || '',
            // A post-dated check cannot be presented before the date written
            // on it - this is what tells the operator which ones are ripe.
            postDated: !!(dated && dated > today),
            depositableOn: dated || null,
            // Days a deposited check has been sitting without clearing. Past
            // about a week that is worth chasing.
            daysInClearing: p.checkDepositedAt && st === 'Deposited'
              ? Math.floor((Date.now() - new Date(p.checkDepositedAt)) / 86400000)
              : null,
          });
        }
      }

      checks.sort((a, b) => new Date(b.collectionDate) - new Date(a.collectionDate));

      const sumOf = (st) => Math.round(checks.filter(c => c.status === st).reduce((s, c) => s + c.amount, 0) * 100) / 100;
      const onHand = checks.filter(c => c.status === 'On Hand');
      res.json({
        success: true,
        checks,
        summary: {
          onHandTotal: sumOf('On Hand'),
          onHandCount: onHand.length,
          // On-hand checks whose date has arrived: money sitting in a drawer
          // that could be in the bank today.
          readyToDepositTotal: Math.round(onHand.filter(c => !c.postDated).reduce((s, c) => s + c.amount, 0) * 100) / 100,
          readyToDepositCount: onHand.filter(c => !c.postDated).length,
          postDatedTotal: Math.round(onHand.filter(c => c.postDated).reduce((s, c) => s + c.amount, 0) * 100) / 100,
          inClearingTotal: sumOf('Deposited'),
          inClearingCount: checks.filter(c => c.status === 'Deposited').length,
          clearedTotal: sumOf('Cleared'),
          bouncedTotal: sumOf('Bounced'),
          bouncedCount: checks.filter(c => c.status === 'Bounced').length,
        },
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── DEPOSIT ──────────────────────────────────────────────────────────────
  // Records that the paper went to the bank. No journal entry: the asset is
  // still an uncleared check, it has just changed hands. This is also the
  // point where the collection finally gets a deposit date, which is what the
  // deposit-basis collection report reads.
  app.post('/api/collections/checks/:orderId/:paymentId/deposit', verifyToken, ...canActCheck, async (req, res) => {
    try {
      const found = await findCheck(req, res);
      if (!found) return;
      const { order, payment } = found;
      if ((payment.checkStatus || 'On Hand') !== 'On Hand')
        return res.status(400).json({ success: false, error: `Only a check On Hand can be deposited (currently ${payment.checkStatus}).` });

      const when = req.body?.depositDate ? new Date(req.body.depositDate) : new Date();
      if (Number.isNaN(when.getTime())) return res.status(400).json({ success: false, error: 'Invalid deposit date.' });
      // Presenting a check before the date written on it is what bounces it.
      if (payment.checkDate && dayStart(when) < dayStart(payment.checkDate))
        return res.status(400).json({ success: false, error: `Check #${payment.checkNumber} is dated ${new Date(payment.checkDate).toLocaleDateString()} and cannot be deposited before then.` });

      payment.checkStatus = 'Deposited';
      payment.checkDepositedAt = when;
      payment.depositDate = when;
      await order.save();

      try { await logAudit?.(req, { action: 'depositCheck', entity: 'Order', entityId: order.orderNumber, after: { checkNumber: payment.checkNumber, amount: payment.amount, depositedAt: when } }); } catch { /* non-fatal */ }
      res.json({ success: true, check: payment });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── CLEAR ────────────────────────────────────────────────────────────────
  // The bank honoured it: the money is finally real. Moves the amount out of
  // Checks on Hand into the account that received it.
  app.post('/api/collections/checks/:orderId/:paymentId/clear', verifyToken, ...canActCheck, async (req, res) => {
    try {
      const found = await findCheck(req, res);
      if (!found) return;
      const { order, payment } = found;
      if (!['On Hand', 'Deposited'].includes(payment.checkStatus || 'On Hand'))
        return res.status(400).json({ success: false, error: `Check is already ${payment.checkStatus}.` });

      const when = req.body?.clearedDate ? new Date(req.body.clearedDate) : new Date();
      if (Number.isNaN(when.getTime())) return res.status(400).json({ success: false, error: 'Invalid clearing date.' });

      // Where the money landed. Defaults to Cash in Bank, which is where a
      // deposited check clears unless told otherwise.
      const toAcct = accountForPaymentMethod(req.body?.clearedTo || 'Cash in Bank');
      const amt = Math.round((Number(payment.amount) || 0) * 100) / 100;
      const reference = `${payment.journalRef || mkRef('ARS', order.orderNumber)}-CLR`;

      const lines = [
        { accountCode: toAcct.code, accountName: toAcct.name, debit: amt, credit: 0 },
        { accountCode: '115000', accountName: 'Checks on Hand (Undeposited)', debit: 0, credit: amt },
      ];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: when, reference,
        description: `Check #${payment.checkNumber} cleared${payment.checkBank ? ` (${payment.checkBank})` : ''} - ${order.orderNumber}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      payment.checkStatus = 'Cleared';
      payment.checkClearedAt = when;
      payment.checkClearedTo = toAcct.name;
      if (!payment.checkDepositedAt) { payment.checkDepositedAt = when; payment.depositDate = when; }
      await order.save();

      try { await logAudit?.(req, { action: 'clearCheck', entity: 'Order', entityId: order.orderNumber, after: { checkNumber: payment.checkNumber, amount: amt, account: toAcct.code, clearedAt: when } }); } catch { /* non-fatal */ }
      emitToMgr('erpUpdated');
      res.json({ success: true, check: payment });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── BOUNCE ───────────────────────────────────────────────────────────────
  // The check was never money. This is the one that MUST be right: the
  // collection is reversed, so the invoice reopens for the amount and the
  // client goes back to owing it. Without this a bounced check silently
  // forgives a debt - the money is gone and the books say it was paid.
  app.post('/api/collections/checks/:orderId/:paymentId/bounce', verifyToken, ...canActCheck, async (req, res) => {
    try {
      const found = await findCheck(req, res);
      if (!found) return;
      const { order, payment } = found;
      if (payment.checkStatus === 'Bounced')
        return res.status(400).json({ success: false, error: 'Check is already marked bounced.' });

      const when = req.body?.bouncedDate ? new Date(req.body.bouncedDate) : new Date();
      if (Number.isNaN(when.getTime())) return res.status(400).json({ success: false, error: 'Invalid bounce date.' });
      const reason = String(req.body?.reason || '').trim().slice(0, 500);

      const amt = Math.round((Number(payment.amount) || 0) * 100) / 100;
      const reference = `${payment.journalRef || mkRef('ARS', order.orderNumber)}-BNC`;

      // Credit whichever asset currently holds the money. A check that already
      // cleared and was later reversed by the bank takes it back out of the
      // bank; one that never cleared comes out of Checks on Hand.
      const wasCleared = payment.checkStatus === 'Cleared';
      const fromAcct = wasCleared
        ? accountForPaymentMethod(payment.checkClearedTo || 'Cash in Bank')
        : { code: '115000', name: 'Checks on Hand (Undeposited)' };

      const lines = [
        { accountCode: '120000', accountName: 'Accounts Receivable', debit: amt, credit: 0 },
        { accountCode: fromAcct.code, accountName: fromAcct.name, debit: 0, credit: amt },
      ];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: when, reference,
        description: `Check #${payment.checkNumber} BOUNCED${payment.checkBank ? ` (${payment.checkBank})` : ''} - ${order.orderNumber} receivable reinstated${reason ? `: ${reason}` : ''}`,
        lines, totalDebit: amt, totalCredit: amt,
      });

      payment.checkStatus = 'Bounced';
      payment.checkBouncedAt = when;
      payment.checkBounceReason = reason;

      // Put the money back on the invoice. arPaidAmount drives every A/R view
      // (see arBalance in lib/credit.js), so this alone reopens the receivable
      // and puts it back in the ageing buckets and the collection worklist.
      const paidAfter = Math.max(0, Math.round((((Number(order.arPaidAmount) || 0)) - amt) * 100) / 100);
      order.arPaidAmount = paidAfter;
      order.arSettled = paidAfter >= (Number(order.total) || 0) - 0.01;
      await order.save();

      try {
        await logAudit?.(req, {
          action: 'bounceCheck', entity: 'Order', entityId: order.orderNumber,
          after: { checkNumber: payment.checkNumber, amount: amt, reason, reinstated: true, paidAfter, reopened: !order.arSettled },
        });
      } catch { /* non-fatal */ }

      // Managers should hear about a bounced check immediately - it is money
      // they believed they had.
      emitToMgr('mgrAlert', {
        kind: 'checkBounced', ref: order.orderNumber,
        message: `Check #${payment.checkNumber} for ₱${amt.toFixed(2)} bounced - ${order.customerName || 'client'} owes it again.`,
      });
      emitToMgr('erpUpdated');
      res.json({ success: true, check: payment, balance: arBalance(order), reopened: !order.arSettled });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });
}
