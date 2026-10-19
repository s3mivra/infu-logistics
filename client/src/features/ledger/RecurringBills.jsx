import { useCallback, useEffect, useState } from 'react';
import { Repeat, Trash2 } from 'lucide-react';
import * as ui from '../../shared/ui';
import SearchSelect from '../../shared/ui/SearchSelect';

// Bills that come round every month - rent, internet, a retainer. Entered
// once; each month's is raised as an ordinary Pending bill, so it is approved
// and paid exactly like a typed-in one. Nothing is posted or paid on its own.
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = 'bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/60';

export default function RecurringBills({ apiFetch, suppliers = [], accounts = [], canManage, onRaised }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ supplierId: '', description: '', amount: '', expenseAccountCode: '', dayOfMonth: 1 });

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/recurring-bills')).json();
      if (d.success) { setRows(d.rows); setMonth(d.month); }
    } catch { /* the list simply stays as it was */ }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await (await apiFetch('/api/recurring-bills', { method: 'POST', body: JSON.stringify(f) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save.');
      setF({ supplierId: '', description: '', amount: '', expenseAccountCode: f.expenseAccountCode, dayOfMonth: 1 });
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };
  const patch = async (row, body) => {
    const d = await (await apiFetch(`/api/recurring-bills/${row._id}`, { method: 'PATCH', body: JSON.stringify(body) })).json();
    if (!d.success) ui.alert(d.error || 'Could not save.');
    load();
  };
  const remove = async (row) => {
    if (!(await ui.confirm(`Stop and remove "${row.description}" for ${row.supplierName}? Bills already raised stay as they are.`))) return;
    await apiFetch(`/api/recurring-bills/${row._id}`, { method: 'DELETE' });
    load();
  };
  const raise = async () => {
    setBusy(true);
    try {
      const d = await (await apiFetch('/api/recurring-bills/raise', { method: 'POST' })).json();
      if (!d.success) return ui.alert(d.error || 'Could not raise the bills.');
      ui.toast(d.raised.length ? `${d.raised.length} bill(s) raised for ${d.month} - waiting in Pending.` : `This month's bills were already raised.`, { tone: 'success' });
      load(); onRaised?.();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  const dueNow = rows.filter(r => r.isActive && r.lastMonth !== month).length;
  // Not a cash or bank account - a bill is charged to what was bought.
  const chargeable = accounts.filter(a => !/^11[1-4]/.test(String(a.code)));

  return (
    <div className="bg-surface border border-white/10 rounded-xl">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-black text-fg"><Repeat size={15} className="text-brand-text" /> Repeating bills
          <span className="text-fg/65 font-bold text-xs">{rows.length ? `${rows.length} set up` : 'rent, internet and the like'}</span>
        </span>
        {dueNow > 0 && <span className="text-[10px] font-black uppercase bg-amber-500/20 text-warning px-2 py-1 rounded">{dueNow} to raise this month</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
          <p className="text-xs text-fg/70">Entered once. Each month's bill is raised as <b>Pending</b> - on its own once a day, or with the button - and then approved and paid like any other bill.</p>
          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.map(r => (
                <div key={r._id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm border-t border-white/5 first:border-0 pt-1.5 first:pt-0 ${r.isActive ? '' : 'opacity-50'}`}>
                  <span className="flex-1 basis-[10rem] min-w-0">
                    <span className="block font-bold text-fg truncate">{r.description}</span>
                    <span className="block text-xs text-fg/70 truncate">{r.supplierName} · due day {r.dayOfMonth} · {r.lastMonth === month ? 'raised this month' : r.isActive ? 'not raised yet this month' : 'paused'}</span>
                  </span>
                  <span className="font-black tabular-nums text-fg">{peso(r.amount)}</span>
                  {canManage && (
                    <span className="flex items-center gap-1">
                      <button onClick={() => patch(r, { isActive: !r.isActive })} className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white/5 text-fg/80 hover:bg-white/10">{r.isActive ? 'Pause' : 'Resume'}</button>
                      <button onClick={() => remove(r)} aria-label={`Remove ${r.description}`} className="p-1.5 rounded-lg text-fg/65 hover:text-danger hover:bg-red-500/10"><Trash2 size={13} /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {canManage && (<>
            <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end">
              <div className="lg:col-span-2">
                <SearchSelect value={f.supplierId} onChange={e => setF(p => ({ ...p, supplierId: e.target.value }))}
                  className={`${field} w-full`} placeholder="Supplier" options={suppliers.map(s => ({ value: s._id, label: s.name }))} />
              </div>
              <input value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} placeholder="What for (e.g. Office rent)" aria-label="What it is for" maxLength={200} className={`${field} lg:col-span-2`} />
              <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} placeholder="Amount each month" aria-label="Amount each month" className={field} />
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-fg/70">Due day
                <input type="number" min="1" max="28" value={f.dayOfMonth} onChange={e => setF(p => ({ ...p, dayOfMonth: e.target.value }))} aria-label="Day of the month it is due" className={`${field} w-16`} />
              </label>
              <select value={f.expenseAccountCode} onChange={e => setF(p => ({ ...p, expenseAccountCode: e.target.value }))} aria-label="Charge to" className={`${field} lg:col-span-4`}>
                <option value="">Charge to which account?</option>
                {chargeable.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
              </select>
              <button type="submit" disabled={busy || !f.supplierId || !f.description.trim() || !(Number(f.amount) > 0) || !f.expenseAccountCode}
                className="lg:col-span-2 bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40">Add repeating bill</button>
            </form>
            {rows.some(r => r.isActive) && (
              <button type="button" onClick={raise} disabled={busy || dueNow === 0}
                className="bg-white/5 hover:bg-white/10 text-fg px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40">
                {dueNow === 0 ? `All raised for ${month}` : `Raise this month's ${dueNow} bill(s) now`}
              </button>
            )}
          </>)}
        </div>
      )}
    </div>
  );
}
