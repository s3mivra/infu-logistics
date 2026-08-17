import React, { useState, useEffect, useCallback } from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, Flame, Calendar, ToggleLeft, ToggleRight } from 'lucide-react';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();
// Category routing default per business type - log routes to Logistics, fb to Kitchen.
const DEFAULT_DEPARTMENT = BUSINESS_TYPE === 'log' ? 'Logistics' : 'Kitchen';

const RULE_TYPE_LABELS = { fixed_price: 'Fixed Sale Price', percent_off: 'Percent Off', threshold: 'Order Threshold' };
const fmt = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const toInputDate = (d) => d ? new Date(d).toISOString().slice(0, 16) : '';

function SaleStatusBadge({ sale }) {
  const now = new Date();
  const start = new Date(sale.startsAt);
  const end = new Date(sale.endsAt);
  if (!sale.isActive) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-fg/30">Inactive</span>;
  if (now < start) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-400">Upcoming</span>;
  if (now > end) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-fg/30">Expired</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-400 flex items-center gap-1"><Flame size={9} />Live</span>;
}

function RuleRow({ rule, products, onRemove }) {
  const prod = products.find(p => p._id === rule.productId);
  const discProd = rule.ruleType === 'threshold' ? products.find(p => p._id === rule.productId) : null;
  return (
    <div className="flex items-start gap-2 bg-surface border border-white/8 rounded-lg px-3 py-2 text-xs">
      <div className="flex-1 min-w-0">
        <span className="font-bold text-brand">{RULE_TYPE_LABELS[rule.ruleType]}</span>
        {rule.ruleType === 'fixed_price' && prod && <span className="text-fg/60 ml-2">{prod.name} → {fmt(rule.salePrice)}</span>}
        {rule.ruleType === 'percent_off' && prod && <span className="text-fg/60 ml-2">{prod.name} → {rule.discountPercent}% off</span>}
        {rule.ruleType === 'threshold' && <span className="text-fg/60 ml-2">Order ≥ {fmt(rule.thresholdAmount)} → {prod?.name || 'product'} gets {rule.discountPercent}% off</span>}
      </div>
      {onRemove && <button onClick={onRemove} className="text-red-400 hover:text-red-300 shrink-0"><X size={12} /></button>}
    </div>
  );
}

