import { formatDateTime } from '../../shared/dates.js';
import { useCallback, useEffect, useState } from 'react';
import { formatPeso } from '../../shared/money.js';
import { RefreshCw, Download, Check, Pencil } from 'lucide-react';
import * as ui from '../../shared/ui';
import SearchSelect from '../../shared/ui/SearchSelect';
import { monthStartStr, todayStr } from '../../shared/businessDay.js';

// The store checklist, the supplier statement, and one client's record.
const peso = formatPeso;
const btn = 'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition';
const btnBrand = `${btn} bg-brand text-on-brand hover:bg-brand/90 disabled:opacity-50`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg`;
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const th = 'px-3 py-2 text-[10px] font-black uppercase tracking-wider text-fg/65';
const td = 'px-3 py-2 text-xs';
const Card = ({ children, className = '' }) => <div className={`bg-surface border border-white/10 rounded-xl ${className}`}>{children}</div>;
const Empty = ({ children }) => <p className="text-fg/65 text-sm text-center p-8 font-bold">{children}</p>;
const day = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const call = async (apiFetch, path, method = 'GET', body) => (await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json();

// ── STORE CHECKLIST ─────────────────────────────────────────────────────────
export function StoreChecklist({ apiFetch, can }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);   // { opening: 'one step per line', closing: '...' }
  const load = useCallback(async (d = date) => {
    try {
      const r = await call(apiFetch, `/api/store-checklist?date=${d}`);
      if (r.success) setData(r); else ui.alert(r.error || 'Could not load the checklist.');
    } catch { ui.alert('Network error.'); }
  }, [apiFetch, date]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isToday = data && data.date === data.today;
  const tick = async (kind, step) => {
    if (!isToday) return;
    const r = await call(apiFetch, '/api/store-checklist/tick', 'POST', { kind, item: step.item, done: !step.done }).catch(() => ({}));
    if (!r.success) ui.alert(r.error || 'Could not save that.');
    load();
  };
  const saveLists = async () => {
    const lines = (t) => t.split('\n').map(x => x.trim()).filter(Boolean);
    const r = await call(apiFetch, '/api/store-checklist/lists', 'PUT', { opening: lines(editing.opening), closing: lines(editing.closing) }).catch(() => ({}));
    if (!r.success) return ui.alert(r.error || 'Could not save the lists.');
    setEditing(null); load();
  };
  if (!data) return <Empty>Loading…</Empty>;
  const List = ({ kind, title }) => {
    const l = data[kind];
    return (
      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="text-xs font-black uppercase tracking-wider text-fg">{title}</p>
          <p className={`text-xs font-bold tabular-nums ${l.total > 0 && l.done === l.total ? 'text-success' : 'text-fg/70'}`}>{l.done} of {l.total}</p>
        </div>
        {l.total === 0 ? <p className="text-xs text-fg/65">No steps on this list.</p> : (
          <ul className="space-y-1">
            {l.items.map(s => (
              <li key={s.item}>
                <button type="button" role="checkbox" aria-checked={s.done} disabled={!isToday} onClick={() => tick(kind, s)}
                  className="w-full flex items-start gap-3 text-left px-2 py-2 rounded-lg hover:bg-white/5 disabled:hover:bg-transparent disabled:cursor-default">
                  <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${s.done ? 'bg-brand border-brand text-on-brand' : 'border-white/25'}`}>{s.done && <Check size={13} />}</span>
                  <span className="min-w-0">
                    <span className={`block text-sm ${s.done ? 'text-fg/70 line-through' : 'text-fg'}`}>{s.item}</span>
                    {s.done && <span className="block text-[10px] text-fg/65">{s.by}{s.at ? ` · ${new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  };
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">The steps to open and to close, ticked off each day with who did each. Only today's can be ticked; earlier days are there to look back on.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <input type="date" value={date} max={todayStr()} onChange={e => { setDate(e.target.value); if (e.target.value) load(e.target.value); }} aria-label="Day" className={input} />
          {can?.('settings.manage') && !editing && (
            <button type="button" onClick={() => setEditing({ opening: data.opening.items.map(i => i.item).join('\n'), closing: data.closing.items.map(i => i.item).join('\n') })} className={btnGhost}><Pencil size={14} /> Change the lists</button>
          )}
        </div>
      </div>
      {!isToday && <p className="text-xs font-bold text-fg/70">Showing {day(data.date)} - a past day, read only.</p>}
      {editing ? (
        <Card className="p-4 space-y-3">
          <p className="text-xs text-fg/70">One step per line. Changing a list does not change the days already done.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {['opening', 'closing'].map(k => (
              <label key={k} className="text-[10px] font-bold uppercase tracking-wider text-fg/70">{k}
                <textarea rows={8} value={editing[k]} onChange={e => setEditing(x => ({ ...x, [k]: e.target.value }))} className={`${input} w-full mt-1 normal-case tracking-normal font-normal`} /></label>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(null)} className={btnGhost}>Cancel</button>
            <button type="button" onClick={saveLists} className={btnBrand}>Save</button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <List kind="opening" title="Opening" />
          <List kind="closing" title="Closing" />
        </div>
      )}
    </div>
  );
}

// ── SUPPLIER STATEMENT ──────────────────────────────────────────────────────
export function SupplierStatementReport({ apiFetch }) {
  const [suppliers, setSuppliers] = useState([]);
  const [f, setF] = useState({ supplierId: '', start: monthStartStr(), end: todayStr(), theirBalance: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    call(apiFetch, '/api/suppliers').then(r => { if (alive) setSuppliers((r.suppliers || r.data || []).filter(s => s && s.name)); }).catch(() => {});
    return () => { alive = false; };
  }, [apiFetch]);
  const load = useCallback(async (next = f) => {
    if (!next.supplierId) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ supplierId: next.supplierId, start: next.start, end: next.end, ...(next.theirBalance !== '' ? { theirBalance: next.theirBalance } : {}) });
      const r = await call(apiFetch, `/api/reports/supplier-statement?${q}`);
      if (r.success) setData(r); else ui.alert(r.error || 'Could not load the statement.');
    } catch { ui.alert('Network error.'); } finally { setLoading(false); }
  }, [apiFetch, f]);
  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`${data.supplier.name} - our account, ${data.start} to ${data.end}`], [],
      ['Date', 'What', 'Their reference', 'Our bill', 'Details', 'Billed', 'Paid', 'Balance'],
      ['', 'Balance brought forward', '', '', '', '', '', data.openingBalance],
      ...data.rows.map(r => [String(r.at).slice(0, 10), r.kind === 'bill' ? 'Bill' : 'Payment', r.reference, r.ours, r.description, r.charge || '', r.payment || '', r.balance]),
      [], ['', '', '', '', 'We owe them', '', '', data.closingBalance],
      ...(data.theirBalance != null ? [['', '', '', '', 'Their statement says', '', '', data.theirBalance], ['', '', '', '', 'Difference', '', '', data.difference]] : []),
    ]), 'Statement');
    XLSX.writeFile(wb, `supplier-statement-${data.supplier.name.replace(/[^\w]+/g, '-')}-${data.end}.xlsx`);
  };
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65 max-w-2xl">Our own account with one supplier - each bill, each payment, and the balance after it - to set beside the statement they send. Type the balance on their statement and it shows how far apart the two are. Bills not yet approved are not counted as owed.</p>
      <form onSubmit={e => { e.preventDefault(); load(); }} className="flex items-end gap-2 flex-wrap">
        <div className="min-w-[220px] flex-1">
          <SearchSelect value={f.supplierId} onChange={e => setF(p => ({ ...p, supplierId: e.target.value }))} className={`${input} w-full`} placeholder="Which supplier?"
            options={suppliers.map(s => ({ value: String(s._id), label: s.name }))} />
        </div>
        <input type="date" value={f.start} max={f.end} onChange={e => setF(p => ({ ...p, start: e.target.value }))} aria-label="From" className={input} />
        <input type="date" value={f.end} min={f.start} onChange={e => setF(p => ({ ...p, end: e.target.value }))} aria-label="To" className={input} />
        <input type="number" step="0.01" value={f.theirBalance} onChange={e => setF(p => ({ ...p, theirBalance: e.target.value }))} placeholder="Balance on their statement" aria-label="Balance on their statement" className={`${input} w-56`} />
        <button type="submit" disabled={loading || !f.supplierId} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Show</button>
        {data && <button type="button" onClick={exportXlsx} className={btnGhost}><Download size={14} /> Excel</button>}
      </form>
      {!data ? <Empty>{loading ? 'Loading…' : 'Choose a supplier and press Show.'}</Empty> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[['We owed at the start', peso(data.openingBalance)], ['Billed in the period', peso(data.totals.charges)], ['Paid in the period', peso(data.totals.payments)], ['We owe them now', peso(data.closingBalance)]].map(([l, v]) => (
              <Card key={l} className="px-4 py-3"><p className="text-[10px] font-black uppercase tracking-wider text-fg/65">{l}</p><p className="text-xl font-black tabular-nums text-fg mt-0.5">{v}</p></Card>
            ))}
          </div>
          {data.theirBalance != null && (
            <p className={`text-sm font-black ${Math.abs(data.difference) < 0.005 ? 'text-success' : 'text-danger'}`}>
              {Math.abs(data.difference) < 0.005 ? 'Their statement and ours agree.'
                : `Their statement says ${peso(data.theirBalance)} - ${peso(Math.abs(data.difference))} ${data.difference > 0 ? 'more than' : 'less than'} ours. ${data.difference > 0 ? 'Look for a bill of theirs that is not here, or a payment they have not applied yet.' : 'Look for a bill here they have not counted, or a payment of ours recorded twice.'}`}
            </p>
          )}
          {(data.notCounted.pending > 0 || data.supplier.creditBalance > 0) && (
            <p className="text-xs text-fg/70">
              {data.notCounted.pending > 0 && `${data.notCounted.pending} bill(s) worth ${peso(data.notCounted.pendingAmount)} are still waiting for approval and are not counted above. `}
              {data.supplier.creditBalance > 0 && `They are also holding ${peso(data.supplier.creditBalance)} of ours as a credit balance.`}
            </p>
          )}
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[680px]">
              <thead><tr><th className={th}>Date</th><th className={th}>What</th><th className={th}>Reference</th><th className={`${th} text-right`}>Billed</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Balance</th></tr></thead>
              <tbody>
                <tr className="border-t border-white/5"><td className={`${td} text-fg/80`}>{day(data.start)}</td><td className={`${td} text-fg/80`} colSpan={4}>Balance brought forward</td><td className={`${td} text-right font-mono text-fg`}>{peso(data.openingBalance)}</td></tr>
                {data.rows.map((r, i) => (
                  <tr key={`${r.ours}-${i}`} className="border-t border-white/5">
                    <td className={`${td} text-fg/80 whitespace-nowrap`}>{day(r.at)}</td>
                    <td className={`${td} text-fg`}>{r.kind === 'bill' ? 'Bill' : 'Payment'}<span className="block text-[10px] text-fg/65">{r.description}</span></td>
                    <td className={`${td} text-fg/80`}>{r.reference}<span className="block text-[10px] text-fg/65">{r.ours}</span></td>
                    <td className={`${td} text-right font-mono text-fg/80`}>{r.charge ? peso(r.charge) : ''}</td>
                    <td className={`${td} text-right font-mono text-fg/80`}>{r.payment ? peso(r.payment) : ''}</td>
                    <td className={`${td} text-right font-mono text-fg font-bold`}>{peso(r.balance)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={6}><Empty>No bills or payments in this period.</Empty></td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── ONE CLIENT'S RECORD, AS A FILE ──────────────────────────────────────────
// Everything held about one client, for when they ask what is kept about
// them. Saved as a workbook: their details, their orders, their deposits.
export async function downloadClientRecord(apiFetch, client) {
  const r = await call(apiFetch, `/api/client-accounts/${client._id}/record`);
  if (!r.success) { ui.alert(r.error || 'Could not get the record.'); return; }
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const c = r.client;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Record held for', c.name], ['Taken', formatDateTime(r.takenAt)], [],
    ...[['Client code', c.clientCode], ['Name', c.name], ['Username', c.username], ['Phone', c.phone], ['Email', c.email],
      ['Registered name', c.registeredName], ['TIN', c.tin], ['Registered address', c.registeredAddress], ['Notes', c.contactNotes],
      ['Usual payment', c.paymentMethod], ['Credit limit', c.creditLimit ?? ''], ['Payment terms (days)', c.creditTermsDays ?? ''], ['Credit balance', c.creditBalance],
      ['Price tier', c.priceTier], ['Active', c.isActive ? 'Yes' : 'No'], ['Affiliate', c.isAffiliate ? 'Yes' : 'No'], ['Account opened', c.createdAt ? String(c.createdAt).slice(0, 10) : '']],
  ]), 'Details');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Order', 'Date', 'Status', 'Type', 'Payment', 'Subtotal', 'Discount', 'Total', 'Paid', 'Refunded', 'Delivery address', 'Note', 'Items'],
    ...r.orders.map(o => [o.orderNumber, String(o.date).slice(0, 10), o.status, o.type, o.paymentMethod, o.subtotal, o.discount, o.total, o.paid, o.refunded, o.deliveryAddress, o.note, o.items]),
  ]), 'Orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Deposit', 'Date', 'Amount', 'Used', 'Purpose', 'Status'],
    ...r.deposits.map(d => [d.number, String(d.date).slice(0, 10), d.amount, d.used, d.purpose, d.status]),
  ]), 'Deposits');
  XLSX.writeFile(wb, `client-record-${String(c.clientCode || c.name).replace(/[^\w]+/g, '-')}.xlsx`);
  ui.toast('Record saved. Taking it was noted in the audit trail.', { tone: 'success' });
}
