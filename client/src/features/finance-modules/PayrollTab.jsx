import { useCallback, useEffect, useState } from 'react';
import {
  Users, Plus, RefreshCw, X, Trash2, Check, Banknote, FileText, ChevronLeft,
} from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import * as ui from '../../shared/ui';

// Payroll - what the work cost, and what each person took home.
//
// Those are different numbers, and the screen keeps them visibly apart: gross
// is the expense, the deductions are held for three different agencies, and
// only the net is handed over. Draft, approve, pay - three steps, because
// approving the payroll and handing over the money happen on different days.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:border-brand/50 focus:outline-none';
const numCls = 'w-full bg-page-bg border border-white/10 rounded px-2 py-1.5 text-xs text-right tabular-nums text-fg focus:border-brand/50 focus:outline-none';

const STATUS_TONE = {
  Draft: 'text-fg/50 bg-white/5',
  Approved: 'text-amber-400 bg-amber-400/10',
  Paid: 'text-green-400 bg-green-400/10',
};

const blankLine = () => ({
  employeeName: '', employeeId: '', grossPay: '', sss: '', philhealth: '',
  pagibig: '', withholdingTax: '', otherDeductions: '', notes: '',
});

const num = (v) => Number(v) || 0;
const netOf = (l) => num(l.grossPay) - num(l.sss) - num(l.philhealth) - num(l.pagibig)
  - num(l.withholdingTax) - num(l.otherDeductions);

