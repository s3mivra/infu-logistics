// Moving onto the system with books already kept elsewhere.
//
// The setup workbook carries a business's existing accounts in, in five sheets:
//
//   Chart of Accounts   their own account codes and names, each placed under
//                       one of ours, so their sheets can keep using their codes
//   P&L History         this year's income statement, month by month, so the
//                       monthly reports start with real figures
//   Opening Balances    the balance sheet on the day they switch over
//   Open Receivables    each customer invoice still unpaid on that day
//   Open Payables       each supplier bill still unpaid on that day
//
// The balance sheet is the only thing that posts balances. The open invoices
// and bills are the detail BEHIND the Accounts Receivable and Payable figures
// on it - they are registered so they can be collected and paid, but they do
// not post again, or those balances would double. Books Health then compares
// each register with its account.
//
// How the P&L and the balance sheet meet: each P&L month posts its accounts
// against Owner's Capital. The balance sheet, carried in without its "net
// income" line (the P&L months now produce that figure), is short by exactly
// the year's profit, and that shortfall is plugged back to Owner's Capital.
// When the two statements agree, Owner's Capital nets to nothing - so what is
// left there is the difference between them, and the response says how much.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import {
  parseAmount, isPnlType, buildOpeningEntry, buildPnlMonthEntry, monthEnd, readMonths,
} from '../lib/setupBooks.js';
import { OPENING_AR_STATUS } from '../lib/credit.js';

const PAYMENT_PARENTS = new Set(['111000', '112000', '113000', '115000', '120000', '220000']);
// Accounts the system itself posts through: sales on account and collections
// (120000), stock (130000), supplier bills (220000). A balance carried into a
// sub-account of one of these would never move - a collection credits 120000,
// not the sub-account - so an old account mapped here IS the control account.
const CONTROL_CODES = new Set(['120000', '130000', '220000']);
const ALIAS_KEY = 'accountAliases';        // Settings: [{ from: their code, to: our code }]
const EARNINGS_CODE = '340000';            // Current Year Earnings
const MAX_ROWS = 2000;