function SalesSection({ apiFetch, products, isSuperAdmin }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', startsAt: '', endsAt: '', rules: [] });
  const [ruleForm, setRuleForm] = useState({ ruleType: 'fixed_price', productId: '', salePrice: '', discountPercent: '', thresholdAmount: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch('/api/sales');
      if (r.success) setSales(r.sales);
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setForm({ name: '', description: '', startsAt: '', endsAt: '', rules: [] }); setEditing(null); };
  const resetRuleForm = () => setRuleForm({ ruleType: 'fixed_price', productId: '', salePrice: '', discountPercent: '', thresholdAmount: '' });

  const addRule = () => {
    if (!ruleForm.productId) return;
    if (ruleForm.ruleType === 'fixed_price' && !(ruleForm.salePrice > 0)) return;
    if (ruleForm.ruleType === 'percent_off' && !(ruleForm.discountPercent > 0)) return;
    if (ruleForm.ruleType === 'threshold' && !(ruleForm.thresholdAmount > 0 && ruleForm.discountPercent > 0)) return;
    const prod = products.find(p => p._id === ruleForm.productId);
    setForm(f => ({ ...f, rules: [...f.rules, { ...ruleForm, productName: prod?.name || '' }] }));
    resetRuleForm();
  };

  const saveSale = async () => {
    if (!form.name.trim() || !form.startsAt || !form.endsAt) return;
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `/api/sales/${editing}` : '/api/sales';
      const r = await apiFetch(url, { method, body: JSON.stringify(form) });
      if (r.success) { load(); resetForm(); }
    } finally { setSaving(false); }
  };

  const deleteSale = async (id) => {
    if (!confirm('Delete this sale?')) return;
    await apiFetch(`/api/sales/${id}`, { method: 'DELETE' });
    load();
  };

  const toggleActive = async (sale) => {
    await apiFetch(`/api/sales/${sale._id}`, { method: 'PUT', body: JSON.stringify({ ...sale, isActive: !sale.isActive }) });
    load();
  };

  const startEdit = (sale) => {
    setEditing(sale._id);
    setForm({ name: sale.name, description: sale.description || '', startsAt: toInputDate(sale.startsAt), endsAt: toInputDate(sale.endsAt), rules: sale.rules || [] });
    setExpanded(sale._id);
  };

  const inputCls = 'bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand placeholder-white/20';

  return (
    <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-1">
        <Flame size={18} className="text-orange-400" />
        <h3 className="text-xl font-bold text-fg">Sales &amp; Promotions</h3>
      </div>
      <p className="text-xs text-fg/40 mb-4">Time-boxed discounts applied automatically during the sale window. Fixed price, percent off, or order-threshold deals.</p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* List */}
        <div className="flex-1 space-y-2">
          {loading && <p className="text-sm text-fg/30 italic py-4">Loading…</p>}
          {!loading && sales.length === 0 && <p className="text-sm text-fg/30 italic py-4">No sales yet.</p>}
          {sales.map(sale => (
            <div key={sale._id} className="bg-page-bg border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setExpanded(expanded === sale._id ? null : sale._id)} className="flex-1 min-w-0 text-left flex items-center gap-2">
                  <ChevronRight size={14} className={`text-fg/40 shrink-0 transition-transform ${expanded === sale._id ? 'rotate-90' : ''}`} />
                  <div className="min-w-0">
                    <p className="font-bold text-fg text-sm truncate">{sale.name}</p>
                    <p className="text-[10px] text-fg/40 flex items-center gap-1 mt-0.5">
                      <Calendar size={9} />{fmtDate(sale.startsAt)} – {fmtDate(sale.endsAt)}
                      <span className="mx-1">·</span>{sale.rules?.length || 0} rule{sale.rules?.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
                <SaleStatusBadge sale={sale} />
                {isSuperAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleActive(sale)} title={sale.isActive ? 'Disable' : 'Enable'} className="p-1 text-fg/40 hover:text-fg/80 transition">
                      {sale.isActive ? <ToggleRight size={16} className="text-green-400" /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => startEdit(sale)} className="p-1 text-fg/40 hover:text-blue-400 transition"><Edit size={13} /></button>
                    <button onClick={() => deleteSale(sale._id)} className="p-1 text-fg/40 hover:text-red-400 transition"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              {expanded === sale._id && (
                <div className="border-t border-white/8 px-4 py-3 space-y-1.5">
                  {(sale.rules || []).length === 0 && <p className="text-xs text-fg/30 italic">No rules yet.</p>}
                  {(sale.rules || []).map((r, i) => <RuleRow key={i} rule={r} products={products} />)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Form */}
        {isSuperAdmin && (
          <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-sm font-black text-fg uppercase tracking-wider">{editing ? 'Edit Sale' : 'New Sale'}</p>

            <input className={`w-full ${inputCls}`} placeholder="Sale name (e.g. Weekend Flash Sale)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className={`w-full ${inputCls}`} placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-fg/40 uppercase font-bold mb-1">Starts</p>
                <input type="datetime-local" className={`w-full ${inputCls} text-xs`} value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div>
                <p className="text-[10px] text-fg/40 uppercase font-bold mb-1">Ends</p>
                <input type="datetime-local" className={`w-full ${inputCls} text-xs`} value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
              </div>
            </div>

            {/* Rules builder */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-fg/40 uppercase font-bold">Discount Rules</p>
              {form.rules.map((r, i) => (
                <RuleRow key={i} rule={r} products={products} onRemove={() => setForm(f => ({ ...f, rules: f.rules.filter((_, j) => j !== i) }))} />
              ))}

              {/* Add rule inline */}
              <div className="bg-surface border border-dashed border-white/10 rounded-lg p-3 space-y-2">
                <select className={`w-full ${inputCls} text-xs`} value={ruleForm.ruleType} onChange={e => setRuleForm(r => ({ ...r, ruleType: e.target.value }))}>
                  <option value="fixed_price">Fixed Sale Price</option>
                  <option value="percent_off">Percent Off</option>
                  <option value="threshold">Order Threshold Deal</option>
                </select>

                <select className={`w-full ${inputCls} text-xs`} value={ruleForm.productId} onChange={e => setRuleForm(r => ({ ...r, productId: e.target.value }))}>
                  <option value="">
                    {ruleForm.ruleType === 'threshold' ? '— Select discounted product —' : '— Select product —'}
                  </option>
                  {products.filter(p => !p.isArchived).map(p => (
                    <option key={p._id} value={p._id}>{p.name}{p.basePrice ? ` (${fmt(p.basePrice)})` : ''}</option>
                  ))}
                </select>

                {ruleForm.ruleType === 'fixed_price' && (
                  <input type="number" min="0" step="0.01" className={`w-full ${inputCls} text-xs`} placeholder="Sale price ₱" value={ruleForm.salePrice} onChange={e => setRuleForm(r => ({ ...r, salePrice: e.target.value }))} />
                )}
                {ruleForm.ruleType === 'percent_off' && (
                  <input type="number" min="1" max="100" className={`w-full ${inputCls} text-xs`} placeholder="Discount % (e.g. 20)" value={ruleForm.discountPercent} onChange={e => setRuleForm(r => ({ ...r, discountPercent: e.target.value }))} />
                )}
                {ruleForm.ruleType === 'threshold' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" min="0" step="0.01" className={`${inputCls} text-xs`} placeholder="Min order ₱" value={ruleForm.thresholdAmount} onChange={e => setRuleForm(r => ({ ...r, thresholdAmount: e.target.value }))} />
                    <input type="number" min="1" max="100" className={`${inputCls} text-xs`} placeholder="Discount %" value={ruleForm.discountPercent} onChange={e => setRuleForm(r => ({ ...r, discountPercent: e.target.value }))} />
                  </div>
                )}

                <button onClick={addRule} className="w-full py-1.5 bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5">
                  <Plus size={12} /> Add Rule
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {editing && (
                <button onClick={resetForm} className="px-3 py-2 bg-white/5 text-fg/50 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
              )}
              <button onClick={saveSale} disabled={saving || !form.name.trim() || !form.startsAt || !form.endsAt} className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-orange-400 transition disabled:opacity-40">
                {saving ? 'Saving…' : editing ? 'Update Sale' : 'Create Sale'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ProductsTab - extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function ProductsTab({ ctx }) {
  // Destructure everything from ctx
  // ── Auto-generated from ctx - do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx - do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx - do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  const {
    API_URL, AUDIT_PAGE_SIZE, BIZ_NAME, COMP_REASON_LABELS, FRONTEND_URL,
    HIST_PAGE_SIZE, POS_PER_PAGE, SHIFT_HIST_PAGE_SIZE, accountingItemsPerPage, accountingPage,
    activeAdmin, activeInventoryItem, activeTab, addInventory, addMaterialToRecipe,
    addOnForm, addSize, analyticsData, analyticsLoading, apiFetch,
    applyComplimentary, applyDiscount, applyItemDiscount, arOutstanding, archiveDay,
    archivedOrders, auditCancelPage, auditCompPage, auditDiscPage, auditFilter,
    auditStaffPage, bsData, calcRecipeCost, cashOnHand, cashTendered,
    catForm, categories, clientAccounts, closeRfFund, collapsedOrders, compOverride,
    compReasonNotes, compReasonTypes, compSelections, confirmPosItem, currentEntries,
    currentInventory, currentOrders, currentPage, currentPricingProducts, currentProducts,
    dailyMovement, deleteAddOn, deleteCategory, deleteInventory, deleteProduct,
    departmentFilter, discountForm, discountInputs, discountList, discounts,
    displayOrders, downloadImportTemplate, downloadJournalCsv, editInvForm, editInvModal,
    editInvSubmitting, editPriceId, editPriceVal, editingCategory, editingProduct,
    packInfo, effectiveDisplay, eodLockedAt, eodStatus, expandedBatchRows, expandedDays,
    expandedOrderLists, expenseCategories, expenseModal, exportAllToPDF, exportAnalyticsToPDF,
    exportDayToPDF, exportInventoryToPDF, exportLedgerToPDF, fetchAnalytics, fetchArOutstanding,
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleRestockSubmit, handleSaveAddOn,
    handleSaveCategory, handleSaveProduct, handleVoidOrder, historyItemName, historyModalOpen,
    historyPage, historySubTab, importModal, importRows, importSubmitting,
    invBadgeCount, invForm, invItemsPerPage, invPage, invSubTab,
    inventory, isPosOpen, isStatusMenuOpen, isSuperAdmin, itemDisplay,
    itemsPerPage, jeForm, journalEntries, ledgerSubTab, navMode,
    newDiscount, openEditInventory, openProductModal, orderFilter, orders,
    ordersItemsPerPage, ordersPage, parseImportFile, paymentSelections, peso,
    physicalCounts, pnlData, pnlRange, posActiveAddOns, posActiveSize,
    posCart, posCashTendered, posCategory, posCheckoutModal, posCustomerName,
    posCustomerPhone, posDeliveryAddress, posDeliveryFee, posDeliveryFeeNum, posDiscountAmt,
    posDiscountType, posDiscountValue, posGrandTotal, posPage, posPayment,
    posScheduledTime, posSearch, posSelectedProduct, posSubtotal, posTable,
    pricingItemsPerPage, pricingPage, printOrderSlip, printXReading, products,
    removeAddOnFromOrder, removeComplimentary, removeMaterial, removeSize, restockData,
    rfActiveFund, rfDisbForm, rfDisbModal, rfDisbSubmitting, rfFunds,
    rfLoading, rfNewForm, rfNewModal, rfNewSubmitting, rfReplForm,
    rfReplModal, rfReplSubmitting, rfTxPage, rfTxPages, rfTxTotal,
    rfTxs, scpwdOpen, setAccountingPage, setActiveInventoryItem, setActiveTab,
    setAddOnForm, setAuditCancelPage, setAuditCompPage, setAuditDiscPage, setAuditFilter,
    setAuditStaffPage, setCashTendered, setCatForm, setCollapsedOrders, setCompOverride,
    setCompReasonNotes, setCompReasonTypes, setCompSelections, setCurrentPage, setDepartmentFilter,
    setDiscountForm, setDiscountInputs, setEditInvForm, setEditInvModal, setEditPriceId,
    setEditPriceVal, setEditingCategory, setEditingProduct, setExpandedBatchRows, setExpenseModal,
    setFormData, setHistoryItemName, setHistoryModalOpen, setHistoryPage, setHistorySubTab,
    setImportModal, setImportRows, setInvForm, setInvPage, setInvSubTab,
    setIsPosOpen, setIsStatusMenuOpen, setJeForm, setJournalEntries, setLedgerSubTab,
    setNewDiscount, setOrderFilter, setOrdersPage, setPaymentSelections, setPhysicalCounts,
    setPnlRange, setPosActiveAddOns, setPosActiveSize, setPosCart, setPosCashTendered,
    setPosCategory, setPosCheckoutModal, setPosCustomerName, setPosCustomerPhone, setPosDeliveryAddress,
    setPosDeliveryFee, setPosDiscountType, setPosDiscountValue, setPosPage, setPosPayment,
    setPosScheduledTime, setPosSearch, setPosSelectedProduct, setPosTable, setPricingPage,
    setRestockData, setRfActiveFund, setRfDisbForm, setRfDisbModal, setRfNewForm,
    setRfNewModal, setRfReplForm, setRfReplModal, setRfTxs, setScpwdOpen,
    setSettleForm, setSettleModal, setSettleSubmitting, setShiftFilter, setShiftHistoryPage,
    setSpoilageForm, setSpoilageModal, setStockHistory, setVarianceNoteMode, setVarianceReasons,
    settleForm, settleModal, settleSubmitting, shiftFilter, shiftHistory,
    shiftHistoryPage, shiftHistoryTotal, spoilageForm, spoilageLoading, spoilageModal,
    standardAccounts, stockHistory, submitManualOrder, submitPhysicalCounts, submitRfDisb,
    submitRfNew, submitRfRepl, toggleDay, toggleOrderList,
    totalAccountingPages, totalInvPages, totalOrdersPages, totalPages, totalPricingPages,
    updateItemStatus, updateMaterialQty, updateSize, updateStatus, updatingOrders,
    users, varianceNoteMode, varianceReasons,
    modifierGroups,
    editingModifier, setEditingModifier, modForm, setModForm, saveModifierGroup, editModifierGroup, deleteModifierGroup,
    combos, editingCombo, setEditingCombo, comboForm, setComboForm, saveCombo, editCombo, deleteCombo,
    resetProductForm,
    prodSearch, setProdSearch, prodFilters, setProdFilters, filteredProducts, prodFiltersActive, resetProdFilters,
  } = ctx;

  const setFilter = (key, value) => setProdFilters({ ...prodFilters, [key]: value });
  const selectCls = 'bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg font-bold outline-none focus:border-brand';

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* FIX 1: Changed h-fixed to h-auto on mobile, and added gap-6 */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-auto lg:h-[calc(100vh-180px)]">
          
          {/* LEFT COLUMN: Menu Items, Categories, and Add-Ons */}
          {/* FIX 2: Added min-h-[500px] so it doesn't get crushed on mobile */}
          <div className="flex-1 bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6 overflow-y-auto custom-scrollbar min-h-[500px] lg:min-h-0">

            {/* 1. Menu Items List */}
            <div className="flex items-baseline justify-between gap-3 mb-4 border-b border-white/10 pb-2">
              <h3 className="text-xl font-bold text-fg">Menu Items</h3>
              <span className="text-xs font-bold text-fg/40 shrink-0">
                {prodFiltersActive ? `${filteredProducts.length} of ${products.length}` : `${products.length} item${products.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {/* Search + filters - a shop with a few hundred SKUs can't page 8-at-a-time
                to find one item, so this narrows the list before pagination. */}
            <div className="mb-5 space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
                <input
                  type="text"
                  value={prodSearch}
                  onChange={e => setProdSearch(e.target.value)}
                  placeholder="Search by name, category, code or description…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2.5 text-sm text-fg outline-none focus:border-brand font-semibold placeholder-white/25"
                />
                {prodSearch && (
                  <button type="button" onClick={() => setProdSearch('')} aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg transition">
                    <X size={15} />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Filter by category" value={prodFilters.category} onChange={e => setFilter('category', e.target.value)} className={selectCls}>
                  <option value="all">All categories</option>
                  {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                </select>

                <select aria-label="Filter by image" value={prodFilters.image} onChange={e => setFilter('image', e.target.value)} className={selectCls}>
                  <option value="all">Any image</option>
                  <option value="with">Has image</option>
                  <option value="without">Missing image</option>
                </select>

                <select aria-label="Filter by stock" value={prodFilters.stock} onChange={e => setFilter('stock', e.target.value)} className={selectCls}>
                  <option value="all">Any stock</option>
                  <option value="in">In stock (&gt;5)</option>
                  <option value="low">Low stock (1–5)</option>
                  <option value="out">Out of stock</option>
                  <option value="untracked">No recipe linked</option>
                </select>

                <select aria-label="Filter by discount" value={prodFilters.discount} onChange={e => setFilter('discount', e.target.value)} className={selectCls}>
                  <option value="all">Any price</option>
                  <option value="discounted">Discounted</option>
                  <option value="full">Full price</option>
                </select>

                <select aria-label="Filter by sizes" value={prodFilters.sizes} onChange={e => setFilter('sizes', e.target.value)} className={selectCls}>
                  <option value="all">Any sizes</option>
                  <option value="multi">Has extra sizes</option>
                  <option value="single">Single size</option>
                </select>

                <select aria-label="Sort products" value={prodFilters.sort} onChange={e => setFilter('sort', e.target.value)} className={selectCls}>
                  <option value="name">Name A–Z</option>
                  <option value="name-desc">Name Z–A</option>
                  <option value="price">Price low → high</option>
                  <option value="price-desc">Price high → low</option>
                  <option value="category">Category</option>
                </select>

                {prodFiltersActive && (
                  <button type="button" onClick={resetProdFilters}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand bg-brand/10 border border-brand/30 hover:bg-brand/20 transition flex items-center gap-1">
                    <X size={12} /> Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {currentProducts.length === 0 && (
                <div className="py-12 px-6 text-center border border-dashed border-white/10 rounded-xl">
                  {prodFiltersActive ? (<>
                    <Search size={26} className="mx-auto mb-3 text-brand/50" />
                    <p className="text-fg/70 font-black uppercase tracking-widest text-xs mb-1">No matching items</p>
                    <p className="text-fg/35 text-xs">No product matches your search and filters. Try clearing them.</p>
                  </>) : (<>
                    <Coffee size={26} className="mx-auto mb-3 text-brand/50" />
                    <p className="text-fg/70 font-black uppercase tracking-widest text-xs mb-1">No menu items yet</p>
                    <p className="text-fg/35 text-xs">Add your first product with the form on the right; it goes live on the menu instantly.</p>
                  </>)}
                </div>
              )}
              {currentProducts.map(p => (
                <div key={p._id} className="flex flex-col sm:flex-row gap-4 p-4 border border-white/10 rounded-xl bg-surface-2 items-start sm:items-center">
                  
                  {/* Top section on mobile: Image + Text */}
                  <div className="flex gap-4 flex-1 w-full">
                    {p.image && ctx.systemSettings?.imagesEnabled !== false ? (
                      <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-lg shadow-sm border border-white/10 shrink-0" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center text-xs text-fg/30 font-bold shrink-0">No Img</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-fg truncate w-full sm:w-auto">{p.name} <span className="text-xs text-brand/70 ml-1">({p.category})</span></h4>
                        {(() => {
                          const est = getEstimatedStock(p.baseRecipe);
                          if (est === null) return null;
                          return (
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${est <= 0 ? 'bg-red-500/15 text-red-400' : est <= 5 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-green-500/15 text-green-400'}`}>
                              {est <= 0 ? 'Out of Stock' : `Est: ${est} left`}
                            </span>
                          );
                        })()}
                      </div>
                      {p.description && <p className="text-xs text-fg/40 mt-1 line-clamp-2">{p.description}</p>}
                      <p className="text-sm text-fg/70 font-bold mt-1">P{Number(p.basePrice || p.price || 0).toFixed(2)} {p.baseSize && <span className="text-xs text-fg/30 font-normal">({p.baseSize})</span>} {p.sizes?.length > 0 && <span className="text-brand/70 text-xs ml-1">(+ {p.sizes.length} sizes)</span>}</p>
                    </div>
                  </div>

                  {/* Edit button: Full width on mobile, auto width on desktop */}
                  <div className="w-full sm:w-auto mt-2 sm:mt-0 shrink-0">
                    <button 
                      onClick={() => { 
                        setEditingProduct(p); 
                        setFormData({ 
                          name: p.name || '', category: p.category || '', description: p.description || '',
                          basePrice: Number(p.basePrice || p.price || 0), discountPercent: Number(p.discountPercent || 0),
                          vatExempt: p.vatExempt === true, isBulk: p.isBulk === true,
                          clientDiscounts: (p.clientDiscounts || []).map(d => ({ clientId: String(d.clientId), percent: Number(d.percent || 0) })),
                          segmentDiscounts: (p.segmentDiscounts || []).map(d => ({ segment: String(d.segment || ''), percent: Number(d.percent || 0) })),
                          bulkBreaks: (p.bulkBreaks || []).map(b => ({ minQty: Number(b.minQty || 0), percent: Number(b.percent || 0) })),
                          baseSize: p.baseSize || '',
                          sizes: p.sizes || [], image: p.image || '', baseRecipe: p.baseRecipe || [], addOns: p.addOns || [],
                          modifierGroups: (p.modifierGroups || []).map(mg => (mg && mg._id) ? mg._id : mg),
                          imageUrl: (p.image || '').startsWith('http') ? p.image : ''
                        }); 
                      }} 
                      className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-white/10 text-fg rounded-lg text-sm font-bold hover:bg-brand hover:text-white transition flex items-center justify-center gap-2"
                    >
                      <Edit size={14} /> Edit
                    </button>
                  </div>
                </div>
              ))}
              {/* --- PAGINATION CONTROLS --- */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center bg-page-bg p-4 rounded-xl border border-white/10 mt-6 shrink-0">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === 1 ? 'bg-white/10 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Previous</span>
                </button>
                
                <span className="text-gray-400 text-sm font-bold tracking-widest">
                  PAGE <span className="text-accent text-lg">{currentPage}</span> OF {totalPages}
                </span>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === totalPages ? 'bg-white/10 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
            </div>
            
            {/* 2. Manage Categories */}
            <div className="mt-8 border-t border-white/10 pt-6">
              <h3 className="text-xl font-bold mb-4 text-fg border-b border-white/10 pb-2">Manage Categories & Routing</h3>
              <form onSubmit={handleSaveCategory} className="flex flex-wrap gap-3 mb-6">
                <input
                  type="text"
                  value={catForm.name}
                  onChange={e => setCatForm({...catForm, name: e.target.value})}
                  placeholder="Category Name"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-semibold placeholder-white/20"
                  required
                />
                <select
                  value={catForm.department}
                  onChange={e => setCatForm({ ...catForm, department: e.target.value })}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-bold"
                >
                  {import.meta.env.VITE_BUSINESS_TYPE === "log" ? (
                    <>
                      <option value="Logistics">Logistics</option>
                      <option value="Warehouse">Warehouse</option>
                    </>
                  ) : (
                    <>
                      <option value="Kitchen">Kitchen</option>
                      <option value="Bar">Bar</option>
                    </>
                  )}
                </select>
                <button type="submit" className="bg-accent text-white font-bold px-6 py-2 rounded-lg hover:bg-opacity-90 transition shadow-md">
                  {editingCategory ? 'Update' : 'Add'}
                </button>
                {editingCategory && (
                  <button type="button" onClick={() => { setEditingCategory(null); setCatForm({ name: '', department: DEFAULT_DEPARTMENT }); }} className="bg-white/10 text-fg/70 font-bold px-4 py-2 rounded-lg hover:bg-white/20 transition">
                    Cancel
                  </button>
                )}
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {categories.map(c => (
                  <div key={c._id} className="flex justify-between items-center p-3 border border-white/10 rounded-xl bg-surface-2">
                    <div>
                      <span className="font-bold text-sm text-fg block">{c.name}</span>
                      <span className="text-[10px] uppercase font-bold text-fg/40 tracking-wider">Routes to: {c.department || DEFAULT_DEPARTMENT}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingCategory(c); setCatForm({ name: c.name, department: c.department || DEFAULT_DEPARTMENT }); }} className="text-fg/40 hover:text-brand p-1.5 rounded"><Edit size={16} /></button>
                      <button onClick={() => deleteCategory(c._id)} className="text-red-400 hover:text-red-300 p-1.5 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. MANAGE GLOBAL ADD-ONS - attaching an add-on to a product needs one to exist first */}
            <div className="mt-8 border-t border-white/10 pt-6">
              <h3 className="text-xl font-bold mb-4 text-fg border-b border-white/10 pb-2">Manage Add-Ons</h3>
              <form onSubmit={handleSaveAddOn} className="flex flex-wrap gap-3 mb-6">
                <input
                  type="text"
                  placeholder={BUSINESS_TYPE === 'log' ? 'Name (e.g. Custom Grind)' : 'Name (e.g. Popping Boba)'}
                  value={addOnForm.name}
                  onChange={e => setAddOnForm({...addOnForm, name: e.target.value})}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-semibold placeholder-white/20"
                  required
                />
                <input
                  type="number"
                  placeholder="Price"
                  value={addOnForm.price}
                  onChange={e => setAddOnForm({...addOnForm, price: e.target.value})}
                  className="w-24 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-bold placeholder-white/20"
                  required
                />
                <select
                  value={addOnForm.category}
                  onChange={e => setAddOnForm({...addOnForm, category: e.target.value})}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-bold"
                >
                  {BUSINESS_TYPE === 'log' ? (<>
                    <option value="Extras">Extras</option>
                    <option value="Packaging">Packaging</option>
                    <option value="Processing">Processing</option>
                  </>) : (<>
                    <option value="Extras">Extras</option>
                    <option value="Sinkers">Sinkers</option>
                    <option value="Milks">Milks</option>
                  </>)}
                </select>
                <button type="submit" className="bg-brand text-white font-bold px-6 py-2 rounded-lg hover:bg-brand-dark transition shadow-md">{addOnForm._id ? 'Save' : 'Add'}</button>
                {addOnForm._id && (
                  <button type="button" onClick={() => setAddOnForm({ name: '', price: '', category: 'Extras' })}
                    className="bg-white/5 text-fg/60 font-bold px-4 py-2 rounded-lg hover:bg-white/10 transition">Cancel</button>
                )}
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {globalAddOns.map(a => (
                  <div key={a._id} className={`flex justify-between items-center p-3 border rounded-xl bg-surface-2 ${addOnForm._id === a._id ? 'border-brand/60' : 'border-white/10'}`}>
                    <div>
                      <span className="font-bold text-sm text-fg block">{a.name}</span>
                      <span className="text-[10px] uppercase font-bold text-brand/70 tracking-wider">{a.category} • +P{a.price}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setAddOnForm({ _id: a._id, name: a.name, price: a.price, category: a.category || 'Extras' })}
                        className="text-fg/40 hover:text-fg bg-white/5 hover:bg-white/10 p-1.5 rounded"><Edit size={16} /></button>
                      <button onClick={() => deleteAddOn(a._id)} className="text-red-400 hover:text-red-300 bg-red-500/10 p-1.5 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Add Product Form */}
          {/* FIX 3: Added min-h-[600px] on mobile so the form has room to breathe */}
          <div className="w-full lg:w-96 bg-surface border border-white/10 rounded-xl p-4 sm:p-6 flex flex-col min-h-[600px] lg:min-h-0 lg:h-full overflow-hidden shadow-md">
            <h3 className="text-xl font-bold text-fg mb-4 border-b border-white/10 pb-2 shrink-0">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h3>
            
            <div className="flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar pr-2 pb-4">
              <form onSubmit={handleSaveProduct} className="space-y-4">
                {/* Basic Info */}
                <div>
                  <label className="block text-sm font-bold text-fg/60 mb-2">Product Image</label>
                  <div className="flex items-center gap-4">
                    {formData.image ? (
                      <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-white/10 shadow-sm" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-xs text-fg/25 font-bold">None</div>
                    )}
                    <div className="flex flex-col gap-2 min-w-0">
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="max-w-full text-sm text-fg/40 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-accent file:text-white hover:file:bg-accent/80 cursor-pointer transition" />
                      {formData.image && (
                        <button type="button" onClick={() => setFormData({ ...formData, image: '', imageUrl: '' })}
                          className="self-start text-sm font-bold bg-red-500 rounded-xl py-2 px-4 text-white hover:text-white/60 transition">
                          Remove image
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div><label className="block text-sm font-bold text-fg/60 mb-1">Name</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand font-semibold placeholder-white/20" /></div>
                <div>
                  <label className="block text-sm font-bold text-fg/60 mb-1">Category</label>
                  <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand font-semibold">
                    <option value="" disabled>Select Category...</option>
                    {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm font-bold text-fg/60 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand h-20 placeholder-white/20 font-medium"></textarea></div>
                
                {/* Base Size & Materials */}
                <div className="bg-surface-2 p-4 rounded-xl border border-white/10 mt-6">
                  <label className="block text-sm font-black text-fg/80 mb-3 uppercase tracking-wider">Base Size / Standard Recipe</label>
                  <div className="flex gap-2 mb-2">
                    <input type="text" placeholder="Size Name (e.g. Regular)" value={formData.baseSize || ''} onChange={e => setFormData({...formData, baseSize: e.target.value})} className="w-1/2 bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand font-bold placeholder-white/20" />
                    <div className="w-1/2 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40 font-bold">₱</span>
                      <input type="number" step="0.01" placeholder="Selling Price" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 pl-8 text-fg outline-none focus:border-brand font-bold" />
                    </div>
                  </div>
                  {/* Per-product discount - applies only to this product's line, not the whole order. */}
                  <div className="flex items-center gap-2 mb-1">
                    <div className="relative w-1/2">
                      <input type="number" min="0" max="100" step="0.01" placeholder="Product Discount" value={formData.discountPercent || ''} onChange={e => setFormData({...formData, discountPercent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 pr-7 text-fg outline-none focus:border-brand font-bold placeholder-white/20" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 font-bold">%</span>
                    </div>
                    {formData.discountPercent > 0 && (
                      <span className="text-[11px] text-emerald-400 font-bold">
                        → ₱{((parseFloat(formData.basePrice) || 0) * (1 - formData.discountPercent / 100)).toFixed(2)} after discount
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-fg/60 mb-3">Discount applies to this product only, on every order line - not the whole order. Overrides below apply when a specific client buys this product.</p>

                  {/* VAT classification. Products are VATable unless flagged here -
                      the exception list, not the opt-in list. Only meaningful once
                      the business is VAT-registered in Settings. */}
                  <label className="flex items-start gap-2.5 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.vatExempt === true}
                      onChange={e => setFormData({ ...formData, vatExempt: e.target.checked })}
                      className="mt-0.5 w-4 h-4 accent-brand shrink-0"
                    />
                    <span className="text-xs font-bold text-fg">VAT-exempt item</span>
                  </label>
                  <p className="text-[10px] text-fg/60 mb-3">
                    Leave unticked for normal goods. Tick only for items exempt by law - raw
                    agricultural produce, prescription medicines. Ignored while the business is
                    set to Non-VAT in Settings.
                  </p>

                  {/* Bulk-sale flag - groups the item under a "Bulk" filter in the POS & portal. */}
                  <label className="flex items-start gap-2.5 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isBulk === true}
                      onChange={e => setFormData({ ...formData, isBulk: e.target.checked })}
                      className="mt-0.5 w-4 h-4 accent-brand shrink-0"
                    />
                    <span className="text-xs font-bold text-fg">Bulk / wholesale item</span>
                  </label>
                  <p className="text-[10px] text-fg/60 mb-3">
                    Shows this product under a dedicated <span className="font-bold">Bulk</span> tab in the register and client portal - for sack/wholesale quantities sold apart from the regular menu.
                  </p>

                  {/* Per-client overrides - a specific client's special rate on THIS product.
                      Client Accounts are a logistics-only concept, so this section only
                      applies (and only renders) in log mode. */}
                  {BUSINESS_TYPE === 'log' && (
                  <div className="bg-page-bg/40 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-fg/70 uppercase tracking-wider">Per-Client Overrides</label>
                      <button type="button"
                        disabled={!clientAccounts?.length}
                        onClick={() => setFormData({ ...formData, clientDiscounts: [...(formData.clientDiscounts || []), { clientId: '', percent: 0 }] })}
                        className="text-[11px] font-black text-brand hover:text-fg transition disabled:opacity-40">+ Add client</button>
                    </div>
                    {(!clientAccounts || clientAccounts.length === 0) && (
                      <p className="text-[10px] text-fg/30 italic">No client accounts yet - create one in the Client Accounts panel to assign a special discount.</p>
                    )}
                    {(formData.clientDiscounts || []).map((cd, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <select value={cd.clientId}
                          onChange={e => {
                            const list = [...(formData.clientDiscounts || [])];
                            list[idx] = { ...list[idx], clientId: e.target.value };
                            setFormData({ ...formData, clientDiscounts: list });
                          }}
                          className="w-1/2 sm:w-3/5 shrink-0 shrink-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs outline-none focus:border-brand">
                          <option value="">Select client…</option>
                          {(clientAccounts || []).map(c => (
                            <option key={c._id} value={c._id}>{c.name || c.username} ({c.clientCode})</option>
                          ))}
                        </select>
                        <div className="relative w-28">
                          <input type="number" min="0" max="100" step="0.01" value={cd.percent}
                            onChange={e => {
                              const list = [...(formData.clientDiscounts || [])];
                              list[idx] = { ...list[idx], percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) };
                              setFormData({ ...formData, clientDiscounts: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/40 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, clientDiscounts: (formData.clientDiscounts || []).filter((_, i) => i !== idx) })}
                          className="text-red-400/70 hover:text-red-500 text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Segment overrides - a rate for any client tagged with a matching
                      segment (e.g. "wholesale", "vip"), instead of one specific client.
                      Same log-mode-only gating as Per-Client Overrides, since segments
                      live on Client Accounts. Beats the flat discount above but loses
                      to a Per-Client Override for the same product. */}
                  {BUSINESS_TYPE === 'log' && (
                  <div className="bg-page-bg/40 border border-white/10 rounded-xl p-3 mt-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-fg/70 uppercase tracking-wider">Segment Overrides</label>
                      <button type="button"
                        onClick={() => setFormData({ ...formData, segmentDiscounts: [...(formData.segmentDiscounts || []), { segment: '', percent: 0 }] })}
                        className="text-[11px] font-black text-brand hover:text-fg transition">+ Add segment</button>
                    </div>
                    {(!formData.segmentDiscounts || formData.segmentDiscounts.length === 0) && (
                      <p className="text-[10px] text-fg/30 italic">No segment rates yet - tag client accounts (e.g. "wholesale") in the Client Accounts panel, then add a matching rate here.</p>
                    )}
                    {(formData.segmentDiscounts || []).map((sd, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <input type="text" value={sd.segment} placeholder="Segment tag (e.g. wholesale)"
                          onChange={e => {
                            const list = [...(formData.segmentDiscounts || [])];
                            list[idx] = { ...list[idx], segment: e.target.value };
                            setFormData({ ...formData, segmentDiscounts: list });
                          }}
                          className="w-1/2 sm:w-3/5 shrink-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs outline-none focus:border-brand" />
                        <div className="relative w-28">
                          <input type="number" min="0" max="100" step="0.01" value={sd.percent}
                            onChange={e => {
                              const list = [...(formData.segmentDiscounts || [])];
                              list[idx] = { ...list[idx], percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) };
                              setFormData({ ...formData, segmentDiscounts: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/40 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, segmentDiscounts: (formData.segmentDiscounts || []).filter((_, i) => i !== idx) })}
                          className="text-red-400/70 hover:text-red-500 text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Quantity-break bulk pricing - buy N+ of this product, get X% off.
                      Independent of the fixed-price Combo bundles; combined with the
                      discounts above by taking whichever percent is higher. */}
                  <div className="bg-page-bg/40 border border-white/10 rounded-xl p-3 mt-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-fg/70 uppercase tracking-wider">Bulk Quantity Breaks</label>
                      <button type="button"
                        onClick={() => setFormData({ ...formData, bulkBreaks: [...(formData.bulkBreaks || []), { minQty: 1, percent: 0 }] })}
                        className="text-[11px] font-black text-brand hover:text-fg transition">+ Add break</button>
                    </div>
                    {(!formData.bulkBreaks || formData.bulkBreaks.length === 0) && (
                      <p className="text-[10px] text-fg/30 italic">No bulk breaks yet - e.g. "buy 10+, get 10% off".</p>
                    )}
                    {(formData.bulkBreaks || []).map((b, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <div className="flex items-center gap-1 w-1/2 sm:w-3/5 shrink-0">
                          <span className="text-[10px] text-fg/40 font-bold shrink-0">Qty ≥</span>
                          <input type="number" min="1" step="1" value={b.minQty}
                            onChange={e => {
                              const list = [...(formData.bulkBreaks || [])];
                              list[idx] = { ...list[idx], minQty: Math.max(1, parseInt(e.target.value, 10) || 1) };
                              setFormData({ ...formData, bulkBreaks: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                        </div>
                        <div className="relative w-28">
                          <input type="number" min="0" max="100" step="0.01" value={b.percent}
                            onChange={e => {
                              const list = [...(formData.bulkBreaks || [])];
                              list[idx] = { ...list[idx], percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) };
                              setFormData({ ...formData, bulkBreaks: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/40 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, bulkBreaks: (formData.bulkBreaks || []).filter((_, i) => i !== idx) })}
                          className="text-red-400/70 hover:text-red-500 text-sm">✕</button>
                      </div>
                    ))}
                  </div>

                  {(() => {
                    const baseCost = calcRecipeCost(formData.baseRecipe);
                    const basePriceVal = parseFloat(formData.basePrice) || 0;
                    const suggestedBasePrice = baseCost > 0 ? (baseCost / 0.7).toFixed(2) : '0.00';
                    const baseMargin = basePriceVal > 0 ? (((basePriceVal - baseCost) / basePriceVal) * 100).toFixed(1) : '0.0';
                    return baseCost > 0 ? (
                      <div className="flex justify-between items-center text-[10px] px-1 mb-3">
                        <span className={parseFloat(baseMargin) >= 30 ? "text-green-400 font-black" : "text-yellow-500 font-black"}>Margin: {baseMargin}%</span>
                        <button type="button" onClick={() => setFormData({...formData, basePrice: parseFloat(suggestedBasePrice)})} className="text-fg/60 hover:text-brand font-bold transition">Set 30% Margin (₱{suggestedBasePrice})</button>
                      </div>
                    ) : <div className="mb-3"></div>;
                  })()}
                  
                  <div className="bg-accent p-3 rounded-lg border border-white/10">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-white font-black uppercase tracking-wider">Base Materials</span>
                      <span className="text-xs text-white font-black">Cost: ₱{calcRecipeCost(formData.baseRecipe).toFixed(2)}</span>
                    </div>
                    {(formData.baseRecipe || []).map((mat, i) => {
                      const invItem = inventory.find(inv => inv._id === mat.invId);
                      const currentPb = mat.packBase > 0 ? mat.packBase : (packInfo && invItem ? (packInfo(invItem).packBase || 1) : 1);
                      const dispQty = +(mat.qty / currentPb).toFixed(3);
                      return (
                      <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                        <span className="flex-1 text-white font-semibold truncate">{mat.name}</span>
                        <input type="number" step="any" value={dispQty}
                          onChange={e => updateMaterialQty((parseFloat(e.target.value) || 0) * currentPb, i, null)}
                          className="w-16 bg-white border border-white/10 rounded p-1.5 text-center text-black font-bold" />
                        <span className="text-white w-8 text-xs font-bold">{mat.unit}</span>
                        <button type="button" onClick={() => removeMaterial(i, null)} className="text-red-400 hover:text-red-300 ml-2"><X size={16} /></button>
                      </div>
                      );
                    })}
                    <div className="mt-4 pt-3 border-t border-white">
                      <div className="text-[10px] text-white uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                      <div className="max-h-32 overflow-y-auto bg-white border border-white/10 rounded-lg custom-scrollbar p-1">
                        {inventory.length === 0 ? (
                          <p className="p-2 text-xs text-accent italic font-medium">No inventory available.</p>
                        ) : (
                          inventory.map(inv => {
                            const pack = packInfo ? packInfo(inv) : { packBase: 1, label: inv.unit };
                            const packBase = pack.packBase || 1;
                            const dispUnit = BUSINESS_TYPE === 'log' ? 'pcs' : (inv.displayUnit || inv.unit);
                            const packCost = (inv.unitCost || 0) * packBase;
                            return (
                            <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, null)} className="w-full text-left px-3 py-2 text-xs text-accent font-bold hover:bg-white/10 transition rounded flex justify-between items-center">
                              <span className="truncate pr-2">{inv.itemName}</span>
                              <span className="text-black shrink-0 font-mono">₱{packCost.toFixed(2)}/{dispUnit}</span>
                            </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Extra Sizes */}
                <div className="border-t border-white/10 pt-5 mt-4">
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-sm font-black text-fg/80 uppercase tracking-wider">Extra Sizes (Small, Large)</label>
                    <button type="button" onClick={addSize} className="text-xs bg-white/10 px-3 py-1.5 rounded-xl font-bold text-fg/70 border border-white/10 hover:bg-brand/20 hover:text-brand hover:border-brand/30 transition flex items-center gap-1"><Plus size={14}/> Add Size</button>
                  </div>

                  {(formData.sizes || []).map((size, idx) => (
                    <div key={idx} className="bg-surface-2 p-4 rounded-xl border border-white/10 mb-4">
                      <div className="flex gap-2 mb-2">
                        <input type="text" placeholder="Size Name" value={size.name} onChange={e => updateSize(idx, 'name', e.target.value)} className="w-1/2 bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-fg font-bold placeholder-white/20" required />
                        <input type="number" step="0.01" placeholder="Price" value={size.price} onChange={e => updateSize(idx, 'price', e.target.value)} className="w-1/3 bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-fg font-bold placeholder-white/20" required />
                        <button type="button" onClick={() => removeSize(idx)} className="text-fg/30 hover:text-red-400 font-bold ml-auto px-2"><X size={20} /></button>
                      </div>

                      <div className="bg-accent p-3 rounded-lg border border-white/10 mt-3">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs text-white font-black uppercase tracking-wider">{size.name || 'New Size'} Materials</span>
                          <span className="text-xs text-white font-black">Cost: ₱{calcRecipeCost(size.recipe).toFixed(2)}</span>
                        </div>
                        {(size.recipe || []).map((mat, i) => {
                          const invItem = inventory.find(inv => inv._id === mat.invId);
                          const currentPb = mat.packBase > 0 ? mat.packBase : (packInfo && invItem ? (packInfo(invItem).packBase || 1) : 1);
                          const dispQty = +(mat.qty / currentPb).toFixed(3);
                          return (
                          <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                            <span className="flex-1 text-white font-semibold truncate">{mat.name}</span>
                            <input type="number" step="any" value={dispQty}
                              onChange={e => updateMaterialQty((parseFloat(e.target.value) || 0) * currentPb, i, idx)}
                              className="w-16 bg-white border border-white/10 rounded p-1.5 text-center text-black font-bold" />
                            <span className="text-white w-8 text-xs font-bold">{mat.unit}</span>
                            <button type="button" onClick={() => removeMaterial(i, idx)} className="text-red-400 hover:text-red-300 ml-2"><X size={16} /></button>
                          </div>
                          );
                        })}
                        <div className="mt-4 pt-3 border-t border-white">
                          <div className="text-[10px] text-white uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                          <div className="max-h-28 overflow-y-auto bg-white border border-white/10 rounded-lg custom-scrollbar p-1">
                            {inventory.map(inv => {
                              const pack = packInfo ? packInfo(inv) : { packBase: 1 };
                              const packBase = pack.packBase || 1;
                              const dispUnit = inv.displayUnit || inv.unit;
                              const packCost = (inv.unitCost || 0) * packBase;
                              return (
                              <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, idx)} className="w-full text-left px-3 py-2 text-xs text-accent font-bold hover:bg-white/10 transition rounded flex justify-between items-center">
                                <span className="truncate pr-2">{inv.itemName}</span>
                                <span className="text-fg shrink-0 font-mono">₱{packCost.toFixed(2)}/{dispUnit}</span>
                              </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* --- OPTIONAL ADD-ONS CHECKBOXES --- */}
                <div className="border-t border-white/10 pt-5 mt-4 mb-4">
                  <label className="text-sm font-black text-fg/80 uppercase tracking-wider mb-3 block">Attach Add-Ons</label>
                  <div className="grid grid-cols-2 gap-2">
                    {globalAddOns.map(addon => {
                      const isAttached = (formData.addOns || []).some(a => a.name === addon.name);
                      return (
                        <label key={addon._id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition ${isAttached ? 'border-brand bg-brand/10 shadow-sm shadow-brand/10' : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'}`}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-accent cursor-pointer"
                            checked={isAttached}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, addOns: [...(formData.addOns || []), { name: addon.name, price: addon.price, recipe: [] }] });
                              } else {
                                setFormData({ ...formData, addOns: (formData.addOns || []).filter(a => a.name !== addon.name) });
                              }
                            }}
                          />
                          <div className="flex flex-col">
                             <span className="text-sm font-bold text-fg leading-tight">{addon.name}</span>
                             <span className="text-[10px] text-accent font-black uppercase tracking-widest">+₱{addon.price}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* --- REQUIRED MODIFIER GROUPS - fb only --- */}
                {BUSINESS_TYPE !== 'log' && modifierGroups.length > 0 && (
                  <div className="border-t border-white/10 pt-5 mt-4 mb-4">
                    <label className="text-sm font-black text-fg/80 uppercase tracking-wider mb-1 block">Required Modifier Groups</label>
                    <p className="text-[10px] text-fg/30 mb-3">Checked groups will be required before adding to cart (e.g. "Choose your milk").</p>
                    <div className="space-y-2">
                      {modifierGroups.map(mg => {
                        const current = (formData.modifierGroups || []).map(id => (id && id._id) ? id._id : id);
                        const isAttached = current.includes(mg._id);
                        return (
                          <label key={mg._id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition ${isAttached ? 'border-brand bg-brand/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                            <input type="checkbox" className="w-4 h-4 accent-accent cursor-pointer" checked={isAttached}
                              onChange={e => {
                                if (e.target.checked) setFormData({...formData, modifierGroups: [...current, mg._id]});
                                else setFormData({...formData, modifierGroups: current.filter(id => id !== mg._id)});
                              }}
                            />
                            <div>
                              <p className="text-sm font-bold text-fg">{mg.name}</p>
                              <p className="text-[10px] text-fg/40">{mg.isRequired ? `Required - pick ${mg.minSelect}${mg.maxSelect>mg.minSelect?`-${mg.maxSelect}`:``}` : 'Optional'} · {mg.options?.length||0} options</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* --- IMAGE URL input --- */}
                <div className="border-t border-white/10 pt-4 mt-2">
                  <label className="text-xs font-bold text-fg/50 uppercase tracking-wider block mb-1.5">Image URL (alternative to upload)</label>
                  <input type="url" placeholder="https://example.com/image.jpg"
                    value={formData.imageUrl || ''}
                    onChange={e => setFormData({...formData, imageUrl: e.target.value, image: e.target.value || formData.image})}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm outline-none focus:border-brand/60 placeholder-white/20"
                  />
                  <p className="text-[10px] text-fg/20 mt-1">Leave blank to use uploaded image. Paste URL to override.</p>
                </div>

                {/* Save Buttons */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-white/10">
                  {editingProduct && (
                    <button type="button" onClick={() => deleteProduct(editingProduct._id)} className="bg-red-500/10 text-red-400 font-bold py-3 px-4 rounded-xl hover:bg-red-500/20 transition flex items-center justify-center border border-red-500/20" title="Delete product" aria-label="Delete product">
                      <Trash2 size={20} />
                    </button>
                  )}
                  <button type="submit" className="flex-1 bg-accent text-white font-black py-4 rounded-xl hover:bg-opacity-90 shadow-lg shadow-accent/20 transition uppercase tracking-wider text-sm">
                    {editingProduct ? 'Update Product' : 'Save Product'}
                  </button>
                </div>
                {/* Cancel - leaves edit mode and clears the form back to "Add Product".
                    Without it the only ways out of an edit were saving or deleting. */}
                {editingProduct && (
                  <button type="button" onClick={resetProductForm}
                    className="w-full bg-white/5 text-fg/60 font-bold py-3 rounded-xl hover:bg-white/10 hover:text-fg transition uppercase tracking-wider text-xs flex items-center justify-center gap-2">
                    <X size={14} /> Cancel edit
                  </button>
                )}
              </form>
            </div>
          </div>
          </div>

          {/* ════════════ MODIFIER GROUPS MANAGEMENT - fb only ════════════ */}
          {BUSINESS_TYPE !== 'log' && <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6">
            <h3 className="text-xl font-bold mb-1 text-fg">Modifier Groups</h3>
            <p className="text-xs text-fg/40 mb-4">Required choices on a product (e.g. "Choose your milk"). Attach them to products in the form above.</p>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Existing groups */}
              <div className="flex-1 space-y-2">
                {modifierGroups.length === 0 ? (
                  <p className="text-sm text-fg/30 italic py-4">No modifier groups yet.</p>
                ) : modifierGroups.map(g => (
                  <div key={g._id} className="bg-page-bg border border-white/10 rounded-xl p-3 flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-fg text-sm">{g.name} {g.isRequired && <span className="text-[9px] bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded uppercase ml-1">Required</span>}</p>
                      <p className="text-[11px] text-fg/40 mt-0.5">Pick {g.minSelect}{g.maxSelect > g.minSelect ? `–${g.maxSelect}` : ''} · {(g.options||[]).map(o => o.name + (o.price ? ` (+₱${o.price})` : '')).join(', ')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => editModifierGroup(g)} className="text-blue-300 hover:text-fg hover:bg-blue-600 text-xs font-bold px-2 py-1 bg-blue-900/30 rounded transition">Edit</button>
                      <button onClick={() => deleteModifierGroup(g._id)} className="text-red-400 hover:text-fg hover:bg-red-600 text-xs font-bold px-2 py-1 bg-red-900/30 rounded transition">Del</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Editor */}
              <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm font-black text-fg uppercase tracking-wider">{editingModifier ? 'Edit Group' : 'New Group'}</p>
                <input type="text" placeholder="Group name (e.g. Choose your milk)" value={modForm.name}
                  onChange={e => setModForm({ ...modForm, name: e.target.value })}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-accent placeholder-white/20" />
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-fg/60 font-bold">
                    <input type="checkbox" className="accent-accent" checked={modForm.isRequired} onChange={e => setModForm({ ...modForm, isRequired: e.target.checked })} /> Required
                  </label>
                  <label className="flex items-center gap-1 text-xs text-fg/60 font-bold">Min
                    <input type="number" min="0" value={modForm.minSelect} onChange={e => setModForm({ ...modForm, minSelect: e.target.value })} className="w-12 bg-surface border border-white/10 rounded px-2 py-1 text-fg text-center" />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-fg/60 font-bold">Max
                    <input type="number" min="1" value={modForm.maxSelect} onChange={e => setModForm({ ...modForm, maxSelect: e.target.value })} className="w-12 bg-surface border border-white/10 rounded px-2 py-1 text-fg text-center" />
                  </label>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-fg/40 font-bold uppercase">Options</p>
                  {modForm.options.map((o, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <input type="text" placeholder="Option name" value={o.name}
                        onChange={e => { const opts=[...modForm.options]; opts[i]={...opts[i],name:e.target.value}; setModForm({...modForm,options:opts}); }}
                        className="flex-1 bg-surface border border-white/10 rounded px-2 py-1.5 text-fg text-xs outline-none focus:border-accent" />
                      <input type="number" placeholder="₱0" value={o.price}
                        onChange={e => { const opts=[...modForm.options]; opts[i]={...opts[i],price:e.target.value}; setModForm({...modForm,options:opts}); }}
                        className="w-16 bg-surface border border-white/10 rounded px-2 py-1.5 text-fg text-xs text-right outline-none focus:border-accent" />
                      <button onClick={() => setModForm({...modForm, options: modForm.options.filter((_,j)=>j!==i)})} className="text-red-400 hover:text-red-300 px-1 font-bold">✕</button>
                    </div>
                  ))}
                  <button onClick={() => setModForm({...modForm, options:[...modForm.options,{name:'',price:'',recipe:[]}]})}
                    className="w-full py-1.5 bg-white/5 text-fg/50 rounded text-xs font-bold hover:bg-white/10 transition">+ Add option</button>
                </div>
                <div className="flex gap-2 pt-1">
                  {editingModifier && (
                    <button onClick={() => { setEditingModifier(null); setModForm({ name:'', isRequired:true, minSelect:1, maxSelect:1, options:[] }); }}
                      className="px-3 py-2 bg-white/5 text-fg/50 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
                  )}
                  <button onClick={saveModifierGroup} className="flex-1 py-2 bg-accent text-fg rounded-lg text-xs font-black uppercase tracking-wider hover:bg-opacity-90 transition">
                    {editingModifier ? 'Update Group' : 'Create Group'}
                  </button>
                </div>
              </div>
            </div>
          </div>}

          {/* ════════════ COMBOS / BUNDLES (PRODUCT PROMOS) ════════════ */}
          <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6">
            <h3 className="text-xl font-bold mb-1 text-fg">Product Promos &amp; Combos</h3>
            <p className="text-xs text-fg/40 mb-4">Fixed-price bundles of existing products (e.g. "Budget Meal: Americano + Pandesal = ₱99"). Sold as one line; stock is deducted per component.</p>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Existing combos */}
              <div className="flex-1 space-y-2">
                {combos.length === 0 ? (
                  <p className="text-sm text-fg/30 italic py-4">No combos yet.</p>
                ) : combos.map(c => (
                  <div key={c._id} className="bg-page-bg border border-white/10 rounded-xl p-3 flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-fg text-sm">{c.name} <span className="text-brand font-black ml-1">₱{Number(c.price).toFixed(2)}</span></p>
                      <p className="text-[11px] text-fg/40 mt-0.5">{(c.items||[]).map(i => `${i.quantity>1?i.quantity+'× ':''}${i.name}${i.sizeName?` (${i.sizeName})`:''}`).join(' + ')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => editCombo(c)} className="text-white hover:text-fg hover:bg-blue-600 text-xs font-bold px-2 py-1 bg-blue-500 rounded transition">Edit</button>
                      <button onClick={() => deleteCombo(c._id)} className="text-white hover:text-fg hover:bg-red-600 text-xs font-bold px-2 py-1 bg-red-500 rounded transition">Del</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Combo editor */}
              <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm font-black text-fg uppercase tracking-wider">{editingCombo ? 'Edit Combo' : 'New Combo'}</p>
                <input type="text" placeholder="Combo name" value={comboForm.name}
                  onChange={e => setComboForm({ ...comboForm, name: e.target.value })}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-accent placeholder-white/20" />
                <div className="flex gap-2">
                  <input type="number" placeholder="Price ₱" value={comboForm.price}
                    onChange={e => setComboForm({ ...comboForm, price: e.target.value })}
                    className="w-28 bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm font-black outline-none focus:border-accent" />
                  <input type="text" placeholder="Description (optional)" value={comboForm.description}
                    onChange={e => setComboForm({ ...comboForm, description: e.target.value })}
                    className="flex-1 min-w-0 bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-accent placeholder-white/20" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-fg/40 font-bold uppercase">Components</p>
                  {comboForm.items.map((it, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <span className="flex-1 text-xs text-fg/80 bg-surface border border-white/10 rounded px-2 py-1.5 truncate">{it.quantity>1?it.quantity+'× ':''}{it.name}</span>
                      <input type="number" min="1" value={it.quantity}
                        onChange={e => { const items=[...comboForm.items]; items[i]={...items[i],quantity:e.target.value}; setComboForm({...comboForm,items}); }}
                        className="w-14 bg-surface border border-white/10 rounded px-2 py-1.5 text-fg text-xs text-center outline-none" />
                      <button onClick={() => setComboForm({...comboForm, items: comboForm.items.filter((_,j)=>j!==i)})} className="text-red-400 hover:text-red-300 px-1 font-bold">✕</button>
                    </div>
                  ))}
                  <select value="" onChange={e => {
                      if (!e.target.value) return;
                      const p = products.find(pr => pr._id === e.target.value);
                      if (p) setComboForm({...comboForm, items:[...comboForm.items, { productId: p._id, name: p.name, sizeName: '', quantity: 1 }]});
                    }}
                    className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg/70 text-xs outline-none focus:border-accent">
                    <option value="">+ Add component product…</option>
                    {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  {editingCombo && (
                    <button onClick={() => { setEditingCombo(null); setComboForm({ name:'', description:'', price:'', image:'', items:[] }); }}
                      className="px-3 py-2 bg-white/5 text-fg/50 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
                  )}
                  <button onClick={saveCombo} className="flex-1 py-2 bg-accent text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-opacity-90 transition">
                    {editingCombo ? 'Update Combo' : 'Create Combo'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <SalesSection apiFetch={apiFetch} products={products} isSuperAdmin={isSuperAdmin} />
    </>
  );
}
