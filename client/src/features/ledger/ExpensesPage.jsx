import { useEffect } from 'react';
import { Check, Plus, Receipt, Download, Upload, X, AlertTriangle } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';

// Expenses as a full page rather than a popup.
//
// The form is the same one that used to live in a modal, but a page can also
// SHOW what's been spent - recent entries and a per-category breakdown - which
// is what an operator actually wants when they open "Expenses". A popup could
// only ever take input.

const STATUS_DOT = { ok: 'bg-green-400', warn: 'bg-yellow-400', error: 'bg-red-400' };

export default function ExpensesPage() {
  const {
    expenseCategories, expenseForm, setExpenseForm, expenseSubmitting, submitExpense,
    expenseList, fetchExpenses, fetchExpenseCategories, exportExpensesPDF,
    downloadExpenseImportTemplate, parseExpenseImportExcel, expenseImportPreview, setExpenseImportPreview, expenseImporting, submitExpenseImport,
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
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2 flex-wrap">
          <Plus size={14} className="text-brand" />
          <h3 className="text-sm font-black text-fg uppercase tracking-wider">Add Expense</h3>
          <span className="text-[10px] text-fg/80 font-bold uppercase tracking-widest mr-auto">Operating cost entry</span>
          {/* Bulk round-trip: download the sheet (Ref No./Date/Category/Total
              Amount/Payment/Paid To/Description), fill it in offline, import
              it back - each valid row becomes the same balanced journal entry
              this form creates one at a time. See parseExpenseImportExcel in
              AdminDashboard.jsx for the full logic. */}
          <button onClick={downloadExpenseImportTemplate} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition">
            <Download size={11} /> Template
          </button>
          <label className="flex items-center gap-1.5 bg-brand/15 hover:bg-brand/25 text-brand px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition cursor-pointer">
            <Upload size={11} /> Import Excel
            <input type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) parseExpenseImportExcel(f); e.target.value = ''; }} />
          </label>
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
          {(expenseList?.expenses || []).length > 0 && (
            <button onClick={exportExpensesPDF} className="ml-auto flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider transition"><Download size={11}/> PDF</button>
          )}
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

      {/* Import preview - nothing hits the server until this is confirmed. */}
      {expenseImportPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setExpenseImportPreview(null)}>
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
              <div>
                <h2 className="font-black text-fg text-lg flex items-center gap-2"><Upload size={16} className="text-brand" /> Import Preview</h2>
                <p className="text-fg/40 text-xs mt-0.5">
                  <span className="text-green-400 font-bold">{expenseImportPreview.readyCount} ready</span>
                  {expenseImportPreview.warnCount > 0 && <> · <span className="text-yellow-400 font-bold">{expenseImportPreview.warnCount} with warnings</span></>}
                  {expenseImportPreview.errorCount > 0 && <> · <span className="text-red-400 font-bold">{expenseImportPreview.errorCount} rejected</span></>}
                  {' · '}total {peso(expenseImportPreview.totalAmount)}
                </p>
              </div>
              <button onClick={() => setExpenseImportPreview(null)} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-xs min-w-[820px]">
                <thead className="text-fg/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5 sticky top-0 bg-surface">
                  <tr>
                    <th className="px-3 py-2 w-6"></th>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Ref No.</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Payment</th>
                    <th className="px-3 py-2">Paid To</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseImportPreview.rows.map(r => (
                    <tr key={r.rowNum} className={`border-b border-white/5 ${r.status === 'error' ? 'bg-red-500/5' : r.status === 'warn' ? 'bg-yellow-500/5' : ''}`}>
                      <td className="px-3 py-2"><span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[r.status]}`} /></td>
                      <td className="px-3 py-2 text-fg/40">{r.rowNum}</td>
                      <td className="px-3 py-2 font-mono text-fg/60">{r.refNo || '-'}</td>
                      <td className="px-3 py-2 text-fg/60 whitespace-nowrap">{r.date || '(today)'}</td>
                      <td className="px-3 py-2 text-fg/70">{r.categoryLabel || '-'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-fg font-bold">{r.amount != null ? peso(r.amount) : '-'}</td>
                      <td className="px-3 py-2 text-fg/70">{r.paymentMethod || '-'}</td>
                      <td className="px-3 py-2 text-fg/70">{r.vendor || '-'}</td>
                      <td className="px-3 py-2 text-fg/70 truncate max-w-[200px]">{r.description || '-'}</td>
                      <td className="px-3 py-2 text-[10px]">
                        {r.status === 'error' && <span className="text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> {r.message}</span>}
                        {r.status === 'warn' && <span className="text-yellow-400">{r.message}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 border-t border-white/10 flex items-center gap-3 shrink-0">
              <p className="text-[10px] text-fg/40 flex-1">
                Rejected rows are skipped, not imported - fix them in the file and re-upload if needed. Rows with a warning still import (booked to Unassigned Receipts until the payment method is routed).
              </p>
              <button onClick={() => setExpenseImportPreview(null)} className="border border-white/10 text-fg/60 hover:text-fg px-4 py-2.5 rounded-xl text-xs font-bold uppercase transition">Cancel</button>
              <button onClick={submitExpenseImport} disabled={expenseImporting || expenseImportPreview.readyCount + expenseImportPreview.warnCount === 0}
                className="bg-brand hover:bg-brand/90 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition">
                {expenseImporting ? 'Importing…' : `Import ${expenseImportPreview.readyCount + expenseImportPreview.warnCount} Row(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
