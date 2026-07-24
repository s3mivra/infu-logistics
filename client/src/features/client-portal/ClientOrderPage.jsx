import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Package, ShoppingCart, Plus, Minus, X, LogOut, CheckCircle,
  AlertCircle, CreditCard, Loader2, ChevronLeft, RefreshCw, Barcode, Search
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5002';
const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Semivra').toUpperCase();
const socket = io(API_URL, { transports: ['websocket'], upgrade: false });

// ── helpers ───────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  Cash: 'Cash on Delivery',
  'E-Wallet': 'E-Wallet',
  'Bank Transfer': 'Bank Transfer',
  'Credit Card': 'Credit Card',
};

// Facebook page for payment-proof submission (logistics flow).
const FB_LINK = import.meta.env.VITE_FB_LINK || '';

// Client-selectable payment methods — mirrors the POS order tab, minus delivery partners.
const CLIENT_PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'];

// Map an order's status to a client-facing queue state for the portal sidebar.
// The first step after ordering asks the client to send payment proof on FB.
const STATUS_VIEW = (status) => {
  switch (status) {
    case 'Pending':
      return { label: 'Sent to logistics', tone: 'amber',
        msg: 'Please send your payment proof on our Facebook page so we can process your order.', needsProof: true };
    case 'Preparing':
      return { label: 'Preparing order', tone: 'blue', msg: 'Payment received - your order is being prepared.' };
    case 'Partially Fulfilled':
      return { label: 'Partially fulfilled', tone: 'blue', msg: 'Some items are ready; the rest will follow.' };
    case 'Out for Delivery':
      return { label: 'Out for delivery', tone: 'blue', msg: 'Your order is on the way.' };
    case 'Awaiting Pickup':
      return { label: 'Ready for pickup', tone: 'blue', msg: 'Your order is ready for pickup.' };
    case 'Delivered':
    case 'Picked Up':
    case 'Completed':
      return { label: 'Ready for pickup', tone: 'green', msg: 'Your order is ready for pickup.', canConfirm: true };
    case 'Cancelled':
      return { label: 'Cancelled', tone: 'red', msg: 'This order was cancelled.' };
    case 'Voided':
    case 'Refunded':
      return { label: status, tone: 'red', msg: `This order was ${String(status).toLowerCase()}.` };
    default:
      return { label: status || 'Processing', tone: 'gray', msg: '' };
  }
};
const TONE_CLS = {
  amber: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  blue:  'bg-blue-500/10 border-blue-500/30 text-blue-300',
  green: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  red:   'bg-red-500/10 border-red-500/30 text-red-300',
  gray:  'bg-white/5 border-white/10 text-white/50',
};

