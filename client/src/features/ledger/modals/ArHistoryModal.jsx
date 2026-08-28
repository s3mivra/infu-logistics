import { X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Every collection posted against ONE receivable, oldest first, with the
// running balance after each. This is the "why does this ₱1,700 invoice still
// show ₱200 outstanding" answer, without sending anyone into the general
// ledger to reconstruct it from journal entries.
export default function ArHistoryModal() {
  const { arHistory, setArHistory, arHistoryLoading } = useDashboard();

  if (!arHistory) return null;

  const { order, payments, totalPaid, balance } = arHistory;
  const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (d) => (d ? new Date(d).toLocaleDateString() : '—');

  return (
    <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) setArHistory(null); }} role="dialog" aria-modal="true" aria-label="A/R payment history">
      <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl shadow-elev-3 flex flex-col max-h-[92vh] animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-fg font-black text-lg">Payment History</h2>
            <p className="text-fg/40 text-xs mt-0.5">{order.orderNumber} · {order.customerName || 'No name'}</p>
          </div>
          <button onClick={() => setArHistory(null)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-fg/40 text-[10px] font-bold uppercase">Invoiced</p>
              <p className="text-xl text-fg font-black tabular-nums">{peso(order.total)}</p>
            </div>
            <div className="bg-green-500/10 rounded-xl p-3 border border-green-500/20">
              <p className="text-fg/40 text-[10px] font-bold uppercase">Collected</p>
              <p className="text-xl text-green-400 font-black tabular-nums">{peso(totalPaid)}</p>
            </div>
            <div className={`rounded-xl p-3 border ${balance > 0.01 ? 'bg-brand/10 border-brand/25' : 'bg-white/5 border-white/10'}`}>
              <p className="text-fg/40 text-[10px] font-bold uppercase">Balance</p>
              <p className={`text-xl font-black tabular-nums ${balance > 0.01 ? 'text-brand' : 'text-fg/40'}`}>{peso(balance)}</p>
            </div>
          </div>

          {arHistoryLoading ? (
            <div className="py-12 text-center text-fg/40 font-bold uppercase tracking-widest text-xs">Loading…</div>
          ) : !payments?.length ? (
            <div className="py-12 text-center text-fg/40 font-bold uppercase tracking-widest text-xs">No collections recorded yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg/50 text-[10px] uppercase tracking-widest border-b border-white/10">
                    <th className="text-left py-2.5">Collected</th>
                    <th className="text-left py-2.5">Deposited</th>
                    <th className="text-left py-2.5">To</th>
                    <th className="text-left py-2.5">Reference</th>
                    <th className="text-right py-2.5">Amount</th>
                    <th className="text-right py-2.5">Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={p._id || i} className="border-b border-white/5">
                      <td className="py-2.5 text-fg/70 text-xs">
                        {day(p.collectionDate)}
                        {p.collectedBy && <span className="block text-[9px] text-fg/35">by {p.collectedBy}</span>}
                      </td>
                      <td className="py-2.5 text-fg/70 text-xs">
                        {day(p.depositDate)}
                        {/* Money that sat with the collector before banking -
                            the gap where cash goes missing. */}
                        {p.depositDate && p.collectionDate && new Date(p.depositDate) > new Date(p.collectionDate) && (
                          <span className="block text-[9px] text-yellow-500/70">
                            +{Math.round((new Date(p.depositDate) - new Date(p.collectionDate)) / 86400000)}d float
                          </span>
                        )}
                      </td>
                      <td className="py-2.5"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/15 text-brand px-2 py-1 rounded">{p.paymentMethod || '—'}</span></td>
                      <td className="py-2.5 text-fg/50 text-xs">
                        {p.referenceNumber || <span className="text-fg/20">—</span>}
                        {p.note && <span className="block text-[9px] text-fg/30 italic">{p.note}</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-bold text-green-400">{peso(p.amount)}</td>
                      <td className={`py-2.5 text-right tabular-nums font-black ${p.balanceAfter > 0.01 ? 'text-fg' : 'text-fg/30'}`}>{peso(p.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
