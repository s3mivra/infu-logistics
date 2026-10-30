import LoadingRows from '../../shared/LoadingRows';
import { X, FileText, Plus, RefreshCw, Minus } from 'lucide-react';
import RevolvingFundLiquidation from './RevolvingFundLiquidation';

import PagedRows from '../../shared/PagedRows';
// Revolving funds: release, spend and replenish.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function RevolvingFundTab({
  ledgerSubTab, exportRevolvingFundsPDF, setRfNewModal, rfLoading, rfFunds, rfActiveFund, closeRfFund, setRfActiveFund,
  setRfDisbForm, setRfDisbModal, setRfReplForm, setRfReplModal, setRfTxs, fetchRfTxs, rfTxTotal, rfTxs,
  rfTxPage, rfTxPages, apiFetch, fetchRfFunds,
}) {
  return (
    <>
    {ledgerSubTab === 'revolving' && (
      <div className="space-y-6 animate-fade-in">

        {/* HEADER + NEW FUND BUTTON */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-2xl font-black text-fg">Revolving Funds</h3>
            <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">Petty cash pools - track disbursements and replenishments</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={exportRevolvingFundsPDF} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[44px]">
              Export PDF
            </button>
            <button
              onClick={() => setRfNewModal(true)}
              className="flex items-center gap-2 bg-brand text-on-brand px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px]"
            >
              <Plus size={14}/> New Fund
            </button>
          </div>
        </div>

        {rfLoading && <LoadingRows />}

        {!rfLoading && rfFunds.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <RefreshCw size={32} className="mx-auto text-fg/65"/>
            <p className="text-fg/65 font-bold uppercase tracking-widest text-sm">No revolving funds yet</p>
            <p className="text-fg/65 text-xs">Create a fund to track petty cash and small operational expenses.</p>
          </div>
        )}

        {!rfLoading && rfFunds.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {rfFunds.map(fund => {
              const pct      = fund.initialAmount > 0 ? (fund.currentBalance / fund.initialAmount) * 100 : 0;
              const low      = pct <= 25;
              const isActive = rfActiveFund?._id === fund._id;
              return (
                <div key={fund._id}
                  className={`bg-surface border rounded-2xl p-5 space-y-4 transition ${isActive ? 'border-brand shadow-lg shadow-brand/10' : 'border-white/10'}`}
                >
                  {/* Fund name + close button */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-fg font-black text-base leading-tight">{fund.name}</p>
                      {fund.description && <p className="text-fg/70 text-xs mt-0.5 line-clamp-1">{fund.description}</p>}
                    </div>
                    <button
                      onClick={() => closeRfFund(fund._id)}
                      className="text-fg/65 hover:text-danger transition p-1 shrink-0"
                      title="Close fund"
                    ><X size={13}/></button>
                  </div>

                  {/* Balance display */}
                  <div>
                    <p className="text-fg/70 text-[10px] font-bold uppercase tracking-widest mb-0.5">Current Balance</p>
                    <p className={`text-3xl font-black tabular-nums ${low ? 'text-danger' : 'text-brand-text'}`}>
                      ₱{fund.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-fg/65 text-xs">of ₱{fund.initialAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} initial</p>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="w-full bg-white/10 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${low ? 'bg-danger' : 'bg-brand'}`}
                        style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
                      />
                    </div>
                    <p className={`text-[10px] font-bold ${low ? 'text-danger' : 'text-fg/65'}`}>
                      {pct.toFixed(0)}% remaining{low ? ' - LOW' : ''}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <button
                      onClick={() => { setRfActiveFund(fund); setRfDisbForm({ amount: '', description: '', categoryCode: '760000' }); setRfDisbModal(true); }}
                      className="bg-danger/10 text-danger border border-danger/20 rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider hover:bg-danger/20 transition min-h-[40px]"
                    >
                      <Minus size={11} className="inline mr-1"/>Out
                    </button>
                    <button
                      onClick={() => { setRfActiveFund(fund); setRfReplForm({ amount: (fund.initialAmount - fund.currentBalance).toFixed(2), note: '', sourceAccount: '111000' }); setRfReplModal(true); }}
                      className="bg-brand/10 text-brand-text border border-brand/20 rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider hover:bg-brand/20 transition min-h-[40px]"
                    >
                      <Plus size={11} className="inline mr-1"/>In
                    </button>
                    <button
                      onClick={() => {
                        if (isActive) {
                          // clicking again collapses the history
                          setRfActiveFund(null);
                          setRfTxs([]);
                        } else {
                          setRfActiveFund(fund);
                          setRfTxs([]);
                          fetchRfTxs(fund._id, 1);
                        }
                      }}
                      className={`rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider transition min-h-[40px] border ${isActive ? 'bg-white/10 text-fg border-white/20' : 'bg-white/5 text-fg/70 border-white/10 hover:bg-white/10 hover:text-fg'}`}
                    >
                      <FileText size={11} className="inline mr-1"/>{isActive ? 'Hide' : 'History'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TRANSACTION HISTORY - only shown when a fund is explicitly selected */}
        {rfActiveFund && (
          <div className="bg-surface border border-brand/30 rounded-2xl overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-brand/5">
              <div>
                <h4 className="text-fg font-black text-lg">Transaction History</h4>
                <p className="text-brand-text text-xs font-bold uppercase tracking-widest mt-0.5">{rfActiveFund.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-fg/65 text-xs tabular-nums">{rfTxTotal} {rfTxTotal === 1 ? 'entry' : 'entries'}</span>
                <button
                  onClick={() => { setRfActiveFund(null); setRfTxs([]); }}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-fg/70 hover:text-fg flex items-center justify-center transition"
                  title="Close history"
                ><X size={14}/></button>
              </div>
            </div>

            {/* Table */}
            {rfTxs.length === 0 ? (
              <div className="py-14 text-center">
                <FileText size={28} className="mx-auto text-fg/15 mb-3"/>
                <p className="text-fg/65 text-sm font-bold uppercase tracking-widest">No transactions yet</p>
                <p className="text-fg/65 text-xs mt-1">Disbursements and replenishments will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-fg/70 text-[10px] font-bold uppercase tracking-widest border-b border-white/10 bg-white/2">
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-3 py-3">Type</th>
                      <th className="text-left px-3 py-3">Description</th>
                      <th className="text-left px-3 py-3 hidden sm:table-cell">By</th>
                      <th className="text-right px-3 py-3">Amount</th>
                      <th className="text-right px-6 py-3">Balance After</th>
                    </tr>
                  </thead>
                  <tbody>
                    <PagedRows items={rfTxs} label="transactions" render={(tx, idx) => (
                      <tr key={tx._id} className={`border-b border-white/5 transition hover:bg-white/3 ${idx % 2 === 0 ? '' : 'bg-white/1'}`}>
                        <td className="py-3 px-6 text-fg/75 text-xs tabular-nums whitespace-nowrap">
                          {new Date(tx.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full whitespace-nowrap ${tx.type === 'disbursement' ? 'bg-danger/20 text-danger' : 'bg-brand/20 text-brand-text'}`}>
                            {tx.type === 'disbursement' ? '▼ Out' : '▲ In'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-fg/80 max-w-[200px] truncate">{tx.description}</td>
                        <td className="py-3 px-3 text-fg/70 text-xs hidden sm:table-cell">{tx.performedBy || '-'}</td>
                        <td className={`py-3 px-3 text-right font-black tabular-nums ${tx.type === 'disbursement' ? 'text-danger' : 'text-brand-text'}`}>
                          {tx.type === 'disbursement' ? '−' : '+'}₱{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-6 text-right text-fg/75 tabular-nums text-xs">
                          ₱{(tx.balanceAfter ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )} />
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination - always visible when there are entries */}
            {rfTxTotal > 0 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-white/10 bg-white/1">
                <button
                  disabled={rfTxPage <= 1}
                  onClick={() => fetchRfTxs(rfActiveFund._id, rfTxPage - 1)}
                  className="px-4 py-2 rounded-lg bg-white/5 text-fg/75 font-bold text-xs disabled:opacity-25 hover:bg-white/10 hover:text-fg transition"
                >← Prev</button>
                <span className="text-fg/65 text-xs font-bold">
                  Page {rfTxPage} of {rfTxPages} &nbsp;·&nbsp; {rfTxTotal} {rfTxTotal === 1 ? 'entry' : 'entries'}
                </span>
                <button
                  disabled={rfTxPage >= rfTxPages}
                  onClick={() => fetchRfTxs(rfActiveFund._id, rfTxPage + 1)}
                  className="px-4 py-2 rounded-lg bg-white/5 text-fg/75 font-bold text-xs disabled:opacity-25 hover:bg-white/10 hover:text-fg transition"
                >Next →</button>
              </div>
            )}
          </div>
        )}

        {rfActiveFund && (
          <RevolvingFundLiquidation key={rfActiveFund._id} apiFetch={apiFetch} fund={rfActiveFund}
            onChanged={() => { fetchRfFunds(); fetchRfTxs(rfActiveFund._id, 1); }} />
        )}
      </div>
    )}
    </>
  );
}
