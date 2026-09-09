import { useCallback, useEffect, useState } from 'react';
import {
  FileText, RefreshCw, ChevronLeft, Send, Clock, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import * as ui from '../../shared/ui';

// Quotations - prices asked for, not sales made.
//
// Nothing on this screen posts. A quotation is a conversation about a price;
// only the client accepting it, and the order that follows, reaches the
// ledger. The screen says so out loud, because a list of large numbers that
// looks like a sales pipeline invites someone to read it as revenue.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');
const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:border-brand/50 focus:outline-none';

const STATUS = {
  Requested: { tone: 'text-amber-400 bg-amber-400/10', icon: Clock, blurb: 'Waiting for you to price it' },
  Quoted:    { tone: 'text-brand bg-brand/10', icon: Send, blurb: 'Sent, waiting on the client' },
  Accepted:  { tone: 'text-green-400 bg-green-400/10', icon: CheckCircle, blurb: 'Accepted' },
  Declined:  { tone: 'text-fg/40 bg-white/5', icon: XCircle, blurb: 'Declined' },
  Expired:   { tone: 'text-fg/40 bg-white/5', icon: AlertCircle, blurb: 'Ran past its validity date' },
};

export default function QuotationsTab() {
  const { apiFetch } = useDashboard();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ waiting: 0, quoted: 0, accepted: 0 });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = status ? `?status=${status}` : '';
      const d = await (await apiFetch(`/api/quotations${qs}`)).json();
      if (d.success) { setRows(d.quotations || []); setCounts(d.counts || {}); }
      else ui.alert(d.error || 'Could not load quotations.');
    } catch { /* keep the last good view */ }
    finally { setLoading(false); }
  }, [apiFetch, status]);

  useEffect(() => { load(); }, [load]);

  if (open) {
    return <QuoteSheet id={open} apiFetch={apiFetch} onBack={() => { setOpen(null); load(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-black text-fg text-lg mr-auto">
          <FileText size={18} /> Quotations
        </h1>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="bg-sidebar-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-fg focus:border-brand/50 focus:outline-none">
          <option value="">Every status</option>
          <option value="Requested">Waiting to be priced</option>
          <option value="Quoted">Sent to the client</option>
          <option value="Accepted">Accepted</option>
          <option value="Declined">Declined</option>
        </select>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <p className="text-xs text-fg/50 leading-relaxed max-w-3xl">
        A price a client has asked for. None of this is a sale and none of it is in the books - the
        figures here are what you have offered, not what you have earned. Only the client accepting,
        and the order that follows, reaches the ledger.
      </p>

      <div className="grid grid-cols-3 gap-2">
        {[
          ['Waiting on you', counts.waiting, counts.waiting > 0 ? 'text-amber-400' : 'text-fg/40'],
          ['Waiting on them', counts.quoted, 'text-fg'],
          ['Accepted', counts.accepted, 'text-green-400'],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-sidebar-bg border border-white/10 rounded-xl p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-fg/40">{label}</p>
            <p className={`text-lg font-black tabular-nums ${cls}`}>{val ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2.5">Quote</th>
                <th className="text-left px-3 py-2.5">Client</th>
                <th className="text-left px-3 py-2.5">Asked</th>
                <th className="text-right px-3 py-2.5">They expected</th>
                <th className="text-right px-3 py-2.5">You quoted</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-fg/40">
                  {loading ? 'Loading…' : 'No quotations yet.'}
                </td></tr>
              )}
              {rows.map(q => {
                const st = STATUS[q.status] || STATUS.Requested;
                const Icon = st.icon;
                return (
                  <tr key={q._id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-bold text-fg">{q.quoteNumber}</td>
                    <td className="px-3 py-2.5 text-fg/70">{q.clientName}</td>
                    <td className="px-3 py-2.5 text-fg/50">{shortDate(q.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg/50">{peso(q.askedTotal)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-fg">
                      {q.quotedTotal == null ? <span className="text-fg/25">not priced</span> : peso(q.quotedTotal)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${st.tone}`}>
                        <Icon size={9} /> {q.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setOpen(q._id)}
                        className="text-[9px] bg-brand/10 hover:bg-brand/20 text-brand px-2.5 py-1 rounded font-bold uppercase tracking-wider transition">
                        {q.status === 'Requested' ? 'Price it' : 'Open'}
                      </button>
                    </td>
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

// Pricing one. Every line has to carry a number before it can go back: a
// half-priced quote is something the client cannot act on.
function QuoteSheet({ id, apiFetch, onBack }) {
  const [q, setQ] = useState(null);
  const [prices, setPrices] = useState({});
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch(`/api/quotations/${id}`)).json();
      if (!d.success) { ui.alert(d.error || 'Could not open that quotation.'); return; }
      setQ(d.quotation);
      setPrices(Object.fromEntries((d.quotation.lines || [])
        .map((l, i) => [i, l.quotedPrice == null ? '' : String(l.quotedPrice)])));
      setValidUntil(d.quotation.validUntil ? String(d.quotation.validUntil).slice(0, 10) : '');
      setNotes(d.quotation.quoteNotes || '');
    } catch { ui.alert('Network error.'); }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const lines = (q.lines || []).map((_, i) => ({ index: i, quotedPrice: prices[i] }));
      const d = await (await apiFetch(`/api/quotations/${id}/quote`, {
        method: 'POST', body: JSON.stringify({ lines, validUntil, quoteNotes: notes }),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Could not send that quote.'); return; }
      ui.alert('Quote sent. Nothing is on the books until they accept it and the order is placed.');
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  if (!q) return <p className="text-fg/40 text-sm">Loading…</p>;

  const total = (q.lines || []).reduce((s, l, i) => s + ((Number(prices[i]) || 0) * (l.quantity || 1)), 0);
  const locked = ['Accepted', 'Declined'].includes(q.status);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-fg/50 hover:text-fg transition">
        <ChevronLeft size={14} /> All quotations
      </button>

      <div>
        <h1 className="font-black text-fg text-lg">{q.quoteNumber} · {q.clientName}</h1>
        <p className="text-xs text-fg/50">
          Asked {shortDate(q.createdAt)} · {q.status}
          {q.validUntil ? ` · valid to ${shortDate(q.validUntil)}` : ''}
          {q.orderNumber ? ` · ordered as ${q.orderNumber}` : ''}
        </p>
      </div>

      {q.clientNotes && (
        <div className="bg-sidebar-bg border border-white/10 rounded-xl px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">What they asked for</p>
          <p className="text-xs text-fg/80 leading-relaxed">{q.clientNotes}</p>
        </div>
      )}

      <div className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[620px]">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40 border-b border-white/10">
                <th className="text-left px-3 py-2.5">Item</th>
                <th className="text-right px-3 py-2.5">Qty</th>
                <th className="text-right px-3 py-2.5">They expected</th>
                <th className="text-right px-3 py-2.5">Your price each</th>
                <th className="text-right px-3 py-2.5">Line</th>
              </tr>
            </thead>
            <tbody>
              {(q.lines || []).map((l, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-3 py-2.5 font-bold text-fg">
                    {l.name}
                    {l.note && <span className="block text-[10px] text-fg/35 font-normal">{l.note}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/70">{l.quantity}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg/40">{peso(l.askedPrice)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <input type="number" min="0" step="0.01" disabled={locked}
                      value={prices[i] ?? ''} placeholder="0.00"
                      onChange={e => setPrices(prev => ({ ...prev, [i]: e.target.value }))}
                      className="w-28 bg-page-bg border border-white/10 rounded px-2 py-1.5 text-xs text-right tabular-nums text-fg focus:border-brand/50 focus:outline-none disabled:opacity-50" />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-fg">
                    {peso((Number(prices[i]) || 0) * (l.quantity || 1))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td colSpan={4} className="px-3 py-2.5 text-right font-black text-fg">Quote total</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-black text-brand">{peso(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {!locked && (
        <div className="bg-sidebar-bg border border-white/10 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">Valid until</span>
              <input type="date" className={inputCls} value={validUntil} onChange={e => setValidUntil(e.target.value)} />
              <span className="block text-[10px] text-fg/35 mt-1">
                A quote with no end date is a price you are bound to forever.
              </span>
            </label>
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-widest text-fg/40 mb-1">Terms</span>
              <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Freight, lead time, anything they should know" />
            </label>
          </div>

          <button onClick={send} disabled={busy}
            className="flex items-center justify-center gap-2 w-full bg-brand hover:bg-brand/90 text-white px-4 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition disabled:opacity-40">
            <Send size={13} /> {busy ? 'Sending…' : q.status === 'Quoted' ? 'Send the revised quote' : 'Send this quote'}
          </button>
          <p className="text-[10px] text-fg/35 text-center">
            Sending posts nothing. The books only move when they accept and the order is placed.
          </p>
        </div>
      )}

      {q.status === 'Accepted' && !q.orderNumber && (
        <p className="flex items-start gap-2 text-[11px] text-amber-400/90 bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-3">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>Accepted, but no order has been placed against it yet. Ring it up at the quoted prices.</span>
        </p>
      )}
    </div>
  );
}
