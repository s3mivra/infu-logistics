import { X, Check } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';


// Edit an inventory item's identity/costing fields. Quantity is deliberately
// NOT editable here - stock only moves through Restock or Waste so every change
// leaves a stock-card trail and a journal entry.
export default function EditInventoryModal() {
  const {
    editInvModal, setEditInvModal, editInvForm, setEditInvForm, editInvSubmitting,
    itemDisplay, packInfo, resolveUnitFE, submitEditInventory,
  } = useDashboard();

  if (!editInvModal) return null;

  const d = itemDisplay(editInvModal.item);
  const packLabel = packInfo({
    itemName: editInvForm.itemName, unit: editInvForm.unit, displayUnit: editInvForm.displayUnit,
    packSize: editInvForm.packSize === '' ? null : parseFloat(editInvForm.packSize),
  }).label || 'pack';
  const costUnit = packLabel;
  const thresholdUnit = d.isPacked ? 'pcs' : (editInvForm.displayUnit || editInvForm.unit || 'unit');
  const set = (patch) => setEditInvForm({ ...editInvForm, ...patch });

  return (
    <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setEditInvModal(null); }} role="dialog" aria-modal="true" aria-label="Edit inventory item">
      <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 flex flex-col max-h-[92vh] overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-fg font-black text-lg">Edit Inventory Item</h2>
            <p className="text-fg/60 text-xs font-bold uppercase tracking-widest mt-0.5">{editInvModal.item.itemCode}</p>
          </div>
          <button onClick={() => setEditInvModal(null)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 custom-scrollbar">
          <div className="bg-white/5 rounded-xl p-3 border border-white/10">
            <p className="text-fg/60 text-[10px] font-bold uppercase">Current Stock</p>
            <p className="text-2xl text-brand font-black tabular-nums">
              {d.packQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}{' '}
              <span className="text-sm text-fg/60 font-bold">{d.isPacked ? 'pcs' : d.unit}</span>
            </p>
            <p className="text-[10px] text-fg/60 mt-1 italic">To change quantity, use Restock or Waste - not this form.</p>
          </div>
          <div>
            <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Item Code *</label>
            <input type="text" value={editInvForm.itemCode ?? ''} onChange={e => set({ itemCode: e.target.value.toUpperCase() })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold font-mono outline-none focus:border-brand/60 transition" />
            <p className="text-[10px] text-yellow-400/70 mt-1">⚠ Changing this also updates the linked product code. Must stay unique.</p>
          </div>
          <div>
            <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Item Name *</label>
            <input type="text" value={editInvForm.itemName} onChange={e => set({ itemName: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60 transition" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Display Unit *</label>
              <select value={editInvForm.displayUnit} onChange={e => set({ displayUnit: e.target.value, unit: resolveUnitFE(e.target.value).base })}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60">
                <option value="">- Pick -</option>
                <option value="L">L (Liters)</option>
                <option value="kg">kg (Kilograms)</option>
                <option value="pcs">pcs (Pieces)</option>
              </select>
              <p className="text-[9px] text-fg/60 mt-1">Recipes still use precise base units internally.</p>
            </div>
            <div>
              <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Unit Cost (₱/{costUnit})</label>
              <input type="number" min="0" step="0.01" value={editInvForm.unitCost} onChange={e => set({ unitCost: e.target.value })}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold tabular-nums outline-none focus:border-brand/60" />
              <p className="text-[9px] text-yellow-400/70 mt-1">⚠ Will not retro-update existing COGS.</p>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Per-Qty Size ({editInvForm.displayUnit || editInvForm.unit || 'unit'} per pack, optional)</label>
            <input type="number" min="0" step="any" placeholder="e.g. 1 for a 1L pack" value={editInvForm.packSize} onChange={e => set({ packSize: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold tabular-nums outline-none focus:border-brand/60" />
            <p className="text-[10px] text-fg/60 mt-1">How much one purchased pack/unit holds, e.g. "Milk 1L" → 1. Leave blank if not tracked.</p>
          </div>
          <div>
            <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Low Stock Threshold ({thresholdUnit})</label>
            <input type="number" min="0" value={editInvForm.lowStockThreshold} onChange={e => set({ lowStockThreshold: e.target.value })}
              className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold tabular-nums outline-none focus:border-brand/60" />
            <p className="text-[10px] text-fg/60 mt-1">Alert when stock drops to or below. 0 = disable.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Expiry Date</label>
              <input type="date" value={editInvForm.expiryDate} onChange={e => set({ expiryDate: e.target.value })}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold outline-none focus:border-brand/60" />
              {editInvForm.expiryDate && (
                <button type="button" onClick={() => set({ expiryDate: '' })} className="text-[10px] text-red-400 hover:text-red-300 mt-1 font-bold uppercase">Clear expiry</button>
              )}
            </div>
            <div>
              <label className="text-[10px] text-fg/60 font-bold uppercase block mb-1">Warn (days before)</label>
              <input type="number" min="1" max="365" value={editInvForm.expiryWarnDays} onChange={e => set({ expiryWarnDays: e.target.value })}
                className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg font-bold tabular-nums outline-none focus:border-brand/60" />
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-white/10 shrink-0">
          <button onClick={submitEditInventory} disabled={editInvSubmitting}
            className="w-full py-4 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand/90 active-press transition shadow-elev-2 disabled:opacity-50 min-h-[56px] flex items-center justify-center gap-2">
            <Check size={18}/> {editInvSubmitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
