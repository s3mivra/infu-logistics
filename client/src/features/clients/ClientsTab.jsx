import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Users, Search, ChevronDown, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import { io } from 'socket.io-client';
import { useDashboard } from '../dashboard/DashboardContext';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';
const socket = io(API_URL, { transports: ['websocket'], upgrade: false });

// Clients - who we sell to, what they owe, and how close they are to their limit.
//
// Previously this lived only inside the SuperAdmin panel as a registration form,
// so answering "how much does this client owe me?" meant visiting three tabs.
// SuperAdmin keeps account creation; this is the operational view.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

export default function ClientsTab() {
  const { apiFetch } = useDashboard();
  const [data, setData] = useState({ clients: [], showMoney: false, mode: 'off' });
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [orders, setOrders] = useState({});   // clientId -> orders[]

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/clients/summary');
      const d = await res.json();
      if (d.success) setData({ clients: d.clients || [], showMoney: !!d.showMoney, mode: d.mode });
    } catch { /* leave the last good view in place */ }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // Keep payment method (and status) live when staff change it in Orders/POS.
  // orderUpdated carries the full updated order object; patch it in-place so
  // the client row reflects the change without a full reload.
  useEffect(() => {
    const onOrderUpdated = (updated) => {
      if (!updated?._id) return;
      setOrders(prev => {
        const next = { ...prev };
        for (const [clientId, list] of Object.entries(next)) {
          const idx = list.findIndex(o => String(o._id) === String(updated._id));
          if (idx !== -1) {
            const newList = [...list];
            newList[idx] = { ...newList[idx], ...updated };
            next[clientId] = newList;
          }
        }
        return next;
      });
      // Also refresh the summary totals (owing/committed may have changed).
      load();
    };
    socket.on('orderUpdated', onOrderUpdated);
    return () => socket.off('orderUpdated', onOrderUpdated);
  }, [load]);

  // Orders are fetched only when a row is opened, so the summary stays one call.
  const toggle = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (orders[id]) return;
    try {
      const res = await apiFetch(`/api/clients/${id}/orders`);
      const d = await res.json();
      if (d.success) setOrders(o => ({ ...o, [id]: d.orders || [] }));
    } catch { /* row simply stays empty */ }
  };

  const term = q.trim().toLowerCase();
  const rows = term
    ? data.clients.filter(c =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.username || '').toLowerCase().includes(term) ||
        (c.clientCode || '').toLowerCase().includes(term))
    : data.clients;

  const overLimitCount = data.clients.filter(c => c.overLimit).length;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
          <Users size={19} className="text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-fg leading-none">Clients</h1>
          <p className="text-fg/40 text-xs font-bold mt-1">
            {data.clients.length} account{data.clients.length === 1 ? '' : 's'}
            {data.showMoney && overLimitCount > 0 && (
              <span className="text-red-400"> · {overLimitCount} over limit</span>
            )}
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search clients…"
            className="bg-surface border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-fg text-sm placeholder-white/25 outline-none focus:border-brand/60 transition w-full sm:w-64"
          />
        </div>
        <button onClick={load} disabled={loading}
          className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/40 hover:text-fg flex items-center justify-center transition disabled:opacity-40"
          aria-label="Refresh clients">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {!data.showMoney && (
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-fg/40 text-xs font-bold">
          <AlertCircle size={14} />
          Balances and credit limits are hidden - they need the accounting permission.
        </div>
      )}

      <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-accent text-white text-[10px] uppercase tracking-widest border-b border-white/10">
              <th className="text-left py-3 px-4">Client</th>
              <th className="text-left py-3">Code</th>
              <th className="text-right py-3">Orders</th>
              <th className="text-right py-3">Last Order</th>
              {data.showMoney && <>
                <th className="text-right py-3">Owing (A/R)</th>
                <th className="text-right py-3">Committed</th>
                <th className="text-right py-3 px-4">Limit / Left</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={data.showMoney ? 7 : 4} className="py-14 text-center text-fg/30 font-bold">
                  {loading ? 'Loading…' : q ? 'No clients match that search.' : 'No client accounts yet - add one in the Admin Panel.'}
                </td>
              </tr>
            ) : rows.map(c => (
              <Fragment key={c._id}>
                <tr
                  onClick={() => toggle(c._id)}
                  className={`border-b border-white/5 cursor-pointer hover:bg-white/5 transition ${c.overLimit ? 'bg-red-500/5' : ''}`}>
                  <td className="py-3 px-4 font-bold text-fg">
                    <span className="inline-flex items-center gap-2">
                      {expanded === c._id ? <ChevronDown size={13} className="text-fg/60" /> : <ChevronRight size={13} className="text-fg/30" />}
                      {c.name}
                      {!c.isActive && <span className="text-[8px] font-black bg-white/10 text-fg/60 px-1.5 py-0.5 rounded uppercase">Inactive</span>}
                      {c.overLimit && <span className="text-[8px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase">Over</span>}
                      {c.source === 'pos' && <span className="text-[8px] font-black bg-white/10 text-fg/40 px-1.5 py-0.5 rounded uppercase" title="Auto-promoted repeat walk-in">Walk-in</span>}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-fg/100 text-xs">{c.clientCode}</td>
                  <td className="py-3 text-right tabular-nums text-fg/100">{c.orderCount}</td>
                  <td className="py-3 text-right text-fg/100 text-xs whitespace-nowrap">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' }) : '-'}
                  </td>
                  {data.showMoney && <>
                    <td className="py-3 text-right tabular-nums font-black text-fg/100">{c.aged?.total ? peso(c.aged.total) : '-'}</td>
                    <td className="py-3 text-right tabular-nums text-brand/80">{c.exposure ? peso(c.exposure) : '-'}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-xs">
                      {c.creditLimit === null || c.creditLimit === undefined
                        ? <span className="text-fg/100">No limit</span>
                        : <span className={c.overLimit ? 'text-red-400 font-bold' : 'text-fg/100'}>
                            ₱{c.creditLimit.toLocaleString('en-PH')} <span className="text-fg/100">/</span> ₱{(c.available ?? 0).toLocaleString('en-PH')}
                          </span>}
                    </td>
                  </>}
                </tr>

                {expanded === c._id && (
                  <tr className="bg-page-bg/40">
                    <td colSpan={data.showMoney ? 7 : 4} className="px-4 py-3">
                      {data.showMoney && c.aged && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {[['Current', c.aged.current], ['31–60', c.aged.d31_60], ['61–90', c.aged.d61_90], ['91+', c.aged.d90_plus]].map(([lbl, amt]) => (
                            <span key={lbl} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                              <span className="text-fg/70 font-bold">{lbl}</span>
                              <span className={`font-black tabular-nums ml-2 ${amt > 0 ? 'text-fg' : 'text-fg/60'}`}>{peso(amt)}</span>
                            </span>
                          ))}
                          {typeof c.lifetimeValue === 'number' && (
                            <span className="bg-brand/10 border border-brand/25 rounded-lg px-3 py-1.5 text-xs">
                              <span className="text-brand/80 font-bold">Lifetime</span>
                              <span className="text-brand font-black tabular-nums ml-2">{peso(c.lifetimeValue)}</span>
                            </span>
                          )}
                        </div>
                      )}
                      {!orders[c._id] ? (
                        <p className="text-fg/30 text-xs font-bold py-2">Loading orders…</p>
                      ) : orders[c._id].length === 0 ? (
                        <p className="text-fg/30 text-xs font-bold py-2">No orders yet.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-fg/100 text-[9px] uppercase tracking-wider border-b border-white/5">
                              <th className="text-left py-1.5">Order</th>
                              <th className="text-left py-1.5">Date</th>
                              <th className="text-left py-1.5">Status</th>
                              <th className="text-left py-1.5">Payment</th>
                              <th className="text-right py-1.5">Items</th>
                              <th className="text-right py-1.5">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders[c._id].map(o => (
                              <tr key={o._id} className="border-b border-white/5">
                                <td className="py-1.5 font-mono text-fg/60">{o.billingNumber || o.orderNumber}</td>
                                <td className="py-1.5 text-fg/80">{new Date(o.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                                <td className="py-1.5 text-fg/80">{o.status}</td>
                                <td className="py-1.5 text-fg/80">
                                  {o.paymentMethod}
                                  {o.paymentMethod !== 'Cash' && !o.arSettled && o.status === 'Completed' && (
                                    <span className="ml-1.5 text-[8px] font-black bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded uppercase">Unsettled</span>
                                  )}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-fg/80">{o.itemCount}</td>
                                <td className="py-1.5 text-right tabular-nums font-bold text-fg">{peso(o.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
