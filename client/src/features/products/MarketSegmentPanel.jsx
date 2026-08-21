import React, { useState } from 'react';
import { Users, UserCheck, Plus, Trash2 } from 'lucide-react';
import * as ui from '../../shared/ui';

// ── helpers ──────────────────────────────────────────────────────────────────

async function saveProduct(productId, patch, apiFetchFn) {
  const res = await apiFetchFn(`/api/products/${productId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Change-Reason': 'market-segment-update' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to save');
}

// DiscountInput — small inline component for % or ₱ entry
function DiscountInput({ type, value, onChange, onTypeChange }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onTypeChange(type === 'percent' ? 'amount' : 'percent')}
        className={`px-2 py-1 rounded text-xs font-bold border transition ${type === 'percent' ? 'bg-brand/20 border-brand text-brand' : 'bg-yellow-500/20 border-yellow-500 text-yellow-400'}`}
        title="Toggle discount type"
      >
        {type === 'percent' ? <Percent size={11} /> : <span className="text-[11px]">₱</span>}
      </button>
      <input
        type="number"
        min="0"
        step={type === 'percent' ? '1' : '0.01'}
        max={type === 'percent' ? '100' : undefined}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 bg-surface border border-white/10 rounded px-2 py-1 text-xs text-fg font-bold outline-none focus:border-brand"
      />
    </div>
  );
}

// ── Walk-in section ───────────────────────────────────────────────────────────

function WalkinSection({ products, apiFetch: fetch, onSaved }) {

  // Derive current walk-in discount across all products
  const [bulkType, setBulkType] = useState('percent');
  const [bulkValue, setBulkValue] = useState(0);
  const [saving, setSaving] = useState(false);

  // Build editable list: one row per product showing current walkin discount
  const [rows, setRows] = useState(() =>
    products.map(p => {
      const wd = (p.segmentDiscounts || []).find(d => d.segment === 'walkin');
      return {
        productId: p._id,
        name: p.name,
        type: wd?.discountType || 'percent',
        value: wd?.discountType === 'amount' ? (wd.amount || 0) : (wd?.percent || 0),
        enabled: !!wd,
      };
    })
  );

  const setRow = (idx, patch) => setRows(r => r.map((row, i) => i === idx ? { ...row, ...patch } : row));

  const applyBulk = () => {
    setRows(r => r.map(row => ({ ...row, type: bulkType, value: bulkValue, enabled: bulkValue > 0 })));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const row of rows) {
        const product = products.find(p => p._id === row.productId);
        if (!product) continue;
        const others = (product.segmentDiscounts || []).filter(d => d.segment !== 'walkin');
        const segmentDiscounts = row.enabled && row.value > 0
          ? [...others, { segment: 'walkin', discountType: row.type, percent: row.type === 'percent' ? row.value : 0, amount: row.type === 'amount' ? row.value : 0 }]
          : others;
        await saveProduct(row.productId, { ...product, segmentDiscounts }, fetch);
      }
      onSaved();
      ui.alert('Walk-in discounts saved.');
    } catch { ui.alert('Failed to save some discounts.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 rounded-xl p-4 border border-white/10">
        <p className="text-xs text-fg/50 mb-3">Set a discount for all walk-in / guest customers. This applies when no client account or segment is matched.</p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold text-fg/60 uppercase tracking-wider">Bulk set all:</span>
          <DiscountInput type={bulkType} value={bulkValue} onChange={setBulkValue} onTypeChange={setBulkType} />
          <button type="button" onClick={applyBulk} className="px-3 py-1.5 bg-brand/20 text-brand border border-brand/30 rounded-lg text-xs font-bold hover:bg-brand/30 transition">
            Apply to All
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
        {rows.map((row, idx) => (
          <div key={row.productId} className="flex items-center gap-3 bg-surface-2 rounded-lg px-3 py-2 border border-white/10">
            <input type="checkbox" checked={row.enabled} onChange={e => setRow(idx, { enabled: e.target.checked })}
              className="accent-brand w-4 h-4 shrink-0" />
            <span className="flex-1 text-sm font-semibold text-fg truncate">{row.name}</span>
            {row.enabled && (
              <DiscountInput type={row.type} value={row.value} onChange={v => setRow(idx, { value: v })} onTypeChange={t => setRow(idx, { type: t })} />
            )}
            {!row.enabled && <span className="text-xs text-fg/30 italic">No discount</span>}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving}
          className="px-5 py-2 bg-brand text-fg rounded-xl font-bold text-sm hover:bg-brand-dark transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Walk-in Discounts'}
        </button>
      </div>
    </div>
  );
}

// ── Client Accounts section ───────────────────────────────────────────────────

function ClientSection({ products, clientAccounts, apiFetch: fetch, onSaved }) {

  const [selectedClientId, setSelectedClientId] = useState('');
  const [rows, setRows] = useState([]); // { productId, name, type, value }
  const [bulkType, setBulkType] = useState('percent');
  const [bulkValue, setBulkValue] = useState(0);
  const [saving, setSaving] = useState(false);
  const [addProdOpen, setAddProdOpen] = useState(false);

  const selectedClient = clientAccounts.find(c => c._id === selectedClientId);

  // Load existing discounts for this client when selection changes
  const loadClient = (clientId) => {
    setSelectedClientId(clientId);
    if (!clientId) { setRows([]); return; }
    const existing = products
      .filter(p => (p.clientDiscounts || []).some(d => String(d.clientId) === clientId))
      .map(p => {
        const d = p.clientDiscounts.find(d => String(d.clientId) === clientId);
        return {
          productId: p._id,
          name: p.name,
          type: d.discountType || 'percent',
          value: d.discountType === 'amount' ? (d.amount || 0) : (d.percent || 0),
        };
      });
    setRows(existing);
  };

  const addProduct = (prod) => {
    if (rows.some(r => r.productId === prod._id)) return;
    setRows(r => [...r, { productId: prod._id, name: prod.name, type: 'percent', value: 0 }]);
    setAddProdOpen(false);
  };

  const removeRow = (idx) => setRows(r => r.filter((_, i) => i !== idx));
  const setRow = (idx, patch) => setRows(r => r.map((row, i) => i === idx ? { ...row, ...patch } : row));

  const applyBulk = () => {
    setRows(r => r.map(row => ({ ...row, type: bulkType, value: bulkValue })));
  };

  const handleSave = async () => {
    if (!selectedClientId) return;
    setSaving(true);
    try {
      // For every product: update clientDiscounts (add/update/remove this client's entry)
      const affectedIds = new Set([
        ...rows.map(r => r.productId),
        ...products.filter(p => (p.clientDiscounts || []).some(d => String(d.clientId) === selectedClientId)).map(p => p._id),
      ]);
      for (const pid of affectedIds) {
        const product = products.find(p => p._id === pid);
        if (!product) continue;
        const row = rows.find(r => r.productId === pid);
        const others = (product.clientDiscounts || []).filter(d => String(d.clientId) !== selectedClientId);
        const clientDiscounts = row && row.value > 0
          ? [...others, { clientId: selectedClientId, discountType: row.type, percent: row.type === 'percent' ? row.value : 0, amount: row.type === 'amount' ? row.value : 0 }]
          : others;
        await saveProduct(pid, { ...product, clientDiscounts }, fetch);
      }
      onSaved();
      ui.alert(`Discounts saved for ${selectedClient?.name || 'client'}.`);
    } catch { ui.alert('Failed to save some discounts.'); }
    finally { setSaving(false); }
  };

  const availableToAdd = products.filter(p => !rows.some(r => r.productId === p._id));

  return (
    <div className="space-y-4">
      {/* Client selector */}
      <div className="bg-surface-2 rounded-xl p-4 border border-white/10">
        <label className="text-xs font-bold text-fg/60 uppercase tracking-wider block mb-2">Select Client Account</label>
        <select value={selectedClientId} onChange={e => loadClient(e.target.value)}
          className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg font-bold outline-none focus:border-brand">
          <option value="">— Choose a registered client —</option>
          {clientAccounts.map(c => (
            <option key={c._id} value={c._id}>{c.name}{c.companyName ? ` (${c.companyName})` : ''}</option>
          ))}
        </select>
        {clientAccounts.length === 0 && (
          <p className="text-xs text-fg/40 mt-2 italic">No registered client accounts found.</p>
        )}
      </div>

      {selectedClientId && (
        <>
          {/* Bulk actions */}
          <div className="flex items-center gap-3 flex-wrap bg-surface-2 rounded-xl p-3 border border-white/10">
            <span className="text-xs font-bold text-fg/60 uppercase tracking-wider">Set all:</span>
            <DiscountInput type={bulkType} value={bulkValue} onChange={setBulkValue} onTypeChange={setBulkType} />
            <button type="button" onClick={applyBulk}
              className="px-3 py-1.5 bg-brand/20 text-brand border border-brand/30 rounded-lg text-xs font-bold hover:bg-brand/30 transition">
              Apply to All
            </button>
            <button type="button" onClick={() => setRows(r => r.map(row => ({ ...row, value: 0 })))}
              className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-bold hover:bg-red-500/20 transition">
              Clear All
            </button>
          </div>

          {/* Product rows */}
          <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {rows.length === 0 && (
              <p className="text-xs text-fg/40 italic text-center py-4">No products added yet. Click + Add Product below.</p>
            )}
            {rows.map((row, idx) => (
              <div key={row.productId} className="flex items-center gap-3 bg-surface-2 rounded-lg px-3 py-2 border border-white/10">
                <span className="flex-1 text-sm font-semibold text-fg truncate">{row.name}</span>
                <DiscountInput type={row.type} value={row.value} onChange={v => setRow(idx, { value: v })} onTypeChange={t => setRow(idx, { type: t })} />
                <button type="button" onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-300 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Add product */}
          <div className="relative">
            <button type="button" onClick={() => setAddProdOpen(o => !o)}
              className="flex items-center gap-2 text-xs font-bold text-brand hover:text-brand-dark transition">
              <Plus size={14} /> Add Product
            </button>
            {addProdOpen && availableToAdd.length > 0 && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-sidebar-bg border border-white/15 rounded-xl shadow-xl min-w-[220px] max-h-48 overflow-y-auto custom-scrollbar">
                {availableToAdd.map(p => (
                  <button key={p._id} type="button" onClick={() => addProduct(p)}
                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-fg/70 hover:bg-white/8 hover:text-fg transition">
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {addProdOpen && availableToAdd.length === 0 && (
              <p className="text-xs text-fg/40 italic mt-1">All products already added.</p>
            )}
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-brand text-fg rounded-xl font-bold text-sm hover:bg-brand-dark transition disabled:opacity-50">
              {saving ? 'Saving…' : `Save for ${selectedClient?.name || 'Client'}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function MarketSegmentPanel({ products, clientAccounts, apiFetch, onSaved }) {
  const [tab, setTab] = useState('walkin');

  return (
    <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6 mt-6">
      <div className="flex items-center gap-3 mb-1">
        <Users size={18} className="text-brand" />
        <h3 className="text-xl font-bold text-fg">Market Segments</h3>
      </div>
      <p className="text-xs text-fg/40 mb-5">Assign pricing discounts per customer type. Walk-in applies broadly to unregistered guests; Client Accounts target specific registered customers.</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b border-white/10 pb-3">
        <button
          type="button"
          onClick={() => setTab('walkin')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${tab === 'walkin' ? 'bg-brand/20 text-brand border border-brand/30' : 'text-fg/50 hover:text-fg hover:bg-white/5'}`}
        >
          <UserCheck size={15} /> Walk-in / Guest
        </button>
        <button
          type="button"
          onClick={() => setTab('clients')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${tab === 'clients' ? 'bg-brand/20 text-brand border border-brand/30' : 'text-fg/50 hover:text-fg hover:bg-white/5'}`}
        >
          <Users size={15} /> Client Accounts
          {clientAccounts.length > 0 && <span className="text-[10px] bg-brand/30 text-brand px-1.5 py-0.5 rounded-full">{clientAccounts.length}</span>}
        </button>
      </div>

      {tab === 'walkin' && (
        <WalkinSection products={products} apiFetch={apiFetch} onSaved={onSaved} />
      )}
      {tab === 'clients' && (
        <ClientSection products={products} clientAccounts={clientAccounts} apiFetch={apiFetch} onSaved={onSaved} />
      )}
    </div>
  );
}
