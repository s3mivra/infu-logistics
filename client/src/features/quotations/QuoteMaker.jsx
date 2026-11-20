import { useMemo, useState } from 'react';
import { X, Plus, Trash2, FileText } from 'lucide-react';
import SearchSelect from '../../shared/ui/SearchSelect';
import { formatPeso } from '../../shared/money.js';
import * as ui from '../../shared/ui';
import { exportQuotationPDF } from '../../shared/quotationPdf';

// Making a quotation the way a manual order is made: pick who it is for, add
// products with quantity and price, a discount, terms and how long the price
// holds. Saving sends nothing and posts nothing - it is a price offer, which
// can then be printed or saved as a PDF, and becomes an order when accepted.
const peso = formatPeso;
const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:border-brand/50 focus:outline-none';
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function QuoteMaker({ apiFetch, products = [], clients = [], pdfDeps, onClose, onSaved }) {
  const [clientId, setClientId] = useState('');
  const [prospect, setProspect] = useState('');
  const [contact, setContact] = useState('');
  const [lines, setLines] = useState([]);   // { productId, name, quantity, price, note }
  const [pick, setPick] = useState('');
  const [discount, setDiscount] = useState('');
  const [validUntil, setValidUntil] = useState(plusDays(15));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const live = useMemo(() => (products || []).filter(p => !p.isArchived), [products]);
  const pct = Math.min(100, Math.max(0, Number(discount) || 0));
  const gross = lines.reduce((t, l) => t + (Number(l.price) || 0) * (Number(l.quantity) || 0), 0);
  const total = Math.round(gross * (1 - pct / 100) * 100) / 100;

  const add = (id) => {
    const p = live.find(x => String(x._id) === String(id));
    if (!p) return;
    setLines(ls => {
      const i = ls.findIndex(l => l.productId === String(p._id));
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...ls, { productId: String(p._id), name: p.name, quantity: '1', price: String(Number(p.basePrice) || 0), note: '' }];
    });
    setPick('');
  };
  const set = (i, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const save = async (andPrint) => {
    if (!clientId && !prospect.trim()) return ui.alert('Choose a client, or type who the quotation is for.');
    if (!lines.length) return ui.alert('Add at least one item.');
    setSaving(true);
    try {
      const d = await (await apiFetch('/api/quotations', {
        method: 'POST',
        body: JSON.stringify({
          ...(clientId ? { clientAccountId: clientId } : { clientName: prospect.trim(), clientContact: contact.trim() }),
          lines: lines.map(l => ({ productId: l.productId || undefined, name: l.name, quantity: Number(l.quantity) || 1, price: Number(l.price) || 0, note: l.note })),
          discountPercent: pct, validUntil: validUntil || undefined, quoteNotes: notes,
        }),
      })).json();
      if (!d.success) return ui.alert(d.error || 'The quotation was not saved.');
      ui.toast(`${d.quotation.quoteNumber} saved.`, { tone: 'success' });
      if (andPrint) await exportQuotationPDF(d.quotation, pdfDeps);
      onSaved?.(d.quotation);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-black/85 flex justify-center p-0 sm:p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="New quotation">
      <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-3xl my-auto flex flex-col max-h-[94vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="font-black text-fg text-lg flex items-center gap-2"><FileText size={18} /> New quotation</h2>
          <button onClick={onClose} aria-label="Close" className="text-fg/65 hover:text-fg"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Who it is for */}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-fg/70">Client
              <div className="mt-1">
                <SearchSelect value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Type to find a client"
                  options={(clients || []).filter(c => c.isActive !== false).map(c => ({ value: String(c._id), label: c.name, hint: c.clientCode || '' }))} />
              </div>
            </label>
            {!clientId ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-fg/70">Or a name
                  <input value={prospect} onChange={e => setProspect(e.target.value)} placeholder="Who is it for" className={`${inputCls} mt-1`} />
                </label>
                <label className="text-[10px] font-black uppercase tracking-widest text-fg/70">Contact
                  <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone / email" className={`${inputCls} mt-1`} />
                </label>
              </div>
            ) : (
              <button onClick={() => setClientId('')} className="text-xs text-fg/65 underline self-end justify-self-start">Not a client yet? Type a name instead</button>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-fg/70">Items</p>
            <SearchSelect value={pick} onChange={e => add(e.target.value)} placeholder="Type to add a product"
              options={live.map(p => ({ value: String(p._id), label: p.name, hint: peso(Number(p.basePrice) || 0) }))} />
            {lines.length === 0 ? (
              <p className="text-xs text-fg/60 py-3 text-center">No items yet - add products above.</p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1fr_5rem_7rem_7rem_auto] gap-2 items-center bg-page-bg border border-white/10 rounded-lg px-3 py-2">
                    <div className="col-span-4 sm:col-span-1 min-w-0">
                      {l.productId
                        ? <p className="text-sm font-bold text-fg truncate">{l.name}</p>
                        : <input value={l.name} onChange={e => set(i, { name: e.target.value })} aria-label="Item name" className="w-full bg-transparent text-sm font-bold text-fg outline-none border-b border-white/10" />}
                      <input value={l.note} onChange={e => set(i, { note: e.target.value })} placeholder="Note on this line (optional)"
                        className="w-full bg-transparent text-[11px] text-fg/70 outline-none" />
                    </div>
                    <input type="number" min="0" step="any" value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} aria-label="Quantity"
                      className="bg-surface border border-white/10 rounded-lg px-2 py-1.5 text-sm text-right text-fg font-bold outline-none" />
                    <input type="number" min="0" step="0.01" value={l.price} onChange={e => set(i, { price: e.target.value })} aria-label="Unit price"
                      className="bg-surface border border-white/10 rounded-lg px-2 py-1.5 text-sm text-right text-fg font-bold outline-none" />
                    <span className="text-sm font-black text-fg text-right tabular-nums">{peso((Number(l.price) || 0) * (Number(l.quantity) || 0))}</span>
                    <button onClick={() => setLines(ls => ls.filter((_, k) => k !== i))} aria-label={`Remove ${l.name}`} className="text-danger/80 hover:text-danger"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setLines(ls => [...ls, { productId: '', name: 'Item', quantity: '1', price: '0', note: '' }])}
                  className="text-[11px] font-black text-brand-text inline-flex items-center gap-1"><Plus size={12} /> Item not in the catalogue</button>
              </div>
            )}
          </div>

          {/* Discount, validity, terms */}
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-fg/70">Discount (%)
              <input type="number" min="0" max="100" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" className={`${inputCls} mt-1`} />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-fg/70">Price valid until
              <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <div className="text-right self-end">
              {pct > 0 && <p className="text-xs text-fg/65">Discount -{peso(gross - total)}</p>}
              <p className="text-[10px] font-black uppercase tracking-widest text-fg/70">Total</p>
              <p className="text-2xl font-black text-fg tabular-nums">{peso(total)}</p>
            </div>
          </div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-fg/70">Terms & notes
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Delivery, payment terms, lead time…" className={`${inputCls} mt-1`} />
          </label>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-3 rounded-xl bg-white/5 text-fg/70 font-bold text-sm">Cancel</button>
          <button onClick={() => save(false)} disabled={saving} className="px-4 py-3 rounded-xl border border-brand/40 text-brand-text font-black text-sm disabled:opacity-50">Save</button>
          <button onClick={() => save(true)} disabled={saving} className="flex-1 px-4 py-3 rounded-xl bg-brand text-on-brand font-black text-sm disabled:opacity-50">Save & PDF</button>
        </div>
      </div>
    </div>
  );
}
