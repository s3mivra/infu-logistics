import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, Plus, Trash2, X, Check, ClipboardList, PackageCheck, ChevronRight, Search, AlertTriangle, FileText, Loader2, Building2, Pencil, Phone, Mail, MapPin, Download } from 'lucide-react';

// ── ProcurementTab — Purchase Order workflow ──────────────────────────────────
// Two-stage tracking. LEFT tab ("Purchase Orders") drafts & tracks planned POs
// through Ordered → Processing. RIGHT tab ("Receiving") reconciles a delivery by
// typing the actual received quantities, which flips the PO to Complete or
// Incomplete. Purely a tracking record — it does not post to inventory/ledger.
//
// Self-contained: only pulls apiFetch / peso / inventory / isSuperAdmin from ctx.

const STATUS_STYLES = {
  Ordered:    'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Processing: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Complete:   'bg-green-500/15 text-green-300 border-green-500/30',
  Incomplete: 'bg-red-500/15 text-red-300 border-red-500/30',
  Cancelled:  'bg-white/5 text-white/40 border-white/10',
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] || STATUS_STYLES.Cancelled}`}>
    {status}
  </span>
);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function ProcurementTab({ ctx }) {
  const { apiFetch, peso, inventory = [], isSuperAdmin } = ctx;
  const money = peso || ((n) => `₱${(Number(n) || 0).toFixed(2)}`);
  // Permission gating (server also enforces). Fall back to role-ish defaults if ctx.can missing.
  const can = ctx.can || (() => true);
  const canManage = can('procurement.manage');
  const canDelete = can('procurement.delete');

  const [subTab, setSubTab] = useState('orders');   // 'orders' | 'receiving' | 'suppliers'
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPOs = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiFetch('/api/purchase-orders?limit=300');
      const d = await res.json();
      if (d.success) setPos(d.purchaseOrders || []);
      else setError(d.error || 'Failed to load purchase orders.');
    } catch (e) { setError('Network error loading purchase orders.'); }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { fetchPOs(); }, [fetchPOs]);

  // ── Suppliers ─────────────────────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState([]);
  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/suppliers');
      const d = await res.json();
      if (d.success) setSuppliers(d.suppliers || []);
    } catch { /* non-fatal */ }
  }, [apiFetch]);
  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  // ── Excel PO import ───────────────────────────────────────────────────────────
  // Parses a supplier's PO/delivery spreadsheet, finds the header row, groups rows
  // by PO NO into draft POs, and pulls the pack size (e.g. "1L", "2L", "250G") out
  // of the product description into the line's unit.
  const [importPreview, setImportPreview] = useState(null); // { pos: [...], skipped }
  const [importing, setImporting] = useState(false);

  // Downloads a blank template with the exact header row the importer expects,
  // plus one filled-in sample row so the user can see the format at a glance.
  const downloadPoTemplate = async () => {
    const XLSX = await import('xlsx');
    const headers = [
      "SUPPLIER'S CODE", 'SUPPLIER NAME', 'ITEM CODE', 'PRODUCT DESCRIPTION', 'PO NO', 'LEAD TIME',
      'DATE (MMDDYYYY)', 'DR / SI', 'DATE (MMDDYYYY)', 'QTY', 'UNIT PRICE (COST PRICE)',
      'GROSS AMOUNT DUE', 'VAT/ DEL FEE', 'DISCOUNT', 'NET PAYABLE', 'BRIEF DESCRIPTION OF TRANS.',
    ];
    const sample = ['', 'ALLEGRO BEVERAGE CORP.', 'P50001', 'OATSIDE BARISTA EDITION 1L', '2026-06-0132', 20, '06/13/26', 'SI-PAM-0000002319', '07/3/26', 180, 115.00, 20700.00, '', '', 20700.00, ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, Math.min(28, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PO Import');
    XLSX.writeFile(wb, 'purchase_order_import_template.xlsx');
  };

  // Pack size in a description: "…1L", "…250G", "…2.5KG", "…750ML". orderedQty is
  // the PACKAGE count and unitCost is per-package (QTY × UNIT PRICE = GROSS in the
  // source), so the pack size becomes the unit LABEL ("1L", "2L", "250G") — we do
  // NOT convert quantities, which would break the cost math.
  const PACK_RE = /\b([0-9]+(?:\.[0-9]+)?)\s*(kg|g|l|ml|pcs|pc)\b/i;
  const parseSize = (desc) => {
    const name = String(desc || '').trim();
    const m = name.match(PACK_RE);
    return { name, unit: m ? `${m[1]}${m[2].toUpperCase()}` : 'pcs' };
  };
  const numify = (v) => { const n = parseFloat(String(v ?? '').replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const parsePoExcel = async (file) => {
    if (!file) return;
    setError(''); setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }); // array-of-arrays

      // Find the header row: it contains "supplier name" AND "product description".
      let hIdx = -1;
      for (let i = 0; i < Math.min(grid.length, 40); i++) {
        const cells = (grid[i] || []).map(norm);
        if (cells.some(c => c.includes('suppliername')) && cells.some(c => c.includes('productdescription'))) { hIdx = i; break; }
      }
      if (hIdx === -1) { setError('Could not find the header row (needs SUPPLIER NAME and PRODUCT DESCRIPTION).'); setImporting(false); return; }

      // Map each needed field to a column index by matching the header cells.
      const header = (grid[hIdx] || []).map(norm);
      const col = (aliases) => header.findIndex(c => aliases.some(a => c.includes(a)));
      const idx = {
        supplierCode: col(['supplierscode', 'suppliercode']),
        supplier:     col(['suppliername']),
        itemCode:     col(['itemcode']),
        desc:         col(['productdescription']),
        poNo:         col(['pono']),
        leadTime:     col(['leadtime']),
        drsi:         col(['drsi', 'dr/si', 'drsi']),
        qty:          header.findIndex(c => c === 'qty' || c === 'quantity'),
        unitPrice:    col(['unitprice', 'costprice']),
        net:          col(['netpayable']),
        brief:        col(['briefdescription']),
      };

      // Group data rows by PO NO (fallback to supplier) into draft POs.
      const byPo = new Map();
      let skipped = 0;
      for (let i = hIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const desc = idx.desc >= 0 ? String(row[idx.desc] ?? '').trim() : '';
        const qty  = idx.qty >= 0 ? numify(row[idx.qty]) : 0;
        if (!desc || qty <= 0) { if (desc || qty) skipped++; continue; }
        const supplier = idx.supplier >= 0 ? String(row[idx.supplier] ?? '').trim() : '';
        const poNo = idx.poNo >= 0 ? String(row[idx.poNo] ?? '').trim() : '';
        const key = poNo || supplier || `row-${i}`;
        if (!byPo.has(key)) byPo.set(key, { poNo, supplier, supplierCode: idx.supplierCode >= 0 ? String(row[idx.supplierCode] ?? '').trim() : '', drsi: idx.drsi >= 0 ? String(row[idx.drsi] ?? '').trim() : '', leadTime: idx.leadTime >= 0 ? String(row[idx.leadTime] ?? '').trim() : '', lines: [] });
        const parsed = parseSize(desc);
        byPo.get(key).lines.push({
          itemName: parsed.name,
          itemCode: idx.itemCode >= 0 ? String(row[idx.itemCode] ?? '').trim() : '',
          unit: parsed.unit,
          orderedQty: qty,
          unitCost: idx.unitPrice >= 0 ? numify(row[idx.unitPrice]) : 0,
          invId: null,
        });
      }

      const posOut = [...byPo.values()].filter(p => p.lines.length);
      if (posOut.length === 0) { setError('No item rows found under the header.'); setImporting(false); return; }
      setImportPreview({ pos: posOut, skipped });
    } catch (e) {
      setError('Could not read the file. Make sure it is a valid .xlsx / .csv.');
    } finally { setImporting(false); }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setImporting(true); setError('');
    let ok = 0, fail = 0;
    for (const p of importPreview.pos) {
      // Link to an existing supplier by name/code if we have one.
      const match = suppliers.find(s => (p.supplierCode && s.supplierCode === p.supplierCode) || (p.supplier && s.name.toLowerCase() === p.supplier.toLowerCase()));
      const noteBits = [p.poNo && `Supplier PO ${p.poNo}`, p.drsi && `DR/SI ${p.drsi}`, p.leadTime && `Lead time ${p.leadTime}d`].filter(Boolean);
      try {
        const res = await apiFetch('/api/purchase-orders', {
          method: 'POST',
          body: JSON.stringify({ supplier: p.supplier, supplierId: match?._id || null, notes: noteBits.join(' · '), lines: p.lines }),
        });
        const d = await res.json();
        if (d.success) ok++; else fail++;
      } catch { fail++; }
    }
    setImporting(false);
    setImportPreview(null);
    await fetchPOs();
    setError(fail ? `Imported ${ok} PO(s); ${fail} failed.` : '');
  };

  // ── Draft form state ────────────────────────────────────────────────────────
  const blankLine = () => ({ invId: null, itemName: '', itemCode: '', unit: '', orderedQty: '', unitCost: '' });
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ supplier: '', supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] });
  const [saving, setSaving] = useState(false);

  const openNewForm = () => {
    setEditId(null);
    setForm({ supplier: '', supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] });
    setShowForm(true);
  };
  const openEditForm = (po) => {
    setEditId(po._id);
    setForm({
      supplier: po.supplier || '',
      supplierId: po.supplierId || '',
      expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString().slice(0, 10) : '',
      notes: po.notes || '',
      lines: (po.lines || []).map(l => ({
        invId: l.invId || null, itemName: l.itemName || '', itemCode: l.itemCode || '',
        unit: l.unit || '', orderedQty: l.orderedQty ?? '', unitCost: l.unitCost ?? '',
      })),
    });
    setShowForm(true);
  };

  // Picking a saved supplier fills the name snapshot; clearing reverts to free-text.
  const pickSupplier = (supplierId) => {
    const s = suppliers.find(x => String(x._id) === String(supplierId));
    setForm(f => ({ ...f, supplierId: supplierId || '', supplier: s ? s.name : f.supplier }));
  };

  // ── Supplier CRUD form ──────────────────────────────────────────────────────
  const blankSupplier = { name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' };
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierEditId, setSupplierEditId] = useState(null);
  const [supplierForm, setSupplierForm] = useState(blankSupplier);
  const [savingSupplier, setSavingSupplier] = useState(false);

  // fromPoForm: true when "+ Add new supplier…" was picked inside the New PO
  // modal, so the freshly-created supplier gets auto-selected back into the PO
  // instead of leaving that field blank after the user just filled it in.
  const [supplierFormOrigin, setSupplierFormOrigin] = useState(null); // 'po' | null
  const openSupplierForm = (s = null, fromPoForm = false) => {
    setSupplierEditId(s?._id || null);
    setSupplierFormOrigin(fromPoForm ? 'po' : null);
    setSupplierForm(s ? {
      name: s.name || '', contactPerson: s.contactPerson || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '', notes: s.notes || '',
    } : blankSupplier);
    setShowSupplierForm(true);
  };

  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) { setError('Supplier name is required.'); return; }
    setSavingSupplier(true); setError('');
    try {
      const url = supplierEditId ? `/api/suppliers/${supplierEditId}` : '/api/suppliers';
      const res = await apiFetch(url, { method: supplierEditId ? 'PATCH' : 'POST', body: JSON.stringify(supplierForm) });
      const d = await res.json();
      if (d.success) {
        setShowSupplierForm(false);
        await fetchSuppliers();
        if (supplierFormOrigin === 'po' && !supplierEditId && d.supplier) {
          setForm(f => ({ ...f, supplierId: d.supplier._id, supplier: d.supplier.name }));
        }
        setSupplierFormOrigin(null);
      } else setError(d.error || 'Failed to save supplier.');
    } catch { setError('Network error saving supplier.'); }
    finally { setSavingSupplier(false); }
  };

  const deleteSupplier = async (s) => {
    if (!window.confirm(`Delete supplier "${s.name}"? Past POs keep their supplier name.`)) return;
    try {
      const res = await apiFetch(`/api/suppliers/${s._id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) fetchSuppliers(); else setError(d.error || 'Failed to delete supplier.');
    } catch { setError('Network error deleting supplier.'); }
  };

  const updateLine = (idx, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (idx) => setForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : f.lines }));

  // Autofill a line when an inventory item is picked.
  const pickInventory = (idx, invId) => {
    const item = inventory.find(i => String(i._id) === String(invId));
    if (!item) { updateLine(idx, { invId: null }); return; }
    updateLine(idx, {
      invId: item._id,
      itemName: item.itemName || '',
      itemCode: item.itemCode || '',
      unit: item.displayUnit || item.unit || '',
      unitCost: item.unitCost ?? '',
    });
  };

  const formEstTotal = useMemo(
    () => form.lines.reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0),
    [form.lines]
  );

  const saveDraft = async () => {
    const cleanLines = form.lines
      .map(l => ({ ...l, orderedQty: Number(l.orderedQty) || 0, unitCost: Number(l.unitCost) || 0 }))
      .filter(l => l.itemName.trim() && l.orderedQty > 0);
    if (cleanLines.length === 0) { setError('Add at least one line with an item name and quantity.'); return; }
    setSaving(true); setError('');
    try {
      const url = editId ? `/api/purchase-orders/${editId}` : '/api/purchase-orders';
      const res = await apiFetch(url, {
        method: editId ? 'PATCH' : 'POST',
        body: JSON.stringify({ supplier: form.supplier, supplierId: form.supplierId || null, expectedDate: form.expectedDate || null, notes: form.notes, lines: cleanLines }),
      });
      const d = await res.json();
      if (d.success) { setShowForm(false); await fetchPOs(); }
      else setError(d.error || 'Failed to save purchase order.');
    } catch (e) { setError('Network error saving purchase order.'); }
    finally { setSaving(false); }
  };

  const setStatus = async (po, status) => {
    try {
      const res = await apiFetch(`/api/purchase-orders/${po._id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      const d = await res.json();
      if (d.success) fetchPOs(); else setError(d.error || 'Failed to update status.');
    } catch (e) { setError('Network error updating status.'); }
  };

  const deletePO = async (po) => {
    if (!window.confirm(`Delete ${po.poNumber}? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/purchase-orders/${po._id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) fetchPOs(); else setError(d.error || 'Failed to delete.');
    } catch (e) { setError('Network error deleting purchase order.'); }
  };

  // ── Receiving / reconciliation ────────────────────────────────────────────────
  const [receiveId, setReceiveId] = useState(null);
  const [receiveQtys, setReceiveQtys] = useState({});
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receiving, setReceiving] = useState(false);

  const openReceive = (po) => {
    setReceiveId(po._id);
    // Prefill received = ordered (common case: full delivery), user tweaks shortfalls.
    const q = {};
    (po.lines || []).forEach((l, i) => { q[l._id || i] = String(l.orderedQty ?? ''); });
    setReceiveQtys(q);
    setReceiveNotes(po.notes || '');
  };

  const submitReceive = async (po) => {
    setReceiving(true); setError('');
    try {
      const received = (po.lines || []).map((l, i) => ({ lineId: l._id, index: i, receivedQty: Number(receiveQtys[l._id || i]) || 0 }));
      const res = await apiFetch(`/api/purchase-orders/${po._id}/receive`, { method: 'POST', body: JSON.stringify({ received, notes: receiveNotes }) });
      const d = await res.json();
      if (d.success) { setReceiveId(null); await fetchPOs(); }
      else setError(d.error || 'Failed to reconcile delivery.');
    } catch (e) { setError('Network error reconciling delivery.'); }
    finally { setReceiving(false); }
  };

  // ── Split lists ───────────────────────────────────────────────────────────────
  const activePOs = pos.filter(p => ['Ordered', 'Processing'].includes(p.status));
  const historyPOs = pos.filter(p => ['Complete', 'Incomplete', 'Cancelled'].includes(p.status));
  const [invSearch, setInvSearch] = useState('');

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-brand/60';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
            <Truck size={19} className="text-brand" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white leading-none">Procurement</h1>
            <p className="text-white/40 text-xs font-bold mt-1">Purchase orders &amp; delivery reconciliation</p>
          </div>
        </div>
        {subTab === 'orders' && canManage && (
          <div className="flex items-center gap-2">
            <button onClick={downloadPoTemplate} title="Download a blank template with the expected headers" className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white font-bold text-sm px-4 py-2.5 rounded-xl transition">
              <FileText size={15} /> Template
            </button>
            <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-bold text-sm px-4 py-2.5 rounded-xl transition cursor-pointer">
              <Download size={15} className="rotate-180" /> Import Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { parsePoExcel(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button onClick={openNewForm} className="flex items-center gap-2 bg-brand hover:bg-brand/90 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition shadow-sm">
              <Plus size={16} /> New PO
            </button>
          </div>
        )}
        {subTab === 'suppliers' && canManage && (
          <button onClick={() => openSupplierForm()} className="flex items-center gap-2 bg-brand hover:bg-brand/90 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition shadow-sm">
            <Plus size={16} /> New Supplier
          </button>
        )}
      </div>

      {/* Sub-tab switch */}
      <div className="inline-flex bg-white/5 border border-white/10 rounded-xl p-1 mb-5">
        {[
          { id: 'orders', label: 'Purchase Orders', icon: ClipboardList },
          { id: 'receiving', label: 'Receiving', icon: PackageCheck, badge: activePOs.length },
          { id: 'suppliers', label: 'Suppliers', icon: Building2 },
        ].map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${subTab === id ? 'bg-brand text-white shadow-sm' : 'text-white/50 hover:text-white'}`}>
            <Icon size={15} /> {label}
            {badge > 0 && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${subTab === id ? 'bg-white/20' : 'bg-brand/20 text-brand'}`}>{badge}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-sm font-bold px-4 py-3 rounded-xl mb-4">
          <AlertTriangle size={16} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-300/60 hover:text-red-300"><X size={15} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-white/40 py-16 font-bold"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : subTab === 'orders' ? (
        /* ── PURCHASE ORDERS LIST ── */
        <div className="space-y-6">
          <PoSection title="Active" empty="No active purchase orders. Create one with “New PO”." pos={activePOs} money={money}
            renderActions={(po) => (
              <div className="flex items-center gap-1.5 flex-wrap">
                {canManage && po.status === 'Ordered' && (
                  <button onClick={() => setStatus(po, 'Processing')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition">Mark Processing</button>
                )}
                {canManage && <button onClick={() => openEditForm(po)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition">Edit</button>}
                {canManage && <button onClick={() => setStatus(po, 'Cancelled')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-red-500/15 hover:text-red-300 transition">Cancel</button>}
                {canDelete && (
                  <button onClick={() => deletePO(po)} className="p-1.5 rounded-lg text-white/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={14} /></button>
                )}
              </div>
            )} />
          <PoSection title="History" empty="No completed or cancelled POs yet." pos={historyPOs} money={money} showReceived
            renderActions={(po) => canDelete && ['Cancelled'].includes(po.status) ? (
              <button onClick={() => deletePO(po)} className="p-1.5 rounded-lg text-white/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={14} /></button>
            ) : null} />
        </div>
      ) : subTab === 'suppliers' ? (
        /* ── SUPPLIERS DIRECTORY ── */
        <div className="space-y-2">
          {suppliers.length === 0 ? (
            <div className="text-center py-16 text-white/40 font-bold">
              <Building2 size={32} className="mx-auto mb-3 opacity-40" />
              No suppliers yet.{canManage ? ' Add one with “New Supplier”.' : ''}
            </div>
          ) : suppliers.map(s => (
            <div key={s._id} className={`bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 flex items-start gap-3 ${s.isActive === false ? 'opacity-50' : ''}`}>
              <div className="w-9 h-9 rounded-lg bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
                <Building2 size={16} className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-white text-sm">{s.name}</span>
                  {s.isActive === false && <span className="text-[10px] font-black uppercase tracking-wider text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full">Inactive</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-white/40 text-xs">
                  {s.contactPerson && <span>{s.contactPerson}</span>}
                  {s.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{s.phone}</span>}
                  {s.email && <span className="inline-flex items-center gap-1"><Mail size={11} />{s.email}</span>}
                  {s.address && <span className="inline-flex items-center gap-1"><MapPin size={11} />{s.address}</span>}
                </div>
                {s.notes && <p className="text-white/30 text-xs mt-1">{s.notes}</p>}
              </div>
              {canManage && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openSupplierForm(s)} className="p-1.5 rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition"><Pencil size={14} /></button>
                  {canDelete && <button onClick={() => deleteSupplier(s)} className="p-1.5 rounded-lg text-white/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={14} /></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ── RECEIVING / RECONCILIATION ── */
        <div className="space-y-3">
          {activePOs.length === 0 ? (
            <div className="text-center py-16 text-white/40 font-bold">
              <PackageCheck size={32} className="mx-auto mb-3 opacity-40" />
              Nothing awaiting delivery. Create a PO in the Purchase Orders tab first.
            </div>
          ) : activePOs.map(po => (
            <div key={po._id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <button onClick={() => receiveId === po._id ? setReceiveId(null) : openReceive(po)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-white text-sm">{po.poNumber}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <p className="text-white/40 text-xs font-bold mt-0.5 truncate">
                    {po.supplier || 'No supplier'} · {po.lines?.length || 0} item(s) · Expected {fmtDate(po.expectedDate)}
                  </p>
                </div>
                <span className="text-white/50 font-black text-sm whitespace-nowrap">{money(po.estTotal)}</span>
                <ChevronRight size={16} className={`text-white/30 transition ${receiveId === po._id ? 'rotate-90' : ''}`} />
              </button>

              {receiveId === po._id && (
                <div className="border-t border-white/10 p-4 space-y-3 bg-black/20">
                  <p className="text-[11px] font-black uppercase tracking-wider text-white/40">Enter actual quantities received</p>
                  <div className="space-y-2">
                    {po.lines.map((l, i) => {
                      const key = l._id || i;
                      const recv = Number(receiveQtys[key]);
                      const short = !isNaN(recv) && recv < (l.orderedQty || 0);
                      return (
                        <div key={key} className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">{l.itemName}</p>
                            <p className="text-white/40 text-xs">Ordered: {l.orderedQty} {l.unit} @ {money(l.unitCost)}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input type="number" min="0" step="any" value={receiveQtys[key] ?? ''}
                              onChange={e => setReceiveQtys(q => ({ ...q, [key]: e.target.value }))}
                              className={`w-24 bg-white/5 border rounded-lg px-2 py-1.5 text-sm text-right text-white focus:outline-none ${short ? 'border-red-500/50' : 'border-white/10 focus:border-brand/60'}`} />
                            <span className="text-white/40 text-xs font-bold w-8">{l.unit}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <textarea value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} rows={2}
                    placeholder="Delivery notes (optional): damages, substitutions, backorders…" className={inputCls} />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setReceiveId(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-white/50 hover:text-white transition">Cancel</button>
                    <button onClick={() => submitReceive(po)} disabled={receiving}
                      className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-4 py-2 rounded-xl transition">
                      {receiving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Confirm Received
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── DRAFT / EDIT MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-3xl my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="font-black text-white text-lg">{editId ? 'Edit Purchase Order' : 'New Purchase Order'}</h2>
              <button onClick={() => !saving && setShowForm(false)} className="text-white/40 hover:text-white transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Supplier</label>
                  {/* Always visible: pick a saved supplier, add a new one on the fly, or
                      just type the name manually below. Not gated on suppliers existing
                      yet, so the picker is discoverable even before any supplier is saved. */}
                  <select value={form.supplierId} onChange={e => { if (e.target.value === '__new__') openSupplierForm(null, true); else pickSupplier(e.target.value); }} className={`${inputCls} mb-1.5`}>
                    <option value="">
                      {suppliers.length > 0 ? '— Pick a saved supplier (or type below) —' : '— No saved suppliers yet (type below, or add one) —'}
                    </option>
                    {suppliers.filter(s => s.isActive !== false).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                    <option value="__new__">+ Add new supplier…</option>
                  </select>
                  <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value, supplierId: '' }))} placeholder="Or type supplier name manually" className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Expected Delivery</label>
                  <input type="date" value={form.expectedDate} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} className={inputCls} />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-black uppercase tracking-wider text-white/40">Line Items</label>
                  <button onClick={addLine} className="flex items-center gap-1 text-brand text-xs font-bold hover:text-brand/80 transition"><Plus size={13} /> Add line</button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((l, idx) => (
                    <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={l.invId || ''} onChange={e => pickInventory(idx, e.target.value)}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand/60">
                          <option value="">Pick from inventory (or type below)</option>
                          {inventory.map(i => <option key={i._id} value={i._id}>{i.itemName}{i.itemCode ? ` (${i.itemCode})` : ''}</option>)}
                        </select>
                        {form.lines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="p-1.5 rounded-lg text-white/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={15} /></button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input value={l.itemName} onChange={e => updateLine(idx, { itemName: e.target.value, invId: null })} placeholder="Item name" className="col-span-2 sm:col-span-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <input type="number" min="0" step="any" value={l.orderedQty} onChange={e => updateLine(idx, { orderedQty: e.target.value })} placeholder="Qty" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <input value={l.unit} onChange={e => updateLine(idx, { unit: e.target.value })} placeholder="Unit" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <input type="number" min="0" step="any" value={l.unitCost} onChange={e => updateLine(idx, { unitCost: e.target.value })} placeholder="Unit cost" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-brand/60" />
                      </div>
                      <p className="text-right text-white/40 text-xs font-bold">Line: {money((Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0))}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes" className={inputCls} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10">
              <span className="text-sm font-black text-white">Estimated total: <span className="text-brand">{money(formEstTotal)}</span></span>
              <div className="flex items-center gap-2">
                <button onClick={() => !saving && setShowForm(false)} className="text-sm font-bold px-4 py-2 rounded-xl text-white/50 hover:text-white transition">Cancel</button>
                <button onClick={saveDraft} disabled={saving} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {editId ? 'Save Changes' : 'Create PO'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SUPPLIER FORM MODAL ── */}
      {showSupplierForm && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !savingSupplier && setShowSupplierForm(false)}>
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-lg my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="font-black text-white text-lg">{supplierEditId ? 'Edit Supplier' : 'New Supplier'}</h2>
              <button onClick={() => !savingSupplier && setShowSupplierForm(false)} className="text-white/40 hover:text-white transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Name *</label>
                <input value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="Supplier name" className={inputCls} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Contact Person</label>
                  <input value={supplierForm.contactPerson} onChange={e => setSupplierForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder="Contact name" className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Phone</label>
                  <input value={supplierForm.phone} onChange={e => setSupplierForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Email</label>
                <input value={supplierForm.email} onChange={e => setSupplierForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Address</label>
                <input value={supplierForm.address} onChange={e => setSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-white/40 mb-1 block">Notes</label>
                <textarea value={supplierForm.notes} onChange={e => setSupplierForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes" className={inputCls} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
              <button onClick={() => !savingSupplier && setShowSupplierForm(false)} className="text-sm font-bold px-4 py-2 rounded-xl text-white/50 hover:text-white transition">Cancel</button>
              <button onClick={saveSupplier} disabled={savingSupplier} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                {savingSupplier ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {supplierEditId ? 'Save Changes' : 'Create Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IMPORT PREVIEW MODAL ── */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !importing && setImportPreview(null)}>
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-3xl my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h2 className="font-black text-white text-lg">Import Purchase Orders</h2>
                <p className="text-white/40 text-xs mt-0.5">
                  {importPreview.pos.length} PO(s) · {importPreview.pos.reduce((s, p) => s + p.lines.length, 0)} line item(s)
                  {importPreview.skipped > 0 && ` · ${importPreview.skipped} row(s) skipped`}
                </p>
              </div>
              <button onClick={() => !importing && setImportPreview(null)} className="text-white/40 hover:text-white transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {importPreview.pos.map((p, pi) => {
                const total = p.lines.reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0);
                return (
                  <div key={pi} className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <span className="font-black text-white text-sm">{p.supplier || 'Unknown supplier'}</span>
                      <div className="flex items-center gap-2 text-[11px] text-white/40 font-bold">
                        {p.poNo && <span>PO {p.poNo}</span>}
                        <span className="text-brand">{money(total)}</span>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      {p.lines.map((l, li) => (
                        <div key={li} className="flex items-center justify-between text-xs text-white/60">
                          <span className="truncate pr-2">{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</span>
                          <span className="whitespace-nowrap font-mono">{l.orderedQty} {l.unit} × {money(l.unitCost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
              <button onClick={() => !importing && setImportPreview(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-white/50 hover:text-white transition">Cancel</button>
              <button onClick={confirmImport} disabled={importing} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                {importing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Import {importPreview.pos.length} PO(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PO list section (card list) ───────────────────────────────────────────────
function PoSection({ title, pos, empty, money, renderActions, showReceived }) {
  const [open, setOpen] = useState({});
  if (!pos.length) {
    return (
      <div>
        <p className="text-[11px] font-black uppercase tracking-wider text-white/30 mb-2">{title}</p>
        <div className="text-center py-8 text-white/30 text-sm font-bold border border-dashed border-white/10 rounded-2xl">{empty}</div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-white/30 mb-2">{title} <span className="text-white/20">({pos.length})</span></p>
      <div className="space-y-2">
        {pos.map(po => {
          const isOpen = open[po._id];
          return (
            <div key={po._id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <button onClick={() => setOpen(o => ({ ...o, [po._id]: !o[po._id] }))} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <ChevronRight size={16} className={`text-white/30 shrink-0 transition ${isOpen ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-white text-sm">{po.poNumber}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <p className="text-white/40 text-xs font-bold mt-0.5 truncate">
                      {po.supplier || 'No supplier'} · {po.lines?.length || 0} item(s)
                      {showReceived && po.receivedAt ? ` · Received ${fmtDate(po.receivedAt)}` : ` · Expected ${fmtDate(po.expectedDate)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white/60 font-black text-sm">{money(showReceived && po.actualTotal ? po.actualTotal : po.estTotal)}</p>
                    {showReceived && po.actualTotal > 0 && <p className="text-white/30 text-[10px] font-bold">est {money(po.estTotal)}</p>}
                  </div>
                </button>
                {renderActions && <div className="shrink-0">{renderActions(po)}</div>}
              </div>
              {isOpen && (
                <div className="border-t border-white/10 px-4 py-3 bg-black/20">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white/30 text-[10px] font-black uppercase tracking-wider text-left">
                        <th className="pb-1.5">Item</th>
                        <th className="pb-1.5 text-right">Ordered</th>
                        {showReceived && <th className="pb-1.5 text-right">Received</th>}
                        <th className="pb-1.5 text-right">Unit Cost</th>
                        <th className="pb-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-white/70">
                      {po.lines.map((l, i) => {
                        const short = showReceived && l.receivedQty != null && l.receivedQty < l.orderedQty;
                        return (
                          <tr key={l._id || i} className="border-t border-white/5">
                            <td className="py-1.5 font-bold text-white/80">{l.itemName}</td>
                            <td className="py-1.5 text-right">{l.orderedQty} {l.unit}</td>
                            {showReceived && <td className={`py-1.5 text-right font-bold ${short ? 'text-red-300' : 'text-green-300'}`}>{l.receivedQty ?? '—'} {l.unit}</td>}
                            <td className="py-1.5 text-right">{money(l.unitCost)}</td>
                            <td className="py-1.5 text-right">{money((showReceived && l.receivedQty != null ? l.receivedQty : l.orderedQty) * l.unitCost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {po.notes && <p className="text-white/40 text-xs mt-2 pt-2 border-t border-white/5"><span className="font-black uppercase tracking-wider text-[10px] text-white/30">Notes: </span>{po.notes}</p>}
                  {po.receivedBy && <p className="text-white/30 text-[11px] mt-1.5 font-bold">Received by {po.receivedBy}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
