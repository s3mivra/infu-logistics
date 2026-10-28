import { formatDate } from '../../shared/dates.js';
import { useMemo, useRef, useState } from 'react';
import { formatPeso } from '../../shared/money.js';
import { HandCoins } from 'lucide-react';
import * as ui from '../../shared/ui';
import SearchSelect from '../../shared/ui/SearchSelect';
import { todayStr } from '../../shared/businessDay.js';

// One payment from a client, spread over the sales they still owe on, oldest
// first - instead of opening each sale and settling it on its own. Every sale
// is settled through the very same step as the Settle button, one after
// another, so each still gets its own receipt entry and history.
//
// A check works the same way: each sale gets its part of the check, all under
// one group, and the check register deposits, clears or bounces every part
// together - it is one piece of paper.
const peso = formatPeso;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const METHODS = ['Cash on Hand', 'Bank Transfer', 'GCash', 'Maya', 'Maribank', 'Check'];
const newGroup = () => `CG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const field = 'bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/60';

export default function CollectFromClient({ apiFetch, orders = [], onDone }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [f, setF] = useState({ amount: '', paymentMethod: 'Cash on Hand', referenceNumber: '', collectedBy: '', collectionDate: todayStr(), checkNumber: '', checkDate: '', checkBank: '' });
  const [busy, setBusy] = useState(null);   // { done, total }
  // One group per check. It is kept until the whole check is recorded, so
  // trying again after a failure adds to the same check rather than being
  // refused as a second entry of its number.
  const group = useRef(newGroup());
  const isCheck = f.paymentMethod === 'Check';

  // Clients with something owed: by account where the sale has one, else by name.
  const clients = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      const bal = r2(o.balance ?? o.total);
      if (!(bal > 0)) continue;
      const key = String(o.clientId || '') || `name:${String(o.customerName || '').trim().toUpperCase()}`;
      const c = m.get(key) || { key, name: o.customerName || 'Customer', owed: 0, orders: [] };
      c.owed = r2(c.owed + bal); c.orders.push(o); m.set(key, c);
    }
    for (const c of m.values()) c.orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);
  const client = clients.find(c => c.key === who) || null;
  const amount = r2(f.amount);

  // Oldest first, until the payment runs out.
  const plan = useMemo(() => {
    if (!client) return [];
    let left = amount; const out = [];
    for (const o of client.orders) {
      if (left <= 0.004) break;
      const take = Math.min(left, r2(o.balance ?? o.total));
      out.push({ order: o, take: r2(take) }); left = r2(left - take);
    }
    return out;
  }, [client, amount]);
  const over = client ? r2(amount - client.owed) : 0;
  // A collection is always recorded against a reference, so it can be matched
  // later; for a check that is the check number.
  const ready = client && amount > 0 && over <= 0.004 && (isCheck ? f.checkNumber.trim() : f.referenceNumber.trim()) && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    if (!(await ui.confirm({
      title: `Collect ${peso(amount)} from ${client.name}?`,
      message: `It settles ${plan.length} sale(s), oldest first${plan.some(p => p.take < r2(p.order.balance ?? p.order.total) - 0.004) ? ', the last one in part' : ''}.`,
      confirmLabel: 'Collect',
    }))) return;
    setBusy({ done: 0, total: plan.length });
    const failed = []; let collected = 0;
    for (const [i, p] of plan.entries()) {
      try {
        const d = await (await apiFetch(`/api/orders/${p.order._id}/settle-ar`, {
          method: 'POST',
          body: JSON.stringify({
            amount: p.take, paymentMethod: f.paymentMethod, referenceNumber: f.referenceNumber,
            collectionDate: f.collectionDate, depositDate: f.collectionDate, collectedBy: f.collectedBy,
            note: `Part of ${peso(amount)} collected from ${client.name}`,
            ...(isCheck ? { checkNumber: f.checkNumber.trim(), checkDate: f.checkDate || undefined, checkBank: f.checkBank.trim(), checkGroup: group.current } : {}),
          }),
        })).json();
        if (d.success) collected = r2(collected + p.take);
        else failed.push(`${p.order.orderNumber}: ${d.error || 'not settled'}`);
      } catch { failed.push(`${p.order.orderNumber}: network error`); }
      setBusy({ done: i + 1, total: plan.length });
    }
    setBusy(null);
    ui.alert(`${peso(collected)} collected from ${client.name} across ${plan.length - failed.length} sale(s).`
      + (failed.length ? `\n\nNot settled - nothing was taken for these:\n- ${failed.join('\n- ')}` : ''));
    if (!failed.length) { setF(p => ({ ...p, amount: '', referenceNumber: '', checkNumber: '', checkDate: '', checkBank: '' })); setWho(''); group.current = newGroup(); }
    onDone?.();
  };

  if (clients.length === 0) return null;
  return (
    <div className="bg-surface border border-white/10 rounded-xl mb-4">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <HandCoins size={15} className="text-brand-text" />
        <span className="text-sm font-black text-fg">Collect one payment from a client</span>
        <span className="text-fg/65 font-bold text-xs">spread over what they owe, oldest first</span>
      </button>
      {open && (
        <form onSubmit={submit} className="px-4 pb-4 pt-3 border-t border-white/10 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <SearchSelect value={who} onChange={e => { setWho(e.target.value); setF(p => ({ ...p, amount: '' })); }}
              className={`${field} w-full`} placeholder="Which client?"
              options={clients.map(c => ({ value: c.key, label: c.name, hint: `${peso(c.owed)} on ${c.orders.length}` }))} />
            <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))}
              placeholder={client ? `Amount received (owes ${peso(client.owed)})` : 'Amount received'} aria-label="Amount received" className={field} disabled={!client} />
            <select value={f.paymentMethod} onChange={e => setF(p => ({ ...p, paymentMethod: e.target.value }))} aria-label="Received as" className={field}>
              {METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
            <input type="date" value={f.collectionDate} max={todayStr()} onChange={e => setF(p => ({ ...p, collectionDate: e.target.value }))} aria-label="Date received" className={field} />
            {isCheck ? (
              <>
                <input value={f.checkNumber} onChange={e => { group.current = newGroup(); setF(p => ({ ...p, checkNumber: e.target.value })); }} placeholder="Check no. *" aria-label="Check number" maxLength={40} className={field} />
                <input value={f.checkBank} onChange={e => setF(p => ({ ...p, checkBank: e.target.value }))} placeholder="Bank (optional)" aria-label="Check bank" maxLength={60} className={field} />
                <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Date on the check
                  <input type="date" value={f.checkDate} onChange={e => setF(p => ({ ...p, checkDate: e.target.value }))} aria-label="Date on the check" className={`${field} w-full mt-1`} /></label>
              </>
            ) : (
              <input value={f.referenceNumber} onChange={e => setF(p => ({ ...p, referenceNumber: e.target.value }))} placeholder="Reference no. * (OR, transfer or GCash ref)" aria-label="Reference number" maxLength={60} className={field} />
            )}
            <input value={f.collectedBy} onChange={e => setF(p => ({ ...p, collectedBy: e.target.value }))} placeholder="Collected by (optional)" aria-label="Collected by" maxLength={80} className={field} />
          </div>
          {client && over > 0.004 && <p className="text-xs font-bold text-danger">That is {peso(over)} more than {client.name} owes. Enter {peso(client.owed)} or less.</p>}
          {client && amount > 0 && over <= 0.004 && (
            <div className="text-xs text-fg/80 space-y-0.5">
              <p className="font-bold text-fg">It will settle:</p>
              {plan.slice(0, 8).map(p => (
                <p key={p.order._id} className="flex justify-between gap-3 tabular-nums">
                  <span>{p.order.orderNumber} · {formatDate(p.order.createdAt)}</span>
                  <span>{peso(p.take)}{p.take < r2(p.order.balance ?? p.order.total) - 0.004 ? ` of ${peso(p.order.balance ?? p.order.total)}` : ''}</span>
                </p>
              ))}
              {plan.length > 8 && <p className="text-fg/65">...and {plan.length - 8} more</p>}
            </div>
          )}
          {isCheck && <p className="text-[11px] text-fg/65">One check can pay several sales. In the check register it is deposited, cleared or bounced as one check, across every sale it paid.</p>}
          <button type="submit" disabled={!ready} className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40">
            {busy ? `Settling ${busy.done} of ${busy.total}…` : 'Collect'}
          </button>
        </form>
      )}
    </div>
  );
}
