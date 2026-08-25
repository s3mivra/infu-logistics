import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, Plus, Trash2, X, Check, ClipboardList, PackageCheck, ChevronRight, ChevronDown, Search, AlertTriangle, FileText, Loader2, Building2, Pencil, Phone, Mail, MapPin, Download, Sparkles, Box } from 'lucide-react';
import * as ui from '../../shared/ui';
import { buildBillingDocHTML, printBillingDoc } from '../../shared/billingDocument';

// ── ProcurementTab - Purchase Order workflow ──────────────────────────────────
// Two-stage tracking. LEFT tab ("Purchase Orders") drafts & tracks planned POs
// through Ordered → Processing. RIGHT tab ("Receiving") reconciles a delivery by
// typing the actual received quantities, which flips the PO to Complete or
// Incomplete. Purely a tracking record - it does not post to inventory/ledger.
//
// Self-contained: only pulls apiFetch / peso / inventory / isSuperAdmin from ctx.

const STATUS_STYLES = {
  Ordered:    'bg-blue-500 text-white border-blue-500',
  Processing: 'bg-amber-500 text-white border-amber-500',
  Complete:   'bg-green-500 text-white border-green-500',
  Incomplete: 'bg-red-500 text-white border-red-500',
  Cancelled:  'bg-white text-fg border-white',
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] || STATUS_STYLES.Cancelled}`}>
    {status}
  </span>
);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

export default function ProcurementTab({ ctx }) {
  const { apiFetch, peso, inventory = [], isSuperAdmin, packInfo, effectiveDisplay, systemSettings = {}, loadPdfLibs,
    stockLocations = [], stockCategories = [], procurementCreditAccounts = [] } = ctx;
  const money = peso || ((n) => `₱${(Number(n) || 0).toFixed(2)}`);

  // Print a PO on the SAME A4 document template the Orders billing statement /
  // order slip uses - only the labels differ ("PURCHASE ORDER" vs "BILLING
  // STATEMENT"). Letterhead/payment/contact and the print size come from the
  // same system settings.
  const printPurchaseOrder = (po) => {
    const items = (po.lines || []).map(l => ({
      code: l.itemCode || '',
      desc: l.itemName + (l.unit ? ` (${l.unit})` : ''),
      qty: l.orderedQty,
      unitPrice: Number(l.unitCost) || 0,
      total: (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0),
    }));
    const total = po.estTotal != null
      ? po.estTotal
      : items.reduce((s, l) => s + l.total, 0);

    const schedRows = [
      po.expectedDate ? { label: 'Expected Delivery:', value: fmtDate(po.expectedDate) } : null,
      po.notes ? { label: 'Notes:', value: po.notes } : null,
    ].filter(Boolean);

    printBillingDoc(buildBillingDocHTML({
      docTitle: 'PURCHASE ORDER',
      dateLabel: 'Date issued',
      dateStr: fmtDate(po.createdAt),
      settings: systemSettings,
      metaFields: [
        { label: 'Supplier', value: po.supplier || '' },
        { label: 'Status', value: po.status || '' },
        { label: 'PO No.', value: po.poNumber || '' },
      ],
      schedRows,
      items,
      totals: [{ label: 'ESTIMATED TOTAL', value: total, grand: true }],
      // A PO to a supplier isn't a billed sale - swap the sales T&C for
      // procurement-appropriate terms and signatory roles.
      termsTitle: 'Purchase Terms',
      terms: [
        '1. Please supply the items listed above at the agreed unit costs.',
        '2. Deliver on or before the expected delivery date.',
        '3. Substitutions or backorders must be confirmed before dispatch.',
      ],
      signatures: [
        'PREPARED BY: Signature over Printed Name / Date',
        'APPROVED BY: Signature over Printed Name / Date',
        'RECEIVED BY (Supplier): Signature over Printed Name / Date',
      ],
    }));
  };
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
  // source), so the pack size becomes the unit LABEL ("1L", "2L", "250G") - we do
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
  const blankLine = () => ({ invId: null, itemName: '', itemCode: '', unit: '', packSize: '', orderedQty: '', unitCost: '', expiryDate: '', productionDate: '', expiryWarnDays: '', lowStockThreshold: '', stockLocation: '', stockCategory: '', creditAccount: '' });
  // Same forced g/mL/pcs display units the inventory uses (see lib/units).
  const UNIT_OPTIONS = ['', 'pcs', 'kg', 'L', 'g', 'ml'];
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ supplier: '', supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] });
  const [saving, setSaving] = useState(false);

  const openNewForm = () => {
    setEditId(null);
    setForm({ supplier: '', supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] });
    setSuggestedQueue([]); setSuggestedQueueTotal(0);
    setShowForm(true);
  };
  const openEditForm = (po) => {
    setEditId(po._id);
    setSuggestedQueue([]); setSuggestedQueueTotal(0);
    setForm({
      supplier: po.supplier || '',
      supplierId: po.supplierId || '',
      expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString().slice(0, 10) : '',
      notes: po.notes || '',
      lines: (po.lines || []).map(l => ({
        invId: l.invId || null, itemName: l.itemName || '', itemCode: l.itemCode || '',
        unit: l.unit || '', packSize: l.packSize ?? '', orderedQty: l.orderedQty ?? '', unitCost: l.unitCost ?? '',
        expiryDate: l.expiryDate ? new Date(l.expiryDate).toISOString().slice(0, 10) : '',
        productionDate: l.productionDate ? new Date(l.productionDate).toISOString().slice(0, 10) : '',
      })),
    });
    setShowForm(true);
  };

  // ── Suggested PO ────────────────────────────────────────────────────────────
  // Pulls the velocity-based reorder report (ADU × cover-days − on-hand) and pre-fills
  // a fresh draft with the items that need restocking. The user reviews/edits before
  // saving, so nothing is ordered automatically. Per-display-unit cost is recovered
  // from the report's estCost so the PO line math (qty × unitCost) matches.
  //
  // The report now resolves each item's cheapest supplier from the supplier catalog,
  // so suggestions are grouped into one draft per supplier (plus an "unassigned"
  // group for items with no catalog match) instead of one mixed-supplier draft.
  // suggestedQueue holds the remaining drafts; saveDraft() advances through it so
  // the reviewer still confirms every PO before anything is created.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedQueue, setSuggestedQueue] = useState([]);
  const [suggestedQueueTotal, setSuggestedQueueTotal] = useState(0);

  const suggestionToLine = (l) => {
    const inv = inventory.find(i => l.invId && String(i._id) === String(l.invId)) || inventory.find(i => i.itemName === l.itemName);
    const displayQty = Number(l.suggestedOrder) || 0;
    // The report's suggestedOrder/estCost are in DISPLAY units (₱/kg-style).
    // LOG orders by the PACK, so convert to a pack count + price-per-pack
    // whenever the item's real pack size is known - same convention as
    // pickInventory() / the Edit Inventory modal. Falls back to the raw
    // display-unit figures when packSize isn't tracked for this item.
    const packSize = inv?.packSize && inv.packSize > 0 ? inv.packSize : null;
    let orderedQty = displayQty;
    let unitCost = displayQty > 0 ? +((Number(l.estCost) || 0) / displayQty).toFixed(4) : (inv?.unitCost ?? l.unitCost ?? '');
    if (BUSINESS_TYPE === 'log' && packSize && packInfo && inv) {
      orderedQty = +(displayQty / packSize).toFixed(2);
      unitCost = +(packInfo(inv).cost).toFixed(4);
    }
    return {
      invId: inv?._id || l.invId || null,
      itemName: l.itemName || '',
      itemCode: inv?.itemCode || l.itemCode || '',
      unit: l.displayUnit || inv?.displayUnit || inv?.unit || l.unit || '',
      packSize: packSize || '',
      orderedQty,
      unitCost,
      expiryDate: '',
    };
  };

  const buildSuggestedPo = async () => {
    setSuggesting(true); setError('');
    try {
      const res = await apiFetch('/api/reports/purchase-order?days=7');
      const d = await res.json();
      if (!d.success) { setError(d.error || 'Failed to build a suggested PO.'); return; }
      const suggested = d.lines || [];
      if (suggested.length === 0) { setError('Nothing to reorder - all stock is at or above its threshold.'); return; }

      const groups = new Map();
      for (const l of suggested) {
        const key = l.supplierId || 'unassigned';
        if (!groups.has(key)) groups.set(key, { supplierId: l.supplierId || '', supplier: l.supplierName || '', lines: [] });
        groups.get(key).lines.push(suggestionToLine(l));
      }
      const noteBase = `Suggested restock (${d.coverDays || 7}-day cover) generated ${new Date().toLocaleDateString()}`;
      const drafts = [...groups.values()].map(g => ({
        supplier: g.supplier, supplierId: g.supplierId, expectedDate: '',
        notes: g.supplierId ? noteBase : `${noteBase} - no matching supplier found, assign one below`,
        lines: g.lines,
      }));

      setEditId(null);
      setForm(drafts[0]);
      setSuggestedQueue(drafts.slice(1));
      setSuggestedQueueTotal(drafts.length);
      setShowForm(true);
    } catch { setError('Network error building suggested PO.'); }
    finally { setSuggesting(false); }
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
  // Which supplier's "what they supply / how much we buy" rollup is expanded.
  const [expandedSupplierId, setExpandedSupplierId] = useState(null);

  // ── Vendor statement (opening balance → invoices/payments → closing balance) ──
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const monthStartStr = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
  const [statementSupplier, setStatementSupplier] = useState(null); // supplier object
  const [statement, setStatement] = useState(null);
  const [statementRange, setStatementRange] = useState({ start: monthStartStr(), end: todayStr() });
  const [loadingStatement, setLoadingStatement] = useState(false);

  const openStatement = async (s, range = statementRange) => {
    setStatementSupplier(s); setStatement(null); setError(''); setLoadingStatement(true);
    try {
      const res = await apiFetch(`/api/finance/vendor-statement/${s._id}?start=${range.start}&end=${range.end}`);
      const d = await res.json();
      if (d.success) setStatement(d); else setError(d.error || 'Failed to load vendor statement.');
    } catch { setError('Network error loading vendor statement.'); }
    finally { setLoadingStatement(false); }
  };
  const closeStatement = () => { setStatementSupplier(null); setStatement(null); };

  const exportStatementToPDF = async () => {
    if (!statement || !statementSupplier) return;
    const { jsPDF, autoTable } = await loadPdfLibs();
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Vendor Statement - ${statementSupplier.name}`, 14, 16);
    doc.setFontSize(9);
    doc.text(`${fmtDate(statement.period.start)} to ${fmtDate(statement.period.end)}`, 14, 22);
    doc.text(`Opening balance: ${money(statement.openingBalance)}`, 14, 28);
    autoTable(doc, {
      startY: 34,
      head: [['Date', 'Reference', 'Description', 'Invoiced', 'Paid', 'Balance']],
      body: statement.entries.map(e => [fmtDate(e.date), e.reference, e.description, money(e.invoiceAmount), money(e.paymentAmount), money(e.runningBalance)]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [30, 30, 30] },
    });
    const endY = (doc.lastAutoTable?.finalY || 34) + 8;
    doc.setFontSize(10);
    doc.text(`Closing balance: ${money(statement.closingBalance)}`, 14, endY);
    doc.save(`vendor-statement-${statementSupplier.name.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
  };

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
    if (!(await ui.confirm(`Delete supplier "${s.name}"? Past POs keep their supplier name.`))) return;
    try {
      const res = await apiFetch(`/api/suppliers/${s._id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) fetchSuppliers(); else setError(d.error || 'Failed to delete supplier.');
    } catch { setError('Network error deleting supplier.'); }
  };

  // ── Supplier catalog (what they supply + their quoted price) ───────────────────
  // Independent of purchase history - lets "who's cheaper for X" be answered
  // before ever placing a PO with them.
  const blankCatalogEntry = { itemName: '', itemCode: '', unit: '', packSize: '', unitCost: '', notes: '', invId: null };
  const [catalogFormFor, setCatalogFormFor] = useState(null); // supplierId currently adding/editing a catalog entry
  const [catalogEditId, setCatalogEditId] = useState(null);   // catalog entry _id being edited (null = adding new)
  const [catalogForm, setCatalogForm] = useState(blankCatalogEntry);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [showPriceCompare, setShowPriceCompare] = useState(false);

  const openCatalogForm = (supplierId, entry = null) => {
    setCatalogFormFor(supplierId);
    setCatalogEditId(entry?._id || null);
    setCatalogForm(entry ? {
      itemName: entry.itemName || '', itemCode: entry.itemCode || '', unit: entry.unit || '',
      packSize: entry.packSize ?? '', unitCost: entry.unitCost ?? '', notes: entry.notes || '',
      invId: entry.invId || null,
    } : blankCatalogEntry);
  };
  const closeCatalogForm = () => { setCatalogFormFor(null); setCatalogEditId(null); setCatalogForm(blankCatalogEntry); };

  // Typing the item name: if it matches an existing inventory item (case-insensitive,
  // exact), link to it (invId) and pull its unit/code across - this is a real stocked
  // product. Otherwise it's a free-text quote for something they sell that we don't
  // stock yet; invId stays null.
  const onCatalogItemNameChange = (typed) => {
    const match = inventory.find(i => i.itemName.toLowerCase() === typed.toLowerCase().trim());
    setCatalogForm(f => ({
      ...f, itemName: typed,
      invId: match ? match._id : null,
      itemCode: match ? (match.itemCode || '') : f.itemCode,
      unit: match ? (match.displayUnit || match.unit || f.unit) : f.unit,
      packSize: match ? (match.packSize && match.packSize > 0 ? match.packSize : f.packSize) : f.packSize,
    }));
  };

  const saveCatalogEntry = async (supplierId) => {
    if (!catalogForm.itemName.trim()) { setError('Item name is required.'); return; }
    if (!(Number(catalogForm.unitCost) > 0)) { setError('A positive price is required.'); return; }
    setSavingCatalog(true); setError('');
    try {
      const url = catalogEditId
        ? `/api/suppliers/${supplierId}/products/${catalogEditId}`
        : `/api/suppliers/${supplierId}/products`;
      const res = await apiFetch(url, { method: catalogEditId ? 'PATCH' : 'POST', body: JSON.stringify(catalogForm) });
      const d = await res.json();
      if (d.success) { closeCatalogForm(); await fetchSuppliers(); }
      else setError(d.error || 'Failed to save catalog item.');
    } catch { setError('Network error saving catalog item.'); }
    finally { setSavingCatalog(false); }
  };

  const deleteCatalogEntry = async (supplierId, entry) => {
    if (!(await ui.confirm(`Remove "${entry.itemName}" from this supplier's catalog?`))) return;
    try {
      const res = await apiFetch(`/api/suppliers/${supplierId}/products/${entry._id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) fetchSuppliers(); else setError(d.error || 'Failed to remove catalog item.');
    } catch { setError('Network error removing catalog item.'); }
  };

  // Flatten every supplier's catalog, grouped by item name (case-insensitive),
  // each group sorted cheapest-first - the actual "who's cheaper" answer.
  const priceComparison = useMemo(() => {
    const groups = new Map();
    for (const s of suppliers) {
      for (const entry of (s.catalog || [])) {
        const key = entry.itemName.trim().toLowerCase();
        if (!groups.has(key)) groups.set(key, { itemName: entry.itemName, offers: [] });
        groups.get(key).offers.push({
          supplierId: s._id, supplierName: s.name, unitCost: entry.unitCost,
          unit: entry.unit, packSize: entry.packSize, notes: entry.notes,
        });
      }
    }
    const rows = Array.from(groups.values()).map(g => ({
      ...g, offers: g.offers.sort((a, b) => a.unitCost - b.unitCost),
    }));
    rows.sort((a, b) => a.itemName.localeCompare(b.itemName));
    return rows;
  }, [suppliers]);

  const updateLine = (idx, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (idx) => setForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : f.lines }));

  // Autofill a line when an inventory item is picked. item.unitCost is always
  // stored per BASE unit (₱/gram) - never copy it straight across.
  //   LOG: ordering is by the PACK ("10 cans of condensed milk"), so unitCost
  //   here must be the price PER PACK - exactly what the Edit Inventory modal
  //   shows (packInfo().cost = base cost × the pack's base-unit size). Using
  //   the per-display-unit (₱/kg) figure instead was the bug: a 250g cookie
  //   pack costing ₱133.46 showed as ₱533.84 (its ₱/kg price × 4).
  //   FB: ordering is by display unit (kg/L), so the per-display-unit cost is
  //   the correct one to prefill.
  // Qty prefills from the most recent OTHER PO that ordered this same item (by
  // PLU/invId) - a fast "same as last time" default the user can still retype.
  // `pos` is already sorted newest-first by the server, so the first match found
  // walking it in order is the most recent one. The PO currently being edited is
  // skipped so re-picking an item already on this draft doesn't just echo itself.
  const lastOrderedQtyFor = (invId) => {
    for (const po of pos) {
      if (editId && po._id === editId) continue;
      const line = (po.lines || []).find(l => l.invId && String(l.invId) === String(invId));
      if (line) return line.orderedQty;
    }
    return null;
  };
  const pickInventory = (idx, invId) => {
    const item = inventory.find(i => String(i._id) === String(invId));
    if (!item) { updateLine(idx, { invId: null }); return; }
    let unitCost = item.unitCost ?? '';
    if (BUSINESS_TYPE === 'log' && packInfo) {
      const pack = packInfo(item);
      if (pack?.packBase > 0) unitCost = +(pack.cost).toFixed(4);
    } else if (effectiveDisplay) {
      const { mult } = effectiveDisplay(item);
      if (item.unitCost != null) unitCost = +(item.unitCost * (mult || 1)).toFixed(4);
    }
    const lastQty = lastOrderedQtyFor(item._id);
    updateLine(idx, {
      invId: item._id,
      itemName: item.itemName || '',
      itemCode: item.itemCode || '',
      unit: item.displayUnit || item.unit || '',
      // item.packSize is the SKU's real per-pack size (e.g. 0.377 for a 377g
      // can); unitMultiplier is the fixed kg/L<->g/ml conversion factor (1000)
      // and is NOT a pack size.
      packSize: item.packSize && item.packSize > 0 ? item.packSize : '',
      unitCost,
      ...(lastQty != null ? { orderedQty: lastQty } : {}),
    });
  };

  const formEstTotal = useMemo(
    () => form.lines.reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0),
    [form.lines]
  );

  const saveDraft = async () => {
    const cleanLines = form.lines
      .map(l => ({
        ...l,
        orderedQty: Number(l.orderedQty) || 0,
        unitCost: Number(l.unitCost) || 0,
        packSize: l.packSize === '' || l.packSize == null ? null : Number(l.packSize) || null,
        expiryDate: l.expiryDate || null,
        productionDate: l.expiryDate ? null : (l.productionDate || null),
        expiryWarnDays: l.expiryWarnDays !== '' && l.expiryWarnDays != null ? Number(l.expiryWarnDays) || null : null,
        lowStockThreshold: l.lowStockThreshold !== '' && l.lowStockThreshold != null ? Number(l.lowStockThreshold) || null : null,
        stockLocation: l.stockLocation || null,
        stockCategory: l.stockCategory || null,
        creditAccount: l.creditAccount || null,
      }))
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
      if (d.success) {
        await fetchPOs();
        if (suggestedQueue.length > 0) {
          const [next, ...rest] = suggestedQueue;
          setEditId(null);
          setForm(next);
          setSuggestedQueue(rest);
        } else {
          setShowForm(false);
          setSuggestedQueueTotal(0);
        }
      }
      else setError(d.error || 'Failed to save purchase order.');
    } catch (e) { setError('Network error saving purchase order.'); }
    finally { setSaving(false); }
  };

  // Abandoning the form also drops any queued supplier-grouped drafts still
  // waiting for review, rather than silently creating them without confirmation.
  const closeForm = () => { setShowForm(false); setSuggestedQueue([]); setSuggestedQueueTotal(0); };

  const setStatus = async (po, status) => {
    try {
      const res = await apiFetch(`/api/purchase-orders/${po._id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      const d = await res.json();
      if (d.success) fetchPOs(); else setError(d.error || 'Failed to update status.');
    } catch (e) { setError('Network error updating status.'); }
  };

  const deletePO = async (po) => {
    if (!(await ui.confirm(`Delete ${po.poNumber}? This cannot be undone.`))) return;
    try {
      const res = await apiFetch(`/api/purchase-orders/${po._id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) fetchPOs(); else setError(d.error || 'Failed to delete.');
    } catch (e) { setError('Network error deleting purchase order.'); }
  };

  // ── Receiving / reconciliation ────────────────────────────────────────────────
  const [receiveId, setReceiveId] = useState(null);
  const [receiveQtys, setReceiveQtys] = useState({});
  const [receiveExpiry, setReceiveExpiry] = useState({});
  const [receiveProduction, setReceiveProduction] = useState({});
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receiving, setReceiving] = useState(false);

  const openReceive = (po) => {
    setReceiveId(po._id);
    // Prefill with what's still MISSING (ordered minus already received), not
    // the full ordered qty - reopening a partially-received PO only asks about
    // the outstanding balance, and the value entered is submitted as THIS
    // delivery's quantity (a delta), never a replacement total.
    const q = {};
    const exp = {};
    const prod = {};
    (po.lines || []).forEach((l, i) => {
      const rem = remainingOf(l);
      if (rem > 0) {
        q[l._id || i] = String(rem);
        // Default to whatever expiry/production date was planned on the draft -
        // editable, since the actual delivery's date can differ from what was planned.
        exp[l._id || i] = l.expiryDate ? new Date(l.expiryDate).toISOString().slice(0, 10) : '';
        prod[l._id || i] = l.productionDate ? new Date(l.productionDate).toISOString().slice(0, 10) : '';
      }
    });
    setReceiveQtys(q);
    setReceiveExpiry(exp);
    setReceiveProduction(prod);
    setReceiveNotes(po.notes || '');
  };

  const submitReceive = async (po) => {
    setReceiving(true); setError('');
    try {
      const received = (po.lines || [])
        .map((l, i) => ({
          lineId: l._id, index: i, receivedQty: Number(receiveQtys[l._id || i]) || 0,
          expiryDate: receiveExpiry[l._id || i] || null,
          productionDate: receiveExpiry[l._id || i] ? null : (receiveProduction[l._id || i] || null),
        }))
        .filter(r => r.receivedQty > 0); // only send lines the user actually entered a delivered qty for
      const res = await apiFetch(`/api/purchase-orders/${po._id}/receive`, { method: 'POST', body: JSON.stringify({ received, notes: receiveNotes }) });
      const d = await res.json();
      if (d.success) { setReceiveId(null); await fetchPOs(); }
      else setError(d.error || 'Failed to reconcile delivery.');
    } catch (e) { setError('Network error reconciling delivery.'); }
    finally { setReceiving(false); }
  };

  // ── Split lists ───────────────────────────────────────────────────────────────
  // Incomplete is NOT terminal - a short delivery stays actionable until every
  // line is fully received, so it belongs with the active/receivable POs, not
  // in History (which is only for genuinely finished records).
  const activePOs = pos.filter(p => ['Ordered', 'Processing', 'Incomplete'].includes(p.status));
  const historyPOs = pos.filter(p => ['Complete', 'Cancelled'].includes(p.status));
  // Per-line remaining-to-receive, used to show "the missing ones only".
  const remainingOf = (l) => Math.max(0, (Number(l.orderedQty) || 0) - (Number(l.receivedQty) || 0));
  const [invSearch, setInvSearch] = useState('');

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg placeholder-fg/25 focus:outline-none focus:border-brand/60';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
            <Truck size={19} className="text-brand" />
          </div>
          <div>
            <h1 className="text-xl font-black text-fg leading-none">Procurement</h1>
            <p className="text-fg/40 text-xs font-bold mt-1">Purchase orders &amp; delivery reconciliation</p>
          </div>
        </div>
        {subTab === 'orders' && canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadPoTemplate} title="Download a blank template with the expected headers" className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg font-bold text-sm px-4 py-2.5 rounded-xl transition">
              <FileText size={15} /> Template
            </button>
            <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg font-bold text-sm px-4 py-2.5 rounded-xl transition cursor-pointer">
              <Download size={15} className="rotate-180" /> Import Excel
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { parsePoExcel(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button onClick={buildSuggestedPo} disabled={suggesting} title="Auto-draft a PO from sales velocity - items below their reorder point" className="flex items-center gap-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-brand font-bold text-sm px-4 py-2.5 rounded-xl transition">
              {suggesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Suggested PO
            </button>
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
      {/* max-w-full + overflow-x lets the 3 pills scroll on a narrow phone
          instead of pushing the whole page wider; shrink-0 keeps each pill
          its natural size. */}
      <div className="flex max-w-full overflow-x-auto scrollbar-hide bg-white/5 border border-white/10 rounded-xl p-1 mb-5">
        {[
          { id: 'orders', label: 'Purchase Orders', icon: ClipboardList },
          { id: 'receiving', label: 'Receiving', icon: PackageCheck, badge: activePOs.length },
          { id: 'suppliers', label: 'Suppliers', icon: Building2 },
        ].map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition shrink-0 ${subTab === id ? 'bg-brand text-white shadow-sm' : 'text-fg/50 hover:text-fg'}`}>
            <Icon size={15} /> {label}
            {badge > 0 && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${subTab === id ? 'bg-white/20' : 'bg-brand/20 text-brand'}`}>{badge}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500 border border-red-500 text-white text-sm font-bold px-4 py-3 rounded-xl mb-4">
          <AlertTriangle size={16} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-white hover:text-red-300"><X size={15} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-fg/40 py-16 font-bold"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : subTab === 'orders' ? (
        /* ── PURCHASE ORDERS LIST ── */
        <div className="space-y-6">
          <PoSection title="Active" empty="No active purchase orders. Create one with “New PO”." pos={activePOs} money={money} showReceived
            renderActions={(po) => {
              // Incomplete already has a partial delivery reconciled against it -
              // editing/deleting would desync from what's already posted to
              // inventory (the server blocks both). The only edit still allowed
              // is cancelling the OUTSTANDING balance when the rest will never
              // arrive; whatever was already received stays exactly as posted.
              if (po.status === 'Incomplete') return (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => printPurchaseOrder(po)} title="Print purchase order" className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 hover:text-fg transition">Print</button>
                  <span className="text-[10px] font-bold text-amber-400/70 uppercase tracking-wider">Receive rest in Receiving tab</span>
                  {canManage && (
                    <button onClick={() => setStatus(po, 'Cancelled')} title="Cancel the outstanding balance - already-received stock is unaffected" className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/40 hover:bg-red-500/15 hover:text-red-300 transition">Cancel rest</button>
                  )}
                </div>
              );
              return (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => printPurchaseOrder(po)} title="Print purchase order" className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 hover:text-fg transition">Print</button>
                {canManage && po.status === 'Ordered' && (
                  <button onClick={() => setStatus(po, 'Processing')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-500/25 transition">Mark Processing</button>
                )}
                {canManage && <button onClick={() => openEditForm(po)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 hover:text-fg transition">Edit</button>}
                {canManage && <button onClick={() => setStatus(po, 'Cancelled')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 hover:text-white/0 transition">Cancel</button>}
                {canDelete && (
                  <button onClick={() => deletePO(po)} className="p-1.5 rounded-lg text-fg/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={14} /></button>
                )}
              </div>
              );
            }} />
          <PoSection title="History" empty="No completed or cancelled POs yet." pos={historyPOs} money={money} showReceived
            renderActions={(po) => (
              <div className="flex items-center gap-1.5">
                <button onClick={() => printPurchaseOrder(po)} title="Print purchase order" className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-fg/60 hover:bg-white/10 hover:text-fg transition">Print</button>
                {canDelete && ['Cancelled'].includes(po.status) && (
                  <button onClick={() => deletePO(po)} className="p-1.5 rounded-lg text-fg/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={14} /></button>
                )}
              </div>
            )} />
        </div>
      ) : subTab === 'suppliers' ? (
        /* ── SUPPLIERS DIRECTORY ── */
        <div className="space-y-3">
          {priceComparison.length > 0 && (
            <button onClick={() => setShowPriceCompare(v => !v)}
              className="w-full flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 hover:bg-white/10 transition">
              <span className="flex items-center gap-2 text-sm font-black text-fg">
                <Sparkles size={14} className="text-brand" /> Compare Prices - {priceComparison.length} item{priceComparison.length === 1 ? '' : 's'} catalogued
              </span>
              {showPriceCompare ? <ChevronDown size={16} className="text-fg/40" /> : <ChevronRight size={16} className="text-fg/40" />}
            </button>
          )}
          {showPriceCompare && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              {priceComparison.map(g => (
                <div key={g.itemName} className="border-b border-white/5 last:border-0 pb-3 last:pb-0">
                  <p className="text-sm font-black text-fg mb-1.5">{g.itemName}</p>
                  <div className="space-y-1">
                    {g.offers.map((o, i) => (
                      <div key={o.supplierId} className={`flex items-center justify-between gap-3 text-xs px-2.5 py-1.5 rounded-lg ${i === 0 ? 'bg-green-500 border border-green-500' : 'bg-white/5'}`}>
                        <span className={`font-bold truncate ${i === 0 ? 'text-white' : 'text-fg/60'}`}>
                          {i === 0 && '✓ '}{o.supplierName}
                        </span>
                        <span className={`whitespace-nowrap font-black ${i === 0 ? 'text-white' : 'text-fg/50'}`}>
                          {money(o.unitCost)}{o.unit ? ` / ${o.unit}` : ''}{o.packSize ? ` (${o.packSize}${o.unit || ''}/pack)` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {suppliers.length === 0 ? (
            <div className="text-center py-16 text-fg/40 font-bold">
              <Building2 size={32} className="mx-auto mb-3 opacity-40" />
              No suppliers yet.{canManage ? ' Add one with “New Supplier”.' : ''}
            </div>
          ) : suppliers.map(s => {
            const catalog = s.catalog || [];
            const purchaseHistory = s.purchaseHistory || [];
            const isOpen = expandedSupplierId === s._id;
            const isAddingCatalog = catalogFormFor === s._id;
            return (
            <div key={s._id} className={`bg-white/5 border border-white/10 rounded-2xl overflow-hidden ${s.isActive === false ? 'opacity-50' : ''}`}>
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
                  <Building2 size={16} className="text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-fg text-sm">{s.name}</span>
                    {s.isActive === false && <span className="text-[10px] font-black uppercase tracking-wider text-fg/40 bg-white/5 px-1.5 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-fg/50 text-xs">
                    {s.contactPerson && <span>{s.contactPerson}</span>}
                    {s.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{s.phone}</span>}
                    {s.email && <span className="inline-flex items-center gap-1"><Mail size={11} />{s.email}</span>}
                    {s.address && <span className="inline-flex items-center gap-1"><MapPin size={11} />{s.address}</span>}
                  </div>
                  {s.notes && <p className="text-fg/50 text-xs mt-1">{s.notes}</p>}
                  <button onClick={() => setExpandedSupplierId(isOpen ? null : s._id)}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand/80 hover:text-brand transition">
                    <Box size={12} />
                    {catalog.length === 0 ? 'No products linked yet' : `Supplies ${catalog.length} item${catalog.length === 1 ? '' : 's'}`}
                    {purchaseHistory.length > 0 && ` · ${money(s.totalSpend)} bought`}
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openStatement(s)} title="Vendor statement" className="p-1.5 rounded-lg text-fg/40 hover:bg-white/10 hover:text-fg transition"><FileText size={14} /></button>
                  {canManage && <button onClick={() => openSupplierForm(s)} className="p-1.5 rounded-lg text-fg/40 hover:bg-white/10 hover:text-fg transition"><Pencil size={14} /></button>}
                  {canManage && canDelete && <button onClick={() => deleteSupplier(s)} className="p-1.5 rounded-lg text-fg/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={14} /></button>}
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-white/10 bg-white/5 px-4 py-3 space-y-3">
                  {/* Catalog - what they supply, at what price (manually maintained) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg">Products Supplied</p>
                      {canManage && !isAddingCatalog && (
                        <button onClick={() => openCatalogForm(s._id)} className="text-[11px] font-bold text-fg hover:text-white/100 flex items-center gap-1"><Plus size={12} /> Link Product</button>
                      )}
                    </div>
                    {catalog.length === 0 && !isAddingCatalog && <p className="text-white text-xs py-1">Nothing linked yet.</p>}
                    <div className="space-y-1">
                      {catalog.map(p => (
                        <div key={p._id} className="flex items-center justify-between gap-3 bg-white rounded-lg px-2.5 py-1.5 text-xs">
                          <div className="min-w-0">
                            <span className="text-accent font-bold truncate block">{p.itemName}</span>
                            {p.notes && <span className="text-black text-[10px] block truncate">{p.notes}</span>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-black/80 font-black whitespace-nowrap">
                              {money(p.unitCost)}{p.unit ? ` / ${p.unit}` : ''}{p.packSize ? ` (${p.packSize}${p.unit || ''}/pack)` : ''}
                            </span>
                            {canManage && (
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => openCatalogForm(s._id, p)} className="p-1 rounded text-black/60 hover:text-black/40 hover:bg-white/10"><Pencil size={12} /></button>
                                <button onClick={() => deleteCatalogEntry(s._id, p)} className="p-1 rounded text-black/60 hover:text-red-300 hover:bg-red-500/15"><Trash2 size={12} /></button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {isAddingCatalog && (
                      <div className="mt-2 bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                        <input value={catalogForm.itemName} onChange={e => onCatalogItemNameChange(e.target.value)}
                          list="supplier-catalog-inventory" placeholder="Type or pick an item…" className={inputCls} />
                        <datalist id="supplier-catalog-inventory">
                          {inventory.map(inv => <option key={inv._id} value={inv.itemName} />)}
                        </datalist>
                        <p className="text-[10px] font-bold uppercase tracking-wider">
                          {catalogForm.invId
                            ? <span className="text-brand">★ Linked to inventory item</span>
                            : <span className="text-brand">New / unstocked item - quote only</span>}
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          <input value={catalogForm.unit} onChange={e => setCatalogForm(f => ({ ...f, unit: e.target.value }))}
                            placeholder="Unit (kg/L/pcs)" className={inputCls} />
                          <input type="number" min="0" step="any" value={catalogForm.packSize} onChange={e => setCatalogForm(f => ({ ...f, packSize: e.target.value }))}
                            placeholder="Pack size" className={inputCls} />
                          <input type="number" min="0" step="0.01" value={catalogForm.unitCost} onChange={e => setCatalogForm(f => ({ ...f, unitCost: e.target.value }))}
                            placeholder="Price ₱" className={inputCls} />
                        </div>
                        <input value={catalogForm.notes} onChange={e => setCatalogForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="Notes (optional)" className={inputCls} />
                        <div className="flex gap-2">
                          <button onClick={() => saveCatalogEntry(s._id)} disabled={savingCatalog}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-brand text-white font-bold text-xs py-2 rounded-lg hover:bg-brand-dark transition disabled:opacity-50">
                            {savingCatalog ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {catalogEditId ? 'Save' : 'Add'}
                          </button>
                          <button onClick={closeCatalogForm} className="px-4 bg-white/5 text-black/80 font-bold text-xs py-2 rounded-lg hover:bg-white/10 transition">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Purchase history - derived from actual POs, read-only */}
                  {purchaseHistory.length > 0 && (
                    <div className="pt-2 border-t border-white/5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/40 mb-1.5">Purchase History</p>
                      <div className="space-y-1">
                        {purchaseHistory.map(p => (
                          <div key={`${p.itemCode || p.itemName}`} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-fg/60 font-bold truncate">{p.itemName}</span>
                            <span className="text-fg/40 whitespace-nowrap">
                              {p.receivedQty}/{p.orderedQty} {p.unit} received · <span className="text-fg/50 font-bold">{money(p.actualSpend)}</span> bought
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );})}
        </div>
      ) : (
        /* ── RECEIVING / RECONCILIATION ── */
        <div className="space-y-3">
          {activePOs.length === 0 ? (
            <div className="text-center py-16 text-fg font-bold">
              <PackageCheck size={32} className="mx-auto mb-3 opacity-40" />
              Nothing awaiting delivery. Create a PO in the Purchase Orders tab first.
            </div>
          ) : activePOs.map(po => (
            <div key={po._id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <button onClick={() => receiveId === po._id ? setReceiveId(null) : openReceive(po)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-fg text-sm">{po.poNumber}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <p className="text-fg/40 text-xs font-bold mt-0.5 truncate">
                    {po.supplier || 'No supplier'} · {po.lines?.length || 0} item(s) · Expected {fmtDate(po.expectedDate)}
                  </p>
                </div>
                <span className="text-fg/50 font-black text-sm whitespace-nowrap">{money(po.estTotal)}</span>
                <ChevronRight size={16} className={`text-fg/30 transition ${receiveId === po._id ? 'rotate-90' : ''}`} />
              </button>

              {receiveId === po._id && (() => {
                const missingLines = po.lines.map((l, i) => ({ l, i, key: l._id || i, rem: remainingOf(l) })).filter(x => x.rem > 0);
                return (
                <div className="border-t border-white/10 p-4 space-y-3 bg-accent">
                  <p className="text-[11px] font-black uppercase tracking-wider text-white">
                    {po.status === 'Incomplete' ? 'Outstanding items only - enter what just arrived' : 'Enter actual quantities received'}
                  </p>
                  {missingLines.length === 0 ? (
                    <p className="text-white text-sm font-bold py-2">Nothing outstanding on this PO.</p>
                  ) : (
                  <div className="space-y-2">
                    {missingLines.map(({ l, key, rem }) => {
                      const recv = Number(receiveQtys[key]);
                      const short = !isNaN(recv) && recv > 0 && recv < rem;
                      const alreadyIn = Number(l.receivedQty) || 0;
                      return (
                        <div key={key} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-accent truncate">{l.itemName}</p>
                            <p className="text-black text-xs">
                              Ordered: {l.orderedQty} {l.unit} @ {money(l.unitCost)}
                              {alreadyIn > 0 && <span className="text-emerald-400/70"> · Received so far: {alreadyIn}</span>}
                              <span className="text-amber-500"> · Missing: {rem} {l.unit}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input type="number" min="0" step="any" value={receiveQtys[key] ?? ''}
                              onChange={e => setReceiveQtys(q => ({ ...q, [key]: e.target.value }))}
                              className={`w-24 bg-white/5 border rounded-lg px-2 py-1.5 text-sm text-right text-fg focus:outline-none ${short ? 'border-red-500/50' : 'border-white/10 focus:border-brand/60'}`} />
                            <span className="text-fg/40 text-xs font-bold w-8">{l.unit}</span>
                            <input type="date" value={receiveExpiry[key] ?? ''}
                              onChange={e => setReceiveExpiry(x => ({ ...x, [key]: e.target.value }))}
                              title="Expiry date on this delivery (optional)"
                              className="w-[9.5rem] bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg/70 focus:outline-none focus:border-brand/60" />
                            {!receiveExpiry[key] && (
                              <input type="date" value={receiveProduction[key] ?? ''}
                                onChange={e => setReceiveProduction(x => ({ ...x, [key]: e.target.value }))}
                                title="Production date on this delivery - for goods with no real expiry, e.g. beans"
                                className="w-[9.5rem] bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg/70 focus:outline-none focus:border-brand/60" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                  <textarea value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} rows={2}
                    placeholder="Delivery notes (optional): damages, substitutions, backorders…" className="w-full bg-white border border-white/10 rounded-lg px-3 py-2 text-sm text-fg placeholder-fg/25 focus:outline-none focus:border-brand/60" />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setReceiveId(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-white hover:text-white/80 transition">Cancel</button>
                    <button onClick={() => submitReceive(po)} disabled={receiving || missingLines.length === 0}
                      className="flex items-center gap-2 bg-white hover:bg-white/90 disabled:opacity-50 text-accent font-bold text-sm px-4 py-2 rounded-xl transition">
                      {receiving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Confirm Received
                    </button>
                  </div>
                </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {/* ── DRAFT / EDIT MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => !saving && closeForm()}>
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-3xl my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="font-black text-fg text-lg">
                {editId ? 'Edit Purchase Order' : 'New Purchase Order'}
                {suggestedQueueTotal > 0 && (
                  <span className="ml-2 text-xs font-bold text-brand align-middle">
                    Draft {suggestedQueueTotal - suggestedQueue.length} of {suggestedQueueTotal} (grouped by supplier)
                  </span>
                )}
              </h2>
              <button onClick={() => !saving && closeForm()} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg/40 mb-1 block">Supplier</label>
                  {/* Always visible: pick a saved supplier, add a new one on the fly, or
                      just type the name manually below. Not gated on suppliers existing
                      yet, so the picker is discoverable even before any supplier is saved. */}
                  <select value={form.supplierId} onChange={e => { if (e.target.value === '__new__') openSupplierForm(null, true); else pickSupplier(e.target.value); }} className={`${inputCls} mb-1.5`}>
                    <option value="">
                      {suppliers.length > 0 ? '- Pick a saved supplier (or type below) -' : '- No saved suppliers yet (type below, or add one) -'}
                    </option>
                    {suppliers.filter(s => s.isActive !== false).map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                    <option value="__new__">+ Add new supplier…</option>
                  </select>
                  <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value, supplierId: '' }))} placeholder="Or type supplier name manually" className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg/40 mb-1 block">Expected Delivery</label>
                  <input type="date" value={form.expectedDate} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} className={inputCls} />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg/40">Line Items</label>
                  <button onClick={addLine} className="flex items-center gap-1 text-brand text-xs font-bold hover:text-brand/80 transition"><Plus size={13} /> Add line</button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((l, idx) => (
                    <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={l.invId || ''} onChange={e => pickInventory(idx, e.target.value)}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg focus:outline-none focus:border-brand/60">
                          <option value="">Pick from inventory (or type below)</option>
                          {inventory.map(i => <option key={i._id} value={i._id}>{i.itemName}{i.itemCode ? ` (${i.itemCode})` : ''}</option>)}
                        </select>
                        {form.lines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="p-1.5 rounded-lg text-fg/30 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 size={15} /></button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <input value={l.itemName} onChange={e => updateLine(idx, { itemName: e.target.value, invId: null })} placeholder="Item name" className="col-span-2 sm:col-span-3 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <input type="number" min="0" step="any" value={l.orderedQty} onChange={e => updateLine(idx, { orderedQty: e.target.value })} placeholder="Qty" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <select value={l.unit} onChange={e => updateLine(idx, { unit: e.target.value })} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg focus:outline-none focus:border-brand/60">
                          {UNIT_OPTIONS.map(u => <option key={u || 'none'} value={u}>{u || 'Unit'}</option>)}
                        </select>
                        <input type="number" min="0" step="any" value={l.unitCost} onChange={e => updateLine(idx, { unitCost: e.target.value })} placeholder="Unit cost" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <input type="number" min="0" step="any" value={l.packSize} onChange={e => updateLine(idx, { packSize: e.target.value })} title="Weight / volume per pack, in the selected unit" placeholder="Per-pack size (opt.)" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        <input type="date" value={l.expiryDate} onChange={e => updateLine(idx, { expiryDate: e.target.value })} title="Expiry date (optional)" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg/70 focus:outline-none focus:border-brand/60" />
                        {!l.expiryDate && (
                          <input type="date" value={l.productionDate || ''} onChange={e => updateLine(idx, { productionDate: e.target.value })} title="Production date - for goods with no real expiry, e.g. beans" placeholder="Production date" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-fg/70 focus:outline-none focus:border-brand/60" />
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-white/8 mt-1">
                        <div>
                          <p className="text-[9px] text-fg/30 uppercase font-bold mb-1">Storage Location</p>
                          <select value={l.stockLocation || ''} onChange={e => updateLine(idx, { stockLocation: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-brand/60">
                            <option value="">- None -</option>
                            {(stockLocations || []).filter(loc => loc.isActive !== false).map(loc => <option key={loc._id} value={loc.name}>{loc.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <p className="text-[9px] text-fg/30 uppercase font-bold mb-1">Stock Category</p>
                          <select value={l.stockCategory || ''} onChange={e => updateLine(idx, { stockCategory: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-brand/60">
                            <option value="">- None -</option>
                            {(stockCategories || []).filter(c => c.isActive !== false).map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <p className="text-[9px] text-fg/30 uppercase font-bold mb-1">Payment Method</p>
                          <select value={l.creditAccount || ''} onChange={e => updateLine(idx, { creditAccount: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-brand/60">
                            <option value="">- Select -</option>
                            {(procurementCreditAccounts || []).map(a => <option key={a.code} value={a.code}>{a.name}{String(a.code).startsWith('220') ? ' (Credit)' : ''}</option>)}
                          </select>
                        </div>
                        <div>
                          <p className="text-[9px] text-fg/30 uppercase font-bold mb-1">Warn Days (expiry)</p>
                          <input type="number" min="1" max="365" value={l.expiryWarnDays || ''} onChange={e => updateLine(idx, { expiryWarnDays: e.target.value })} placeholder="e.g. 7" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        </div>
                        <div>
                          <p className="text-[9px] text-fg/30 uppercase font-bold mb-1">Low Stock Alert</p>
                          <input type="number" min="0" value={l.lowStockThreshold || ''} onChange={e => updateLine(idx, { lowStockThreshold: e.target.value })} placeholder="e.g. 10" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg placeholder-white/25 focus:outline-none focus:border-brand/60" />
                        </div>
                      </div>
                      <p className="text-right text-fg/40 text-xs font-bold">Line: {money((Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0))}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-fg/40 mb-1 block">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes" className={inputCls} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10">
              <span className="text-sm font-black text-fg">Estimated total: <span className="text-brand">{money(formEstTotal)}</span></span>
              <div className="flex items-center gap-2">
                <button onClick={() => !saving && closeForm()} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition">{suggestedQueue.length > 0 ? 'Cancel remaining' : 'Cancel'}</button>
                <button onClick={saveDraft} disabled={saving} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {editId ? 'Save Changes' : (suggestedQueue.length > 0 ? 'Create PO & Continue' : 'Create PO')}
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
              <h2 className="font-black text-fg text-lg">{supplierEditId ? 'Edit Supplier' : 'New Supplier'}</h2>
              <button onClick={() => !savingSupplier && setShowSupplierForm(false)} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-fg mb-1 block">Name *</label>
                <input value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="Supplier name" className={inputCls} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg mb-1 block">Contact Person</label>
                  <input value={supplierForm.contactPerson} onChange={e => setSupplierForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder="Contact name" className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg mb-1 block">Phone</label>
                  <input value={supplierForm.phone} onChange={e => setSupplierForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-fg mb-1 block">Email</label>
                <input value={supplierForm.email} onChange={e => setSupplierForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-fg mb-1 block">Address</label>
                <input value={supplierForm.address} onChange={e => setSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-fg mb-1 block">Notes</label>
                <textarea value={supplierForm.notes} onChange={e => setSupplierForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes" className={inputCls} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
              <button onClick={() => !savingSupplier && setShowSupplierForm(false)} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition">Cancel</button>
              <button onClick={saveSupplier} disabled={savingSupplier} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-xl transition">
                {savingSupplier ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {supplierEditId ? 'Save Changes' : 'Create Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VENDOR STATEMENT MODAL ── */}
      {statementSupplier && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={closeStatement}>
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl w-full max-w-2xl my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="font-black text-fg text-lg">Vendor Statement - {statementSupplier.name}</h2>
              <button onClick={closeStatement} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg/40 mb-1 block">From</label>
                  <input type="date" value={statementRange.start} onChange={e => setStatementRange(r => ({ ...r, start: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-fg/40 mb-1 block">To</label>
                  <input type="date" value={statementRange.end} onChange={e => setStatementRange(r => ({ ...r, end: e.target.value }))} className={inputCls} />
                </div>
                <button onClick={() => openStatement(statementSupplier, statementRange)} disabled={loadingStatement} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-fg font-bold text-sm px-4 py-2 rounded-xl transition">
                  {loadingStatement ? <Loader2 size={15} className="animate-spin" /> : 'Refresh'}
                </button>
                {statement && (
                  <button onClick={exportStatementToPDF} className="flex items-center gap-2 bg-brand hover:bg-brand/90 text-white font-bold text-sm px-4 py-2 rounded-xl transition ml-auto"><Download size={15} /> Export PDF</button>
                )}
              </div>

              {loadingStatement && <div className="text-center py-10 text-fg/40 text-sm"><Loader2 size={20} className="animate-spin mx-auto mb-2" />Loading…</div>}

              {!loadingStatement && statement && (
                <>
                  <p className="text-sm font-bold text-fg">Opening balance: <span className="text-brand">{money(statement.openingBalance)}</span></p>
                  <div className="max-h-[45vh] overflow-y-auto border border-white/10 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 text-fg/50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-black uppercase tracking-wider">Date</th>
                          <th className="text-left px-3 py-2 font-black uppercase tracking-wider">Reference</th>
                          <th className="text-left px-3 py-2 font-black uppercase tracking-wider">Description</th>
                          <th className="text-right px-3 py-2 font-black uppercase tracking-wider">Invoiced</th>
                          <th className="text-right px-3 py-2 font-black uppercase tracking-wider">Paid</th>
                          <th className="text-right px-3 py-2 font-black uppercase tracking-wider">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statement.entries.length === 0 && (
                          <tr><td colSpan={6} className="text-center px-3 py-6 text-fg/40">No activity in this period.</td></tr>
                        )}
                        {statement.entries.map((e, i) => (
                          <tr key={i} className="border-t border-white/5">
                            <td className="px-3 py-1.5 text-fg/70">{fmtDate(e.date)}</td>
                            <td className="px-3 py-1.5 text-fg/70">{e.reference}</td>
                            <td className="px-3 py-1.5 text-fg/70">{e.description}</td>
                            <td className="px-3 py-1.5 text-right text-fg/70">{e.invoiceAmount ? money(e.invoiceAmount) : ''}</td>
                            <td className="px-3 py-1.5 text-right text-fg/70">{e.paymentAmount ? money(e.paymentAmount) : ''}</td>
                            <td className="px-3 py-1.5 text-right font-bold text-fg">{money(e.runningBalance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-right text-sm font-black text-fg">Closing balance: <span className="text-brand">{money(statement.closingBalance)}</span></p>
                </>
              )}
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
                <h2 className="font-black text-fg text-lg">Import Purchase Orders</h2>
                <p className="text-fg/40 text-xs mt-0.5">
                  {importPreview.pos.length} PO(s) · {importPreview.pos.reduce((s, p) => s + p.lines.length, 0)} line item(s)
                  {importPreview.skipped > 0 && ` · ${importPreview.skipped} row(s) skipped`}
                </p>
              </div>
              <button onClick={() => !importing && setImportPreview(null)} className="text-fg/40 hover:text-fg transition"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {importPreview.pos.map((p, pi) => {
                const total = p.lines.reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0);
                return (
                  <div key={pi} className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <span className="font-black text-fg text-sm">{p.supplier || 'Unknown supplier'}</span>
                      <div className="flex items-center gap-2 text-[11px] text-fg/40 font-bold">
                        {p.poNo && <span>PO {p.poNo}</span>}
                        <span className="text-brand">{money(total)}</span>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      {p.lines.map((l, li) => (
                        <div key={li} className="flex items-center justify-between text-xs text-fg/60">
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
              <button onClick={() => !importing && setImportPreview(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/50 hover:text-fg transition">Cancel</button>
              <button onClick={confirmImport} disabled={importing} className="flex items-center gap-2 bg-brand hover:bg-brand/90 disabled:opacity-50 text-fg font-bold text-sm px-5 py-2 rounded-xl transition">
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
        <p className="text-[11px] font-black uppercase tracking-wider text-fg/30 mb-2">{title}</p>
        <div className="text-center py-8 text-fg/30 text-sm font-bold border border-dashed border-white/10 rounded-2xl">{empty}</div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-fg/30 mb-2">{title} <span className="text-fg/20">({pos.length})</span></p>
      <div className="space-y-2">
        {pos.map(po => {
          const isOpen = open[po._id];
          return (
            <div key={po._id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <button onClick={() => setOpen(o => ({ ...o, [po._id]: !o[po._id] }))} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <ChevronRight size={16} className={`text-fg/30 shrink-0 transition ${isOpen ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-fg text-sm">{po.poNumber}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <p className="text-fg/40 text-xs font-bold mt-0.5 truncate">
                      {po.supplier || 'No supplier'} · {po.lines?.length || 0} item(s)
                      {showReceived && po.receivedAt ? ` · Received ${fmtDate(po.receivedAt)}` : ` · Expected ${fmtDate(po.expectedDate)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-fg/60 font-black text-sm">{money(showReceived && po.actualTotal ? po.actualTotal : po.estTotal)}</p>
                    {showReceived && po.actualTotal > 0 && <p className="text-fg/30 text-[10px] font-bold">est {money(po.estTotal)}</p>}
                  </div>
                </button>
                {renderActions && <div className="shrink-0">{renderActions(po)}</div>}
              </div>
              {isOpen && (
                <div className="border-t border-white/10 px-4 py-3 bg-accent">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white text-[10px] font-black uppercase tracking-wider text-left">
                        <th className="pb-1.5">Item</th>
                        <th className="pb-1.5 text-right">Ordered</th>
                        {showReceived && <th className="pb-1.5 text-right">Received</th>}
                        <th className="pb-1.5 text-right">Unit Cost</th>
                        <th className="pb-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-fg">
                      {po.lines.map((l, i) => {
                        const short = showReceived && l.receivedQty != null && l.receivedQty < l.orderedQty;
                        return (
                          <tr key={l._id || i} className="border-t border-white">
                            <td className="py-1.5 font-bold text-white">{l.itemName}</td>
                            <td className="py-1.5 text-white text-right">{l.orderedQty} {l.unit}</td>
                            {showReceived && <td className={`py-1.5 text-right font-bold ${short ? 'text-red-400' : 'text-green-400'}`}>{l.receivedQty ?? '-'} {l.unit}</td>}
                            <td className="py-1.5 text-white text-right">{money(l.unitCost)}</td>
                            <td className="py-1.5 text-white text-right">{money((showReceived && l.receivedQty != null ? l.receivedQty : l.orderedQty) * l.unitCost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {po.notes && <p className="text-white text-xs mt-2 pt-2 border-t border-white/5"><span className="font-black uppercase tracking-wider text-[10px] text-fg/30">Notes: </span>{po.notes}</p>}
                  {po.receivedBy && <p className="text-white text-[11px] mt-1.5 font-bold">Received by {po.receivedBy}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
