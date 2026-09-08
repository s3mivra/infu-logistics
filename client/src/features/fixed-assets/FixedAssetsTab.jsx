import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Plus, Download, FileText, Upload, RefreshCw, TrendingDown,
  Archive, X, AlertCircle, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import * as ui from '../../shared/ui';

// Fixed assets - what the business owns, what it has worn off, what it is
// still worth.
//
// The register is a VIEW of the ledger, never a parallel list: every action
// here posts a balanced entry server-side, so the two cannot disagree. Cost
// and accumulated depreciation stay in separate accounts on purpose - a
// P60,000 machine that is half worn out is not the same fact as a P30,000
// machine, and netting them loses that.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE = {
  Active: 'text-green-400 bg-green-400/10',
  'Fully Depreciated': 'text-amber-400 bg-amber-400/10',
  Disposed: 'text-fg/40 bg-white/5',
};

// One labelled input. The label is not decoration: an unlabelled row of boxes
// is the complaint that started this, and "useful life" in particular is
// meaningless without its unit.
function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-fg/35 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:border-brand/50 focus:outline-none';

export default function FixedAssetsTab() {
  const { apiFetch, downloadDataset, exportBusy } = useDashboard();

  const [assets, setAssets] = useState([]);
  const [totals, setTotals] = useState({ count: 0, cost: 0, accumulatedDepreciation: 0, netBookValue: 0, dueNow: 0 });
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');          // '' = every status
  const [classFilter, setClassFilter] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(null);    // assetId whose schedule is open
  const [schedules, setSchedules] = useState({});    // assetId -> rows[]

  const [acquireOpen, setAcquireOpen] = useState(false);
  const [disposeFor, setDisposeFor] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (classFilter) qs.set('accountCode', classFilter);
      const res = await apiFetch(`/api/fixed-assets${qs.toString() ? `?${qs}` : ''}`);
      const d = await res.json();
      if (d.success) { setAssets(d.assets || []); setTotals(d.totals || {}); }
      else ui.alert(d.error || 'Could not load the asset register.');
    } catch { /* leave the last good view in place */ }
    finally { setLoading(false); }
  }, [apiFetch, status, classFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const d = await (await apiFetch('/api/fixed-assets/classes')).json();
        if (d.success) setClasses(d.classes || []);
      } catch { /* the form falls back to an empty picker and says so */ }
    })();
  }, [apiFetch]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(a => [a.name, a.assetCode, a.serialNumber, a.location, a.supplierName]
      .some(v => String(v || '').toLowerCase().includes(needle)));
  }, [assets, q]);

  const openSchedule = async (a) => {
    if (expanded === a._id) { setExpanded(null); return; }
    setExpanded(a._id);
    if (schedules[a._id]) return;
    try {
      const d = await (await apiFetch(`/api/fixed-assets/${a._id}`)).json();
      if (d.success) setSchedules(prev => ({ ...prev, [a._id]: d.schedule || [] }));
    } catch { /* the row still shows its totals */ }
  };

  // ── DEPRECIATION ───────────────────────────────────────────────────────────
  const depreciateOne = async (a) => {
    setBusy(a._id);
    try {
      const res = await apiFetch(`/api/fixed-assets/${a._id}/depreciate`, { method: 'POST', body: JSON.stringify({}) });
      const d = await res.json();
      if (!d.success) { ui.alert(d.error || 'Nothing to post.'); return; }
      ui.toast(`Posted ${peso(d.posted)} over ${d.months} month(s)${d.capped ? ' - capped at the salvage floor' : ''}.`, { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(''); }
  };

  const runMonthEnd = async () => {
    const due = assets.filter(a => a.status !== 'Disposed' && a.due?.amount > 0);
    if (due.length === 0) return ui.alert('Nothing is due. Depreciation is charged in whole months.');
    const ok = await ui.confirm(
      `Post depreciation for ${due.length} asset(s), ${peso(totals.dueNow)} in total?\n\n` +
      'Each one posts its own entry: DR Depreciation Expense / CR accumulated depreciation.',
    );
    if (!ok) return;
    setBusy('run');
    try {
      const d = await (await apiFetch('/api/fixed-assets/run-depreciation', { method: 'POST', body: JSON.stringify({}) })).json();
      if (!d.success) { ui.alert(d.error || 'Run failed.'); return; }
      ui.alert(`Posted for ${d.posted} asset(s), ${peso(d.totalAmount)} in total.` +
        (d.skipped ? `\n\n${d.skipped} had nothing due yet.` : ''));
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(''); }
  };

  // ── IMPORT ─────────────────────────────────────────────────────────────────
  const importFile = async (file) => {
    if (!file) return;
    setBusy('import');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (rows.length === 0) { ui.alert('That sheet has no rows.'); return; }

      const ok = await ui.confirm(
        `Import ${rows.length} asset(s)?\n\n` +
        'Each row posts its own acquisition entry against cash. A row that fails is reported and the rest still import.',
      );
      if (!ok) return;

      const d = await (await apiFetch('/api/fixed-assets/import', { method: 'POST', body: JSON.stringify({ rows }) })).json();
      if (!d.success) { ui.alert(d.error || 'Import failed.'); return; }
      const bad = (d.skipped || []).map(s => `Row ${s.row}: ${s.error}`);
      ui.alert(`Imported ${d.created || 0} asset(s).` +
        (bad.length ? `\n\nNot imported:\n- ${bad.join('\n- ')}` : ''));
      load();
    } catch (err) {
      console.error('fixed asset import', err);
      ui.alert('Could not read that file. Use the downloaded template.');
    } finally { setBusy(''); }
  };

  const busyExport = exportBusy === 'fixedAssets';

  return (
    <div className="space-y-4">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-black text-fg text-lg mr-auto">
          <Building2 size={18} /> Fixed Assets
        </h1>

        <button onClick={() => downloadDataset?.('fixedAssets')} disabled={busyExport}
          className="flex items-center gap-1.5 text-[10px] bg-brand/10 hover:bg-brand/20 text-brand px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <Download size={12} /> {busyExport ? 'Working…' : 'Export'}
        </button>
        <button onClick={() => downloadDataset?.('fixedAssets', { template: true })} disabled={busyExport}
          title="Blank workbook with the same columns, plus a sheet of the accepted values for each one"
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <FileText size={12} /> Template
        </button>
        <label className={`flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition ${busy === 'import' ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
          <Upload size={12} /> {busy === 'import' ? 'Reading…' : 'Import'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; importFile(f); }} />
        </label>
        <button onClick={() => setAcquireOpen(true)}
          className="flex items-center gap-1.5 text-[10px] bg-brand hover:bg-brand/90 text-white px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition">
          <Plus size={12} /> Add Asset
        </button>
      </div>

      {/* ── TOTALS ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          ['Assets held', String(totals.count ?? 0), 'text-fg'],
          ['At cost', peso(totals.cost), 'text-fg'],
          ['Depreciated', peso(totals.accumulatedDepreciation), 'text-amber-400'],
          ['Net book value', peso(totals.netBookValue), 'text-green-400'],
          ['Due now', peso(totals.dueNow), totals.dueNow > 0 ? 'text-brand' : 'text-fg/40'],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-sidebar-bg border border-white/10 rounded-xl p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-fg/40">{label}</p>
            <p className={`text-base font-black tabular-nums ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* Month-end. Disposed assets are excluded from every total above -
          they are history, not part of what the business currently owns. */}
      {totals.dueNow > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-brand/10 border border-brand/20 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="text-brand shrink-0" />
          <p className="text-xs text-fg/80 mr-auto">
            {peso(totals.dueNow)} of depreciation is owed. It is charged in whole months, so a part-month waits.
          </p>
          <button onClick={runMonthEnd} disabled={busy === 'run'}
            className="flex items-center gap-1.5 text-[10px] bg-brand hover:bg-brand/90 text-white px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
            <TrendingDown size={12} /> {busy === 'run' ? 'Posting…' : 'Run month-end'}
          </button>
        </div>
      )}

      {/* ── FILTERS ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code, serial, location…"
          className="flex-1 min-w-[180px] bg-sidebar-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-fg focus:border-brand/50 focus:outline-none" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="bg-sidebar-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-fg focus:border-brand/50 focus:outline-none">
          <option value="">Every status</option>
          <option value="Active">Active</option>
          <option value="Fully Depreciated">Fully Depreciated</option>
          <option value="Disposed">Disposed</option>
        </select>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
          className="bg-sidebar-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-fg focus:border-brand/50 focus:outline-none">
          <option value="">Every class</option>
          {classes.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── REGISTER ───────────────────────────────────────────────────── */}
      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2.5 w-6" />
                <th className="text-left px-3 py-2.5">Asset</th>
                <th className="text-left px-3 py-2.5">Class</th>
                <th className="text-left px-3 py-2.5">Acquired</th>
                <th className="text-right px-3 py-2.5">Cost</th>
                <th className="text-right px-3 py-2.5">Depreciated</th>
                <th className="text-right px-3 py-2.5">Net book value</th>
                <th className="text-right px-3 py-2.5">Due</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-fg/40">
                  {loading ? 'Loading…' : assets.length === 0
                    ? 'No assets yet. Add one, or import the filled-in template.'
                    : 'Nothing matches that search.'}
                </td></tr>
              )}
              {shown.map(a => (
                <FragmentRow key={a._id} a={a} expanded={expanded === a._id} rows={schedules[a._id]}
                  busy={busy === a._id} onToggle={() => openSchedule(a)}
                  onDepreciate={() => depreciateOne(a)} onDispose={() => setDisposeFor(a)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {acquireOpen && (
        <AcquireModal classes={classes} apiFetch={apiFetch}
          onClose={() => setAcquireOpen(false)} onDone={() => { setAcquireOpen(false); load(); }} />
      )}
      {disposeFor && (
        <DisposeModal asset={disposeFor} apiFetch={apiFetch}
          onClose={() => setDisposeFor(null)} onDone={() => { setDisposeFor(null); load(); }} />
      )}
    </div>
  );
}

// ── ONE ROW, plus its depreciation schedule when opened ────────────────────
function FragmentRow({ a, expanded, rows, busy, onToggle, onDepreciate, onDispose }) {
  const disposed = a.status === 'Disposed';
  return (
    <>
      <tr className="border-b border-white/5 hover:bg-white/[0.02]">
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="text-fg/40 hover:text-fg transition" title="Depreciation schedule">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </td>
        <td className="px-3 py-2.5">
          <p className="font-bold text-fg">{a.name}</p>
          <p className="text-[10px] text-fg/35">
            {a.assetCode}{a.serialNumber ? ` · ${a.serialNumber}` : ''}{a.location ? ` · ${a.location}` : ''}
          </p>
        </td>
        <td className="px-3 py-2.5 text-fg/60">{a.className}</td>
        <td className="px-3 py-2.5 text-fg/60">{shortDate(a.acquisitionDate)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-fg">{peso(a.acquisitionCost)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-amber-400/80">{peso(a.accumulatedDepreciation)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-fg">{peso(a.netBookValue)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {a.due?.amount > 0
            ? <span className="text-brand font-bold">{peso(a.due.amount)}<span className="text-fg/35 font-normal"> · {a.due.months}mo</span></span>
            : <span className="text-fg/25">—</span>}
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${STATUS_TONE[a.status] || 'text-fg/40 bg-white/5'}`}>
            {a.status}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1.5">
            {!disposed && a.due?.amount > 0 && (
              <button onClick={onDepreciate} disabled={busy}
                className="text-[9px] bg-brand/10 hover:bg-brand/20 text-brand px-2 py-1 rounded font-bold uppercase tracking-wider transition disabled:opacity-40">
                {busy ? '…' : 'Depreciate'}
              </button>
            )}
            {!disposed && (
              <button onClick={onDispose}
                className="flex items-center gap-1 text-[9px] border border-white/15 text-fg/50 hover:text-fg hover:bg-white/5 px-2 py-1 rounded font-bold uppercase tracking-wider transition">
                <Archive size={10} /> Dispose
              </button>
            )}
            {disposed && <span className="text-[10px] text-fg/30">{shortDate(a.disposedAt)}</span>}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-page-bg/50">
          <td colSpan={10} className="px-3 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-fg/40 mb-2">
              Schedule from here · {peso(a.monthlyDepreciation)} a month
              {a.salvageValue > 0 && <span className="text-fg/30 font-normal"> · stops at the {peso(a.salvageValue)} salvage floor</span>}
            </p>
            {!rows && <p className="text-[11px] text-fg/40">Loading…</p>}
            {rows?.length === 0 && <p className="text-[11px] text-fg/40">Nothing further to charge - this asset is fully depreciated.</p>}
            {rows?.length > 0 && (
              <div className="max-h-52 overflow-y-auto border border-white/10 rounded-lg">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-sidebar-bg">
                    <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40">
                      <th className="text-left px-3 py-1.5">Month</th>
                      <th className="text-right px-3 py-1.5">Charge</th>
                      <th className="text-right px-3 py-1.5">Accumulated</th>
                      <th className="text-right px-3 py-1.5">Net book value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.period} className="border-t border-white/5">
                        <td className="px-3 py-1.5 text-fg/50">+{r.period}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-fg/80">{peso(r.charge)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-amber-400/70">{peso(r.accumulated)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-fg">{peso(r.netBookValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── ACQUIRE ────────────────────────────────────────────────────────────────
function AcquireModal({ classes, apiFetch, onClose, onDone }) {
  const [f, setF] = useState({
    name: '', accountCode: '', acquisitionCost: '', acquisitionDate: today(),
    salvageValue: '', usefulLifeMonths: '60', paidFromAccount: '111000', onAccount: false,
    supplierName: '', referenceNumber: '', serialNumber: '', location: '', description: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const cost = Number(f.acquisitionCost) || 0;
  const salvage = Number(f.salvageValue) || 0;
  const life = parseInt(f.usefulLifeMonths, 10) || 0;
  const perMonth = life > 0 && cost > salvage ? (cost - salvage) / life : 0;

  const submit = async () => {
    if (!f.name.trim()) return ui.alert('Give the asset a name.');
    if (!f.accountCode) return ui.alert('Pick an asset class - it decides which account it is carried in.');
    if (!(cost > 0)) return ui.alert('Acquisition cost must be more than zero.');
    if (salvage > cost) return ui.alert('Salvage value cannot exceed the cost.');
    if (!(life > 0)) return ui.alert('Useful life must be a positive number of months.');

    setSaving(true);
    try {
      const res = await apiFetch('/api/fixed-assets', { method: 'POST', body: JSON.stringify({ ...f, onAccount: !!f.onAccount }) });
      const d = await res.json();
      if (!d.success) { ui.alert(d.error || 'Could not record that asset.'); return; }
      ui.toast(`${d.asset?.assetCode || 'Asset'} recorded.`, { tone: 'success' });
      onDone();
    } catch { ui.alert('Network error.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Add a fixed asset" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name" className="sm:col-span-2">
          <input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. La Marzocco espresso machine" />
        </Field>

        <Field label="Asset class" hint="Decides the account it is carried in, and its paired accumulated-depreciation account.">
          <select className={inputCls} value={f.accountCode} onChange={e => set('accountCode', e.target.value)}>
            <option value="">Pick one…</option>
            {classes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Acquisition date">
          <input type="date" className={inputCls} value={f.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)} />
        </Field>

        <Field label="Acquisition cost" hint="What was paid, before any depreciation.">
          <input type="number" min="0" step="0.01" className={inputCls} value={f.acquisitionCost}
            onChange={e => set('acquisitionCost', e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Salvage value" hint="What it will still be worth at the end. Depreciation stops here.">
          <input type="number" min="0" step="0.01" className={inputCls} value={f.salvageValue}
            onChange={e => set('salvageValue', e.target.value)} placeholder="0.00" />
        </Field>

        <Field label="Useful life (months)" hint="60 months = 5 years.">
          <input type="number" min="1" step="1" className={inputCls} value={f.usefulLifeMonths}
            onChange={e => set('usefulLifeMonths', e.target.value)} />
        </Field>
        <Field label="Paid from" hint="Which account the money left. Ignored if bought on account.">
          <select className={inputCls} value={f.paidFromAccount} disabled={f.onAccount}
            onChange={e => set('paidFromAccount', e.target.value)}>
            <option value="111000">111000 · Cash on Hand</option>
            <option value="112000">112000 · Cash in Bank</option>
            <option value="113000">113000 · Petty Cash</option>
          </select>
        </Field>

        <label className="sm:col-span-2 flex items-center gap-2 text-[11px] text-fg/70 cursor-pointer">
          <input type="checkbox" checked={f.onAccount} onChange={e => set('onAccount', e.target.checked)} />
          Bought on account — the other side is a payable (225100 Non-Trade), not cash
        </label>

        <Field label="Supplier"><input className={inputCls} value={f.supplierName} onChange={e => set('supplierName', e.target.value)} placeholder="Optional" /></Field>
        <Field label="Reference / invoice no."><input className={inputCls} value={f.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} placeholder="Optional" /></Field>
        <Field label="Serial number"><input className={inputCls} value={f.serialNumber} onChange={e => set('serialNumber', e.target.value)} placeholder="Optional" /></Field>
        <Field label="Location"><input className={inputCls} value={f.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Main bar" /></Field>
        <Field label="Description" className="sm:col-span-2">
          <input className={inputCls} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {perMonth > 0 && (
        <p className="mt-3 text-[11px] text-fg/50">
          Straight line: <span className="text-fg font-bold tabular-nums">{peso(perMonth)}</span> a month
          for {life} months, down to {peso(salvage)}.
        </p>
      )}

      <ModalActions onClose={onClose} onSubmit={submit} busy={saving} label="Record asset" />
    </Modal>
  );
}

// ── DISPOSE ────────────────────────────────────────────────────────────────
function DisposeModal({ asset, apiFetch, onClose, onDone }) {
  const [proceeds, setProceeds] = useState('');
  const [receivedInAccount, setReceivedInAccount] = useState('111000');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const got = Number(proceeds) || 0;
  const nbv = Number(asset.netBookValue) || 0;
  const diff = got - nbv;

  const submit = async () => {
    const ok = await ui.confirm(
      `Dispose of ${asset.assetCode} - ${asset.name}?\n\n` +
      `Its cost (${peso(asset.acquisitionCost)}) and accumulated depreciation ` +
      `(${peso(asset.accumulatedDepreciation)}) both come off the books, and the ` +
      `difference against ${peso(got)} of proceeds is booked as a ` +
      `${diff >= 0 ? 'gain' : 'loss'} of ${peso(Math.abs(diff))}.\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/fixed-assets/${asset._id}/dispose`, {
        method: 'POST', body: JSON.stringify({ proceeds: got, receivedInAccount, note }),
      });
      const d = await res.json();
      if (!d.success) { ui.alert(d.error || 'Could not dispose of that asset.'); return; }
      ui.alert(`Disposed. ${d.gain > 0 ? `Gain of ${peso(d.gain)}` : d.loss > 0 ? `Loss of ${peso(d.loss)}` : 'No gain or loss'}.\n\nEntry ${d.reference}.`);
      onDone();
    } catch { ui.alert('Network error.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Dispose of ${asset.name}`} onClose={onClose}>
      <div className="bg-page-bg border border-white/10 rounded-lg p-3 mb-3 grid grid-cols-3 gap-2 text-center">
        {[['Cost', peso(asset.acquisitionCost)], ['Depreciated', peso(asset.accumulatedDepreciation)], ['Net book value', peso(nbv)]]
          .map(([l, v]) => (
            <div key={l}>
              <p className="text-[9px] font-black uppercase tracking-widest text-fg/40">{l}</p>
              <p className="text-xs font-black tabular-nums text-fg">{v}</p>
            </div>
          ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Proceeds" hint="What it sold for. Zero if it was scrapped.">
          <input type="number" min="0" step="0.01" className={inputCls} value={proceeds}
            onChange={e => setProceeds(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Received into">
          <select className={inputCls} value={receivedInAccount} onChange={e => setReceivedInAccount(e.target.value)}>
            <option value="111000">111000 · Cash on Hand</option>
            <option value="112000">112000 · Cash in Bank</option>
            <option value="113000">113000 · Petty Cash</option>
          </select>
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="Why it went, who took it" />
        </Field>
      </div>

      <p className={`mt-3 text-[11px] font-bold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-fg/50'}`}>
        {diff > 0 ? `Gain of ${peso(diff)}` : diff < 0 ? `Loss of ${peso(-diff)}` : 'No gain or loss'}
        <span className="text-fg/40 font-normal"> — proceeds against a net book value of {peso(nbv)}.</span>
      </p>

      <ModalActions onClose={onClose} onSubmit={submit} busy={saving} label="Dispose" danger />
    </Modal>
  );
}

// ── SHELL ──────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-fg text-lg">{title}</h2>
          <button onClick={onClose} className="text-fg/40 hover:text-fg transition"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSubmit, busy, label, danger }) {
  return (
    <div className="flex justify-end gap-2 mt-5">
      <button onClick={onClose} disabled={busy}
        className="text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
        Cancel
      </button>
      <button onClick={onSubmit} disabled={busy}
        className={`text-[10px] text-white px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40 ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand hover:bg-brand/90'}`}>
        {busy ? 'Working…' : label}
      </button>
    </div>
  );
}
