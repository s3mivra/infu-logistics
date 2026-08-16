import { useDashboard } from '../../dashboard/DashboardContext';
import * as ui from '../../../shared/ui';


// Reasons are a closed list on purpose: spoilage posts a journal entry, and a
// free-text reason makes the waste report unaggregatable at month-end.
const REASONS = [
  ['Spoilage', 'Spoilage / Expired'],
  ['Damage', 'Damage / Breakage'],
  ['Theft', 'Theft / Pilferage'],
  ['Encoding Error', 'Encoding Error'],
  ['Supplier Discrepancy', 'Supplier Discrepancy'],
  ['Quality Rejection', 'Quality Rejection'],
  ['Other', 'Other'],
];

export default function SpoilageModal() {
  const {
    spoilageModal, setSpoilageModal, spoilageForm, setSpoilageForm,
    spoilageLoading, setSpoilageLoading, itemDisplay, packInfo, apiFetch, fetchERPData,
  } = useDashboard();

  if (!spoilageModal) return null;

  const item = spoilageModal.item;
  const d = itemDisplay(item);
  const unitLabel = d.isPacked ? 'pcs' : d.unit;
  const currentQty = d.packQty.toLocaleString(undefined, { maximumFractionDigits: 3 });

  const submit = async () => {
    // The form collects packs (or display units for unpacked items); the API
    // always takes base units.
    const pack = packInfo(item);
    const qtyEntered = parseFloat(spoilageForm.qty);
    const qtyBase = qtyEntered * (pack.packBase || 1);
    const { reason, note } = spoilageForm;
    const label = `${qtyEntered} ${unitLabel} of ${item.itemName}`;

    // Held for a few seconds rather than reversed afterwards: writing off stock
    // posts a journal entry and a stock-card row, and NOT creating those is much
    // cleaner than creating then reversing them. Close the form immediately so
    // the countdown is the only thing on screen.
    setSpoilageModal(null);
    const ran = await ui.deferred(async () => {
      setSpoilageLoading(true);
      try {
        const res = await apiFetch(`/api/inventory/spoilage/${item._id}`, {
          method: 'POST',
          body: JSON.stringify({ qty: qtyBase, reason, note }),
        });
        const data = await res.json();
        if (data.success) { fetchERPData(); ui.alert(`Waste logged: ${label}.`, { tone: 'success' }); }
        else ui.alert(data.error || 'Failed to log spoilage.');
      } finally { setSpoilageLoading(false); }
    }, {
      message: `Writing off ${label}…`,
      undoMessage: 'Waste entry cancelled - nothing was written off.',
    });
    return ran;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-black text-fg uppercase tracking-wider">Log Waste / Spoilage</h2>
            <p className="text-orange-400 text-xs font-bold mt-0.5">{item.itemName}</p>
          </div>
          <button onClick={() => setSpoilageModal(null)} className="text-gray-500 hover:text-fg text-xl font-bold">✕</button>
        </div>
        <div className="bg-surface-2 rounded-xl p-3 text-sm flex justify-between">
          <span className="text-gray-400">Current Stock</span>
          <span className="font-black text-fg">{currentQty} {unitLabel}</span>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Quantity to Discard ({unitLabel})</label>
          <input type="number" min="0.001" step="any" placeholder="0.00" value={spoilageForm.qty}
            onChange={e => setSpoilageForm(f => ({ ...f, qty: e.target.value }))}
            className="w-full bg-surface-2 border border-orange-500/40 focus:border-orange-400 text-fg py-2.5 px-3 rounded-xl outline-none font-black text-lg text-center"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Reason *</label>
          <select value={spoilageForm.reason} onChange={e => setSpoilageForm(f => ({ ...f, reason: e.target.value }))}
            className="w-full bg-surface-2 border border-gray-600 focus:border-orange-400 text-fg py-2.5 px-3 rounded-xl outline-none text-sm font-bold"
          >
            <option value="">- Select Reason -</option>
            {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Notes (optional)</label>
          <input type="text" placeholder="Additional details..." value={spoilageForm.note}
            onChange={e => setSpoilageForm(f => ({ ...f, note: e.target.value }))}
            className="w-full bg-surface-2 border border-gray-700 focus:border-orange-400 text-fg py-2.5 px-3 rounded-xl outline-none text-sm"
          />
        </div>
        <div className="flex gap-3 mt-2">
          <button onClick={() => setSpoilageModal(null)} className="flex-1 py-3 bg-surface-2 border border-white/10 text-fg/50 font-bold rounded-xl hover:text-fg transition text-sm uppercase">Cancel</button>
          <button
            disabled={spoilageLoading || !spoilageForm.qty || !spoilageForm.reason}
            onClick={submit}
            className="flex-1 py-3 bg-orange-600 text-white font-black rounded-xl hover:bg-orange-500 transition text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {spoilageLoading ? 'Logging…' : 'Log Waste'}
          </button>
        </div>
      </div>
    </div>
  );
}
