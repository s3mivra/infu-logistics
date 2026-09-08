import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Landmark, Plus, RefreshCw, Check, X, AlertCircle, ChevronLeft, Lock, Unlock,
} from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import * as ui from '../../shared/ui';

// Bank reconciliation - explaining the gap between the ledger and the bank.
//
// The screen is a worksheet, not a report: you tick off what the statement
// shows and watch the unexplained difference fall to zero. It cannot be closed
// while anything is left over, because that leftover IS the finding - a missed
// entry, a duplicate, or money gone.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:border-brand/50 focus:outline-none';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-fg/35 mt-1">{hint}</span>}
    </label>
  );
}

export default function BankReconciliationTab() {
  const { apiFetch } = useDashboard();
  const [list, setList] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch('/api/bank-reconciliations')).json();
      if (d.success) setList(d.reconciliations || []);
      else ui.alert(d.error || 'Could not load reconciliations.');
    } catch { /* keep the last good view */ }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try {
        const d = await (await apiFetch('/api/bank-reconciliations/accounts')).json();
        if (d.success) setAccounts(d.accounts || []);
      } catch { /* the picker is simply empty */ }
    })();
  }, [apiFetch]);

  if (openId) {
    return <Worksheet id={openId} onBack={() => { setOpenId(null); load(); }} apiFetch={apiFetch} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-black text-fg text-lg mr-auto">
          <Landmark size={18} /> Bank Reconciliation
        </h1>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={() => setStartOpen(true)}
          className="flex items-center gap-1.5 text-[10px] bg-brand hover:bg-brand/90 text-white px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition">
          <Plus size={12} /> New Statement
        </button>
      </div>

      <p className="text-xs text-fg/50 leading-relaxed max-w-3xl">
        The ledger and the bank never agree on the day, and they are not supposed to — a cheque written
        on the 28th clears on the 3rd. Reconciling accounts for every peso of that gap. What cannot be
        explained is the finding: a missed entry, a duplicate, or money gone.
      </p>

      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2.5">Reference</th>
                <th className="text-left px-3 py-2.5">Account</th>
                <th className="text-left px-3 py-2.5">Statement date</th>
                <th className="text-right px-3 py-2.5">Per bank</th>
                <th className="text-right px-3 py-2.5">Per books</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-fg/40">
                  {loading ? 'Loading…' : 'No statements yet. Start one when your bank statement arrives.'}
                </td></tr>
              )}
              {list.map(r => (
                <tr key={r._id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 font-bold text-fg">{r.reference}</td>
                  <td className="px-3 py-2.5 text-fg/60">{r.accountName}</td>
                  <td className="px-3 py-2.5 text-fg/60">{shortDate(r.statementDate)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg">{peso(r.statementBalance)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/70">{peso(r.ledgerBalance)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${
                      r.status === 'Reconciled' ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'
                    }`}>
                      {r.status === 'Reconciled' ? <Lock size={9} /> : <Unlock size={9} />}{r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => setOpenId(r._id)}
                      className="text-[9px] bg-brand/10 hover:bg-brand/20 text-brand px-2.5 py-1 rounded font-bold uppercase tracking-wider transition">
                      {r.status === 'Reconciled' ? 'View' : 'Reconcile'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {startOpen && (
        <StartModal accounts={accounts} apiFetch={apiFetch}
          onClose={() => setStartOpen(false)}
          onDone={(id) => { setStartOpen(false); load(); setOpenId(id); }} />
      )}
    </div>
  );
}

function StartModal({ accounts, apiFetch, onClose, onDone }) {
  const [accountCode, setAccountCode] = useState(accounts[0]?.code || '112000');
  const [statementDate, setStatementDate] = useState(today());
  const [statementBalance, setStatementBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (statementBalance === '') return ui.alert('Enter the closing balance printed on the statement.');
    setSaving(true);
    try {
      const res = await apiFetch('/api/bank-reconciliations', {
        method: 'POST',
        body: JSON.stringify({ accountCode, statementDate, statementBalance: Number(statementBalance), notes }),
      });
      const d = await res.json();
      if (!d.success) { ui.alert(d.error || 'Could not start that reconciliation.'); return; }
      onDone(d.reconciliation._id);
    } catch { ui.alert('Network error.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-fg text-lg">New bank statement</h2>
          <button onClick={onClose} className="text-fg/40 hover:text-fg transition"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <Field label="Account" hint="Only cash and bank accounts can be reconciled.">
            <select className={inputCls} value={accountCode} onChange={e => setAccountCode(e.target.value)}>
              {accounts.length === 0 && <option value="112000">112000 · Cash in Bank</option>}
              {accounts.map(a => (
                <option key={a.code} value={a.code}>{a.code} · {a.name} — {peso(a.balance)} per books</option>
              ))}
            </select>
          </Field>
          <Field label="Statement date" hint="The closing date printed on the statement.">
            <input type="date" className={inputCls} value={statementDate} onChange={e => setStatementDate(e.target.value)} />
          </Field>
          <Field label="Closing balance per bank" hint="Copy it from the statement. This is the outside fact everything is reconciled to.">
            <input type="number" step="0.01" className={inputCls} value={statementBalance}
              onChange={e => setStatementBalance(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Notes">
            <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving}
            className="text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="text-[10px] bg-brand hover:bg-brand/90 text-white px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
            {saving ? 'Working…' : 'Start reconciling'}
          </button>
        </div>
      </div>
    </div>
  );
}

// The worksheet. Ticks are held locally and saved as a set, so ticking twenty
// lines is twenty clicks and one round trip rather than twenty.
function Worksheet({ id, onBack, apiFetch }) {
  const [data, setData] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const keyOf = (l) => `${l.journalEntryId}:${l.debit}:${l.credit}`;

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch(`/api/bank-reconciliations/${id}`)).json();
      if (!d.success) { ui.alert(d.error || 'Could not open that reconciliation.'); return; }
      setData(d);
      setTicked(new Set((d.lines || []).filter(l => l.cleared).map(keyOf)));
    } catch { ui.alert('Network error.'); }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  // The running figures, computed here so every tick updates instantly rather
  // than waiting on a round trip. The server recomputes the same way on save.
  const live = useMemo(() => {
    if (!data) return null;
    const outstanding = (data.lines || []).filter(l => !ticked.has(keyOf(l)));
    const depositsInTransit = outstanding.reduce((s, l) => s + l.debit, 0);
    const outstandingPayments = outstanding.reduce((s, l) => s + l.credit, 0);
    const adjusted = data.reconciliation.statementBalance + depositsInTransit - outstandingPayments;
    const difference = Math.round((adjusted - data.reconciliation.ledgerBalance) * 100) / 100;
    return { depositsInTransit, outstandingPayments, adjusted, difference, reconciles: Math.abs(difference) <= 0.01 };
  }, [data, ticked]);

  const save = async () => {
    setBusy(true);
    try {
      const lines = (data.lines || []).filter(l => ticked.has(keyOf(l)));
      const d = await (await apiFetch(`/api/bank-reconciliations/${id}/clear`, {
        method: 'POST', body: JSON.stringify({ lines }),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Could not save.'); return; }
      ui.toast('Saved.', { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const lines = (data.lines || []).filter(l => ticked.has(keyOf(l)));
      await apiFetch(`/api/bank-reconciliations/${id}/clear`, { method: 'POST', body: JSON.stringify({ lines }) });
      const d = await (await apiFetch(`/api/bank-reconciliations/${id}/finish`, {
        method: 'POST', body: JSON.stringify({}),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Could not close this reconciliation.'); return; }
      ui.alert('Reconciled. Every peso of the difference is accounted for.');
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!(await ui.confirm('Reopen this reconciliation so the ticks can be changed?'))) return;
    const d = await (await apiFetch(`/api/bank-reconciliations/${id}/reopen`, { method: 'POST', body: JSON.stringify({}) })).json();
    if (!d.success) return ui.alert(d.error || 'Could not reopen.');
    load();
  };

  if (!data) return <p className="text-fg/40 text-sm">Loading…</p>;
  const rec = data.reconciliation;
  const closed = rec.status === 'Reconciled';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-fg/50 hover:text-fg transition mr-auto">
          <ChevronLeft size={14} /> All statements
        </button>
        {!closed && (
          <>
            <button onClick={save} disabled={busy}
              className="text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
              Save progress
            </button>
            <button onClick={finish} disabled={busy || !live.reconciles}
              title={live.reconciles ? '' : 'Every difference has to be accounted for first'}
              className="flex items-center gap-1.5 text-[10px] bg-brand hover:bg-brand/90 text-white px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-30">
              <Check size={12} /> Mark reconciled
            </button>
          </>
        )}
        {closed && (
          <button onClick={reopen}
            className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition">
            <Unlock size={12} /> Reopen
          </button>
        )}
      </div>

      <div>
        <h1 className="font-black text-fg text-lg">{rec.reference} · {rec.accountName}</h1>
        <p className="text-xs text-fg/50">Statement dated {shortDate(rec.statementDate)}</p>
      </div>

      {/* The reconciliation itself, laid out as the arithmetic it is. */}
      <div className="bg-sidebar-bg border border-white/10 rounded-xl p-4">
        <div className="space-y-1.5 text-sm max-w-md">
          <Row label="Closing balance per bank" value={rec.statementBalance} />
          <Row label="+ Deposits in transit" value={live.depositsInTransit}
            hint="Recorded by us, not yet at the bank" />
          <Row label="− Outstanding payments" value={-live.outstandingPayments}
            hint="Recorded by us, not yet cleared" />
          <div className="border-t border-white/10 pt-1.5">
            <Row label="Adjusted bank balance" value={live.adjusted} bold />
          </div>
          <Row label="Balance per books" value={rec.ledgerBalance} />
          <div className={`border-t pt-1.5 ${live.reconciles ? 'border-green-400/30' : 'border-red-400/30'}`}>
            <Row label={live.reconciles ? 'Difference — accounted for' : 'Unexplained difference'}
              value={live.difference} bold
              tone={live.reconciles ? 'text-green-400' : 'text-red-400'} />
          </div>
        </div>

        {!live.reconciles && !closed && (
          <p className="flex items-start gap-2 text-[11px] text-amber-400/90 mt-3 max-w-2xl">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>
              Still out by {peso(Math.abs(live.difference))}. Tick the items the statement shows. If something
              on the statement is not in the ledger at all — a bank charge, interest — book it as its own
              entry first; this screen deliberately will not adjust the books for you.
            </span>
          </p>
        )}
      </div>

      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
          <p className="text-[9px] font-black uppercase tracking-widest text-fg/40">
            Ledger entries to {shortDate(rec.statementDate)}
          </p>
          <p className="text-[10px] text-fg/40">{ticked.size} of {data.lines.length} ticked</p>
        </div>
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="sticky top-0 bg-sidebar-bg">
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2 w-10">On stmt</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Reference</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">In</th>
                <th className="text-right px-3 py-2">Out</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-fg/40">
                  Nothing has been posted to this account up to that date.
                </td></tr>
              )}
              {data.lines.map(l => {
                const k = keyOf(l);
                const on = ticked.has(k);
                return (
                  <tr key={k} className={`border-b border-white/5 ${on ? 'bg-green-400/[0.04]' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={on} disabled={closed}
                        onChange={() => setTicked(prev => {
                          const next = new Set(prev);
                          if (next.has(k)) next.delete(k); else next.add(k);
                          return next;
                        })} />
                    </td>
                    <td className="px-3 py-2 text-fg/60">{shortDate(l.date)}</td>
                    <td className="px-3 py-2 text-fg/80">{l.reference}</td>
                    <td className="px-3 py-2 text-fg/50 truncate max-w-[18rem]">{l.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-400/80">{l.debit ? peso(l.debit) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-400/70">{l.credit ? peso(l.credit) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, hint, bold, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={`${bold ? 'font-bold text-fg' : 'text-fg/60'}`}>
        {label}
        {hint && <span className="block text-[10px] text-fg/30">{hint}</span>}
      </span>
      <span className={`tabular-nums ${bold ? 'font-black' : ''} ${tone || 'text-fg'}`}>{peso(value)}</span>
    </div>
  );
}
