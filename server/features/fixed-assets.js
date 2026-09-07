// Fixed assets: acquire, depreciate, dispose.
//
// Every route posts a balanced entry, so the register and the ledger cannot
// disagree - the register is a view of the same postings, never a parallel
// list maintained by hand.
//
//   acquire      DR 1401xx asset            CR cash / payable
//   depreciate   DR 690000 Dep. Expense     CR 1501xx accumulated depreciation
//   dispose      DR cash + DR accumulated   CR asset  (+/- gain or loss)
//
// Cost and accumulated depreciation are deliberately kept in separate accounts.
// Netting them loses the difference between "a P60,000 machine that is half
// worn out" and "a P30,000 machine", which are not the same fact.
import { captureError } from '../lib/errorLog.js';
import { dayStart, dayEnd } from '../lib/reportRange.js';
import {
  depreciationDue, applyDepreciation, netBookValue, depreciableBase,
  disposalResult, schedule, monthlyDepreciation,
} from '../lib/depreciation.js';

export default function registerFixedAssets(ctx) {
  const {
    app, mongoose, IS_PROD, log, BUSINESS_TYPE, tenantScope, logAudit,
    FixedAsset, FIXED_ASSET_CLASSES, JournalEntry,
    assertBalanced, acctMeta, mkSeqRef, currentBranchCode,
    verifyToken, requireStaff, requirePermission,
  } = ctx;

  const canView = [requireStaff, requirePermission('accounting.view')];
  const canPost = [requireStaff, requirePermission('accounting.manage')];

  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const isCashLike = (c) => /^(111|112|113|114)/.test(String(c || ''));
  const nameOf = (code, fallback) => acctMeta(code)?.name || fallback || code;

  // A view of the asset with the derived figures the UI needs, so the client
  // never re-implements the depreciation arithmetic.
  const decorate = (a, asOf = new Date()) => ({
    ...a,
    netBookValue: netBookValue(a),
    depreciableBase: depreciableBase(a),
    monthlyDepreciation: monthlyDepreciation(a),
    due: depreciationDue(a, asOf),
    className: FIXED_ASSET_CLASSES[a.accountCode]?.name || nameOf(a.accountCode),
  });

  // ── CLASSES ───────────────────────────────────────────────────────────────
  app.get('/api/fixed-assets/classes', verifyToken, ...canView, async (req, res) => {
    res.json({
      success: true,
      classes: Object.entries(FIXED_ASSET_CLASSES).map(([code, c]) => ({
        code, name: c.name, accumCode: c.accum, accumName: nameOf(c.accum),
      })),
    });
  });

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get('/api/fixed-assets', verifyToken, ...canView, async (req, res) => {
    try {
      const q = { businessType: BUSINESS_TYPE, ...tenantScope(req) };
      if (req.query.status) q.status = req.query.status;
      if (req.query.accountCode) q.accountCode = req.query.accountCode;
      if (req.query.start || req.query.end) {
        q.acquisitionDate = {};
        if (req.query.start) q.acquisitionDate.$gte = dayStart(req.query.start);
        if (req.query.end) q.acquisitionDate.$lte = dayEnd(req.query.end);
      }
      const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 500));
      const rows = (await FixedAsset.find(q).sort({ acquisitionDate: -1 }).limit(limit).lean())
        .map(a => decorate(a));

      // Disposed assets are excluded from the totals: they are history, not
      // part of what the business currently owns.
      const live = rows.filter(a => a.status !== 'Disposed');
      res.json({
        success: true,
        assets: rows,
        totals: {
          count: live.length,
          cost: money(live.reduce((s, a) => s + (a.acquisitionCost || 0), 0)),
          accumulatedDepreciation: money(live.reduce((s, a) => s + (a.accumulatedDepreciation || 0), 0)),
          netBookValue: money(live.reduce((s, a) => s + a.netBookValue, 0)),
          dueNow: money(live.reduce((s, a) => s + a.due.amount, 0)),
        },
      });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  app.get('/api/fixed-assets/:id', verifyToken, ...canView, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const a = await FixedAsset.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!a) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, asset: decorate(a), schedule: schedule(a, 24) });
    } catch (err) { (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message })); }
  });

  // ── ACQUIRE ───────────────────────────────────────────────────────────────
  app.post('/api/fixed-assets', verifyToken, ...canPost, async (req, res) => {
    try {
      const {
        name, accountCode, acquisitionCost, acquisitionDate, salvageValue,
        usefulLifeMonths, paidFromAccount, description, serialNumber,
        location, supplierName, referenceNumber, onAccount,
      } = req.body || {};

      if (!String(name || '').trim()) return res.status(400).json({ success: false, error: 'An asset name is required.' });
      if (!FIXED_ASSET_CLASSES[accountCode]) {
        return res.status(400).json({ success: false, error: `accountCode must be one of: ${Object.keys(FIXED_ASSET_CLASSES).join(', ')}.` });
      }
      const cost = money(acquisitionCost);
      if (!cost || cost <= 0) return res.status(400).json({ success: false, error: 'Acquisition cost must be positive.' });
      const salvage = Math.max(0, money(salvageValue));
      if (salvage > cost) return res.status(400).json({ success: false, error: 'Salvage value cannot exceed the acquisition cost.' });
      const life = parseInt(usefulLifeMonths, 10);
      if (!Number.isFinite(life) || life <= 0) return res.status(400).json({ success: false, error: 'Useful life must be a positive number of months.' });

      const acqDate = acquisitionDate ? dayStart(acquisitionDate) : new Date();
      // Bought on credit, the other side is a payable rather than cash.
      const credCode = onAccount ? '220000'
        : (acctMeta(paidFromAccount) && isCashLike(paidFromAccount)) ? paidFromAccount : '111000';

      const assetCode = await mkSeqRef('FA');
      const reference = await mkSeqRef('FA-ACQ');
      const lines = [
        { accountCode, accountName: nameOf(accountCode), debit: cost, credit: 0 },
        { accountCode: credCode, accountName: nameOf(credCode), debit: 0, credit: cost },
      ];
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: acqDate, reference,
        description: `Acquired fixed asset ${assetCode} - ${name}${referenceNumber ? ` [ref: ${referenceNumber}]` : ''}`,
        lines, totalDebit: cost, totalCredit: cost,
      });

      const asset = await FixedAsset.create({
        businessType: BUSINESS_TYPE, ...tenantScope(req),
        assetCode, branchCode: await currentBranchCode(),
        name: String(name).trim(), description: description || '',
        accountCode, acquisitionDate: acqDate, acquisitionCost: cost,
        salvageValue: salvage, usefulLifeMonths: life,
        serialNumber: serialNumber || '', location: location || '',
        supplierName: supplierName || '', referenceNumber: referenceNumber || '',
        journalEntryRef: reference, createdBy: req.user?.name || '',
      });

      await logAudit(req, { action: 'create', entity: 'FixedAsset', entityId: asset._id, after: { assetCode, name, cost } });
      res.json({ success: true, asset: decorate(asset.toObject()) });
    } catch (err) {
      log.error?.({ err }, 'POST /api/fixed-assets failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── DEPRECIATE ────────────────────────────────────────────────────────────
  // Posts whatever whole months are owed, capped at the remaining depreciable
  // value. Catching up several missed months in one entry is normal and safe;
  // what must never happen is writing an asset below its salvage value.
  const depreciateOne = async (asset, asOf, req) => {
    const due = depreciationDue(asset, asOf);
    if (due.amount <= 0) return { posted: false, due };

    const accumCode = FIXED_ASSET_CLASSES[asset.accountCode]?.accum;
    if (!accumCode) return { posted: false, due, error: 'No accumulated-depreciation account for this asset class.' };

    const reference = await mkSeqRef('FA-DEP');
    const lines = [
      { accountCode: '690000', accountName: nameOf('690000', 'Depreciation Expense'), debit: due.amount, credit: 0 },
      { accountCode: accumCode, accountName: nameOf(accumCode), debit: 0, credit: due.amount },
    ];
    assertBalanced(lines, reference);
    await JournalEntry.create({
      date: asOf, reference,
      description: `Depreciation for ${asset.assetCode} - ${asset.name} (${due.months} month${due.months === 1 ? '' : 's'})${due.capped ? ' - final charge, capped at remaining value' : ''}`,
      lines, totalDebit: due.amount, totalCredit: due.amount,
    });

    const next = applyDepreciation(asset, due.amount, asOf);
    await FixedAsset.updateOne({ _id: asset._id }, {
      $set: {
        accumulatedDepreciation: next.accumulatedDepreciation,
        lastDepreciationDate: next.lastDepreciationDate,
        status: next.status,
      },
      $push: {
        depreciationHistory: {
          amount: due.amount, months: due.months, throughDate: asOf,
          journalRef: reference, by: req.user?.name || '',
        },
      },
    });
    return { posted: true, due, reference, status: next.status };
  };

  app.post('/api/fixed-assets/:id/depreciate', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const asset = await FixedAsset.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!asset) return res.status(404).json({ success: false, error: 'Not found' });
      if (asset.status === 'Disposed') return res.status(409).json({ success: false, error: 'This asset has been disposed of.' });

      const asOf = req.body?.asOf ? dayEnd(req.body.asOf) : new Date();
      const out = await depreciateOne(asset, asOf, req);
      if (!out.posted) {
        return res.status(409).json({ success: false, error: out.error || 'Nothing is due yet - depreciation is charged in whole months.', due: out.due });
      }
      const fresh = await FixedAsset.findById(asset._id).lean();
      res.json({ success: true, posted: out.due.amount, months: out.due.months, capped: out.due.capped, asset: decorate(fresh) });
    } catch (err) {
      log.error?.({ err }, 'POST /api/fixed-assets/:id/depreciate failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // Run every asset that has whole months owed - the month-end job.
  app.post('/api/fixed-assets/run-depreciation', verifyToken, ...canPost, async (req, res) => {
    try {
      const asOf = req.body?.asOf ? dayEnd(req.body.asOf) : new Date();
      const assets = await FixedAsset.find({
        businessType: BUSINESS_TYPE, ...tenantScope(req), status: { $ne: 'Disposed' },
      }).lean();

      const results = [];
      let total = 0;
      for (const a of assets) {
        const out = await depreciateOne(a, asOf, req);
        if (out.posted) {
          total += out.due.amount;
          results.push({ assetCode: a.assetCode, name: a.name, amount: out.due.amount, months: out.due.months, status: out.status });
        }
      }
      await logAudit(req, { action: 'update', entity: 'FixedAsset', entityId: 'run-depreciation', after: { asOf, count: results.length, total } });
      res.json({ success: true, posted: results.length, totalAmount: money(total), skipped: assets.length - results.length, results });
    } catch (err) {
      log.error?.({ err }, 'POST /api/fixed-assets/run-depreciation failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── DISPOSE ───────────────────────────────────────────────────────────────
  // Removes the asset AND its accumulated depreciation from the books, and
  // books the difference against proceeds as a gain or a loss. Leaving the
  // contra behind would understate assets forever.
  app.post('/api/fixed-assets/:id/dispose', verifyToken, ...canPost, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
      const asset = await FixedAsset.findOne({ _id: req.params.id, businessType: BUSINESS_TYPE, ...tenantScope(req) }).lean();
      if (!asset) return res.status(404).json({ success: false, error: 'Not found' });
      if (asset.status === 'Disposed') return res.status(409).json({ success: false, error: 'This asset has already been disposed of.' });

      const { proceeds, receivedInAccount, note } = req.body || {};
      const got = Math.max(0, money(proceeds));
      const cashCode = (acctMeta(receivedInAccount) && isCashLike(receivedInAccount)) ? receivedInAccount : '111000';
      const accumCode = FIXED_ASSET_CLASSES[asset.accountCode]?.accum;
      const result = disposalResult(asset, got);

      const reference = await mkSeqRef('FA-DIS');
      const lines = [];
      if (got > 0) lines.push({ accountCode: cashCode, accountName: nameOf(cashCode), debit: got, credit: 0 });
      if ((asset.accumulatedDepreciation || 0) > 0) {
        lines.push({ accountCode: accumCode, accountName: nameOf(accumCode), debit: money(asset.accumulatedDepreciation), credit: 0 });
      }
      if (result.loss > 0) lines.push({ accountCode: '920000', accountName: nameOf('920000', 'Loss on Asset Disposal'), debit: result.loss, credit: 0 });
      lines.push({ accountCode: asset.accountCode, accountName: nameOf(asset.accountCode), debit: 0, credit: money(asset.acquisitionCost) });
      if (result.gain > 0) lines.push({ accountCode: '820000', accountName: nameOf('820000', 'Gain on Asset Disposal'), debit: 0, credit: result.gain });

      const totalDebit = money(lines.reduce((s, l) => s + (l.debit || 0), 0));
      const totalCredit = money(lines.reduce((s, l) => s + (l.credit || 0), 0));
      assertBalanced(lines, reference);
      await JournalEntry.create({
        date: new Date(), reference,
        description: `Disposal of ${asset.assetCode} - ${asset.name}${result.gain ? ` (gain ${result.gain})` : result.loss ? ` (loss ${result.loss})` : ''}${note ? ` - ${note}` : ''}`,
        lines, totalDebit, totalCredit,
      });

      await FixedAsset.updateOne({ _id: asset._id }, {
        $set: {
          status: 'Disposed', disposedAt: new Date(), disposalProceeds: got,
          disposalNote: note || '', disposalJournalRef: reference,
        },
      });

      await logAudit(req, { action: 'update', entity: 'FixedAsset', entityId: asset._id, after: { assetCode: asset.assetCode, disposed: true, proceeds: got, ...result } });
      res.json({ success: true, ...result, reference });
    } catch (err) {
      log.error?.({ err }, 'POST /api/fixed-assets/:id/dispose failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });

  // ── IMPORT ────────────────────────────────────────────────────────────────
  // Bulk onboarding from the downloaded template. Each row posts its own
  // acquisition entry, and a row that fails is reported rather than aborting
  // the batch - a hundred-row sheet with one bad date should import ninety-nine.
  app.post('/api/fixed-assets/import', verifyToken, ...canPost, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) return res.status(400).json({ success: false, error: 'No rows to import.' });

      const byName = new Map(Object.entries(FIXED_ASSET_CLASSES).map(([code, c]) => [c.name.toLowerCase(), code]));
      const created = [];
      const skipped = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          // The template's Class column accepts either the code or its name,
          // because a person filling a spreadsheet will reach for the name.
          const code = FIXED_ASSET_CLASSES[String(r.accountCode || r.class || '').trim()]
            ? String(r.accountCode || r.class).trim()
            : byName.get(String(r.class || r.accountCode || '').trim().toLowerCase());
          if (!code) throw new Error(`Unknown asset class "${r.class || r.accountCode || ''}".`);

          const cost = money(r.acquisitionCost ?? r.cost);
          if (!cost || cost <= 0) throw new Error('Acquisition cost must be positive.');
          const life = parseInt(r.usefulLifeMonths ?? r.life, 10);
          if (!Number.isFinite(life) || life <= 0) throw new Error('Useful life (months) must be a positive number.');
          const salvage = Math.max(0, money(r.salvageValue ?? r.salvage));
          if (salvage > cost) throw new Error('Salvage value cannot exceed cost.');
          if (!String(r.name || '').trim()) throw new Error('Name is required.');

          const acqDate = r.acquisitionDate ? dayStart(r.acquisitionDate) : new Date();
          if (Number.isNaN(acqDate.getTime())) throw new Error('Invalid acquisition date.');

          const assetCode = await mkSeqRef('FA');
          const reference = await mkSeqRef('FA-ACQ');
          const credCode = '111000';
          const lines = [
            { accountCode: code, accountName: nameOf(code), debit: cost, credit: 0 },
            { accountCode: credCode, accountName: nameOf(credCode), debit: 0, credit: cost },
          ];
          assertBalanced(lines, reference);
          await JournalEntry.create({
            date: acqDate, reference,
            description: `Acquired fixed asset ${assetCode} - ${String(r.name).trim()} (imported)`,
            lines, totalDebit: cost, totalCredit: cost,
          });

          const asset = await FixedAsset.create({
            businessType: BUSINESS_TYPE, ...tenantScope(req),
            assetCode, branchCode: await currentBranchCode(),
            name: String(r.name).trim(), description: r.description || '',
            accountCode: code, acquisitionDate: acqDate, acquisitionCost: cost,
            salvageValue: salvage, usefulLifeMonths: life,
            // An asset already part-worn when it is carried in keeps its
            // accumulated depreciation, or every imported asset would look
            // brand new and the balance sheet would overstate what is owned.
            accumulatedDepreciation: Math.min(money(r.accumulatedDepreciation ?? 0), Math.max(0, cost - salvage)),
            serialNumber: r.serialNumber || '', location: r.location || '',
            supplierName: r.supplierName || '', referenceNumber: r.referenceNumber || '',
            journalEntryRef: reference, createdBy: req.user?.name || '',
          });
          created.push({ row: i + 1, assetCode, name: asset.name });
        } catch (e) {
          skipped.push({ row: i + 1, error: e.message, data: r });
        }
      }

      await logAudit(req, { action: 'create', entity: 'FixedAsset', entityId: 'import', after: { created: created.length, skipped: skipped.length } });
      res.json({ success: true, created: created.length, skipped, assets: created });
    } catch (err) {
      log.error?.({ err }, 'POST /api/fixed-assets/import failed');
      (captureError(req, err), res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }));
    }
  });
}
