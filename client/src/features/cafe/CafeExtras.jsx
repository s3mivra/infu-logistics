import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Star, Trash2, X } from 'lucide-react';
import * as ui from '../../shared/ui';
import { monthStartStr, todayStr } from '../../shared/businessDay.js';

import PagedRows from '../../shared/PagedRows';
// What a cafe keeps beside its books: tips, a stamp card for regulars, what
// customers thought of their order, and what to prepare for tomorrow. None of
// it posts to the ledger. A logistics business has none of these screens.
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const btn = 'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition';
const btnBrand = `${btn} bg-brand text-on-brand hover:bg-brand/90 disabled:opacity-50`;
const btnGhost = `${btn} bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg`;
const input = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const th = 'px-3 py-2 text-[10px] font-black uppercase tracking-wider text-fg/65';
const td = 'px-3 py-2 text-xs';
const Card = ({ children, className = '' }) => <div className={`bg-surface border border-white/10 rounded-xl ${className}`}>{children}</div>;
const Empty = ({ children }) => <p className="text-fg/65 text-sm text-center p-8 font-bold">{children}</p>;
const Tile = ({ label, value, hint }) => (
  <Card className="px-4 py-3">
    <p className="text-[10px] font-black uppercase tracking-wider text-fg/65">{label}</p>
    <p className="text-xl font-black tabular-nums text-fg mt-0.5">{value}</p>
    {hint && <p className="text-[10px] text-fg/65 mt-0.5">{hint}</p>}
  </Card>
);
const when = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const send = async (apiFetch, path, method, body) => (await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json();

// ── TIPS ────────────────────────────────────────────────────────────────────
export function TipsPanel({ apiFetch, can }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ amount: '', method: 'Cash', note: '' });
  const [shares, setShares] = useState([{ name: '', amount: '' }]);
  const [busy, setBusy] = useState(false);
  const canPayOut = !!can?.('scheduling.manage');
  const load = useCallback(async () => {
    try {
      const d = await send(apiFetch, `/api/tips?start=${monthStartStr()}&end=${todayStr()}`, 'GET');
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load tips.');
    } catch { ui.alert('Network error.'); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!(Number(f.amount) > 0)) return;
    setBusy(true);
    try {
      const d = await send(apiFetch, '/api/tips', 'POST', { amount: Number(f.amount), method: f.method, note: f.note });
      if (!d.success) return ui.alert(d.error || 'Could not record the tip.');
      setF({ amount: '', method: f.method, note: '' });
      load();
    } catch { ui.alert('Network error.'); } finally { setBusy(false); }
  };
  const remove = async (t) => {
    if (!(await ui.holdForUndo(`Removing the ${peso(t.amount)} tip…`))) return;
    const d = await send(apiFetch, `/api/tips/${t._id}`, 'DELETE').catch(() => ({}));
    if (!d.success) return ui.alert(d.error || 'Could not remove it.');
    load();
  };
  const given = Math.round(shares.reduce((t, s) => t + (Number(s.amount) || 0), 0) * 100) / 100;
  const left = data ? Math.round((data.pool - given) * 100) / 100 : 0;
  const splitEvenly = () => {
    const named = shares.filter(s => s.name.trim());
    if (!named.length || !data) return;
    const cents = Math.round(data.pool * 100), each = Math.floor(cents / named.length);
    // The odd centavos go to the first names, so the shares add up exactly.
    setShares(named.map((s, i) => ({ name: s.name, amount: ((each + (i < cents - each * named.length ? 1 : 0)) / 100).toFixed(2) })));
  };
  const payOut = async () => {
    const list = shares.filter(s => s.name.trim() && Number(s.amount) > 0).map(s => ({ name: s.name.trim(), amount: Number(s.amount) }));
    if (!(await ui.confirm({ title: `Share out ${peso(data.pool)}?`, message: list.map(s => `${s.name}: ${peso(s.amount)}`).join('\n'), confirmLabel: 'Share out' }))) return;
    setBusy(true);
    try {
      const d = await send(apiFetch, '/api/tips/payout', 'POST', { shares: list });
      if (!d.success) return ui.alert(d.error || 'Could not share out the tips.');
      ui.toast('Tips shared out.', { tone: 'success' });
      setShares([{ name: '', amount: '' }]);
      load();
    } catch { ui.alert('Network error.'); } finally { setBusy(false); }
  };

  if (!data) return <Empty>Loading…</Empty>;
  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-xs text-fg/65 max-w-2xl">Tips left for the staff, and each time the pool is shared out. This is a record only: tips are the staff's money, not the shop's income, so nothing here is posted to the books.</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label="In the pool" value={peso(data.pool)} hint={`${data.poolCount} tip(s) not yet shared out`} />
        <Tile label="Collected this month" value={peso(data.collected)} hint={`${data.tips.length} tip(s)`} />
        <Tile label="Payouts this month" value={data.payouts.length} hint={peso(data.payouts.reduce((t, p) => t + p.total, 0))} />
      </div>
      <Card className="p-4">
        <p className="text-xs font-black uppercase tracking-wider text-fg mb-2">Record a tip</p>
        <form onSubmit={add} className="flex items-end gap-2 flex-wrap">
          <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} placeholder="Amount" aria-label="Tip amount" className={`${input} w-32`} />
          <select value={f.method} onChange={e => setF(p => ({ ...p, method: e.target.value }))} aria-label="How it was given" className={input}>
            {['Cash', 'GCash', 'Maya', 'Card', 'Other'].map(m => <option key={m}>{m}</option>)}
          </select>
          <input value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))} placeholder="Note (optional)" aria-label="Tip note" maxLength={300} className={`${input} flex-1 min-w-[140px]`} />
          <button type="submit" disabled={busy || !(Number(f.amount) > 0)} className={btnBrand}>Add tip</button>
        </form>
      </Card>
      {canPayOut && data.pool > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-fg">Share out the pool · {peso(data.pool)}</p>
          {shares.map((s, i) => (
            <div key={i} className="flex gap-2 flex-wrap">
              <input value={s.name} onChange={e => setShares(l => l.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" aria-label={`Share ${i + 1} name`} maxLength={80} className={`${input} flex-1 min-w-[140px]`} />
              <input type="number" min="0" step="0.01" value={s.amount} onChange={e => setShares(l => l.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} placeholder="Amount" aria-label={`Share ${i + 1} amount`} className={`${input} w-32`} />
              {shares.length > 1 && <button type="button" onClick={() => setShares(l => l.filter((_, n) => n !== i))} aria-label="Remove this share" className="text-fg/65 hover:text-danger px-2"><X size={14} /></button>}
            </div>
          ))}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setShares(l => [...l, { name: '', amount: '' }])} className={btnGhost}>Add a person</button>
            <button type="button" onClick={splitEvenly} className={btnGhost}>Split evenly</button>
            <span className={`text-xs font-bold ${left === 0 ? 'text-success' : 'text-danger'}`}>{left === 0 ? 'Adds up to the pool' : left > 0 ? `${peso(left)} still to share` : `${peso(-left)} more than the pool`}</span>
            <button type="button" onClick={payOut} disabled={busy || left !== 0} className={`${btnBrand} ml-auto`}>Share out</button>
          </div>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-left min-w-[520px]">
          <thead><tr><th className={th}>When</th><th className={`${th} text-right`}>Amount</th><th className={th}>How</th><th className={th}>Note</th><th className={th}>Recorded by</th><th className={th}></th></tr></thead>
          <tbody>
            {data.tips.length === 0 && <tr><td colSpan={6}><Empty>No tips recorded this month.</Empty></td></tr>}
            <PagedRows items={data.tips} label="tips" render={t => (
              <tr key={t._id} className="border-t border-white/5">
                <td className={`${td} text-fg/80 whitespace-nowrap`}>{when(t.date)}</td>
                <td className={`${td} text-right font-mono text-fg`}>{peso(t.amount)}</td>
                <td className={`${td} text-fg/80`}>{t.method}</td>
                <td className={`${td} text-fg/80`}>{t.note}</td>
                <td className={`${td} text-fg/80`}>{t.recordedBy}</td>
                <td className={`${td} text-right`}>{t.payoutId ? <span className="text-[10px] text-fg/65">shared out</span>
                  : <button type="button" onClick={() => remove(t)} aria-label="Remove this tip" className="text-fg/65 hover:text-danger"><Trash2 size={13} /></button>}</td>
              </tr>
            )} />
          </tbody>
        </table>
      </Card>
      {data.payouts.length > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-fg">Payouts this month</p>
          {data.payouts.map(p => (
            <div key={p._id} className="text-xs text-fg/80 border-t border-white/5 pt-2 first:border-0 first:pt-0">
              <span className="font-bold text-fg">{peso(p.total)}</span> · {when(p.date)} · by {p.paidBy}
              <span className="block text-fg/70">{p.shares.map(s => `${s.name} ${peso(s.amount)}`).join(' · ')}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── LOYALTY (a window opened from the till) ─────────────────────────────────
export function LoyaltyDialog({ apiFetch, onClose }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [card, setCard] = useState(null);
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const call = async (fn) => { setBusy(true); try { await fn(); } catch { ui.alert('Network error.'); } finally { setBusy(false); } };
  const look = (e) => { e?.preventDefault(); call(async () => {
    const d = await send(apiFetch, `/api/loyalty/card?phone=${encodeURIComponent(phone)}`, 'GET');
    if (!d.success) return ui.alert(d.error || 'Could not look up that number.');
    setCard(d.card); setFound(d.found); setName(d.card.name || '');
  }); };
  const stamp = (n) => call(async () => {
    const d = await send(apiFetch, '/api/loyalty/stamp', 'POST', { phone, name, stamps: n });
    if (!d.success) return ui.alert(d.error || 'Could not add the stamp.');
    setCard(d.card); setFound(true);
    ui.toast(d.card.rewardsAvailable > 0 ? `Stamped - a reward is ready!` : `Stamped - ${d.card.toNext} to go.`, { tone: 'success' });
  });
  const redeem = () => call(async () => {
    if (!(await ui.confirm({ title: 'Give the reward?', message: 'Ring the free item up as a complimentary order, so stock and the books see it.', confirmLabel: 'Reward given' }))) return;
    const d = await send(apiFetch, '/api/loyalty/redeem', 'POST', { phone });
    if (!d.success) return ui.alert(d.error || 'Could not redeem.');
    setCard(d.card);
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Loyalty card" className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3 my-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-fg text-lg">Loyalty card</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-fg/65 hover:text-fg"><X size={18} /></button>
        </div>
        <form onSubmit={look} className="flex gap-2">
          <input value={phone} onChange={e => { setPhone(e.target.value); setCard(null); }} placeholder="Phone number" aria-label="Customer phone number" inputMode="tel" autoFocus className={`${input} flex-1`} />
          <button type="submit" disabled={busy || phone.replace(/\D/g, '').length < 7} className={btnBrand}>Find</button>
        </form>
        {card && (
          <div className="space-y-3">
            {!found && <p className="text-xs text-fg/70">No card for this number yet. The first stamp starts one.</p>}
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Customer name" maxLength={80} className={`${input} w-full`} />
            <div className="flex flex-wrap gap-1.5" aria-label={`${card.onCard} of ${card.perReward} stamps`}>
              {Array.from({ length: card.perReward }, (_, i) => (
                <span key={i} className={`w-7 h-7 rounded-full border flex items-center justify-center ${i < card.onCard ? 'bg-brand border-brand text-on-brand' : 'border-white/20 text-fg/30'}`}><Star size={13} /></span>
              ))}
            </div>
            <p className="text-xs text-fg/80">{card.onCard} of {card.perReward} · {card.toNext} to the next reward · {card.stamps} stamp(s) in all</p>
            {card.rewardsAvailable > 0 && <p className="text-sm font-black text-success">{card.rewardsAvailable} reward(s) ready to give.</p>}
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => stamp(1)} disabled={busy} className={btnBrand}>Add a stamp</button>
              <button type="button" onClick={() => stamp(2)} disabled={busy} className={btnGhost}>+2</button>
              {card.rewardsAvailable > 0 && <button type="button" onClick={redeem} disabled={busy} className={`${btn} border border-success text-success hover:bg-success/10 ml-auto`}>Give reward</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FEEDBACK ────────────────────────────────────────────────────────────────
function useRange(apiFetch, path) {
  const [range, setRange] = useState({ start: monthStartStr(), end: todayStr() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await send(apiFetch, `${path}?start=${range.start}&end=${range.end}`, 'GET');
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load.');
    } catch { ui.alert('Network error.'); } finally { setLoading(false); }
  }, [apiFetch, path, range.start, range.end]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { range, setRange, data, loading, load };
}
const Stars = ({ n }) => <span className="whitespace-nowrap" aria-label={`${n} of 5 stars`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={12} className={`inline ${i <= n ? 'text-brand-text fill-current' : 'text-fg/25'}`} />)}</span>;

export function FeedbackReport({ apiFetch }) {
  const { range, setRange, data, loading, load } = useRange(apiFetch, '/api/reports/feedback');
  const [lowOnly, setLowOnly] = useState(false);
  const max = data ? Math.max(1, ...data.counts.map(c => c.count)) : 1;
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">What customers said after ordering from the table QR: a rating out of five and, if they wrote one, a comment. One per order.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <input type="date" value={range.start} max={range.end} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} aria-label="From" className={input} />
          <input type="date" value={range.end} min={range.start} max={todayStr()} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} aria-label="To" className={input} />
          <button type="button" onClick={load} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : data.count === 0 ? <Empty>No feedback from {data.start} to {data.end}.</Empty> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Tile label="Average" value={`${data.average} / 5`} hint={`${data.count} rating(s)`} />
            <Tile label="1 or 2 stars" value={data.low} hint={data.low ? 'worth reading first' : 'none'} />
            <Card className="px-4 py-3 col-span-2 lg:col-span-1">
              {[...data.counts].reverse().map(c => (
                <div key={c.stars} className="flex items-center gap-2 text-[11px] text-fg/80">
                  <span className="w-4 tabular-nums">{c.stars}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-brand" style={{ width: `${Math.round((c.count / max) * 100)}%` }} /></div>
                  <span className="w-6 text-right tabular-nums">{c.count}</span>
                </div>
              ))}
            </Card>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-fg/80"><input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Only 1 and 2 stars</label>
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[520px]">
              <thead><tr><th className={th}>When</th><th className={th}>Rating</th><th className={th}>Comment</th><th className={th}>Order</th></tr></thead>
              <tbody>
                <PagedRows items={data.entries.filter(e => !lowOnly || e.rating <= 2)} label="entries" render={(e, i) => (
                  <tr key={`${e.orderNumber}-${i}`} className="border-t border-white/5">
                    <td className={`${td} text-fg/80 whitespace-nowrap`}>{when(e.at)}</td>
                    <td className={td}><Stars n={e.rating} /></td>
                    <td className={`${td} text-fg`}>{e.comment || <span className="text-fg/65">(no comment)</span>}</td>
                    <td className={`${td} text-fg/80 whitespace-nowrap`}>{e.orderNumber}{e.table && <span className="text-fg/65"> · {e.table}</span>}</td>
                  </tr>
                )} />
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── PREP LIST ───────────────────────────────────────────────────────────────
export function PrepListReport({ apiFetch }) {
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [date, setDate] = useState(tomorrow);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (d = date) => {
    setLoading(true);
    try {
      const r = await send(apiFetch, `/api/reports/prep-list?date=${d}`, 'GET');
      if (r.success) setData(r); else ui.alert(r.error || 'Could not load the prep list.');
    } catch { ui.alert('Network error.'); } finally { setLoading(false); }
  }, [apiFetch, date]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <p className="text-xs text-fg/65 max-w-xl">What usually sells on that weekday: each product's average over the last few of the same weekday, rounded up, beside the most and the least it sold on one of them. A guide for what to prepare ahead - weather, a holiday or a promo will still move it.</p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">For
            <input type="date" value={date} onChange={e => { setDate(e.target.value); if (e.target.value) load(e.target.value); }} className={`${input} block mt-1`} /></label>
          <button type="button" onClick={() => load()} disabled={loading} className={btnBrand}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          {data?.products?.length > 0 && <button type="button" onClick={() => window.print()} className={btnGhost}>Print</button>}
        </div>
      </div>
      {!data ? <Empty>{loading ? 'Loading…' : 'Refresh to load.'}</Empty> : data.products.length === 0 ? (
        <Empty>{data.note || `Nothing sold on the last few ${data.weekday}s to go by.`}</Empty>
      ) : (
        <>
          <p className="text-sm font-black text-fg">{data.weekday}, {data.date} · about {data.totalToPrepare} item(s) · from {data.days.length} earlier {data.weekday}(s)</p>
          <Card className="overflow-x-auto">
            <table className="w-full text-left min-w-[480px]">
              <thead><tr><th className={th}>Product</th><th className={`${th} text-right`}>Prepare</th><th className={`${th} text-right`}>Average</th><th className={`${th} text-right`}>Most · least</th><th className={`${th} text-right`}>Sold on</th></tr></thead>
              <tbody>
                {data.products.map(p => (
                  <tr key={p.name} className="border-t border-white/5">
                    <td className={`${td} text-fg font-bold`}>{p.name}</td>
                    <td className={`${td} text-right font-mono text-fg font-bold`}>{p.prepare}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{p.average}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{p.most} · {p.least}</td>
                    <td className={`${td} text-right tabular-nums text-fg/80`}>{p.soldOn} of {data.days.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ── RATE THIS ORDER (shown to the customer after ordering from the QR) ──────
export function RateOrder({ apiUrl, orderId }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [state, setState] = useState('ask');   // ask | sending | thanks | gone
  if (!orderId || state === 'gone') return null;
  const submit = async () => {
    if (!rating) return;
    setState('sending');
    try {
      const r = await fetch(`${apiUrl}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, rating, comment }) });
      // Already rated, or the order is too old: either way there is nothing more to ask.
      setState(r.ok || r.status === 409 ? 'thanks' : 'gone');
    } catch { setState('ask'); }
  };
  if (state === 'thanks') return <p className="text-sm font-bold text-fg/80 mt-6">Thank you - we read every one.</p>;
  return (
    <div className="mt-6 w-full max-w-sm mx-auto text-left bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-black text-fg text-center">How was your order?</p>
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(n)} className="p-1.5">
            <Star size={30} className={n <= rating ? 'text-brand-text fill-current' : 'text-fg/30'} />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={500} rows={2} placeholder="Anything to tell us? (optional)" aria-label="Comment" className={`${input} w-full`} />
          <button type="button" onClick={submit} disabled={state === 'sending'} className={`${btnBrand} w-full justify-center`}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
        </>
      )}
    </div>
  );
}