const ProductCard = memo(({ product, onAdd }) => {
  // Unorderable when staff 86'd it OR the linked stock is depleted (stockAvailable).
  const unavailable = product.isAvailable === false || product.stockAvailable === false;
  return (
  <div
    onClick={() => !unavailable && onAdd(product)}
    className={`bg-sidebar-bg rounded-2xl border p-3 transition-all duration-150 group relative
      ${unavailable
        ? 'border-white/5 opacity-50 cursor-not-allowed'
        : 'border-white/5 hover:border-brand/30 cursor-pointer active:scale-[0.97]'}`}
  >
    {/* Product image — only present when the "Product Images" setting is on
        (the server strips product.image for customers when disabled). */}
    {product.image && (
      <div className="w-full h-28 mb-2.5 rounded-xl overflow-hidden bg-page-bg/40 flex items-center justify-center">
        <img src={product.image} alt={product.name} loading="lazy" className="w-full h-full object-contain" />
      </div>
    )}
    <div className="flex items-start justify-between gap-2">
      <h3 className="font-bold text-white text-sm leading-snug">{product.name}</h3>
      <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${unavailable ? 'bg-white/5 border-white/10 text-white/40' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
        {unavailable ? 'Out of Stock' : 'In Stock'}
      </span>
    </div>
    {product.description && <p className="text-white/40 text-xs mt-1 line-clamp-2">{product.description}</p>}
    <div className="flex items-center justify-between mt-3">
      {/* Logistics: price is hidden - staff confirms the customer's rate via Messenger. */}
      <p className="text-white/40 font-black text-[11px] uppercase tracking-wider">Inquire price</p>
      {!unavailable && (
        <button
          onClick={e => { e.stopPropagation(); onAdd(product); }}
          className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center shadow-lg shadow-brand/40 hover:bg-brand-dark transition active:scale-90"
          aria-label={`Add ${product.name}`}
        >
          <Plus size={16} className="text-white" strokeWidth={2.5} />
        </button>
      )}
    </div>
  </div>
  );
});
ProductCard.displayName = 'ProductCard';

// ── main component ────────────────────────────────────────────────────────────

export default function ClientOrderPage() {
  const navigate = useNavigate();

  // Auth
  const [clientInfo, setClientInfo] = useState(null);
  const [token, setToken] = useState('');

  // Products
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [productSearch, setProductSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Cart
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  // Order state
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successOrder, setSuccessOrder] = useState(null);

  // Order status queue (portal sidebar)
  const [myOrders, setMyOrders] = useState([]);
  const [queueOpen, setQueueOpen] = useState(false);

  // On mount: verify session
  useEffect(() => {
    const storedToken = sessionStorage.getItem('client_token');
    const storedInfo = sessionStorage.getItem('client_info');
    if (!storedToken || !storedInfo) {
      navigate('/client/portal', { replace: true });
      return;
    }
    // Basic expiry check
    try {
      const payload = JSON.parse(atob(storedToken.split('.')[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        sessionStorage.removeItem('client_token');
        sessionStorage.removeItem('client_info');
        navigate('/client/portal', { replace: true });
        return;
      }
    } catch { /* malformed token - redirect */ navigate('/client/portal', { replace: true }); return; }

    const info = JSON.parse(storedInfo);
    setToken(storedToken);
    setClientInfo(info);
    // Only honour the preset if it's a client-selectable method (no delivery partners).
    setPaymentMethod(CLIENT_PAYMENT_METHODS.includes(info.paymentMethod) ? info.paymentMethod : 'Cash');
  }, [navigate]);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const [prodRes, catRes] = await Promise.all([
        fetch(`${API_URL}/api/products`),
        fetch(`${API_URL}/api/categories`),
      ]);
      const prodData = await prodRes.json();
      const catData = await catRes.json();
      setProducts((prodData.products || []).filter(p => !p.isArchived));
      setCategories(catData.categories || []);
    } catch { /* silently retry on socket event */ }
    finally { setLoadingProducts(false); }
  }, []);

  useEffect(() => { if (token) fetchProducts(); }, [token, fetchProducts]);

  // Real-time menu refresh
  useEffect(() => {
    socket.on('menuUpdated', fetchProducts);
    return () => socket.off('menuUpdated', fetchProducts);
  }, [fetchProducts]);

  // Client's own orders → status queue sidebar
  const fetchMyOrders = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/client/orders`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setMyOrders(data.orders || []);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { if (token) fetchMyOrders(); }, [token, fetchMyOrders]);

  const confirmReceived = useCallback(async (orderId) => {
    try {
      const res = await fetch(`${API_URL}/api/client/orders/${orderId}/received`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) fetchMyOrders();
      else alert(data.error || 'Could not confirm.');
    } catch { alert('Network error.'); }
  }, [token, fetchMyOrders]);

  // Cancel a still-pending (unpaid) order from the portal.
  const cancelOrder = useCallback(async (orderId) => {
    if (!window.confirm('Cancel this order? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_URL}/api/client/orders/${orderId}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) fetchMyOrders();
      else alert(data.error || 'Could not cancel.');
    } catch { alert('Network error.'); }
  }, [token, fetchMyOrders]);

  // Live updates: refresh the queue whenever any order changes, + gentle poll.
  useEffect(() => {
    if (!token) return;
    const refresh = () => fetchMyOrders();
    socket.on('orderUpdated', refresh);
    socket.on('erpUpdated', refresh);
    const iv = setInterval(refresh, 30000);
    return () => { socket.off('orderUpdated', refresh); socket.off('erpUpdated', refresh); clearInterval(iv); };
  }, [token, fetchMyOrders]);

  // Active orders still in the pipeline (exclude finished/cancelled from the badge count).
  const activeOrders = useMemo(
    () => myOrders.filter(o => !['Completed', 'Delivered', 'Picked Up', 'Cancelled', 'Voided', 'Refunded'].includes(o.status)),
    [myOrders]
  );

  // Cart helpers
  const addToCart = useCallback((product) => {
    if (product.isAvailable === false || product.stockAvailable === false) return;
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === String(product._id));
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [...prev, {
        productId: String(product._id),
        name: product.name,
        productCode: product.productCode,
        price: product.basePrice,
        // effectiveDiscountPercent reflects the per-client override (when applicable);
        // falls back to the product default if there's no override.
        discountPercent: (product.effectiveDiscountPercent ?? product.discountPercent) || 0,
        quantity: 1,
        selectedAddOns: [],
      }];
    });
  }, []);

  const changeQty = useCallback((productId, delta) => {
    setCart(prev => {
      const updated = prev.map(i => i.productId === productId ? { ...i, quantity: i.quantity + delta } : i)
        .filter(i => i.quantity > 0);
      return updated;
    });
  }, []);

  const netPrice = (i) => (i.price || 0) * (1 - (i.discountPercent || 0) / 100);
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + netPrice(i) * i.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  const visibleProducts = useMemo(() => {
    let active = products.filter(p => !p.isArchived);
    if (activeCategory !== 'All') active = active.filter(p => p.category === activeCategory);
    const q = productSearch.trim().toLowerCase();
    if (q) active = active.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.productCode?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
    return active;
  }, [products, activeCategory, productSearch]);

  const handleLogout = () => {
    sessionStorage.removeItem('client_token');
    sessionStorage.removeItem('client_info');
    navigate('/client/portal', { replace: true });
  };

  const handleSubmitOrder = async () => {
    if (!cart.length || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: cart,
          table: 'Client Order',
          customerName: clientInfo?.name || clientInfo?.username || 'Client',
          paymentMethod,
          orderNotes: orderNotes.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessOrder(data.order);
        setCart([]);
        setCartOpen(false);
        setOrderNotes('');
        fetchMyOrders();
      } else {
        alert(data.error || 'Order failed. Please try again.');
      }
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (successOrder) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
          <CheckCircle size={32} className="text-emerald-400" />
        </div>
        <h2 className="text-2xl font-black text-white mb-1">Sent to Logistics!</h2>
        <p className="text-white/50 text-sm mb-3">Your order has been received.</p>
        {/* POS reference - show this to staff so they can pull up the same order. */}
        <div className="bg-page-bg border border-brand/30 rounded-2xl px-4 py-3 mb-3 w-full max-w-sm">
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-black mb-1">Order Reference (show to staff)</p>
          <p className="text-brand font-mono font-black text-lg tracking-wider">{successOrder.orderNumber}</p>
          {successOrder.billingNumber && (
            <p className="text-white/50 text-[11px] font-mono mt-0.5">Billing: <span className="text-white/80 font-bold">{successOrder.billingNumber}</span></p>
          )}
        </div>

        {/* First queue state: ask for payment proof */}
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-2xl px-4 py-3 w-full max-w-sm mb-5 text-left">
          <p className="text-xs font-black uppercase tracking-wider mb-1">Next step - Payment proof</p>
          <p className="text-[12px] leading-snug opacity-90">Please send your payment proof on our Facebook page so we can start preparing your order.</p>
          {FB_LINK && (
            <a href={FB_LINK} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 bg-white/10 hover:bg-white/20 transition rounded-lg px-3 py-1.5 text-[11px] font-black text-white">
              Send payment proof →
            </a>
          )}
        </div>
        <div className="bg-sidebar-bg border border-white/10 rounded-2xl p-5 w-full max-w-sm mb-6 text-left space-y-2">
          {successOrder.items?.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <div>
                <span className="text-white font-bold">{item.name}</span>
              </div>
              <span className="text-white/70 font-mono">×{item.quantity}</span>
            </div>
          ))}
          <div className="border-t border-white/10 pt-2 text-[11px] text-white/40 italic">
            Final total will be confirmed by our team via Messenger.
          </div>
        </div>
        <button
          onClick={() => setSuccessOrder(null)}
          className="bg-brand hover:bg-brand-dark text-white font-black px-8 py-3 rounded-xl transition uppercase tracking-widest text-sm"
        >
          Place Another Order
        </button>
      </div>
    );
  }

  // ── Main ordering UI ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-page-bg flex flex-col text-white">

      {/* Header */}
      <header className="sticky top-0 z-30 bg-sidebar-bg border-b border-white/5 px-4 h-14 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-brand" />
          <span className="font-black text-white text-sm uppercase tracking-widest">{BIZ_NAME}</span>
        </div>
        <div className="flex items-center gap-3">
          {clientInfo && (
            <span className="text-white/40 text-xs hidden sm:block">
              {clientInfo.name || clientInfo.username}
            </span>
          )}
          <button
            onClick={() => { setQueueOpen(true); fetchMyOrders(); }}
            className="relative p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition"
            aria-label="My orders"
            title="My orders"
          >
            <Package size={16} />
            {activeOrders.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[9px] font-black flex items-center justify-center">
                {activeOrders.length}
              </span>
            )}
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ── Order status queue (sidebar drawer) ───────────────────────────────── */}
      {queueOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setQueueOpen(false)} />
          <aside className="w-full max-w-sm h-full bg-sidebar-bg border-l border-white/10 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-4 h-14 border-b border-white/5 flex-shrink-0">
              <h2 className="font-black text-white text-sm uppercase tracking-widest flex items-center gap-2">
                <Package size={16} className="text-brand" /> My Orders
              </h2>
              <button onClick={() => setQueueOpen(false)} className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {myOrders.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <Package size={36} className="text-white/10 mb-3" />
                  <p className="text-white/40 text-sm font-bold">No orders yet.</p>
                </div>
              ) : myOrders.map(o => {
                const v = STATUS_VIEW(o.status);
                return (
                  <div key={o._id} className="bg-page-bg border border-white/8 rounded-2xl p-4">
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="font-mono text-xs text-brand font-black tracking-wider">{o.orderNumber}</span>
                        {o.billingNumber && (
                          <span className="font-mono text-[10px] text-white/40">Billing: {o.billingNumber}</span>
                        )}
                      </div>
                      <span className="text-white/30 text-[10px] font-black uppercase tracking-wider shrink-0">Inquire total</span>
                    </div>
                    <div className={`rounded-xl border px-3 py-2 ${TONE_CLS[v.tone] || TONE_CLS.gray}`}>
                      <p className="text-xs font-black uppercase tracking-wider">{v.label}</p>
                      {v.msg && <p className="text-[11px] mt-1 leading-snug opacity-90">{v.msg}</p>}
                      {v.needsProof && FB_LINK && (
                        <a href={FB_LINK} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-2 bg-white/10 hover:bg-white/20 transition rounded-lg px-3 py-1.5 text-[11px] font-black text-white">
                          Send payment proof →
                        </a>
                      )}
                      {v.canConfirm && (
                        o.clientReceived ? (
                          <p className="mt-2 text-[11px] font-black inline-flex items-center gap-1.5"><CheckCircle size={13} /> Received - thank you!</p>
                        ) : (
                          <button onClick={() => confirmReceived(o._id)}
                            className="mt-2 w-full bg-emerald-500 hover:bg-emerald-400 transition rounded-lg px-3 py-2 text-[11px] font-black text-white uppercase tracking-wider">
                            I received my order
                          </button>
                        )
                      )}
                    </div>
                    {o.status === 'Pending' && (
                      <button onClick={() => cancelOrder(o._id)}
                        className="mt-2 w-full border border-red-500/30 text-red-300 hover:bg-red-500/10 transition rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wider">
                        Cancel order
                      </button>
                    )}
                    <div className="mt-2 text-[10px] text-white/30">
                      {(o.items || []).reduce((s, i) => s + (i.quantity || 0), 0)} item(s) · {new Date(o.createdAt).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      {/* Product search */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            placeholder="Search products by name or code…"
            className="w-full bg-white/5 border border-white/10 focus:border-brand rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder-white/30 outline-none transition"
          />
          {productSearch && (
            <button onClick={() => setProductSearch('')} aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide border-b border-white/5 flex-shrink-0">
        {['All', ...categories.map(c => c.name)].map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition flex-shrink-0
              ${activeCategory === cat ? 'bg-brand text-white' : 'bg-white/5 text-white/50 hover:text-white'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {loadingProducts ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-brand" />
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Package size={40} className="text-white/10 mb-4" />
            <p className="text-white/40 font-bold text-sm">
              {productSearch.trim() ? `No products match "${productSearch.trim()}".` : 'No products available.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleProducts.map(p => (
              <ProductCard key={p._id} product={p} onAdd={addToCart} />
            ))}
          </div>
        )}
      </div>

      {/* Cart FAB */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <button
            onClick={() => setCartOpen(true)}
            className="flex items-center gap-3 bg-brand hover:bg-brand-dark text-white font-black px-6 py-3.5 rounded-2xl shadow-2xl shadow-brand/40 transition active:scale-95"
          >
            <ShoppingCart size={18} />
            <span>{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page-bg">

          {/* Drawer header */}
          <div className="flex items-center gap-3 px-4 h-14 bg-sidebar-bg border-b border-white/5 flex-shrink-0">
            <button
              onClick={() => setCartOpen(false)}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition"
              aria-label="Back"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1">
              <h2 className="font-black text-white text-sm uppercase tracking-widest">Your Order</h2>
              <p className="text-white/40 text-xs">{clientInfo?.name || clientInfo?.username}</p>
            </div>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.map(item => (
              <div key={item.productId} className="flex items-center gap-3 bg-sidebar-bg border border-white/5 rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0">
                  {item.productCode && (
                    <p className="text-white/30 text-[10px] font-mono uppercase tracking-widest">{item.productCode}</p>
                  )}
                  <p className="font-bold text-white text-sm truncate">{item.name}</p>
                  <p className="text-white/30 text-[10px] italic">Price confirmed via Messenger</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => changeQty(item.productId, -1)}
                    className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                    aria-label="Decrease"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="text-white font-black text-sm w-6 text-center">{item.quantity}</span>
                  <button
                    onClick={() => changeQty(item.productId, 1)}
                    className="w-8 h-8 rounded-lg bg-brand/20 hover:bg-brand/30 text-brand flex items-center justify-center transition"
                    aria-label="Increase"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <p className="text-white/30 font-black text-[10px] w-20 text-right flex-shrink-0 uppercase tracking-wider">
                  ×{item.quantity}
                </p>
              </div>
            ))}

            {/* Payment method (pre-set, can be changed) */}
            <div className="bg-sidebar-bg border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-white/40 uppercase tracking-widest">
                <CreditCard size={13} />
                Payment Method
              </div>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full bg-white/5 border border-white/10 focus:border-brand text-white px-3 py-2.5 rounded-xl outline-none text-sm font-medium"
              >
                {/* Mirrors the POS order-tab methods, minus delivery partners. */}
                <optgroup className="bg-[#1a1a1a]" label="In-Store Payments">
                  <option className="bg-[#1a1a1a]" value="Cash">Cash</option>
                  <option className="bg-[#1a1a1a]" value="Bank Transfer">Bank Transfer</option>
                </optgroup>
                <optgroup className="bg-[#1a1a1a]" label="E-Wallets">
                  <option className="bg-[#1a1a1a]" value="GCash">GCash</option>
                  <option className="bg-[#1a1a1a]" value="Maya">Maya</option>
                  <option className="bg-[#1a1a1a]" value="Maribank">Maribank / Seabank</option>
                  <option className="bg-[#1a1a1a]" value="Other E-Wallet">Other E-Wallet</option>
                </optgroup>
              </select>
              {clientInfo?.paymentMethod && clientInfo.paymentMethod !== paymentMethod && (
                <p className="text-xs text-white/30">
                  Default: {PAYMENT_LABELS[clientInfo.paymentMethod] || clientInfo.paymentMethod}
                  {' '}
                  <button
                    onClick={() => setPaymentMethod(clientInfo.paymentMethod)}
                    className="text-brand underline"
                  >
                    Reset
                  </button>
                </p>
              )}
            </div>

            {/* Order notes */}
            <div className="bg-sidebar-bg border border-white/5 rounded-xl p-4">
              <p className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2">Order Notes (optional)</p>
              <textarea
                value={orderNotes}
                onChange={e => setOrderNotes(e.target.value)}
                placeholder="Special instructions, delivery notes…"
                rows={2}
                className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/20 px-3 py-2 rounded-xl outline-none transition text-sm resize-none"
              />
            </div>
          </div>

          {/* Drawer footer */}
          <div className="p-4 bg-sidebar-bg border-t border-white/5 flex-shrink-0 space-y-2">
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2.5 text-[11px] leading-snug">
              <p className="font-black uppercase tracking-wider mb-0.5">Pricing & Payment</p>
              <p className="opacity-90">Final total will be confirmed by our team. After placing the order, please contact us on Messenger for payment.</p>
              {FB_LINK && (
                <a href={FB_LINK} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-1.5 bg-white/10 hover:bg-white/20 transition rounded-lg px-3 py-1.5 text-[11px] font-black text-white">
                  Contact on Messenger →
                </a>
              )}
            </div>
            <button
              onClick={handleSubmitOrder}
              disabled={submitting}
              className="w-full bg-brand hover:bg-brand-dark text-white font-black py-4 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {submitting ? 'Placing Order…' : 'Place Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
