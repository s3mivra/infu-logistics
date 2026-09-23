import React, { useState, useEffect, useCallback } from 'react';
import { Copy, Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag, Flame, Calendar, ToggleLeft, ToggleRight, Upload } from 'lucide-react';
import SearchSelect from '../../shared/ui/SearchSelect';
import * as ui from '../../shared/ui';
import RecipeMatrix from './RecipeMatrix';
import LinkAddOns from './LinkAddOns';
import { columnsOf, readiness, marginOf, rowKeyOf } from '../../shared/recipeMatrix';

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
  if (!sale.isActive) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-fg/65">Inactive</span>;
  if (now < start) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-info">Upcoming</span>;
  if (now > end) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-fg/65">Expired</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-success flex items-center gap-1"><Flame size={9} />Live</span>;
}

function RuleRow({ rule, products, onRemove }) {
  const prod = products.find(p => p._id === rule.productId);
  const discProd = rule.ruleType === 'threshold' ? products.find(p => p._id === rule.productId) : null;
  return (
    <div className="flex items-start gap-2 bg-surface border border-white/8 rounded-lg px-3 py-2 text-xs">
      <div className="flex-1 min-w-0">
        <span className="font-bold text-brand-text">{RULE_TYPE_LABELS[rule.ruleType]}</span>
        {rule.ruleType === 'fixed_price' && prod && <span className="text-fg/65 ml-2">{prod.name} → {fmt(rule.salePrice)}</span>}
        {rule.ruleType === 'percent_off' && prod && <span className="text-fg/65 ml-2">{prod.name} → {rule.discountPercent}% off</span>}
        {rule.ruleType === 'threshold' && <span className="text-fg/65 ml-2">Order ≥ {fmt(rule.thresholdAmount)} → {prod?.name || 'product'} gets {rule.discountPercent}% off</span>}
      </div>
      {onRemove && <button onClick={onRemove} className="text-danger shrink-0"><X size={12} /></button>}
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

  const inputCls = 'bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand placeholder-fg/70';

  return (
    <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-1">
        <Flame size={18} className="text-warning" />
        <h3 className="text-xl font-bold text-fg">Sales &amp; Promotions</h3>
      </div>
      <p className="text-xs text-fg/70 mb-4">Time-boxed discounts applied automatically during the sale window. Fixed price, percent off, or order-threshold deals.</p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* List */}
        <div className="flex-1 space-y-2">
          {loading && <p className="text-sm text-fg/65 italic py-4">Loading…</p>}
          {!loading && sales.length === 0 && <p className="text-sm text-fg/65 italic py-4">No sales yet.</p>}
          {sales.map(sale => (
            <div key={sale._id} className="bg-page-bg border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setExpanded(expanded === sale._id ? null : sale._id)} className="flex-1 min-w-0 text-left flex items-center gap-2">
                  <ChevronRight size={14} className={`text-fg/70 shrink-0 transition-transform ${expanded === sale._id ? 'rotate-90' : ''}`} />
                  <div className="min-w-0">
                    <p className="font-bold text-fg text-sm truncate">{sale.name}</p>
                    <p className="text-[10px] text-fg/70 flex items-center gap-1 mt-0.5">
                      <Calendar size={9} />{fmtDate(sale.startsAt)} - {fmtDate(sale.endsAt)}
                      <span className="mx-1">·</span>{sale.rules?.length || 0} rule{sale.rules?.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
                <SaleStatusBadge sale={sale} />
                {isSuperAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => toggleActive(sale)} title={sale.isActive ? 'Disable' : 'Enable'} className="p-1 text-fg/70 hover:text-fg/80 transition">
                      {sale.isActive ? <ToggleRight size={16} className="text-success" /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => startEdit(sale)} className="p-1 text-fg/70 hover:text-info transition"><Edit size={13} /></button>
                    <button onClick={() => deleteSale(sale._id)} className="p-1 text-fg/70 hover:text-danger transition"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              {expanded === sale._id && (
                <div className="border-t border-white/8 px-4 py-3 space-y-1.5">
                  {(sale.rules || []).length === 0 && <p className="text-xs text-fg/65 italic">No rules yet.</p>}
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
                <p className="text-[10px] text-fg/70 uppercase font-bold mb-1">Starts</p>
                <input type="datetime-local" className={`w-full ${inputCls} text-xs`} value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div>
                <p className="text-[10px] text-fg/70 uppercase font-bold mb-1">Ends</p>
                <input type="datetime-local" className={`w-full ${inputCls} text-xs`} value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
              </div>
            </div>

            {/* Rules builder */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-fg/70 uppercase font-bold">Discount Rules</p>
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

                <SearchSelect className={`w-full ${inputCls} text-xs`} value={ruleForm.productId} onChange={e => setRuleForm(r => ({ ...r, productId: e.target.value }))}
                  placeholder={ruleForm.ruleType === 'threshold' ? 'Type to find the discounted product' : 'Type to find a product'}
                  options={products.filter(p => !p.isArchived).map(p => ({ value: p._id, label: p.name, hint: p.basePrice ? fmt(p.basePrice) : '' }))} />

                {ruleForm.ruleType === 'fixed_price' && (
                  <input type="number" min="0" step="0.01" className={`w-full ${inputCls} text-xs`} placeholder="Sale price ₱" value={ruleForm.salePrice} onChange={e => setRuleForm(r => ({ ...r, salePrice: e.target.value }))} />
                )}
                {ruleForm.ruleType === 'percent_off' && (
                  <input type="number" min="0" max="100" step="0.01" className={`w-full ${inputCls} text-xs`} placeholder="Discount % (e.g. 12.5)" value={ruleForm.discountPercent} onChange={e => setRuleForm(r => ({ ...r, discountPercent: e.target.value }))} />
                )}
                {ruleForm.ruleType === 'threshold' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" min="0" step="0.01" className={`${inputCls} text-xs`} placeholder="Min order ₱" value={ruleForm.thresholdAmount} onChange={e => setRuleForm(r => ({ ...r, thresholdAmount: e.target.value }))} />
                    <input type="number" min="0" max="100" step="0.01" className={`${inputCls} text-xs`} placeholder="Discount %" value={ruleForm.discountPercent} onChange={e => setRuleForm(r => ({ ...r, discountPercent: e.target.value }))} />
                  </div>
                )}

                <button onClick={addRule} className="w-full py-1.5 bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5">
                  <Plus size={12} /> Add Rule
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {editing && (
                <button onClick={resetForm} className="px-3 py-2 bg-white/5 text-fg/75 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
              )}
              <button onClick={saveSale} disabled={saving || !form.name.trim() || !form.startsAt || !form.endsAt} className="flex-1 py-2 bg-orange-700 text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-orange-800 transition disabled:opacity-40">
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
  // Recipes are edited in RecipeMatrix now; its own pickers replaced the
  // per-size ingredient search and the not-from-stock adder that lived here.

  // ── Product editor state ─────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [draftRestored, setDraftRestored] = React.useState(false);
  const DRAFT_KEY = 'semivra.productDraft';
  const LAST_CAT_KEY = 'semivra.lastProductCategory';
  const readLS = (store, k) => { try { return store.getItem(k); } catch { return null; } };
  const writeLS = (store, k, v) => { try { v == null ? store.removeItem(k) : store.setItem(k, v); } catch { /* private mode */ } };
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
    activeAdmin, activeInventoryItem, activeTab, addInventory, addMaterialToRecipe, addNonStockToRecipe,
    addOnForm, addSize, analyticsData, analyticsLoading, apiFetch,
    applyComplimentary, applyDiscount, applyItemDiscount, arOutstanding, archiveDay,
    archivedOrders, auditCancelPage, auditCompPage, auditDiscPage, auditFilter,
    auditStaffPage, bsData, calcRecipeCost, cashOnHand, cashTendered,
    catForm, categories, clientAccounts, priceTiers, closeRfFund, collapsedOrders, compOverride,
    compReasonNotes, compReasonTypes, compSelections, confirmPosItem, currentEntries,
    currentInventory, currentOrders, currentPage, currentPricingProducts, currentProducts,
    dailyMovement, deleteAddOn, deleteCategory, deleteInventory, deleteProduct,
    departmentFilter, discountForm, discountInputs, discountList, discounts,
    displayOrders, downloadImportTemplate, editInvForm, editInvModal,
    editInvSubmitting, editPriceId, editPriceVal, editingCategory, editingProduct,
    packInfo, effectiveDisplay, eodLockedAt, eodStatus, expandedBatchRows, expandedDays,
    expandedOrderLists, expenseCategories, expenseModal, exportAllToPDF, exportAnalyticsToPDF,
    exportDayToPDF, exportInventoryToPDF, exportLedgerToPDF, fetchAnalytics, fetchArOutstanding,
    exportMenuItemsPDF,
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleRestockSubmit, handleSaveAddOn,
    handleSaveCategory, handleSaveProduct, handleVoidOrder, historyItemName, historyModalOpen,
    historyPage, historySubTab, importModal, importRows, importSubmitting,
    invBadgeCount, invForm, invItemsPerPage, invPage, invSubTab,
    inventory, isPosOpen, isStatusMenuOpen, isSuperAdmin, can, itemDisplay,
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
    menuBackupBusy, downloadMenuBackup, menuRestoreModal, setMenuRestoreModal, openMenuRestore, runMenuRestore,
    rsFile, rsPreview, rsBusy, rsCreateMissing, setRsCreateMissing, openRecipeSheet, closeRecipeSheet, submitRecipeSheet,
    msFile, msPreview, msBusy, openMenuSheet, closeMenuSheet, submitMenuSheet,
    rsDrafts = [], rsPrices = {}, setRsPrice = () => {},
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

  // One recipe line, made safe to show in the editor.
  //
  // A line is a pair: `qty` is always in base units, and `packBase` says how
  // many base units one of whatever `unit` names holds. The editor shows
  // qty / packBase and labels it `unit`, so the two must agree.
  //
  // A line added by hand is written in packs ("377g", and 377 base units), and
  // one saved before packBase existed needs that number filled in. But an
  // IMPORTED line is written in stock units - 20g of beans, one cup - and
  // handing it the item's pack size read one cup out of a sleeve of fifty as
  // "0.02 pcs" and 20g of beans as "0.02 kg". So the pack size is only ever
  // borrowed when the line is actually labelled with that item's pack.
  const readyLine = (mat) => {
    const invItem = inventory.find(inv => String(inv._id) === String(mat.invId));
    // A cafe reads every stock line in the real measure: 20 g, 150 ml, 1 pc.
    // A line added by hand used to be written in packs - "0.02" of a "1kg" -
    // and is shown the same way as an imported one now. Only the display
    // changes: qty is already in base units either way.
    if (BUSINESS_TYPE !== 'log' && invItem && !mat.nonStock) {
      return { ...mat, packBase: 1, unit: invItem.unit || mat.unit };
    }
    if (mat.packBase > 0) return mat;
    const pack = invItem && packInfo ? packInfo(invItem) : null;
    if (pack && String(mat.unit || '') === String(pack.label)) {
      return { ...mat, packBase: pack.packBase || 1 };
    }
    // Otherwise it is one base unit per unit, labelled the way stock is
    // counted. The label is corrected too: an older import wrote the promoted
    // display unit ("kg", "L") over a base-unit quantity, which read as 20 kg
    // of beans in a cup of coffee.
    return { ...mat, packBase: 1, unit: (invItem && invItem.unit) || mat.unit };
  };

  // Adding a line to an add-on's optional recipe.
  const [aoMat, setAoMat] = useState('');
  const [aoQty, setAoQty] = useState('');
  const [aoNsName, setAoNsName] = useState('');
  const [aoNsQty, setAoNsQty] = useState('');
  const [aoNsUnit, setAoNsUnit] = useState('ml');
  const aoRecipe = addOnForm.recipe || [];
  const setAoRecipe = (recipe) => setAddOnForm({ ...addOnForm, recipe });
  // Written in the unit stock is kept in - 18 g, 30 ml, 1 pc - the same way a
  // drink's recipe is, so an extra shot reads as coffee, not a fraction of a bag.
  const addAoStock = () => {
    const item = inventory.find(i => String(i._id) === String(aoMat));
    const qty = parseFloat(aoQty);
    if (!item || !(qty > 0)) return;
    if (aoRecipe.some(r => String(r.invId) === String(item._id))) return;
    setAoRecipe([...aoRecipe, { invId: String(item._id), name: item.itemName, qty, cost: item.unitCost || 0, unit: item.unit || 'pcs', packBase: 1 }]);
    setAoMat(''); setAoQty('');
  };
  const addAoNonStock = () => {
    const name = aoNsName.trim();
    const qty = parseFloat(aoNsQty);
    if (!name || !(qty > 0)) return;
    setAoRecipe([...aoRecipe, { name, qty, cost: 0, unit: aoNsUnit, packBase: 1, nonStock: true }]);
    setAoNsName(''); setAoNsQty('');
  };
  const emptyAddOn = { name: '', price: '', category: 'Extras', recipe: [] };

  const setFilter = (key, value) => setProdFilters({ ...prodFilters, [key]: value });
  const selectCls = 'bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-fg font-bold outline-none focus:border-brand';

  // The object the Edit button builds from a saved product.
  const productToForm = (p) => ({ 
                          name: p.name || '', category: p.category || '', description: p.description || '',
                          basePrice: Number(p.basePrice || p.price || 0), discountPercent: Number(p.discountPercent || 0),
                          vatExempt: p.vatExempt === true, isBulk: p.isBulk === true, showOnQr: p.showOnQr !== false,
                          clientDiscounts: (p.clientDiscounts || []).map(d => ({ clientId: String(d.clientId), percent: Number(d.percent || 0) })),
                          segmentDiscounts: (p.segmentDiscounts || []).map(d => ({ segment: String(d.segment || ''), percent: Number(d.percent || 0) })),
                          bulkBreaks: (p.bulkBreaks || []).map(b => ({ minQty: Number(b.minQty || 0), percent: Number(b.percent || 0) })),
                          clientBulkBreaks: (p.clientBulkBreaks || []).map(b => ({ clientId: String(b.clientId || ''), minQty: Number(b.minQty || 0), price: Number(b.price || 0) })),
                          baseSize: p.baseSize || '',
                          image: p.image || '',
                          // packBase and the label only - see readyLine.
                          // This used to also set `qty: pb`, which reset every
                          // ingredient to one full pack every time the product
                          // was opened, and since packBase was never persisted
                          // that branch ran on EVERY edit. Enter 0.15 of a
                          // carton, save, reopen, and it was silently back to
                          // 1, taking the recipe cost with it. qty is already
                          // in base units and is the user's own number: never
                          // recompute it here.
                          baseRecipe: (p.baseRecipe || []).map(readyLine),
                          // Size recipes were never backfilled at all, so their
                          // quantities rendered in raw base units (150 instead
                          // of 0.15 of a carton). Same treatment, same rule.
                          sizes: (p.sizes || []).map(sz => ({
                            ...sz,
                            recipe: (sz.recipe || []).map(readyLine),
                          })),
                          addOns: p.addOns || [],
                          modifierGroups: (p.modifierGroups || []).map(mg => (mg && mg._id) ? mg._id : mg),
                          imageUrl: (p.image || '').startsWith('http') ? p.image : '',
  });
  const openEdit = (p) => { setEditingProduct(p); setFormData(productToForm(p)); setDraftRestored(false); setEditorOpen(true); };
  // A copy of a product, as a new one: everything but the name.
  const openLike = (p) => {
    setEditingProduct(null);
    setFormData({ ...productToForm(p), name: '', image: '', imageUrl: '' });
    setDraftRestored(false); setEditorOpen(true);
  };
  const openNew = () => {
    resetProductForm();
    let draft;
    try { draft = JSON.parse(readLS(sessionStorage, DRAFT_KEY) || 'null'); } catch { draft = null; }
    if (draft && (draft.name || (draft.baseRecipe || []).length)) { setFormData(draft); setDraftRestored(true); }
    else { setFormData(f => ({ ...f, category: readLS(localStorage, LAST_CAT_KEY) || '' })); setDraftRestored(false); }
    setEditorOpen(true);
  };
  const discardDraft = () => {
    writeLS(sessionStorage, DRAFT_KEY, null);
    resetProductForm();
    setFormData(f => ({ ...f, category: readLS(localStorage, LAST_CAT_KEY) || '' }));
    setDraftRestored(false);
  };
  const closeEditor = () => { resetProductForm(); setEditorOpen(false); setDraftRestored(false); };
  // A new product in progress survives closing the sheet or switching tabs.
  React.useEffect(() => {
    if (!editorOpen || editingProduct) return;
    writeLS(sessionStorage, DRAFT_KEY, JSON.stringify(formData));
  }, [editorOpen, editingProduct, formData]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveFromEditor = async (e) => {
    e.preventDefault();
    const category = formData.category;
    const ok = await handleSaveProduct(e);
    if (ok === false) return;
    writeLS(localStorage, LAST_CAT_KEY, category || null);
    writeLS(sessionStorage, DRAFT_KEY, null);
    setDraftRestored(false);
    setEditorOpen(false);
  };

  // What the footer and the section list say about the product so far.
  const editorCols = columnsOf(formData);
  const editorIssues = readiness(formData, calcRecipeCost);
  const specialPricingCount = (formData.clientDiscounts || []).length + (formData.segmentDiscounts || []).length
    + (formData.bulkBreaks || []).length + (formData.clientBulkBreaks || []).length;
  const ingredientCount = new Set(editorCols.flatMap(col => col.recipe.map(rowKeyOf))).size;
  const editorSummary = [
    `${editorCols.length} size${editorCols.length === 1 ? '' : 's'}`,
    `${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'}`,
    ...editorCols.map(col => {
      const m = marginOf(col.price, calcRecipeCost(col.recipe));
      return m === null ? null : `${col.name || 'base'} ${Math.round(m * 100)}%`;
    }).filter(Boolean),
  ].join(' · ');
  const editorSections = [
    { id: 'details', label: 'Details', done: !!(formData.name && formData.category) },
    { id: 'recipe', label: 'Sizes & recipe', done: editorIssues.length === 0 },
    { id: 'options', label: 'Options', done: false, note: `${(formData.addOns || []).length + (formData.modifierGroups || []).length || ''}` },
    { id: 'pricing', label: 'Special pricing', done: false, note: specialPricingCount ? String(specialPricingCount) : '' },
  ];

  // Quick add: name, category, price - on sale at once, the rest later.
  const [quick, setQuick] = React.useState({ name: '', category: '', price: '' });
  const [quickBusy, setQuickBusy] = React.useState(false);
  const quickAdd = async (e) => {
    e.preventDefault();
    const name = quick.name.trim();
    const category = quick.category || readLS(localStorage, LAST_CAT_KEY) || '';
    if (!name || !category) return ui.alert('Give it a name and a category.');
    setQuickBusy(true);
    try {
      const res = await apiFetch('/api/products', { method: 'POST', body: JSON.stringify({
        name, category, basePrice: parseFloat(quick.price) || 0, description: '', baseSize: '', sizes: [], baseRecipe: [], addOns: [], modifierGroups: [],
      }) });
      const d = await res.json();
      if (!d.success) return ui.alert(d.error || 'Could not add it.');
      writeLS(localStorage, LAST_CAT_KEY, category);
      setQuick({ name: '', category, price: '' });
      ui.toast(`${name} added. Open it to add sizes and a recipe.`, { tone: 'success' });
      fetchData();
    } finally { setQuickBusy(false); }
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* FIX 1: Changed h-fixed to h-auto on mobile, and added gap-6 */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-auto lg:h-[calc(100vh-180px)]">
          
          {/* LEFT COLUMN: Menu Items, Categories, and Add-Ons */}
          {/* FIX 2: Added min-h-[500px] so it doesn't get crushed on mobile */}
          <div className="flex-1 bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6 overflow-y-auto custom-scrollbar min-h-[500px] lg:min-h-0">

            {/* 1. Menu Items List */}
            {/* Wraps on a phone: with shrink-0 on the actions, "New product"
                was pushed off the right edge and cut to "NEW PROD". */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4 border-b border-white/10 pb-2">
              <h3 className="text-xl font-bold text-fg whitespace-nowrap">Menu Items</h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-xs font-bold text-fg/70">
                  {prodFiltersActive ? `${filteredProducts.length} of ${products.length}` : `${products.length} item${products.length === 1 ? '' : 's'}`}
                </span>
                <button onClick={exportMenuItemsPDF} className="text-[10px] bg-brand/10 hover:bg-brand/20 text-brand-text px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition">Export PDF</button>
                {can('products.manage') && (
                  <button onClick={openNew} className="flex items-center gap-1.5 text-xs bg-brand hover:bg-brand-dark text-on-brand px-3 py-2 rounded-lg font-black uppercase tracking-wider transition">
                    <Plus size={14} /> New product
                  </button>
                )}
              </div>
            </div>

            {/* Quick add - for the items that are just a name and a price. */}
            {can('products.manage') && (
              <form onSubmit={quickAdd} className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-page-bg border border-white/10 rounded-xl">
                <span className="text-[11px] font-black uppercase tracking-widest text-fg/75 mr-1">Quick add</span>
                <input value={quick.name} onChange={e => setQuick(q => ({ ...q, name: e.target.value }))} placeholder="Name, e.g. Bottled Water" aria-label="Quick add name"
                  className="flex-1 min-w-[160px] bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
                <select value={quick.category || readLS(localStorage, LAST_CAT_KEY) || ''} onChange={e => setQuick(q => ({ ...q, category: e.target.value }))} aria-label="Quick add category"
                  className="bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand">
                  <option value="">Category…</option>
                  {categories.map(c2 => <option key={c2._id} value={c2.name}>{c2.name}</option>)}
                </select>
                <div className="relative w-28">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/70 text-sm">₱</span>
                  <input type="number" min="0" step="0.01" value={quick.price} onChange={e => setQuick(q => ({ ...q, price: e.target.value }))} placeholder="Price" aria-label="Quick add price"
                    className="w-full bg-surface border border-white/10 rounded-lg pl-6 pr-2 py-2 text-sm text-fg outline-none focus:border-brand tabular-nums" />
                </div>
                <button type="submit" disabled={quickBusy} className="bg-brand text-on-brand text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg disabled:opacity-50">Add</button>
              </form>
            )}

            {/* Menu backup: an exact copy of every product, size, recipe and
                add-on in one file. Unlike the spreadsheet importer this is a
                true round-trip, so rebuilding a database does not mean
                rebuilding the menu by hand. Recipes re-link to stock by
                ingredient NAME, since inventory ids change on a rebuild. */}
            <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-page-bg border border-white/10 rounded-xl">
              <div className="mr-auto min-w-0">
                <p className="text-[11px] font-black uppercase tracking-widest text-fg/65">Menu Backup</p>
                <p className="text-[10px] text-fg/70 mt-0.5">Download the whole menu, restore it after a rebuild.</p>
              </div>
              <button onClick={() => downloadMenuBackup(false)} disabled={menuBackupBusy}
                className="flex items-center gap-1.5 text-[10px] bg-brand/10 hover:bg-brand/20 text-brand-text px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
                <Download size={12} /> {menuBackupBusy ? 'Working…' : 'Download'}
              </button>
              <label className={`flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition ${menuBackupBusy ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                <Upload size={12} /> Restore
                <input type="file" accept="application/json,.json" className="hidden"
                  onChange={e => { openMenuRestore(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>

            {/* Recipe workbook import. Separate from the backup above: that is a
                round-trip of what the system already holds, this reads the
                barista sheets a human typed. Always review-then-commit. */}
            <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-page-bg border border-white/10 rounded-xl">
              <div className="mr-auto min-w-0">
                <p className="text-[11px] font-black uppercase tracking-widest text-fg/65">Recipe Workbook</p>
                <p className="text-[10px] text-fg/70 mt-0.5">Read drinks and bulk recipes from the barista sheets.</p>
              </div>
              <label className={`flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition ${rsBusy ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                <Upload size={12} /> {rsBusy ? 'Reading…' : 'Read Workbook'}
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { openRecipeSheet(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>

            {/* The coded menu sheet. F&B only: it describes drinks with sizes
                and recipes, which is not how a logistics catalogue is built. */}
            {BUSINESS_TYPE === 'fb' && (
              <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-page-bg border border-white/10 rounded-xl">
                <div className="mr-auto min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-widest text-fg/65">Menu Sheet</p>
                  <p className="text-[10px] text-fg/70 mt-0.5">One row per size, ingredients by stock code, e.g. <span className="font-mono">G10002/Water</span> with <span className="font-mono">20g/35ml</span>.</p>
                </div>
                <label className={`flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition ${msBusy ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                  <Upload size={12} /> {msBusy ? 'Reading…' : 'Read Menu Sheet'}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => { openMenuSheet(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
            )}

            {msPreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeMenuSheet}>
                <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h2 className="font-black text-fg text-lg mb-1">Menu sheet</h2>
                  <p className="text-xs text-fg/75 mb-4 break-all">{msFile?.name} &middot; sheet &ldquo;{msFile?.sheet}&rdquo;</p>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                    {[
                      ['Products', msPreview.counts.products, 'text-fg'],
                      ['Sizes', msPreview.counts.sizes, 'text-fg'],
                      ['Linked to stock', msPreview.counts.stockLines, 'text-success'],
                      ['Non-stock lines', msPreview.counts.nonStockLines, 'text-fg/70'],
                      ['Need a look', msPreview.counts.needingReview, msPreview.counts.needingReview ? 'text-warning' : 'text-fg/65'],
                    ].map(([label, value, cls]) => (
                      <div key={label} className="bg-page-bg border border-white/10 rounded-xl p-2.5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-fg/65">{label}</p>
                        <p className={`text-base font-black tabular-nums ${cls}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Anything the sheet says that cannot be read is shown before
                      the import runs, not swallowed by it. */}
                  {msPreview.problems.length > 0 && (
                    <div className="mb-4 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
                      <p className="text-[11px] font-black uppercase tracking-wider text-warning mb-1.5">Needs a look first</p>
                      <ul className="space-y-1">
                        {msPreview.problems.map(p => (
                          <li key={p.product} className="text-[11px] text-fg/80">
                            <span className="font-bold">{p.product}</span>: {p.problems.map(x => x.detail).join(' ')}
                          </li>
                        ))}
                      </ul>
                      <p className="text-[10px] text-fg/65 mt-2">These lines are left out of the recipe rather than guessed at. Fix the sheet and read it again, or import now and add them by hand.</p>
                    </div>
                  )}

                  {msPreview.nonStockNames.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[11px] font-black uppercase tracking-wider text-fg/65 mb-1.5">Recorded as non-stock</p>
                      <p className="text-[11px] text-fg/75 leading-snug">{msPreview.nonStockNames.join(' &middot; ')}</p>
                      <p className="text-[10px] text-fg/65 mt-1">Measured in the recipe but never deducted and never costed. Anything here that looks like a stock code is an item that does not exist yet.</p>
                    </div>
                  )}

                  <div className="border border-white/10 rounded-xl overflow-hidden mb-4">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-page-bg text-[9px] uppercase tracking-widest text-fg/65">
                          <th className="text-left py-2 px-3">Product</th>
                          <th className="text-left py-2">Category</th>
                          <th className="text-left py-2">Sizes</th>
                          <th className="text-right py-2 px-3">Ingredients</th>
                        </tr>
                      </thead>
                      <tbody>
                        {msPreview.products.map(p => (
                          <tr key={p.name} className="border-t border-white/5">
                            <td className="py-2 px-3 font-bold text-fg">{p.name}</td>
                            <td className="py-2 text-fg/70">{p.category || '-'}</td>
                            {/* The first row of the sheet is the base size, so it
                                belongs in this column with the rest. Listing only
                                the extras made a hot-only drink read as having no
                                size and no ingredients at all. */}
                            <td className="py-2 text-fg/70">
                              {[
                                ...(p.baseSize ? [{ name: p.baseSize, price: p.srp }] : []),
                                ...p.sizes,
                              ].map(sz => `${sz.name} ${peso ? peso(sz.price) : sz.price}`).join(' · ')}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-fg/70">
                              {p.ingredients.length + p.sizes.reduce((n, sz) => n + sz.ingredients.length, 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button onClick={closeMenuSheet} disabled={msBusy}
                      className="text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">Cancel</button>
                    <button onClick={submitMenuSheet} disabled={msBusy || msPreview.counts.products === 0}
                      className="text-[10px] bg-brand hover:bg-brand/90 text-on-brand px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
                      {msBusy ? 'Importing…' : `Import ${msPreview.counts.products} product(s)`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {rsPreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeRecipeSheet}>
                <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h2 className="font-black text-fg text-lg mb-1">Recipe workbook</h2>
                  <p className="text-xs text-fg/75 mb-4 break-all">{rsFile?.name}</p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {[
                      ['Drinks read', rsPreview.counts.drinks, 'text-fg'],
                      ['Ready', rsPreview.counts.drinks - rsPreview.counts.drinksNeedingReview, 'text-success'],
                      ['Need review', rsPreview.counts.drinksNeedingReview, 'text-warning'],
                      ['Bulk recipes', rsPreview.counts.bulkRecipes, 'text-fg'],
                    ].map(([label, val, cls]) => (
                      <div key={label} className="bg-page-bg border border-white/10 rounded-lg p-2.5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-fg/70">{label}</p>
                        <p className={`text-lg font-black tabular-nums ${cls}`}>{val}</p>
                      </div>
                    ))}
                  </div>

                  {/* Materials: what already exists vs what would be created. */}
                  <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-1.5">
                    Materials · {rsPreview.counts.materialsMatched} in stock, {rsPreview.counts.materialsMissing} missing
                  </p>
                  <div className="max-h-44 overflow-y-auto bg-page-bg border border-white/10 rounded-lg mb-2">
                    {rsPreview.materials.map(m => (
                      <div key={m.name} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/5 last:border-0 text-xs">
                        <span className="truncate text-fg/80">{m.name} <span className="text-fg/65">×{m.uses}</span></span>
                        {m.matchedInvId ? (
                          <span className={`shrink-0 text-[10px] font-bold ${m.unitMismatch ? 'text-warning' : 'text-success'}`}>
                            {m.unitMismatch ? `unit mismatch (stock is ${m.matchedUnit})` : (m.matchedCode || 'in stock')}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-bold text-fg/70">will be created</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Prices. The workbook is a recipe sheet - it has no price
                      column - so SRP is typed here, per size, before import. */}
                  {rsDrafts.length > 0 && (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-1.5">
                        Drinks &amp; prices · {rsDrafts.length} ready
                      </p>
                      <div className="max-h-60 overflow-y-auto bg-page-bg border border-white/10 rounded-lg mb-4">
                        {rsDrafts.map(d => (
                          <div key={d.name} className="px-3 py-2 border-b border-white/5 last:border-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-fg truncate">{d.name}</p>
                                <p className="text-[10px] text-fg/70">
                                  {d.category} · {d.baseSizeName || 'no size'} · {(d.baseRecipe || []).length} ingredient(s)
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] text-fg/70">SRP</span>
                                <input
                                  type="number" min="0" step="0.01" placeholder="0.00"
                                  value={rsPrices[d.name]?.[''] ?? ''}
                                  onChange={e => setRsPrice(d.name, '', e.target.value)}
                                  className="w-20 bg-sidebar-bg border border-white/10 rounded px-2 py-1 text-xs text-right tabular-nums text-fg"
                                />
                              </div>
                            </div>
                            {(d.sizes || []).map(sz => (
                              <div key={sz.name} className="flex items-center justify-between gap-2 mt-1 pl-3">
                                <span className="text-[10px] text-fg/75 truncate">
                                  + {sz.name} <span className="text-fg/65">({(sz.recipe || []).length} ingredient(s))</span>
                                </span>
                                <input
                                  type="number" min="0" step="0.01" placeholder="0.00"
                                  value={rsPrices[d.name]?.[sz.name] ?? ''}
                                  onChange={e => setRsPrice(d.name, sz.name, e.target.value)}
                                  className="w-20 bg-sidebar-bg border border-white/10 rounded px-2 py-1 text-xs text-right tabular-nums text-fg"
                                />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <label className="flex items-center gap-2 text-[11px] text-fg/65 mb-4 cursor-pointer">
                    <input type="checkbox" checked={rsCreateMissing} onChange={e => setRsCreateMissing(e.target.checked)} />
                    Create the {rsPreview.counts.materialsMissing} missing stock item(s), at zero qty and zero cost
                  </label>

                  {rsPreview.counts.drinksNeedingReview > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 mb-4 text-xs">
                      <AlertTriangle size={15} className="text-warning mt-0.5 shrink-0" />
                      <div>
                        <p className="text-warning font-black uppercase tracking-wider">
                          {rsPreview.counts.drinksNeedingReview} drink(s) skipped
                        </p>
                        <p className="text-fg/75 mt-1">
                          Their ingredient cells are ambiguous - usually several materials in one cell, or a hot/iced
                          split that could be read two ways. Add these by hand rather than let the import guess:
                        </p>
                        <p className="text-fg/70 mt-1">
                          {rsPreview.drinks.filter(d => d.needsReview).map(d => d.name).join(', ')}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="text-[11px] text-fg/70 bg-page-bg border border-white/10 rounded-lg p-2.5 mb-4">
                    Prices are not in these sheets, so every drink imports at ₱0 - set each price before selling.
                    Sizes are imported using their hot figure; adjust iced quantities on the product afterwards.
                  </div>

                  <div className="flex gap-3">
                    <button onClick={closeRecipeSheet} disabled={rsBusy}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                      Cancel
                    </button>
                    <button onClick={submitRecipeSheet} disabled={rsBusy}
                      className="flex-1 bg-brand hover:bg-brand-dark text-on-brand font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-50">
                      {rsBusy ? 'Importing…' : `Import ${rsPreview.counts.drinks - rsPreview.counts.drinksNeedingReview} drink(s)`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Restore always previews first (a dry run on the server) so the
                user sees what WOULD change - and which ingredients cannot be
                linked - before a single product is written. */}
            {menuRestoreModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setMenuRestoreModal(null)}>
                <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h2 className="font-black text-fg text-lg mb-1">Restore menu backup</h2>
                  <p className="text-xs text-fg/75 mb-4 break-all">
                    {menuRestoreModal.fileName} · {menuRestoreModal.backup.products.length} product(s)
                    {menuRestoreModal.backup.exportedAt && ` · exported ${new Date(menuRestoreModal.backup.exportedAt).toLocaleDateString()}`}
                  </p>

                  <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1.5">If a product is already on the menu</label>
                  <div className="space-y-1.5 mb-4">
                    {[
                      ['skip', 'Keep what is on the menu', 'Existing products are left exactly as they are.'],
                      ['overwrite', 'Replace it from the backup', 'Overwrites price, recipe and settings with the file.'],
                    ].map(([v, label, help]) => (
                      <button key={v} onClick={() => setMenuRestoreModal(m => ({ ...m, onConflict: v, preview: null }))}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition ${
                          menuRestoreModal.onConflict === v ? 'bg-brand/15 border-brand/50' : 'bg-white/5 border-white/10 hover:border-white/20'}`}>
                        <span className={`block text-xs font-bold ${menuRestoreModal.onConflict === v ? 'text-fg' : 'text-fg/65'}`}>{label}</span>
                        <span className="block text-[10px] text-fg/70 mt-0.5">{help}</span>
                      </button>
                    ))}
                  </div>

                  {menuRestoreModal.preview ? (
                    <div className="bg-page-bg border border-white/10 rounded-xl p-3 mb-4 text-xs space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-1.5">Preview</p>
                      <div className="flex justify-between"><span className="text-fg/75">Will be created</span><span className="tabular-nums font-bold text-success">{menuRestoreModal.preview.created}</span></div>
                      <div className="flex justify-between"><span className="text-fg/75">Will be updated</span><span className="tabular-nums font-bold text-warning">{menuRestoreModal.preview.updated}</span></div>
                      <div className="flex justify-between"><span className="text-fg/75">Left untouched</span><span className="tabular-nums font-bold text-fg/75">{menuRestoreModal.preview.skipped}</span></div>

                      {/* How recipe lines re-linked to stock. Leaning on NAME
                          is the one worth flagging: it means the stock codes
                          did not line up, so a rename could have mismatched. */}
                      {(() => {
                        const mb = menuRestoreModal.preview.matchedBy || {};
                        const total = (mb.invId || 0) + (mb.itemCode || 0) + (mb.name || 0);
                        if (!total) return null;
                        return (
                          <div className="mt-2 pt-2 border-t border-white/10">
                            <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-1">Recipe lines linked by</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                              {mb.invId > 0 && <span className="text-fg/75">same stock record <span className="text-fg/80 font-bold tabular-nums">{mb.invId}</span></span>}
                              {mb.itemCode > 0 && <span className="text-fg/75">stock code <span className="text-success font-bold tabular-nums">{mb.itemCode}</span></span>}
                              {mb.name > 0 && <span className="text-fg/75">name only <span className="text-warning font-bold tabular-nums">{mb.name}</span></span>}
                            </div>
                            {mb.name > 0 && (
                              <p className="text-[10px] text-warning mt-1">
                                Matched by name because the stock code did not line up - worth checking those are the right items.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      {menuRestoreModal.preview.unmatchedIngredients?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                          <p className="text-[11px] text-warning font-bold">
                            {menuRestoreModal.preview.unmatchedIngredients.length} ingredient(s) not in stock
                          </p>
                          <p className="text-[10px] text-fg/70 mt-0.5">
                            Those recipe lines will be left out, so affected products under-report cost until the
                            ingredient exists:
                          </p>
                          <p className="text-[10px] text-fg/65 mt-1">{menuRestoreModal.preview.unmatchedIngredients.join(', ')}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-fg/70 mb-4">Preview first to see exactly what this file would change.</p>
                  )}

                  <div className="flex gap-2">
                    <button onClick={() => setMenuRestoreModal(null)} disabled={menuBackupBusy}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg font-bold py-2.5 rounded-xl transition text-sm">
                      Cancel
                    </button>
                    <button onClick={() => runMenuRestore(true)} disabled={menuBackupBusy}
                      className="flex-1 border border-white/15 text-fg font-bold py-2.5 rounded-xl transition text-sm hover:bg-white/5 disabled:opacity-40">
                      {menuBackupBusy ? 'Checking…' : 'Preview'}
                    </button>
                    <button onClick={() => runMenuRestore(false)} disabled={menuBackupBusy || !menuRestoreModal.preview}
                      title={!menuRestoreModal.preview ? 'Preview first' : ''}
                      className="flex-1 bg-brand hover:bg-brand-dark text-on-brand font-bold py-2.5 rounded-xl transition text-sm disabled:opacity-40">
                      Restore
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Search + filters - a shop with a few hundred SKUs can't page 8-at-a-time
                to find one item, so this narrows the list before pagination. */}
            <div className="mb-5 space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/65" />
                <input
                  type="text"
                  value={prodSearch}
                  onChange={e => setProdSearch(e.target.value)}
                  placeholder="Search by name, category, code or description…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2.5 text-sm text-fg outline-none focus:border-brand font-semibold placeholder-fg/70"
                />
                {prodSearch && (
                  <button type="button" onClick={() => setProdSearch('')} aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg/70 hover:text-fg transition">
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
                  <option value="low">Low stock (1-5)</option>
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
                  <option value="name">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                  <option value="price">Price low → high</option>
                  <option value="price-desc">Price high → low</option>
                  <option value="category">Category</option>
                </select>

                {prodFiltersActive && (
                  <button type="button" onClick={resetProdFilters}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand-text bg-brand/10 border border-brand/30 hover:bg-brand/20 transition flex items-center gap-1">
                    <X size={12} /> Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {currentProducts.length === 0 && (
                <div className="py-12 px-6 text-center border border-dashed border-white/10 rounded-xl">
                  {prodFiltersActive ? (<>
                    <Search size={26} className="mx-auto mb-3 text-brand-text" />
                    <p className="text-fg/70 font-black uppercase tracking-widest text-xs mb-1">No matching items</p>
                    <p className="text-fg/70 text-xs">No product matches your search and filters. Try clearing them.</p>
                  </>) : (<>
                    <Coffee size={26} className="mx-auto mb-3 text-brand-text" />
                    <p className="text-fg/70 font-black uppercase tracking-widest text-xs mb-1">No menu items yet</p>
                    <p className="text-fg/70 text-xs">Add your first product with the form on the right; it goes live on the menu instantly.</p>
                  </>)}
                </div>
              )}
              {currentProducts.map(p => {
                const est = getEstimatedStock(p.baseRecipe);
                const price = Number(p.basePrice || p.price || 0);
                const chip = 'text-[11px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap';
                return (
                <div key={p._id} className="flex flex-col sm:flex-row gap-3 sm:gap-4 p-3 sm:p-4 border border-white/10 rounded-xl bg-surface-2 sm:items-center">
                  <div className="flex gap-3 flex-1 min-w-0">
                    {p.image && ctx.systemSettings?.imagesEnabled !== false ? (
                      <img src={p.image} alt="" className="w-12 h-12 object-cover rounded-lg border border-white/10 shrink-0" />
                    ) : (
                      // The name's first letter reads better than a grey "No Img" box.
                      <div aria-hidden="true" className="w-12 h-12 rounded-lg bg-brand/15 border border-brand/25 flex items-center justify-center text-brand-text text-lg font-black shrink-0">
                        {(p.name || '?').trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                        <h4 className="font-bold text-fg break-words min-w-0">{p.name}</h4>
                        {est !== null && (
                          <span className={`${chip} ${est <= 0 ? 'bg-red-500/15 text-danger' : est <= 5 ? 'bg-yellow-500/15 text-warning' : 'bg-green-500/15 text-success'}`}>
                            {est <= 0 ? 'Out of stock' : `${est} left`}
                          </span>
                        )}
                        {/* The server decides what the customer menu shows, and it can
                            disagree with the estimate above (a dangling ingredient
                            link, an unlinked recipe). The reason is spelled out below. */}
                        {p.stockAvailable === false && (
                          <span title={p.stockReason || 'Not shown to customers.'} className={`${chip} bg-red-500/15 text-danger`}>
                            Can't be made
                          </span>
                        )}
                        {BUSINESS_TYPE !== 'log' && p.showOnQr === false && (
                          <span title="Sold at the POS only - not on the table QR menu" className={`${chip} bg-white/10 text-fg/80`}>
                            Counter only
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-fg/70 mt-0.5">
                        {[p.category, p.baseSize, p.sizes?.length > 0 ? `+${p.sizes.length} size${p.sizes.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                      </p>
                      {p.description && <p className="text-xs text-fg/70 mt-1 line-clamp-2">{p.description}</p>}
                      {p.stockAvailable === false && p.stockReason && (
                        <p className="text-[11px] text-danger mt-1 flex items-start gap-1"><AlertCircle size={12} className="mt-px shrink-0" />{p.stockReason}</p>
                      )}
                      {/* A priced size with no materials sells for money while
                          deducting nothing - not fatal, but it should not go
                          unnoticed. */}
                      {p.sizesWithoutRecipe?.length > 0 && (
                        <p className="text-[11px] text-warning mt-1 flex items-start gap-1">
                          <AlertTriangle size={12} className="mt-px shrink-0" />
                          <span>
                            No materials set for {p.sizesWithoutRecipe.length === 1 ? 'size' : 'sizes'}{' '}
                            {p.sizesWithoutRecipe.map(n => `"${n}"`).join(', ')} - selling {p.sizesWithoutRecipe.length === 1 ? 'it' : 'them'} deducts no stock.
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 shrink-0 sm:pl-2">
                    <p className="text-fg font-black tabular-nums mr-auto sm:mr-0 sm:min-w-[6.5rem] sm:text-right">
                      ₱{price.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {/* The two buttons are one group, so a narrow screen moves them
                        together instead of splitting them across lines. */}
                    <div className="flex items-center gap-2 ml-auto">
                      <button onClick={() => openEdit(p)}
                        className="h-9 px-3.5 bg-white/10 text-fg rounded-lg text-xs font-bold hover:bg-brand hover:text-on-brand transition inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Edit size={13} /> Edit
                      </button>
                      {/* A new product that starts as this one: the sizes, recipe and
                          options come across, and only the name is left to type. */}
                      <button type="button" onClick={() => openLike(p)} title="Start a new product from this one"
                        className="h-9 px-3.5 border border-white/10 text-fg/80 rounded-lg text-xs font-bold hover:bg-white/10 hover:text-fg transition inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Copy size={13} /> New like this
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
              {/* --- PAGINATION CONTROLS --- */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center bg-page-bg p-4 rounded-xl border border-white/10 mt-6 shrink-0">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === 1 ? 'bg-white/10 text-fg/70 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-brand-text'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Previous</span>
                </button>
                
                <span className="text-fg/70 text-sm font-bold tracking-widest">
                  PAGE <span className="text-brand-text text-lg">{currentPage}</span> OF {totalPages}
                </span>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === totalPages ? 'bg-white/10 text-fg/70 cursor-not-allowed' : 'bg-surface border border-gray-700 text-fg hover:border-accent hover:text-brand-text'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
            </div>
            
            {/* 2. Manage Categories */}
            <div className="mt-8 border-t border-white/10 pt-6">
              <h3 className="text-xl font-bold mb-4 text-fg border-b border-white/10 pb-2">Manage Categories & Routing</h3>
              {can('products.manage') && (
              <form onSubmit={handleSaveCategory} className="flex flex-wrap gap-3 mb-6">
                <input
                  type="text"
                  value={catForm.name}
                  onChange={e => setCatForm({...catForm, name: e.target.value})}
                  placeholder="Category Name"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-semibold placeholder-fg/70"
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
                <button type="submit" className="bg-accent text-on-brand font-bold px-6 py-2 rounded-lg hover:bg-opacity-90 transition shadow-md">
                  {editingCategory ? 'Update' : 'Add'}
                </button>
                {editingCategory && (
                  <button type="button" onClick={() => { setEditingCategory(null); setCatForm({ name: '', department: DEFAULT_DEPARTMENT }); }} className="bg-white/10 text-fg/70 font-bold px-4 py-2 rounded-lg hover:bg-white/20 transition">
                    Cancel
                  </button>
                )}
              </form>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {categories.map(c => (
                  <div key={c._id} className="flex justify-between items-center p-3 border border-white/10 rounded-xl bg-surface-2">
                    <div>
                      <span className="font-bold text-sm text-fg block">{c.name}</span>
                      <span className="text-[10px] uppercase font-bold text-fg/70 tracking-wider">Routes to: {c.department || DEFAULT_DEPARTMENT}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingCategory(c); setCatForm({ name: c.name, department: c.department || DEFAULT_DEPARTMENT }); }} className="text-fg/70 hover:text-brand-text p-1.5 rounded"><Edit size={16} /></button>
                      {can('products.manage') && <button onClick={() => deleteCategory(c._id)} className="text-danger p-1.5 rounded"><Trash2 size={16} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. MANAGE GLOBAL ADD-ONS - attaching an add-on to a product needs one to exist first */}
            <div className="mt-8 border-t border-white/10 pt-6">
              <h3 className="text-xl font-bold mb-4 text-fg border-b border-white/10 pb-2">Manage Add-Ons</h3>
              {isSuperAdmin && (
              <form onSubmit={handleSaveAddOn} className="flex flex-wrap gap-3 mb-6">
                <input
                  type="text"
                  placeholder={BUSINESS_TYPE === 'log' ? 'Name (e.g. Custom Grind)' : 'Name (e.g. Popping Boba)'}
                  value={addOnForm.name}
                  onChange={e => setAddOnForm({...addOnForm, name: e.target.value})}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-semibold placeholder-fg/70"
                  required
                />
                <input
                  type="number"
                  placeholder="Price"
                  value={addOnForm.price}
                  onChange={e => setAddOnForm({...addOnForm, price: e.target.value})}
                  className="w-24 bg-white/5 border border-white/10 rounded-lg p-3 text-fg outline-none focus:border-brand font-bold placeholder-fg/70"
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
                <button type="submit" className="bg-brand text-on-brand font-bold px-6 py-2 rounded-lg hover:bg-brand-dark transition shadow-md">{addOnForm._id ? 'Save' : 'Add'}</button>
                {addOnForm._id && (
                  <button type="button" onClick={() => setAddOnForm(emptyAddOn)}
                    className="bg-white/5 text-fg/65 font-bold px-4 py-2 rounded-lg hover:bg-white/10 transition">Cancel</button>
                )}

                {/* Optional: what this extra takes from stock when it is sold.
                    Without one, the add-on only changes the price. */}
                <details className="w-full bg-white/5 border border-white/10 rounded-lg p-3" open={aoRecipe.length > 0}>
                  <summary className="text-xs font-bold text-fg/80 cursor-pointer select-none">
                    Recipe (optional){aoRecipe.length > 0 ? ` - ${aoRecipe.length} item${aoRecipe.length === 1 ? '' : 's'}` : ' - takes nothing from stock'}
                  </summary>
                  <div className="mt-3 space-y-2">
                    {aoRecipe.map((r, i) => (
                      <div key={`${r.invId || r.name}-${i}`} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 text-fg font-semibold truncate">
                          {r.name}{r.nonStock && <span className="ml-2 text-[9px] font-black uppercase tracking-wider text-fg/65">not stock</span>}
                        </span>
                        <input type="number" step="any" min="0" value={r.qty}
                          onChange={e => setAoRecipe(aoRecipe.map((x, j) => j === i ? { ...x, qty: parseFloat(e.target.value) || 0 } : x))}
                          className="w-20 bg-page-bg border border-white/10 rounded p-1.5 text-center text-fg font-bold" />
                        <span className="w-8 text-xs text-fg/70 font-bold">{r.unit}</span>
                        <button type="button" onClick={() => setAoRecipe(aoRecipe.filter((_, j) => j !== i))} className="text-danger"><X size={15} /></button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <SearchSelect value={aoMat} onChange={e => setAoMat(e.target.value)}
                        className="flex-1 min-w-[160px] bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-xs text-fg outline-none focus:border-brand"
                        placeholder="From stock - type to find"
                        options={inventory.map(inv => ({ value: inv._id, label: inv.itemName, hint: inv.unit || 'pcs' }))} />
                      <input type="number" step="any" min="0" placeholder={(inventory.find(i => String(i._id) === String(aoMat))?.unit) || 'qty'}
                        value={aoQty} onChange={e => setAoQty(e.target.value)}
                        className="w-20 bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-xs text-fg outline-none focus:border-brand" />
                      <button type="button" onClick={addAoStock} className="bg-brand/15 text-brand-text px-3 py-2 rounded-lg text-xs font-bold hover:bg-brand/25 transition">Add</button>
                    </div>
                    {BUSINESS_TYPE !== 'log' && (
                      <div className="flex flex-wrap gap-2">
                        <input type="text" placeholder="Not from stock, e.g. Hot Water" value={aoNsName} onChange={e => setAoNsName(e.target.value)}
                          className="flex-1 min-w-[160px] bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-xs text-fg outline-none focus:border-brand" />
                        <input type="number" step="any" min="0" placeholder="qty" value={aoNsQty} onChange={e => setAoNsQty(e.target.value)}
                          className="w-20 bg-page-bg border border-white/10 rounded-lg px-2 py-2 text-xs text-fg outline-none focus:border-brand" />
                        <select value={aoNsUnit} onChange={e => setAoNsUnit(e.target.value)}
                          className="w-16 bg-page-bg border border-white/10 rounded-lg px-1 py-2 text-xs text-fg outline-none focus:border-brand">
                          {['ml', 'g', 'pcs'].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <button type="button" onClick={addAoNonStock} className="bg-white/10 text-fg/80 px-3 py-2 rounded-lg text-xs font-bold hover:bg-white/15 transition">Add</button>
                      </div>
                    )}
                  </div>
                </details>
              </form>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {globalAddOns.map(a => (
                  <div key={a._id} className={`flex justify-between items-center p-3 border rounded-xl bg-surface-2 ${addOnForm._id === a._id ? 'border-brand/60' : 'border-white/10'}`}>
                    <div>
                      <span className="font-bold text-sm text-fg block">{a.name}</span>
                      <span className="text-[10px] uppercase font-bold text-brand-text tracking-wider">
                        {a.category} • +P{a.price}{(a.recipe || []).length > 0 ? ` • recipe: ${a.recipe.length}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setAddOnForm({ _id: a._id, name: a.name, price: a.price, category: a.category || 'Extras', recipe: a.recipe || [] })}
                        className="text-fg/70 hover:text-fg bg-white/5 hover:bg-white/10 p-1.5 rounded"><Edit size={16} /></button>
                      <button onClick={() => deleteAddOn(a._id)} className="text-danger bg-red-500/10 p-1.5 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
              {/* One step for "put the Extra Shot on every coffee" instead of an edit per drink. */}
              {can('products.manage') && globalAddOns.length > 0 && (
                <LinkAddOns addOns={globalAddOns} products={products} categories={categories} apiFetch={apiFetch} onDone={fetchData} />
              )}
            </div>
          </div>

          {/* ════════════ PRODUCT EDITOR ════════════
              A full-width sheet instead of the narrow column it replaced, with
              the same fields in four sections. Sizes, prices and every size's
              recipe are one grid (RecipeMatrix), so two sizes are always seen
              side by side, with what each costs to make. */}
          {editorOpen && can('products.manage') && (
          <div className="fixed inset-0 z-50 bg-black/60 flex justify-center items-stretch sm:p-4" role="dialog" aria-modal="true" aria-label={editingProduct ? 'Edit product' : 'New product'}
            onKeyDown={e => { if (e.key === 'Escape') closeEditor(); }}>
            <form onSubmit={saveFromEditor} className="bg-page-bg sm:rounded-2xl border border-white/10 w-full max-w-6xl flex flex-col overflow-hidden shadow-2xl">
              <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-surface">
                <h3 className="text-lg font-black text-fg flex-1 truncate">{editingProduct ? `Edit ${formData.name || 'product'}` : (formData.name ? `New: ${formData.name}` : 'New product')}</h3>
                {draftRestored && !editingProduct && (
                  <span className="hidden sm:flex items-center gap-2 text-xs text-fg/75">
                    Restored your unsaved draft
                    <button type="button" onClick={discardDraft} className="text-brand-text font-bold hover:underline">Start blank</button>
                  </span>
                )}
                <button type="button" onClick={closeEditor} aria-label="Close" className="p-2 rounded-lg text-fg/75 hover:text-fg hover:bg-white/10"><X size={18} /></button>
              </header>

              <div className="flex-1 flex min-h-0">
                <nav className="hidden md:flex flex-col w-52 shrink-0 border-r border-white/10 p-3 gap-1" aria-label="Sections">
                  {editorSections.map(sec => (
                    <button key={sec.id} type="button" onClick={() => document.getElementById(`pe-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm font-bold text-fg/80 hover:text-fg hover:bg-white/5">
                      <span>{sec.label}</span>
                      {sec.done ? <Check size={14} className="text-success" /> : <span className="text-[10px] text-fg/65">{sec.note || ''}</span>}
                    </button>
                  ))}
                </nav>

                <div className="flex-1 overflow-y-auto p-5 space-y-10">
                  <section id="pe-details" className="scroll-mt-4 space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-widest text-fg/75">Details</h4>
                    <div className="grid md:grid-cols-[260px_1fr] gap-6">
                      <div className="space-y-4">
                {/* Basic Info */}
                <div>
                  <label className="block text-sm font-bold text-fg/65 mb-2">Product Image</label>
                  <div className="flex items-center gap-4">
                    {formData.image ? (
                      <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-white/10 shadow-sm" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-xs text-fg/65 font-bold">None</div>
                    )}
                    <div className="flex flex-col gap-2 min-w-0">
                      {/* The browser's own file control ("Choose File - no file
                          chosen") was the one native widget left on screen and
                          looked nothing like the rest of the form. The input is
                          hidden inside its label so the label IS the button. */}
                      <label className="self-start cursor-pointer text-sm font-bold bg-accent hover:bg-accent/80 text-on-brand rounded-xl py-2 px-4 transition">
                        {formData.image ? 'Replace image' : 'Choose image'}
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                      </label>
                      {formData.image && (
                        <button type="button" onClick={() => setFormData({ ...formData, image: '', imageUrl: '' })}
                          className="self-start text-sm font-bold border border-white/15 text-danger hover:bg-red-500/10 rounded-xl py-2 px-4 transition">
                          Remove image
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* --- IMAGE URL input --- */}
                <div className="border-t border-white/10 pt-4 mt-2">
                  <label className="text-xs font-bold text-fg/75 uppercase tracking-wider block mb-1.5">Image URL (alternative to upload)</label>
                  <input type="url" placeholder="https://example.com/image.jpg"
                    value={formData.imageUrl || ''}
                    onChange={e => setFormData({...formData, imageUrl: e.target.value, image: e.target.value || formData.image})}
                    className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm outline-none focus:border-brand/60 placeholder-fg/70"
                  />
                  <p className="text-[10px] text-fg/65 mt-1">Leave blank to use uploaded image. Paste URL to override.</p>
                </div>

                      </div>
                      <div className="space-y-4">
                <div><label className="block text-sm font-bold text-fg/65 mb-1">Name</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand font-semibold placeholder-fg/70" /></div>
                <div>
                  <label className="block text-sm font-bold text-fg/65 mb-1">Category</label>
                  <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand font-semibold">
                    <option value="" disabled>Select Category...</option>
                    {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm font-bold text-fg/65 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-fg outline-none focus:border-brand h-20 placeholder-fg/70 font-medium"></textarea></div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
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
                  <p className="text-[10px] text-fg/65 mb-3">
                    Leave unticked for normal goods. Tick only for items exempt by law - raw
                    agricultural produce, prescription medicines. Ignored while the business is
                    set to Non-VAT in Settings.
                  </p>

                          </div>
                          <div>
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
                  <p className="text-[10px] text-fg/65 mb-3">
                    Shows this product under a dedicated <span className="font-bold">Bulk</span> tab in the register and client portal - for sack/wholesale quantities sold apart from the regular menu.
                  </p>
                  {BUSINESS_TYPE !== 'log' && (
                    <>
                      {/* Café: counter-only products are sold at the POS but never offered on the table QR. */}
                      <label className="flex items-start gap-2.5 mb-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.showOnQr !== false}
                          onChange={e => setFormData({ ...formData, showOnQr: e.target.checked })}
                          className="mt-0.5 w-4 h-4 accent-brand shrink-0"
                        />
                        <span className="text-xs font-bold text-fg">Show on the QR menu</span>
                      </label>
                      <p className="text-[10px] text-fg/65 mb-3">
                        Untick to make it counter-only: staff can still sell it at the POS, but customers ordering from a table QR will not see or order it.
                      </p>
                    </>
                  )}

                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section id="pe-recipe" className="scroll-mt-4 space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-widest text-fg/75">Sizes, prices &amp; recipe</h4>
                    <RecipeMatrix key={editingProduct?._id || 'new'} form={formData} setForm={setFormData} inventory={inventory}
                      calcRecipeCost={calcRecipeCost} packInfo={packInfo} businessType={BUSINESS_TYPE} />
                  </section>

                  <section id="pe-options" className="scroll-mt-4">
                    <h4 className="text-xs font-black uppercase tracking-widest text-fg/75">Options</h4>
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
                             <span className="text-[10px] text-brand-text font-black uppercase tracking-widest">+₱{addon.price}</span>
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
                    <p className="text-[10px] text-fg/65 mb-3">Checked groups will be required before adding to cart (e.g. "Choose your milk").</p>
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
                              <p className="text-[10px] text-fg/70">{mg.isRequired ? `Required - pick ${mg.minSelect}${mg.maxSelect>mg.minSelect?`-${mg.maxSelect}`:``}` : 'Optional'} · {mg.options?.length||0} options</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                  </section>

                  <section id="pe-pricing" className="scroll-mt-4">
                    <details open={specialPricingCount > 0 || (formData.discountPercent || 0) > 0} className="group">
                      <summary className="cursor-pointer list-none flex items-center gap-2 text-xs font-black uppercase tracking-widest text-fg/75">
                        <ChevronRight size={14} className="transition group-open:rotate-90" /> Special pricing
                        <span className="normal-case tracking-normal font-bold text-fg/70">
                          {specialPricingCount > 0 || (formData.discountPercent || 0) > 0
                            ? `${specialPricingCount + ((formData.discountPercent || 0) > 0 ? 1 : 0)} rule(s)`
                            : '- none, most products need none'}
                        </span>
                      </summary>
                      <div className="mt-4 space-y-4">
                  {/* Per-product discount - applies only to this product's line, not the whole order. */}
                  <div className="flex items-center gap-2 mb-1">
                    <div className="relative w-1/2">
                      <input type="number" min="0" max="100" step="0.01" placeholder="Discount" value={formData.discountPercent || ''} onChange={e => setFormData({...formData, discountPercent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0))})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 pr-7 text-fg outline-none focus:border-brand font-bold placeholder-fg/70" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/70 font-bold">%</span>
                    </div>
                    {formData.discountPercent > 0 && (
                      <span className="text-[11px] text-success font-bold">
                        → ₱{((parseFloat(formData.basePrice) || 0) * (1 - formData.discountPercent / 100)).toFixed(2)} after discount
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-fg/65 mb-3">Discount applies to this product only, on every order line - not the whole order. The rules below apply when a specific client or quantity is involved.</p>

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
                        className="text-[11px] font-black text-brand-text hover:text-fg transition disabled:opacity-40">+ Add client</button>
                    </div>
                    {(!clientAccounts || clientAccounts.length === 0) && (
                      <p className="text-[10px] text-fg/65 italic">No client accounts yet - create one in the Client Accounts panel to assign a special discount.</p>
                    )}
                    {(formData.clientDiscounts || []).map((cd, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <SearchSelect value={cd.clientId}
                          onChange={e => {
                            const list = [...(formData.clientDiscounts || [])];
                            list[idx] = { ...list[idx], clientId: e.target.value };
                            setFormData({ ...formData, clientDiscounts: list });
                          }}
                          className="w-1/2 sm:w-3/5 shrink-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs outline-none focus:border-brand"
                          placeholder="Type to find a client"
                          options={(clientAccounts || []).map(c => ({ value: c._id, label: c.name || c.username, hint: c.clientCode || '' }))} />
                        <div className="relative w-28">
                          <input type="number" min="0" max="100" step="0.01" value={cd.percent}
                            onChange={e => {
                              const list = [...(formData.clientDiscounts || [])];
                              list[idx] = { ...list[idx], percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) };
                              setFormData({ ...formData, clientDiscounts: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/70 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, clientDiscounts: (formData.clientDiscounts || []).filter((_, i) => i !== idx) })}
                          className="text-danger text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Per-client quantity breaks - "once THIS client orders 50+, it's
                      ₱180 each" - a real quoted PRICE, not a percent, and unlike Bulk
                      Quantity Breaks below it only applies to the named client. Every
                      other buyer hitting the same quantity pays the regular price.
                      Combined with every other discount by taking whichever is
                      better - never stacked. */}
                  {BUSINESS_TYPE === 'log' && (
                  <div className="bg-page-bg/40 border border-white/10 rounded-xl p-3 mt-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-fg/70 uppercase tracking-wider">Client Bulk Pricing</label>
                      <button type="button"
                        disabled={!clientAccounts?.length}
                        onClick={() => setFormData({ ...formData, clientBulkBreaks: [...(formData.clientBulkBreaks || []), { clientId: '', minQty: 1, price: 0 }] })}
                        className="text-[11px] font-black text-brand-text hover:text-fg transition disabled:opacity-40">+ Add break</button>
                    </div>
                    {(!formData.clientBulkBreaks || formData.clientBulkBreaks.length === 0) && (
                      <p className="text-[10px] text-fg/65 italic">
                        {(!clientAccounts || clientAccounts.length === 0)
                          ? 'No client accounts yet - create one in the Client Accounts panel first.'
                          : 'e.g. "once this client orders 50+, charge them ₱180 each" - a quoted price at volume, only for this client.'}
                      </p>
                    )}
                    {(formData.clientBulkBreaks || []).map((b, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <SearchSelect value={b.clientId}
                          onChange={e => {
                            const list = [...(formData.clientBulkBreaks || [])];
                            list[idx] = { ...list[idx], clientId: e.target.value };
                            setFormData({ ...formData, clientBulkBreaks: list });
                          }}
                          className="w-full sm:w-2/5 shrink-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs outline-none focus:border-brand"
                          placeholder="Type to find a client"
                          options={(clientAccounts || []).map(c => ({ value: c._id, label: c.name || c.username, hint: c.clientCode || '' }))} />
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-fg/70 font-bold shrink-0">Qty ≥</span>
                          <input type="number" min="1" step="1" value={b.minQty}
                            onChange={e => {
                              const list = [...(formData.clientBulkBreaks || [])];
                              list[idx] = { ...list[idx], minQty: Math.max(1, parseInt(e.target.value, 10) || 1) };
                              setFormData({ ...formData, clientBulkBreaks: list });
                            }}
                            className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                        </div>
                        <div className="relative w-28 shrink-0">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-fg/70 text-[10px] font-bold">₱</span>
                          <input type="number" min="0" step="0.01" value={b.price}
                            onChange={e => {
                              const list = [...(formData.clientBulkBreaks || [])];
                              list[idx] = { ...list[idx], price: Math.max(0, parseFloat(e.target.value) || 0) };
                              setFormData({ ...formData, clientBulkBreaks: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-5 pr-2 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, clientBulkBreaks: (formData.clientBulkBreaks || []).filter((_, i) => i !== idx) })}
                          className="text-danger text-sm">✕</button>
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
                        className="text-[11px] font-black text-brand-text hover:text-fg transition">+ Add segment</button>
                    </div>
                    {(!formData.segmentDiscounts || formData.segmentDiscounts.length === 0) && (
                      <p className="text-[10px] text-fg/65 italic">
                        {(priceTiers || []).length === 0
                          ? 'No price tiers yet - create them in Price Tiers (Super Admin), assign clients to one, then set a per-product rate here.'
                          : 'Optional. A tier already applies its own percent to every product; add a row here only to override this one product for that tier.'}
                      </p>
                    )}
                    {(formData.segmentDiscounts || []).map((sd, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        {/* Picked from the tier registry, never typed - orders.js matches
                            this against ClientAccount.segments by exact string, so a
                            free-text typo here silently charges the client full price. */}
                        <select value={sd.segment}
                          onChange={e => {
                            const list = [...(formData.segmentDiscounts || [])];
                            list[idx] = { ...list[idx], segment: e.target.value };
                            setFormData({ ...formData, segmentDiscounts: list });
                          }}
                          className="w-1/2 sm:w-3/5 shrink-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs outline-none focus:border-brand">
                          <option value="">Select tier…</option>
                          {(priceTiers || []).map(t => (
                            <option key={t._id} value={t.name}>{t.name}{t.percent > 0 ? ` (default ${t.percent}%)` : ''}</option>
                          ))}
                          {/* A tag saved before the registry existed, or a since-renamed
                              tier - kept selectable so editing the row doesn't wipe it. */}
                          {sd.segment && !(priceTiers || []).some(t => t.name === sd.segment) && (
                            <option value={sd.segment}>{sd.segment} (unrecognised)</option>
                          )}
                        </select>
                        <div className="relative w-28">
                          <input type="number" min="0" max="100" step="0.01" value={sd.percent}
                            onChange={e => {
                              const list = [...(formData.segmentDiscounts || [])];
                              list[idx] = { ...list[idx], percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) };
                              setFormData({ ...formData, segmentDiscounts: list });
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-2 pr-6 py-1.5 text-fg text-xs font-bold outline-none focus:border-brand" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/70 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, segmentDiscounts: (formData.segmentDiscounts || []).filter((_, i) => i !== idx) })}
                          className="text-danger text-sm">✕</button>
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
                        className="text-[11px] font-black text-brand-text hover:text-fg transition">+ Add break</button>
                    </div>
                    {(!formData.bulkBreaks || formData.bulkBreaks.length === 0) && (
                      <p className="text-[10px] text-fg/65 italic">No bulk breaks yet - e.g. "buy 10+, get 10% off".</p>
                    )}
                    {(formData.bulkBreaks || []).map((b, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-1.5">
                        <div className="flex items-center gap-1 w-1/2 sm:w-3/5 shrink-0">
                          <span className="text-[10px] text-fg/70 font-bold shrink-0">Qty ≥</span>
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
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/70 text-[10px] font-bold">%</span>
                        </div>
                        <button type="button"
                          onClick={() => setFormData({ ...formData, bulkBreaks: (formData.bulkBreaks || []).filter((_, i) => i !== idx) })}
                          className="text-danger text-sm">✕</button>
                      </div>
                    ))}
                  </div>

                      </div>
                    </details>
                  </section>
                </div>
              </div>

              <footer className="border-t border-white/10 bg-surface px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px] text-xs">
                  <p className="text-fg/80 font-semibold">{editorSummary}</p>
                  {editorIssues.length > 0 && (
                    <p className="text-warning mt-0.5" title={editorIssues.join('\n')}>
                      {editorIssues[0]}{editorIssues.length > 1 ? ` (+${editorIssues.length - 1} more)` : ''}
                    </p>
                  )}
                </div>
                {editingProduct && (
                  <button type="button" onClick={async () => { await deleteProduct(editingProduct._id); setEditorOpen(false); }} title="Delete product" aria-label="Delete product"
                    className="bg-red-500/10 text-danger font-bold py-2.5 px-3 rounded-xl hover:bg-red-500/20 transition border border-red-500/20"><Trash2 size={18} /></button>
                )}
                <button type="button" onClick={closeEditor} className="px-4 py-2.5 rounded-xl text-sm font-bold text-fg/80 hover:text-fg hover:bg-white/5">Cancel</button>
                <button type="submit" className="bg-brand hover:bg-brand-dark text-on-brand font-black py-2.5 px-6 rounded-xl uppercase tracking-wider text-sm shadow-lg">
                  {editingProduct ? 'Save changes' : 'Save product'}
                </button>
              </footer>
            </form>
          </div>
          )}
          </div>

          {/* ════════════ MODIFIER GROUPS MANAGEMENT - fb only ════════════ */}
          {BUSINESS_TYPE !== 'log' && <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6">
            <h3 className="text-xl font-bold mb-1 text-fg">Modifier Groups</h3>
            <p className="text-xs text-fg/70 mb-4">Required choices on a product (e.g. "Choose your milk"). Attach them to products in the form above.</p>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Existing groups */}
              <div className="flex-1 space-y-2">
                {modifierGroups.length === 0 ? (
                  <p className="text-sm text-fg/65 italic py-4">No modifier groups yet.</p>
                ) : modifierGroups.map(g => (
                  <div key={g._id} className="bg-page-bg border border-white/10 rounded-xl p-3 flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-fg text-sm">{g.name} {g.isRequired && <span className="text-[9px] bg-red-900/40 text-danger px-1.5 py-0.5 rounded uppercase ml-1">Required</span>}</p>
                      <p className="text-[11px] text-fg/70 mt-0.5">Pick {g.minSelect}{g.maxSelect > g.minSelect ? `-${g.maxSelect}` : ''} · {(g.options||[]).map(o => o.name + (o.price ? ` (+₱${o.price})` : '')).join(', ')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => editModifierGroup(g)} className="text-info hover:text-fg hover:bg-blue-600 text-xs font-bold px-2 py-1 bg-blue-900/30 rounded transition">Edit</button>
                      <button onClick={() => deleteModifierGroup(g._id)} className="text-danger hover:text-fg hover:bg-red-600 text-xs font-bold px-2 py-1 bg-red-900/30 rounded transition">Del</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Editor */}
              <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm font-black text-fg uppercase tracking-wider">{editingModifier ? 'Edit Group' : 'New Group'}</p>
                <input type="text" placeholder="Group name (e.g. Choose your milk)" value={modForm.name}
                  onChange={e => setModForm({ ...modForm, name: e.target.value })}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-accent placeholder-fg/70" />
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-fg/65 font-bold">
                    <input type="checkbox" className="accent-accent" checked={modForm.isRequired} onChange={e => setModForm({ ...modForm, isRequired: e.target.checked })} /> Required
                  </label>
                  <label className="flex items-center gap-1 text-xs text-fg/65 font-bold">Min
                    <input type="number" min="0" value={modForm.minSelect} onChange={e => setModForm({ ...modForm, minSelect: e.target.value })} className="w-12 bg-surface border border-white/10 rounded px-2 py-1 text-fg text-center" />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-fg/65 font-bold">Max
                    <input type="number" min="1" value={modForm.maxSelect} onChange={e => setModForm({ ...modForm, maxSelect: e.target.value })} className="w-12 bg-surface border border-white/10 rounded px-2 py-1 text-fg text-center" />
                  </label>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-fg/70 font-bold uppercase">Options</p>
                  {modForm.options.map((o, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <input type="text" placeholder="Option name" value={o.name}
                        onChange={e => { const opts=[...modForm.options]; opts[i]={...opts[i],name:e.target.value}; setModForm({...modForm,options:opts}); }}
                        className="flex-1 bg-surface border border-white/10 rounded px-2 py-1.5 text-fg text-xs outline-none focus:border-accent" />
                      <input type="number" placeholder="₱0" value={o.price}
                        onChange={e => { const opts=[...modForm.options]; opts[i]={...opts[i],price:e.target.value}; setModForm({...modForm,options:opts}); }}
                        className="w-16 bg-surface border border-white/10 rounded px-2 py-1.5 text-fg text-xs text-right outline-none focus:border-accent" />
                      <button onClick={() => setModForm({...modForm, options: modForm.options.filter((_,j)=>j!==i)})} className="text-danger px-1 font-bold">✕</button>
                    </div>
                  ))}
                  <button onClick={() => setModForm({...modForm, options:[...modForm.options,{name:'',price:'',recipe:[]}]})}
                    className="w-full py-1.5 bg-white/5 text-fg/75 rounded text-xs font-bold hover:bg-white/10 transition">+ Add option</button>
                </div>
                <div className="flex gap-2 pt-1">
                  {editingModifier && (
                    <button onClick={() => { setEditingModifier(null); setModForm({ name:'', isRequired:true, minSelect:1, maxSelect:1, options:[] }); }}
                      className="px-3 py-2 bg-white/5 text-fg/75 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
                  )}
                  <button onClick={saveModifierGroup} className="flex-1 py-2 bg-accent text-on-brand rounded-lg text-xs font-black uppercase tracking-wider hover:bg-opacity-90 transition">
                    {editingModifier ? 'Update Group' : 'Create Group'}
                  </button>
                </div>
              </div>
            </div>
          </div>}

          {/* ════════════ COMBOS / BUNDLES (PRODUCT PROMOS) ════════════ */}
          <div className="bg-surface border border-white/10 shadow-md rounded-xl p-4 sm:p-6">
            <h3 className="text-xl font-bold mb-1 text-fg">Product Promos &amp; Combos</h3>
            <p className="text-xs text-fg/70 mb-4">Fixed-price bundles of existing products (e.g. "Budget Meal: Americano + Pandesal = ₱99"). Sold as one line; stock is deducted per component.</p>
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Existing combos */}
              <div className="flex-1 space-y-2">
                {combos.length === 0 ? (
                  <p className="text-sm text-fg/65 italic py-4">No combos yet.</p>
                ) : combos.map(c => (
                  <div key={c._id} className="bg-page-bg border border-white/10 rounded-xl p-3 flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-fg text-sm">{c.name} <span className="text-brand-text font-black ml-1">₱{Number(c.price).toFixed(2)}</span></p>
                      <p className="text-[11px] text-fg/70 mt-0.5">{(c.items||[]).map(i => `${i.quantity>1?i.quantity+'× ':''}${i.name}${i.sizeName?` (${i.sizeName})`:''}`).join(' + ')}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => editCombo(c)} className="text-white hover:bg-blue-800 text-xs font-bold px-2 py-1 bg-blue-700 rounded transition">Edit</button>
                      <button onClick={() => deleteCombo(c._id)} className="text-white hover:bg-red-700 text-xs font-bold px-2 py-1 bg-red-600 rounded transition">Del</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Combo editor */}
              <div className="w-full lg:w-96 bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm font-black text-fg uppercase tracking-wider">{editingCombo ? 'Edit Combo' : 'New Combo'}</p>
                <input type="text" placeholder="Combo name" value={comboForm.name}
                  onChange={e => setComboForm({ ...comboForm, name: e.target.value })}
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-accent placeholder-fg/70" />
                <div className="flex gap-2">
                  <input type="number" placeholder="Price ₱" value={comboForm.price}
                    onChange={e => setComboForm({ ...comboForm, price: e.target.value })}
                    className="w-28 bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm font-black outline-none focus:border-accent" />
                  <input type="text" placeholder="Description (optional)" value={comboForm.description}
                    onChange={e => setComboForm({ ...comboForm, description: e.target.value })}
                    className="flex-1 min-w-0 bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-accent placeholder-fg/70" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-fg/70 font-bold uppercase">Components</p>
                  {comboForm.items.map((it, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <span className="flex-1 text-xs text-fg/80 bg-surface border border-white/10 rounded px-2 py-1.5 truncate">{it.quantity>1?it.quantity+'× ':''}{it.name}</span>
                      <input type="number" min="1" value={it.quantity}
                        onChange={e => { const items=[...comboForm.items]; items[i]={...items[i],quantity:e.target.value}; setComboForm({...comboForm,items}); }}
                        className="w-14 bg-surface border border-white/10 rounded px-2 py-1.5 text-fg text-xs text-center outline-none" />
                      <button onClick={() => setComboForm({...comboForm, items: comboForm.items.filter((_,j)=>j!==i)})} className="text-danger px-1 font-bold">✕</button>
                    </div>
                  ))}
                  <SearchSelect value="" onChange={e => {
                      if (!e.target.value) return;
                      const p = products.find(pr => pr._id === e.target.value);
                      if (p) setComboForm({...comboForm, items:[...comboForm.items, { productId: p._id, name: p.name, sizeName: '', quantity: 1 }]});
                    }}
                    className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-accent"
                    placeholder="+ Add component product - type to find"
                    options={products.map(p => ({ value: p._id, label: p.name }))} />
                </div>
                <div className="flex gap-2 pt-1">
                  {editingCombo && (
                    <button onClick={() => { setEditingCombo(null); setComboForm({ name:'', description:'', price:'', image:'', items:[] }); }}
                      className="px-3 py-2 bg-white/5 text-fg/75 rounded-lg text-xs font-bold hover:bg-white/10 transition">Cancel</button>
                  )}
                  <button onClick={saveCombo} className="flex-1 py-2 bg-accent text-on-brand rounded-lg text-xs font-black uppercase tracking-wider hover:bg-opacity-90 transition">
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