export default function registerSetupImport(ctx) {
  const {
    app, mongoose, IS_PROD, BUSINESS_TYPE, tenantScope, logAudit, emitToMgr, emitToAll,
    ACCOUNTS, Account, JournalEntry, Order, Bill, Supplier, ClientAccount, Settings,
    acctMeta, refreshCustomMeta, normalBalanceForCode, assertBalanced, mkSeqRef, periodLockFor,
    verifyToken, requireStaff, requirePermission,
  } = ctx;

  const canPost = [requireStaff, requirePermission('accounting.manage')];
  const fail = (req, res, err) => (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
  const text = (v) => String(v ?? '').trim();
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const rowsOf = (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) { res.status(400).json({ success: false, error: 'No rows to import.' }); return null; }
    if (rows.length > MAX_ROWS) { res.status(400).json({ success: false, error: `Too many rows (${rows.length}) - at most ${MAX_ROWS} at a time.` }); return null; }
    return rows;
  };
  const closed = async (date) => {
    const lock = await periodLockFor(date);
    return lock ? `${lock.year}-${String(lock.month).padStart(2, '0')} is a closed period. Reopen it first.` : null;
  };
  // A date cell: a YYYY-MM-DD string (the client sends dates that way) or blank.
  const dateOf = (v) => {
    const s = text(v);
    if (!s) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? dayStart(s) : new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  // Their code, or ours -> our code. Theirs are matched without regard to case
  // or surrounding spaces, the way a person retyping one would expect.
  const loadAliases = async () => (await Settings.findOne({ key: ALIAS_KEY }).lean())?.value || [];
  const codeResolver = async () => {
    const external = await Account.find({ externalCode: { $ne: null } }, { code: 1, externalCode: 1 }).lean();
    const byExternal = new Map(external.map(a => [String(a.externalCode).trim().toLowerCase(), a.code]));
    for (const a of await loadAliases()) byExternal.set(String(a.from).trim().toLowerCase(), a.to);
    return (raw) => {
      const c = text(raw);
      if (!c) return null;
      if (acctMeta(c)) return c;
      return byExternal.get(c.toLowerCase()) || null;
    };
  };
  const rollsUpTo = (code, target) => {
    for (let c = code, guard = 0; c && guard < 10; guard++) {
      if (c === target) return true;
      c = acctMeta(c)?.parent;
    }
    return false;
  };

  // ── CHART OF ACCOUNTS ──────────────────────────────────────────────────────
  // Each of their accounts becomes a sub-account of ours, named as they name it
  // and remembering their code. Re-importing the same sheet is harmless: an
  // account already carried in is left as it is.
  app.post('/api/setup/accounts/import', verifyToken, ...canPost, async (req, res) => {
    try {
      const rows = rowsOf(req, res); if (!rows) return;
      const canonicalByName = new Map(Object.entries(ACCOUNTS).map(([code, a]) => [a.name.toLowerCase(), code]));
      const existing = await Account.find({ externalCode: { $ne: null } }).lean();
      const byExternal = new Map(existing.map(a => [String(a.externalCode).trim().toLowerCase(), a]));
      const aliases = await loadAliases();
      const aliasOf = new Map(aliases.map(a => [String(a.from).trim().toLowerCase(), a.to]));
      const forcedSame = [];
      const taken = new Set([...Object.keys(ACCOUNTS), ...(await Account.find({}, { code: 1 }).lean()).map(a => a.code)]);
      const nextFree = (parent) => {
        const base = String(parent).slice(0, 3);
        for (let i = 1; i <= 999; i++) {
          const cand = base + String(i).padStart(3, '0');
          if (!taken.has(cand)) return cand;
        }
        return null;
      };

      const created = [], kept = [], skipped = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          const yourCode = text(r.code);
          const name = text(r.name);
          const under = text(r.goesUnder);
          if (!yourCode) throw new Error('Your account code is required.');
          if (!name) throw new Error('The account name is required.');
          if (acctMeta(yourCode)) throw new Error(`${yourCode} is already one of the system's own codes - use it directly, no row needed.`);
          const parent = ACCOUNTS[under] ? under : canonicalByName.get(under.toLowerCase());
          if (!parent) throw new Error(`"${under || '(blank)'}" is not one of the system's accounts. Give its code or name from the Accounts sheet.`);
          const already = byExternal.get(yourCode.toLowerCase()) || (aliasOf.has(yourCode.toLowerCase()) && { code: aliasOf.get(yourCode.toLowerCase()) });
          if (already) { kept.push({ row: i + 1, yourCode, code: already.code }); continue; }

          // "No" to keeping it separate: their code simply names our account.
          const wantsSeparate = !/^(no|n|false|0|same)$/i.test(text(r.keepSeparate));
          if (!wantsSeparate || CONTROL_CODES.has(parent)) {
            if (ACCOUNTS[parent].isParent) throw new Error(`${ACCOUNTS[parent].name} is a heading, not an account - it can only hold sub-accounts. Set keepSeparate to Yes, or pick an account under it.`);
            if (wantsSeparate) forcedSame.push(`${yourCode} → ${parent} ${ACCOUNTS[parent].name}`);
            aliases.push({ from: yourCode, to: parent });
            aliasOf.set(yourCode.toLowerCase(), parent);
            created.push({ row: i + 1, yourCode, code: parent, name: ACCOUNTS[parent].name, parent, parentName: ACCOUNTS[parent].name, same: true });
            continue;
          }
          const code = nextFree(parent);
          if (!code) throw new Error(`No free code left under ${parent}.`);
          const acct = await Account.create({
            code, name, type: ACCOUNTS[parent].type, parent, custom: true,
            normalBalance: normalBalanceForCode(code), externalCode: yourCode,
            // Under cash, bank, receivable or payable an account would otherwise
            // appear as a way to pay at the till. A bank account carried in from
            // the old books is not a tender until someone decides it is.
            isActive: !PAYMENT_PARENTS.has(parent),
          });
          taken.add(code);
          byExternal.set(yourCode.toLowerCase(), acct);
          created.push({ row: i + 1, yourCode, code, name, parent, parentName: ACCOUNTS[parent].name });
        } catch (e) {
          skipped.push({ row: i + 1, error: e.message });
        }
      }
      await Settings.findOneAndUpdate({ key: ALIAS_KEY }, { key: ALIAS_KEY, value: aliases }, { upsert: true });
      await refreshCustomMeta();
      emitToAll('paymentMethodsUpdated');
      await logAudit(req, { action: 'import', entity: 'Account', entityId: 'setup', after: { created: created.length, kept: kept.length, skipped: skipped.length } });
      const notes = [];
      if (kept.length) notes.push(`${kept.length} account(s) were already carried in and left as they are.`);
      if (forcedSame.length) notes.push(`Posted straight to the system's own account, because the system's sales, collections, stock and bills run through it: ${forcedSame.join('; ')}.`);
      res.json({ success: true, created: created.length, accounts: created, skipped, note: notes.join(' ') });
    } catch (err) { fail(req, res, err); }
  });

  // ── P&L HISTORY ────────────────────────────────────────────────────────────
  // One entry per month, dated its last day. All or nothing: a sheet with one
  // unknown account posts no month at all, so a fixed sheet can simply be
  // imported again.
  app.post('/api/setup/pnl-history/import', verifyToken, ...canPost, async (req, res) => {
    try {
      const rows = rowsOf(req, res); if (!rows) return;
      const resolve = await codeResolver();
      const problems = [];
      const byMonth = new Map();           // 'YYYY-MM' -> Map(code -> amount)
      rows.forEach((r, i) => {
        const raw = text(r.code);
        const { months, bad } = readMonths(r);
        if (!raw && !Object.keys(months).length) return;       // an empty or heading row
        const code = resolve(raw);
        const meta = code && acctMeta(code);
        if (!meta) { problems.push(`Row ${i + 1}: "${raw || '(no code)'}" is not an account - add it to the Chart of Accounts sheet.`); return; }
        if (!isPnlType(meta.type)) { problems.push(`Row ${i + 1}: ${raw} ${meta.name} is a ${meta.type} account - it belongs on the Opening Balances sheet.`); return; }
        bad.forEach(b => problems.push(`Row ${i + 1}: ${b} is not an amount.`));
        const year = parseInt(text(r.year), 10);
        if (!(year >= 1990 && year <= 2100)) { problems.push(`Row ${i + 1}: give the year the figures are for (e.g. 2026).`); return; }
        for (const [m, amount] of Object.entries(months)) {
          const ym = `${year}-${String(m).padStart(2, '0')}`;
          if (!byMonth.has(ym)) byMonth.set(ym, new Map());
          const acc = byMonth.get(ym);
          acc.set(code, r2((acc.get(code) || 0) + amount));
        }
      });
      if (problems.length) return res.status(400).json({ success: false, error: `Nothing was posted. ${problems.length} problem(s) to fix first.`, problems: problems.slice(0, 50) });
      if (!byMonth.size) return res.status(400).json({ success: false, error: 'Every amount was blank or zero - nothing to carry in.' });

      const months = [...byMonth.keys()].sort();
      const force = req.body?.force === true;
      for (const ym of months) {
        const [y, m] = ym.split('-').map(Number);
        const lock = await closed(dayEnd(monthEnd(y, m)));
        if (lock) return res.status(423).json({ success: false, error: `Nothing was posted. ${lock}` });
        const posted = await JournalEntry.exists({ reference: /^PNLH-/, description: new RegExp(`^P&L history ${ym}\\b`) });
        if (posted && !force) {
          return res.status(409).json({ success: false, error: `Nothing was posted. The P&L for ${ym} was already carried in - importing it again would double that month.`, alreadyPosted: ym });
        }
      }

      const result = [];
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          result.length = 0;
          for (const ym of months) {
            const [y, m] = ym.split('-').map(Number);
            const entry = buildPnlMonthEntry([...byMonth.get(ym)].map(([accountCode, amount]) => ({ accountCode, amount })), acctMeta);
            if (!entry) continue;
            const reference = await mkSeqRef('PNLH');
            assertBalanced(entry.jeLines, reference);
            await JournalEntry.create([{
              date: dayEnd(monthEnd(y, m)), reference,
              description: `P&L history ${ym} - carried in from the previous books`,
              lines: entry.jeLines, totalDebit: entry.totalDebit, totalCredit: entry.totalCredit,
            }], { session });
            result.push({ month: ym, reference, netRevenue: entry.revenue, expenses: entry.expenses, netIncome: entry.netIncome });
          }
        });
      } finally { session.endSession(); }

      const netIncome = r2(result.reduce((s, x) => s + x.netIncome, 0));
      await logAudit(req, { action: 'import', entity: 'JournalEntry', entityId: 'pnl-history', after: { months: result.length, netIncome } });
      emitToMgr('erpUpdated');
      res.json({
        success: true, created: result.length, months: result, netIncome,
        note: `${result.length} month(s) posted. Net income carried in: ₱${netIncome.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`,
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── OPENING BALANCES ───────────────────────────────────────────────────────
  // The balance sheet on the switch-over day, as one entry. With the P&L
  // history carried in too (`pnlHistory: true`), a "net income" line - any
  // account under Current Year Earnings - is left out, because the P&L months
  // already produce it; the response compares the two.
  app.post('/api/setup/opening-balances/import', verifyToken, ...canPost, async (req, res) => {
    try {
      const rows = rowsOf(req, res); if (!rows) return;
      const resolve = await codeResolver();
      const problems = [];
      const lines = [];
      let asOf = null, earningsLeftOut = 0;
      rows.forEach((r, i) => {
        const raw = text(r.code);
        const amount = parseAmount(r.balance);
        if (!raw && !amount) return;
        if (Number.isNaN(amount)) { problems.push(`Row ${i + 1}: "${r.balance}" is not an amount.`); return; }
        if (!amount) return;
        const code = resolve(raw);
        if (!code) { problems.push(`Row ${i + 1}: "${raw || '(no code)'}" is not an account - add it to the Chart of Accounts sheet.`); return; }
        const d = dateOf(r.asOf);
        if (d === undefined) { problems.push(`Row ${i + 1}: "${r.asOf}" is not a date.`); return; }
        if (d) {
          if (asOf && asOf.getTime() !== d.getTime()) { problems.push(`Row ${i + 1}: every row must be as of the same date.`); return; }
          asOf = d;
        }
        if (req.body?.pnlHistory === true && rollsUpTo(code, EARNINGS_CODE)) { earningsLeftOut = r2(earningsLeftOut + amount); return; }
        lines.push({ accountCode: code, amount });
      });
      if (problems.length) return res.status(400).json({ success: false, error: `Nothing was posted. ${problems.length} problem(s) to fix first.`, problems: problems.slice(0, 50) });
      if (!asOf) return res.status(400).json({ success: false, error: 'Nothing was posted. Give the date these balances are as of (the As Of column) - usually the last day before you switch over.' });

      const built = buildOpeningEntry(lines, acctMeta);
      if (built.error) return res.status(400).json({ success: false, error: `Nothing was posted. ${built.error}` });
      const existing = await JournalEntry.findOne({ reference: /^OPEN-/ }).lean();
      if (existing && req.body?.force !== true) {
        return res.status(409).json({ success: false, error: `Nothing was posted. Opening balances were already carried in (${existing.reference}) - importing them again would double every balance.` });
      }
      const lock = await closed(dayEnd(asOf.toISOString().slice(0, 10)));
      if (lock) return res.status(423).json({ success: false, error: `Nothing was posted. ${lock}` });

      const reference = await mkSeqRef('OPEN');
      assertBalanced(built.jeLines, reference);
      await JournalEntry.create({
        date: asOf, reference,
        description: 'Opening balances - carried in from the previous books (setup workbook)',
        lines: built.jeLines, totalDebit: built.totalDebit, totalCredit: built.totalCredit,
      });
      await logAudit(req, { action: 'create', entity: 'JournalEntry', entityId: reference, after: { openingBalance: true, lines: built.jeLines.length, plug: built.plug } });
      emitToMgr('erpUpdated');
      res.json({
        success: true, created: built.jeLines.length, reference,
        asOf: asOf.toISOString().slice(0, 10),
        // The balance sheet's own view of the year's profit, and what was
        // plugged to make the entry balance. With P&L history these two should
        // be the same number; the client says so, or says by how much not.
        earningsOnBalanceSheet: earningsLeftOut,
        balancingToCapital: built.plug,
        // The control balances the open-item sheets must add up to.
        controls: Object.fromEntries([['receivables', '120000'], ['payables', '220000'], ['inventory', '130000']].map(([k, code]) => {
          const l = built.jeLines.find(x => x.accountCode === code);
          return [k, l ? r2(code === '220000' ? l.credit - l.debit : l.debit - l.credit) : 0];
        })),
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── OPEN RECEIVABLES ───────────────────────────────────────────────────────
  // Each unpaid customer invoice becomes a receivable that AR & AP lists, ages
  // and collects - with no posting, since Accounts Receivable on the opening
  // balance sheet already holds it. Kept apart from sales by its status.
  app.post('/api/setup/open-receivables/import', verifyToken, ...canPost, async (req, res) => {
    try {
      const rows = rowsOf(req, res); if (!rows) return;
      const clients = await ClientAccount.find(tenantScope(req), { name: 1 }).lean();
      const clientByName = new Map(clients.map(c => [String(c.name || '').trim().toLowerCase(), c]));
      const created = [], skipped = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          const customer = text(r.customer);
          const invoiceNo = text(r.invoiceNo);
          const amount = r2(parseAmount(r.amountOwed));
          if (!customer) throw new Error('Customer is required.');
          if (!invoiceNo) throw new Error('The invoice number is required - it is how the payment will be matched to it.');
          if (!(amount > 0)) throw new Error('Amount still owed must be more than zero.');
          const invoiceDate = dateOf(r.invoiceDate);
          if (!invoiceDate) throw new Error('Invoice date is required (YYYY-MM-DD) - it is what ages the debt.');
          const dueDate = dateOf(r.dueDate);
          if (dueDate === undefined) throw new Error(`"${r.dueDate}" is not a date.`);
          if (await Order.exists({ orderNumber: invoiceNo })) throw new Error(`${invoiceNo} is already in the system - it was carried in before, or an order has that number.`);
          const client = clientByName.get(customer.toLowerCase());
          await Order.create({
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            orderNumber: invoiceNo, table: 'Opening balance', customerName: client?.name || customer,
            ...(client ? { clientAccountId: String(client._id) } : {}),
            items: [], subtotal: amount, total: amount,
            status: OPENING_AR_STATUS, paymentMethod: 'Credit',
            isArchived: true, arSettled: false, arDueDate: dueDate || null,
            cashierName: req.user?.name || 'Setup import',
            createdAt: invoiceDate,
          });
          created.push({ row: i + 1, invoiceNo, customer: client?.name || customer, amount, matchedClient: !!client });
        } catch (e) {
          skipped.push({ row: i + 1, error: e.message });
        }
      }
      const total = r2(created.reduce((s, x) => s + x.amount, 0));
      await logAudit(req, { action: 'import', entity: 'Order', entityId: 'open-receivables', after: { created: created.length, skipped: skipped.length, total } });
      emitToMgr('erpUpdated');
      const unmatched = created.filter(x => !x.matchedClient).length;
      res.json({
        success: true, created: created.length, receivables: created, skipped, total,
        note: `₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })} owed by customers, ready to collect in AR & AP. Nothing posted - the opening Accounts Receivable already holds it.`
          + (unmatched ? ` ${unmatched} invoice(s) are for a name with no client account.` : ''),
      });
    } catch (err) { fail(req, res, err); }
  });

  // ── OPEN PAYABLES ──────────────────────────────────────────────────────────
  // Each unpaid supplier bill, Approved and ready to pay - with no posting,
  // since Accounts Payable on the opening balance sheet already holds it.
  app.post('/api/setup/open-payables/import', verifyToken, ...canPost, async (req, res) => {
    try {
      const rows = rowsOf(req, res); if (!rows) return;
      const suppliers = await Supplier.find(tenantScope(req), { name: 1 }).lean();
      const byName = new Map(suppliers.map(s => [String(s.name || '').trim().toLowerCase(), s]));
      const created = [], skipped = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          const supplierName = text(r.supplier);
          const invoiceNo = text(r.invoiceNo);
          const amount = r2(parseAmount(r.amountOwed));
          if (!supplierName) throw new Error('Supplier is required.');
          const supplier = byName.get(supplierName.toLowerCase());
          if (!supplier) throw new Error(`No supplier named "${supplierName}" - add them on the Suppliers sheet.`);
          if (!invoiceNo) throw new Error("The supplier's invoice number is required - it is what they will quote when chasing it.");
          if (!(amount > 0)) throw new Error('Amount still owed must be more than zero.');
          const billDate = dateOf(r.invoiceDate);
          if (billDate === undefined) throw new Error(`"${r.invoiceDate}" is not a date.`);
          const dueDate = dateOf(r.dueDate);
          if (dueDate === undefined) throw new Error(`"${r.dueDate}" is not a date.`);
          if (await Bill.exists({ supplierId: supplier._id, supplierInvoiceNo: invoiceNo })) throw new Error(`${supplier.name}'s ${invoiceNo} was already carried in.`);
          const billNumber = await mkSeqRef('BILL');
          await Bill.create({
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            billNumber, supplierId: supplier._id, supplierName: supplier.name,
            source: 'Opening', supplierInvoiceNo: invoiceNo,
            description: text(r.description) || `Unpaid at switch-over - invoice ${invoiceNo}`,
            amount, status: 'Approved', dueDate: dueDate || null,
            approvedBy: req.user?.name || '', approvedAt: new Date(),
            createdBy: req.user?.name || '',
            ...(billDate ? { createdAt: billDate } : {}),
          });
          created.push({ row: i + 1, billNumber, supplier: supplier.name, invoiceNo, amount });
        } catch (e) {
          skipped.push({ row: i + 1, error: e.message });
        }
      }
      const total = r2(created.reduce((s, x) => s + x.amount, 0));
      await logAudit(req, { action: 'import', entity: 'Bill', entityId: 'open-payables', after: { created: created.length, skipped: skipped.length, total } });
      emitToMgr('erpUpdated');
      res.json({
        success: true, created: created.length, bills: created, skipped, total,
        note: `₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })} owed to suppliers, Approved and ready to pay in Bills (AP). Nothing posted - the opening Accounts Payable already holds it.`,
      });
    } catch (err) { fail(req, res, err); }
  });
}
