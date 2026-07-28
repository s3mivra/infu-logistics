import { AlertCircle, Building2, CheckCircle, DollarSign } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard; reads shared state via useDashboard().
export default function ShiftEndModal() {
  const { DENOMS, denomCounts, denomTotal, depositAmount, depositError, depositLoading, handleBankDeposit, handleEndShift, performLogout, setDenomCounts, setDepositAmount, setDepositError, setShiftEndModal, setShiftReconcile, shiftEndLoading, shiftEndModal, shiftReconcile, startingCash } = useDashboard();

  if (!(shiftEndModal)) return null;

  return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-8 flex flex-col gap-5">

          {shiftReconcile.result ? (
            /* ── RESULTS SCREEN ── */
            <>
              <div className="text-center">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${shiftReconcile.result.variance >= 0 ? 'bg-green-500/20 border border-green-500/40' : 'bg-red-500/20 border border-red-500/40'}`}>
                  {shiftReconcile.result.variance >= 0
                    ? <CheckCircle size={32} className="text-green-400" />
                    : <AlertCircle size={32} className="text-red-400" />}
                </div>
                <h2 className="text-xl font-black text-fg tracking-wider uppercase">Shift Summary</h2>
                <p className="text-gray-400 text-xs mt-1">Recorded for {shiftReconcile.result.cashierName}</p>
              </div>

              <div className="bg-surface-2 rounded-xl p-4 space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Opening Cash</span><span className="font-bold text-fg">₱{(shiftReconcile.result.startingCash||0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Cash Sales</span><span className="font-bold text-accent">+₱{(shiftReconcile.result.salesTotal||0).toFixed(2)}</span></div>
                <div className="flex justify-between border-t border-gray-700 pt-3"><span className="text-gray-400">Expected in Register</span><span className="font-black text-fg text-base">₱{(shiftReconcile.result.expectedCash||0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Actual Cash Count</span><span className="font-black text-fg text-base">₱{(shiftReconcile.result.actualCash||0).toFixed(2)}</span></div>
                <div className={`flex justify-between pt-1 border-t border-gray-700 font-black text-base ${shiftReconcile.result.variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  <span>Variance</span>
                  <span>{shiftReconcile.result.variance >= 0 ? '+' : ''}₱{(shiftReconcile.result.variance||0).toFixed(2)}</span>
                </div>
              </div>

              {shiftReconcile.result.variance < 0 && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3 text-xs text-red-300 font-medium">
                  Short by ₱{Math.abs(shiftReconcile.result.variance).toFixed(2)} - report to manager before leaving.
                </div>
              )}

              {/* ── BANK DEPOSIT ── */}
              {shiftReconcile.result.isReconciled ? (
                <div className="bg-green-900/20 border border-green-500/30 rounded-xl px-4 py-3 text-xs text-green-300 font-bold text-center flex items-center justify-center gap-2">
                  <CheckCircle size={14} /> Drawer Reconciled - cash matches starting fund.
                </div>
              ) : (
                <div className="bg-surface-2 rounded-xl p-4 space-y-3 text-sm border border-blue-500/20">
                  <h3 className="text-blue-400 font-black uppercase tracking-wider text-xs flex items-center gap-2">
                    <Building2 size={14} /> Bank Deposit
                  </h3>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Cash on Hand</span>
                      <span className="font-bold text-fg">₱{Math.max(0, (shiftReconcile.result.actualCash || 0) - (shiftReconcile.result.depositedAmount || 0)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Keep in Drawer</span>
                      <span className="font-bold text-fg">₱{(shiftReconcile.result.startingCash || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-700 pt-1">
                      <span className="text-gray-400">Suggested Deposit</span>
                      <span className="font-bold text-blue-400">₱{Math.max(0, (shiftReconcile.result.actualCash || 0) - (shiftReconcile.result.depositedAmount || 0) - (shiftReconcile.result.startingCash || 0)).toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 font-black pointer-events-none">₱</span>
                    <input
                      type="number" min="0" step="0.01" placeholder="Deposit amount"
                      value={depositAmount}
                      onChange={e => { setDepositAmount(e.target.value); setDepositError(''); }}
                      className="w-full bg-gray-800 border-2 border-blue-500/50 focus:border-blue-400 text-fg py-2.5 pl-8 pr-4 rounded-xl outline-none font-bold text-sm"
                    />
                  </div>
                  {depositError && <p className="text-red-400 text-xs">{depositError}</p>}
                  <button
                    onClick={handleBankDeposit}
                    disabled={depositLoading || !depositAmount}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-fg font-black py-3 rounded-xl uppercase tracking-wider transition disabled:opacity-50 text-sm"
                  >
                    {depositLoading ? 'Posting…' : 'Post Bank Deposit'}
                  </button>
                </div>
              )}

              <button
                onClick={performLogout}
                className="w-full bg-accent text-fg font-black py-4 rounded-xl uppercase tracking-widest hover:bg-brand-dark transition"
              >
                Confirm & Log Out
              </button>
            </>
          ) : (
            /* ── COUNT SCREEN ── */
            <>
              <div className="text-center">
                <div className="w-14 h-14 bg-accent/10 border border-accent/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <DollarSign size={26} className="text-accent" />
                </div>
                <h2 className="text-xl font-black text-fg tracking-wider uppercase">End of Shift</h2>
                <p className="text-gray-400 text-sm mt-1">Count your register before logging out.</p>
              </div>

              {/* Bill/coin denomination breakdown */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Count Your Bills & Coins</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {DENOMS.map(d => (
                    <div key={d} className="flex items-center gap-1.5 bg-surface-2 rounded-xl px-2.5 py-2 border border-white/5">
                      <span className="text-fg/50 font-bold text-xs w-10 shrink-0">₱{d}</span>
                      <input type="number" min="0" placeholder="0"
                        value={denomCounts[d] || ''}
                        onChange={e => setDenomCounts(p => ({ ...p, [d]: e.target.value }))}
                        className="w-full bg-transparent text-fg text-right font-black text-sm tabular-nums outline-none"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center bg-brand/10 border border-brand/30 rounded-xl px-4 py-2.5">
                  <span className="text-brand font-black uppercase tracking-wider text-xs">Total Count</span>
                  <span className="text-brand font-black text-xl tabular-nums">₱{denomTotal.toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-fg/30 text-center">Or type total directly:</p>
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={shiftReconcile.actualCash}
                  onChange={e => setShiftReconcile(prev => ({ ...prev, actualCash: e.target.value }))}
                  className="w-full bg-surface-2 border border-white/10 text-center text-fg py-2 rounded-xl outline-none font-bold text-sm"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShiftEndModal(false)}
                  className="flex-1 py-3 bg-surface-2 border border-white/10 text-fg/50 font-bold rounded-xl hover:text-fg transition text-sm uppercase"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEndShift}
                  disabled={shiftEndLoading}
                  className="flex-1 py-3 bg-accent text-fg font-black rounded-xl hover:bg-brand-dark transition text-sm uppercase tracking-wider disabled:opacity-60"
                >
                  {shiftEndLoading ? 'Processing...' : 'Submit Count'}
                </button>
              </div>

              <button
                onClick={performLogout}
                className="text-xs text-gray-600 hover:text-red-400 transition text-center w-full"
              >
                Skip & force logout (emergency only)
              </button>
            </>
          )}
        </div>
      </div>
  );
}