export default function PayrollTab() {
  const { apiFetch } = useDashboard();
  const [runs, setRuns] = useState([]);
  const [totals, setTotals] = useState({ gross: 0, net: 0, unpaid: 0 });
  const [liabilities, setLiabilities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [openRun, setOpenRun] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch('/api/payroll-runs')).json();
      if (d.success) { setRuns(d.runs || []); setTotals(d.totals || {}); }
      else ui.alert(d.error || 'Could not load payroll.');
      const l = await (await apiFetch('/api/payroll-runs/liabilities/summary')).json();
      if (l.success) setLiabilities(l.liabilities || []);
    } catch { /* keep the last good view */ }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const act = async (run, what) => {
    const label = what === 'approve' ? 'Approve' : 'Pay out';
    const detail = what === 'approve'
      ? `Post ${peso(run.totals.gross)} of wages to the books?\n\nThe deductions are held for SSS, PhilHealth, Pag-IBIG and the BIR. No cash moves yet — ${peso(run.totals.net)} becomes owed to staff.`
      : `Pay out ${peso(run.totals.net)} to ${run.lines.length} employee(s)?\n\nThis discharges what is owed to them. The deductions stay held until each agency is paid.`;
    if (!(await ui.confirm(detail))) return;
    try {
      const d = await (await apiFetch(`/api/payroll-runs/${run._id}/${what}`, {
        method: 'POST', body: JSON.stringify({}),
      })).json();
      if (!d.success) { ui.alert(d.error || `${label} failed.`); return; }
      ui.toast(`${label} done.`, { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
  };

  if (openRun) {
    return <RunDetail run={openRun} apiFetch={apiFetch}
      onBack={() => { setOpenRun(null); load(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-black text-fg text-lg mr-auto">
          <Users size={18} /> Payroll
        </h1>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={() => setDraftOpen(true)}
          className="flex items-center gap-1.5 text-[10px] bg-brand hover:bg-brand/90 text-white px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition">
          <Plus size={12} /> New Run
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {[
          ['Gross, all runs', peso(totals.gross), 'text-fg'],
          ['Net paid out', peso(totals.net), 'text-fg'],
          ['Approved, not yet paid', peso(totals.unpaid), totals.unpaid > 0 ? 'text-amber-400' : 'text-fg/40'],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-sidebar-bg border border-white/10 rounded-xl p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-fg/40">{label}</p>
            <p className={`text-base font-black tabular-nums ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* What is still held on someone else's behalf. Three agencies, three
          schedules - a single pooled figure could not say which is short. */}
      {liabilities.some(l => l.outstanding > 0) && (
        <div className="bg-sidebar-bg border border-white/10 rounded-xl p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-fg/40 mb-2">Held, not yet remitted</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {liabilities.map(l => (
              <div key={l.accountCode}>
                <p className="text-[10px] text-fg/50 truncate">{l.accountName}</p>
                <p className={`text-sm font-black tabular-nums ${l.outstanding > 0 ? 'text-amber-400' : 'text-fg/30'}`}>
                  {peso(l.outstanding)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2.5">Reference</th>
                <th className="text-left px-3 py-2.5">Period</th>
                <th className="text-right px-3 py-2.5">Staff</th>
                <th className="text-right px-3 py-2.5">Gross</th>
                <th className="text-right px-3 py-2.5">Deductions</th>
                <th className="text-right px-3 py-2.5">Net</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-fg/40">
                  {loading ? 'Loading…' : 'No payroll runs yet.'}
                </td></tr>
              )}
              {runs.map(r => {
                const deductions = (r.totals?.gross || 0) - (r.totals?.net || 0);
                return (
                  <tr key={r._id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-bold text-fg">{r.reference}</td>
                    <td className="px-3 py-2.5 text-fg/60">{shortDate(r.periodStart)} – {shortDate(r.periodEnd)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg/60">{r.lines?.length || 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{peso(r.totals?.gross)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-400/80">{peso(deductions)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-fg">{peso(r.totals?.net)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${STATUS_TONE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setOpenRun(r)}
                          className="text-[9px] border border-white/15 text-fg/50 hover:text-fg hover:bg-white/5 px-2 py-1 rounded font-bold uppercase tracking-wider transition">
                          Payslips
                        </button>
                        {r.status === 'Draft' && (
                          <button onClick={() => act(r, 'approve')}
                            className="flex items-center gap-1 text-[9px] bg-brand/10 hover:bg-brand/20 text-brand px-2 py-1 rounded font-bold uppercase tracking-wider transition">
                            <Check size={10} /> Approve
                          </button>
                        )}
                        {r.status === 'Approved' && (
                          <button onClick={() => act(r, 'pay')}
                            className="flex items-center gap-1 text-[9px] bg-brand hover:bg-brand/90 text-white px-2 py-1 rounded font-bold uppercase tracking-wider transition">
                            <Banknote size={10} /> Pay out
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {draftOpen && (
        <DraftModal apiFetch={apiFetch}
          onClose={() => setDraftOpen(false)}
          onDone={() => { setDraftOpen(false); load(); }} />
      )}
    </div>
  );
}

function DraftModal({ apiFetch, onClose, onDone }) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payDate, setPayDate] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [saving, setSaving] = useState(false);

  const setLine = (i, k, v) => setLines(prev => prev.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const totals = lines.reduce((acc, l) => ({
    gross: acc.gross + num(l.grossPay),
    net: acc.net + Math.max(0, netOf(l)),
  }), { gross: 0, net: 0 });

  const submit = async () => {
    if (!periodStart || !periodEnd) return ui.alert('Set the pay period.');
    const filled = lines.filter(l => String(l.employeeName).trim());
    if (filled.length === 0) return ui.alert('Add at least one employee.');
    const bad = filled.find(l => netOf(l) < 0);
    if (bad) return ui.alert(`${bad.employeeName}: the deductions come to more than the gross pay.`);

    setSaving(true);
    try {
      const d = await (await apiFetch('/api/payroll-runs', {
        method: 'POST',
        body: JSON.stringify({
          periodStart, periodEnd, payDate: payDate || periodEnd,
          lines: filled.map(l => ({
            employeeName: l.employeeName, employeeId: l.employeeId,
            grossPay: num(l.grossPay), sss: num(l.sss), philhealth: num(l.philhealth),
            pagibig: num(l.pagibig), withholdingTax: num(l.withholdingTax),
            otherDeductions: num(l.otherDeductions), notes: l.notes,
          })),
        }),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Could not save that run.'); return; }
      ui.toast('Draft saved. Nothing posts until it is approved.', { tone: 'success' });
      onDone();
    } catch { ui.alert('Network error.'); }
    finally { setSaving(false); }
  };

  const COLS = [
    ['grossPay', 'Gross'], ['sss', 'SSS'], ['philhealth', 'PhilHealth'],
    ['pagibig', 'Pag-IBIG'], ['withholdingTax', 'Tax'], ['otherDeductions', 'Other'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-black text-fg text-lg">New payroll run</h2>
            <p className="text-xs text-fg/50">A draft posts nothing — check it against the timesheets, then approve.</p>
          </div>
          <button onClick={onClose} className="text-fg/40 hover:text-fg transition"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <label className="block">
            <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">Period start</span>
            <input type="date" className={inputCls} value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">Period end</span>
            <input type="date" className={inputCls} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            <span className="block text-[10px] text-fg/35 mt-1">The wages are dated here — that is the month they belong to.</span>
          </label>
          <label className="block">
            <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">Pay date</span>
            <input type="date" className={inputCls} value={payDate} onChange={e => setPayDate(e.target.value)} />
            <span className="block text-[10px] text-fg/35 mt-1">When the cash actually leaves. Often a later month.</span>
          </label>
        </div>

        <div className="overflow-x-auto border border-white/10 rounded-lg">
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-2 py-2">Employee</th>
                {COLS.map(([k, label]) => <th key={k} className="text-right px-2 py-2">{label}</th>)}
                <th className="text-right px-2 py-2">Net</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const net = netOf(l);
                return (
                  <tr key={i} className="border-b border-white/5">
                    <td className="px-2 py-1.5">
                      <input className={`${numCls} text-left`} value={l.employeeName}
                        onChange={e => setLine(i, 'employeeName', e.target.value)} placeholder="Name" />
                    </td>
                    {COLS.map(([k]) => (
                      <td key={k} className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" className={numCls} value={l[k]}
                          onChange={e => setLine(i, k, e.target.value)} placeholder="0" />
                      </td>
                    ))}
                    <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${net < 0 ? 'text-red-400' : 'text-fg'}`}>
                      {peso(net)}
                    </td>
                    <td className="px-2 py-1.5">
                      {lines.length > 1 && (
                        <button onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}
                          className="text-fg/30 hover:text-red-400 transition"><Trash2 size={12} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-4 mt-3">
          <button onClick={() => setLines(prev => [...prev, blankLine()])}
            className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition">
            <Plus size={11} /> Add employee
          </button>
          <p className="text-xs text-fg/60">
            Gross <span className="font-black text-fg tabular-nums">{peso(totals.gross)}</span>
            <span className="mx-2 text-fg/25">·</span>
            Take-home <span className="font-black text-fg tabular-nums">{peso(totals.net)}</span>
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving}
            className="text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="text-[10px] bg-brand hover:bg-brand/90 text-white px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run, apiFetch, onBack }) {
  const [fresh, setFresh] = useState(run);
  useEffect(() => {
    (async () => {
      try {
        const d = await (await apiFetch(`/api/payroll-runs/${run._id}`)).json();
        if (d.success) setFresh(d.run);
      } catch { /* the list row is already good enough to render */ }
    })();
  }, [apiFetch, run._id]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-fg/50 hover:text-fg transition">
        <ChevronLeft size={14} /> All runs
      </button>
      <div>
        <h1 className="flex items-center gap-2 font-black text-fg text-lg">
          <FileText size={17} /> {fresh.reference}
        </h1>
        <p className="text-xs text-fg/50">
          {shortDate(fresh.periodStart)} – {shortDate(fresh.periodEnd)} · paid {shortDate(fresh.payDate)} · {fresh.status}
        </p>
      </div>

      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2.5">Employee</th>
                <th className="text-right px-3 py-2.5">Gross</th>
                <th className="text-right px-3 py-2.5">SSS</th>
                <th className="text-right px-3 py-2.5">PhilHealth</th>
                <th className="text-right px-3 py-2.5">Pag-IBIG</th>
                <th className="text-right px-3 py-2.5">Tax</th>
                <th className="text-right px-3 py-2.5">Other</th>
                <th className="text-right px-3 py-2.5">Take-home</th>
              </tr>
            </thead>
            <tbody>
              {(fresh.lines || []).map((l, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-3 py-2.5 font-bold text-fg">
                    {l.employeeName}
                    {l.employeeId && <span className="block text-[10px] text-fg/35">{l.employeeId}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg">{peso(l.grossPay)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/50">{peso(l.sss)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/50">{peso(l.philhealth)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/50">{peso(l.pagibig)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/50">{peso(l.withholdingTax)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/50">{peso(l.otherDeductions)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-black text-fg">{peso(l.netPay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 text-fg font-black">
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{peso(fresh.totals?.gross)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg/60">{peso(fresh.totals?.sss)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg/60">{peso(fresh.totals?.philhealth)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg/60">{peso(fresh.totals?.pagibig)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg/60">{peso(fresh.totals?.withholdingTax)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg/60">{peso(fresh.totals?.otherDeductions)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{peso(fresh.totals?.net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
