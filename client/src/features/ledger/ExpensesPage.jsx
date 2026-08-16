import { useEffect } from 'react';
import { Check, Plus, Receipt } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';

// Expenses as a full page rather than a popup.
//
// The form is the same one that used to live in a modal, but a page can also
// SHOW what's been spent - recent entries and a per-category breakdown - which
// is what an operator actually wants when they open "Expenses". A popup could
// only ever take input.

export default function ExpensesPage() {
  const {
    expenseCategories, expenseForm, setExpenseForm, expenseSubmitting, submitExpense,
    expenseList, fetchExpenses, fetchExpenseCategories,
  } = useDashboard();

  useEffect(() => {
    fetchExpenseCategories?.();
    fetchExpenses?.();
  }, [fetchExpenseCategories, fetchExpenses]);

  const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  const set = (patch) => setExpenseForm({ ...expenseForm, ...patch });

  return (
    <div className="space-y-4">
      {/* Summary - the range total plus where the money went. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface border border-white/10 rounded-xl px-5 py-4">
          <p className="text-fg/80 text-[10px] font-bold uppercase tracking-widest">Spent This Month</p>
          <p className="text-3xl text-brand font-black tabular-nums mt-1">{peso(expenseList?.total)}</p>
          <p className="text-fg/60 text-[10px] mt-1">{(expenseList?.expenses || []).length} recent entries shown</p>
        </div>
        <div className="sm:col-span-2 bg-surface border border-white/10 rounded-xl px-5 py-4">
          <p className="text-fg/80 text-[10px] font-bold uppercase tracking-widest mb-2">By Category</p>
          {(expenseList?.byCategory || []).length === 0 ? (
            <p className="text-fg/60 text-sm font-bold">Nothing spent yet this month.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {expenseList.byCategory.map(c => (
                <span key={c.code} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                  <span className="text-fg/50 font-bold">{c.name}</span>
                  <span className="text-fg font-black tabular-nums ml-2">{peso(c.total)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Entry form - same fields as the old modal, laid out for a page. */}
      <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <Plus size={14} className="text-brand" />
          <h3 className="text-sm font-black text-fg uppercase tracking-wider">Add Expense</h3>
          <span className="ml-auto text-[10px] text-fg/80 font-bold uppercase tracking-widest">Operating cost entry</span>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Amount (₱) *</label>
            <input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={e => set({ amount: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg text-xl font-black tabular-nums outline-none focus:border-brand/60" />
          </div>
          <div>
            <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Category *</label>
            <select value={expenseForm.categoryCode} onChange={e => set({ categoryCode: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
              <option value="">Select category…</option>
              {(expenseCategories || []).map(c => (
                <option key={c.code} value={c.code}>{c.code} - {c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Paid From *</label>
            <select value={expenseForm.paymentMethod} onChange={e => set({ paymentMethod: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-fg font-bold outline-none focus:border-brand/60">
              <option>Cash on Hand</option>
              <option>Bank Transfer</option>
              <option>GCash</option>
              <option>Maya</option>
              <option>Maribank</option>
              <option>On Account</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Description *</label>
            <input type="text" placeholder="e.g. June electricity bill" value={expenseForm.description} onChange={e => set({ description: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
          </div>
          <div>
            <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Vendor (optional)</label>
            <input type="text" placeholder="Meralco" value={expenseForm.vendor} onChange={e => set({ vendor: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold placeholder-white/25 outline-none focus:border-brand/60" />
          </div>
          <div>
            <label className="text-[10px] text-fg/80 font-bold uppercase block mb-1">Date</label>
            <input type="date" value={expenseForm.date} onChange={e => set({ date: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <p className="text-[10px] text-fg/60 italic flex-1">
              A balanced journal entry is created automatically:{' '}
              <span className="text-fg/80">DR Expense / CR {expenseForm.paymentMethod}</span>
            </p>
            <button onClick={submitExpense} disabled={expenseSubmitting}
              className="sm:w-auto w-full px-8 py-3.5 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand/90 active-press transition shadow-elev-2 disabled:opacity-50 min-h-[52px] flex items-center justify-center gap-2">
              <Check size={18}/> {expenseSubmitting ? 'Saving…' : 'Record Expense'}
            </button>
          </div>
        </div>
      </div>

      {/* Recent entries */}
      <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <Receipt size={14} className="text-fg/50" />
          <h3 className="text-sm font-black text-fg uppercase tracking-wider">Recent Expenses</h3>
        </div>
        {(expenseList?.expenses || []).length === 0 ? (
          <p className="text-fg/60 text-sm p-8 text-center font-bold">
            No expenses recorded this month yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[520px]">
              <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                <tr>
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-5 py-2.5">Reference</th>
                  <th className="px-5 py-2.5">Category</th>
                  <th className="px-5 py-2.5">Description</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenseList.expenses.map((e, i) => (
                  <tr key={e._id || i} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                    <td className="px-5 py-2.5 text-fg/40 whitespace-nowrap">
                      {new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-fg/60 whitespace-nowrap">{e.reference}</td>
                    <td className="px-5 py-2.5 text-fg/70 whitespace-nowrap">{e.categoryName}</td>
                    <td className="px-5 py-2.5 text-fg/70 truncate max-w-[260px]">{e.description}</td>
                    <td className="px-5 py-2.5 text-right text-fg font-mono tabular-nums font-bold">{peso(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
