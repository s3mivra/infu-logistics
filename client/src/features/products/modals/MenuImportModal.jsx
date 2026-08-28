import { Fragment } from 'react';
import { Check, X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Bulk menu import preview - the fb-style counterpart to the Inventory bulk
// import (ImportModal.jsx). One row per Product, showing every ingredient
// line and whether it matched an existing Inventory item; unmatched
// ingredients are skipped (not blocking) on submit, same "never fail the
// whole batch over one bad line" posture as the inventory importer.
export default function MenuImportModal() {
  const { menuImportModal, menuImportRows, menuImportSubmitting, peso, setMenuImportModal, submitMenuImport } = useDashboard();

  if (!menuImportModal) return null;

  const totalIngredients = menuImportRows.reduce((s, r) => s + r.ingredients.length, 0);
  const matchedIngredients = menuImportRows.reduce((s, r) => s + r.ingredients.filter(i => i._matched).length, 0);
  const unmatchedIngredients = totalIngredients - matchedIngredients;

  return (
    <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setMenuImportModal(false); }} role="dialog" aria-modal="true" aria-label="Menu import preview">
      <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-4xl shadow-elev-3 flex flex-col max-h-[92vh] overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-fg font-black text-lg">Bulk Import - Menu</h2>
            <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-0.5">Creates/updates products · wires matched ingredients into each recipe</p>
          </div>
          <button onClick={() => setMenuImportModal(false)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
        </div>

        <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-white/10 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500 text-white px-2.5 py-1.5 rounded">PRODUCTS · {menuImportRows.length}</span>
          <span className="text-[10px] font-black uppercase tracking-widest bg-green-500 text-white px-2.5 py-1.5 rounded">INGREDIENTS MATCHED · {matchedIngredients}</span>
          {unmatchedIngredients > 0 && <span title="These ingredient names didn't match any Inventory item - the product still imports, just without that recipe line. Fix the name in the sheet (or add the ingredient to Inventory) and re-import to pick it up." className="text-[10px] font-black uppercase tracking-widest bg-amber-500 text-black px-2.5 py-1.5 rounded">⚠ UNMATCHED · {unmatchedIngredients}</span>}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead className="bg-accent sticky top-0">
              <tr className="text-white text-[10px] uppercase tracking-widest">
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-2 py-3">Category</th>
                <th className="text-right px-2 py-3">SRP</th>
                <th className="text-left px-4 py-3">Ingredients</th>
              </tr>
            </thead>
            <tbody>
              {menuImportRows.map((r, i) => (
                <tr key={i} className="border-b border-white/5 align-top">
                  <td className="px-4 py-2.5 text-fg font-bold whitespace-nowrap">{r.name}</td>
                  <td className="px-2 py-2.5 text-fg/60">{r.category}</td>
                  <td className="px-2 py-2.5 text-right text-fg font-bold tabular-nums whitespace-nowrap">{peso(r.srp)}</td>
                  <td className="px-4 py-2.5">
                    {r.ingredients.length === 0 && <span className="text-fg/30 italic">No ingredients listed</span>}
                    <div className="flex flex-wrap gap-1.5">
                      {r.ingredients.map((ing, j) => (
                        <span key={j} title={ing._matched ? `Matched: ${ing._matchName}` : 'No matching Inventory item - this line will be skipped'}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ing._matched ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'}`}>
                          {ing._matched ? <Check size={9} className="inline mr-0.5 -mt-0.5" /> : '⚠ '}{ing.qty}{ing.unit} {ing.name}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 border-t border-white/10 flex items-center gap-3 shrink-0">
          <button onClick={() => setMenuImportModal(false)} disabled={menuImportSubmitting} className="flex-1 sm:flex-initial px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg font-bold text-xs uppercase tracking-wider transition min-h-[44px] disabled:opacity-40 disabled:pointer-events-none">
            Cancel
          </button>
          <button onClick={submitMenuImport} disabled={menuImportSubmitting || menuImportRows.length === 0}
            className="flex-1 px-5 py-3 rounded-xl bg-brand hover:bg-brand-dark text-white font-black text-sm uppercase tracking-widest transition shadow-elev-2 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2">
            <Check size={16}/> {menuImportSubmitting ? 'Importing…' : `Import ${menuImportRows.length} Product${menuImportRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
