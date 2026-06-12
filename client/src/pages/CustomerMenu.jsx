import React, { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { io } from 'socket.io-client';
import { Coffee, ShoppingCart, Plus, Minus, X, Clock, CheckCircle, Package, AlertCircle, Users, Lock, RefreshCw, ChevronLeft } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5002';
const socket = io(API_URL, { transports: ['websocket'], upgrade: false });

const playCustomerDing = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.log('Audio blocked');
  }
};

const MenuItemCard = memo(({ product, onAdd }) => (
  <div
    onClick={() => onAdd(product)}
    className="bg-sidebar-bg rounded-2xl overflow-hidden border border-white/5 hover:border-brand/30 cursor-pointer active:scale-[0.97] transition-all duration-150 group"
  >
    <div className="aspect-[4/3] relative overflow-hidden bg-black/30 flex items-center justify-center p-2">
      {product.image
        ? <img src={product.image} alt={product.name} loading="lazy" className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500 drop-shadow-md" />
        : <div className="w-full h-full flex items-center justify-center"><Coffee size={32} className="text-white/10" /></div>
      }
      <button
        onClick={e => { e.stopPropagation(); onAdd(product); }}
        className="absolute bottom-2 right-2 w-9 h-9 bg-brand rounded-xl flex items-center justify-center shadow-lg shadow-brand/40 hover:bg-brand-dark transition active:scale-90"
        aria-label={`Add ${product.name}`}
      >
        <Plus size={18} className="text-white" strokeWidth={2.5} />
      </button>
    </div>
    <div className="p-3">
      <h3 className="font-bold text-white text-sm leading-tight truncate">{product.name}</h3>
      {product.description && <p className="text-white/40 text-xs mt-0.5 line-clamp-1">{product.description}</p>}
      <p className="text-brand font-black text-sm mt-2">
        ₱{(product.basePrice || 0).toFixed(2)}
        {product.sizes?.length > 0 && <span className="text-white/30 font-normal text-xs ml-1">& up</span>}
      </p>
    </div>
  </div>
));
MenuItemCard.displayName = 'MenuItemCard';

// A product is shown to customers only when both flags are satisfied:
//  • isAvailable !== false  — staff haven't manually 86'd it
//  • stockAvailable !== false — all recipe ingredients are in stock
const isProductVisible = (p) => p.isAvailable !== false && p.stockAvailable !== false;

const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Kasa Lokal').toUpperCase();

export default function CustomerMenu() {
  // --- UI FLOW STATE MACHINE ---
  const [flowState, setFlowState] = useState('landing'); // 'landing' -> 'name_input' -> 'menu' -> 'status'
  const [selectedAddOns, setSelectedAddOns] = useState([]);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]); // <-- THE FIX: Add this state
  const [combos, setCombos] = useState([]); // active combos / promos
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');

  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);

  // --- SECURITY & SESSION STATE ---
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [tableNum, setTableNum] = useState(null);
  const [successMessage, setSuccessMessage] = useState(false);
  const [lockedOrder, setLockedOrder] = useState(null);

  const [isVibrating, setIsVibrating] = useState(false);
  const vibrationInterval = useRef(null);
  const [isFinished, setIsFinished] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const wakeLockRef = useRef(null);

  // --- CART DRAWER STATE ---
  const [cartOpen, setCartOpen] = useState(false);

  // Lock body scroll when any overlay is open (prevents Android WebView scroll-behind bug)
  useEffect(() => {
    document.body.style.overflow = (selectedProduct || cartOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [selectedProduct, cartOpen]);

  const requestWakeLock = async () =>{
    try{
      if ('wakelock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch (err){ console.log('Wake Lock error:', err); }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current !== null) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  // --- 1. INITIALIZATION & PRELOAD ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');

    // If there is no secure session token in the URL, block them instantly.
    if (!session) {
      setIsAuthorized(false);
      setIsCheckingSession(false);
      return;
    }

    setSessionToken(session);

    // PRELOAD MENU DATA SILENTLY SO THERE IS NO LOADING SCREEN
    fetchProducts();

    const validateSessionAndCheckMemory = async () => {
      try {
        // --- FIX: CHECK LOCAL MEMORY FIRST ---
        // If the customer has an active order cooking, ALWAYS let them in to see it,
        // even if the session link technically expired in the background.
        const savedOrderId = localStorage.getItem('semivra_active_order');
        if (savedOrderId) {
          const orderRes = await fetch(`${API_URL}/api/orders/${savedOrderId}`);
          if (orderRes.ok) {
            const orderData = await orderRes.json();

            if (orderData.status !== 'Cancelled' && orderData.status !== 'Voided' && !localStorage.getItem(`received_${savedOrderId}`)) {
              setLockedOrder(orderData);
              setTableNum(orderData.table); // Restore the table number for WebSockets
              setFlowState('status');
              setIsAuthorized(true); // Bypass the link expiration check!
              setIsCheckingSession(false);
              return; // Stop here, do not check the heartbeat.
            } else {
              localStorage.removeItem('semivra_active_order');
            }
          }
        }

        // --- IF NO ACTIVE ORDER, CHECK THE SESSION NORMALLY ---
        const heartbeatRes = await fetch(`${API_URL}/api/sessions/${session}/heartbeat`, { method: 'POST' });
        const heartbeatData = await heartbeatRes.json();

        if (heartbeatData.success) {
          setIsAuthorized(true);
          setTableNum(heartbeatData.table);
        } else {
          setIsAuthorized(false);
        }
      } catch (err) {
        setIsAuthorized(false);
      }
      setIsCheckingSession(false);
    };

    validateSessionAndCheckMemory();
  }, []);

// --- DYNAMIC INACTIVITY TRACKER (20 mins / Infinite / 15 mins) ---
  useEffect(() => {
    if (!isAuthorized || !sessionToken) return;

    let inactivityTimer;
    let heartbeatInterval;

    const resetInactivity = () => {
      clearTimeout(inactivityTimer);

      // RULE 1: If there is an active order (Pending, Preparing, Ready), NEVER expire the link.
      if (lockedOrder && ['Pending', 'Preparing', 'Ready'].includes(lockedOrder.status)) {
         return; // Skip setting the expiration timer entirely. Let them wait forever.
      }

      // RULE 2: If they already finished an order, give them 15 mins to order dessert.
      // RULE 3: If they are just browsing initially, give them 20 mins.
      const timeoutMinutes = isFinished ? 15 : 20;

      inactivityTimer = setTimeout(async () => {
        // Time is up! Destroy the link securely in the backend.
        await fetch(`${API_URL}/api/sessions/${sessionToken}/close`, { method: 'POST' });
        setIsAuthorized(false);
      }, timeoutMinutes * 60 * 1000);
    };

    // Send a silent heartbeat to the server every 2 minutes so the backend knows they are still online
    heartbeatInterval = setInterval(async () => {
      await fetch(`${API_URL}/api/sessions/${sessionToken}/heartbeat`, { method: 'POST' });
    }, 2 * 60 * 1000);

    // Listen to user touches/scrolls to reset the timer
    window.addEventListener('touchstart', resetInactivity);
    window.addEventListener('click', resetInactivity);
    window.addEventListener('scroll', resetInactivity);
    resetInactivity(); // Start timer immediately

    return () => {
      clearTimeout(inactivityTimer);
      clearInterval(heartbeatInterval);
      window.removeEventListener('touchstart', resetInactivity);
      window.removeEventListener('click', resetInactivity);
      window.removeEventListener('scroll', resetInactivity);
    };
  }, [isAuthorized, sessionToken, lockedOrder, isFinished]);

  // --- 2. WEBSOCKET LISTENERS ---
  useEffect(() => {
    if (!tableNum) return;

    const handleOrderUpdated = (updatedOrder) => {
      if (updatedOrder.table === tableNum) {
        if (['Preparing', 'Ready', 'Completed'].includes(updatedOrder.status)) {
          if (!localStorage.getItem(`received_${updatedOrder._id}`)) {
            setLockedOrder(updatedOrder);
            setFlowState('status');
          }
        } else if (['Cancelled', 'Voided'].includes(updatedOrder.status)) {
          setLockedOrder(null);
          localStorage.removeItem('semivra_active_order');
          setFlowState('landing');
        }
      }
    };

    const handleArchive = () => {
      setLockedOrder(null);
      setCart([]);
      localStorage.removeItem('semivra_active_order');
      setFlowState('landing');
    };

    socket.on('menuUpdated', fetchProducts);
    socket.on('orderUpdated', handleOrderUpdated);
    socket.on('ordersArchived', handleArchive);

    return () => {
      socket.off('menuUpdated', fetchProducts);
      socket.off('orderUpdated', handleOrderUpdated);
      socket.off('ordersArchived', handleArchive);
    };
  }, [tableNum]);

  // --- 3. HARDWARE ALERTS ---
  useEffect(() => {
    if (lockedOrder?.status === 'Preparing') {
      playCustomerDing();
      setIsVibrating(false);
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      requestWakeLock();
    } else if (lockedOrder?.status === 'Ready' || lockedOrder?.status === 'Completed') {
      playCustomerDing();

      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function(registration) {
          registration.showNotification('Your Order is Ready! ☕', {
            body: 'Please collect your order at the counter.',
            icon: '/logo.png',
            vibrate: [1000, 500, 1000, 500, 2000],
            tag: 'order-ready',
            requireInteraction: true
          });
        });
      }

      if (!isVibrating) {
        setIsVibrating(true);
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
        vibrationInterval.current = setInterval(() => {
          if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
          playCustomerDing();
        }, 3000);
      }
    } else {
      setIsVibrating(false);
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      releaseWakeLock();
    }

    return () => {
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      releaseWakeLock();
    };
  }, [lockedOrder?.status]);

  // --- BURN AFTER RECEIVING ---
  const handleReceived = async () => {
    setIsVibrating(false);
    if (vibrationInterval.current) clearInterval(vibrationInterval.current);
    releaseWakeLock();

    if (lockedOrder) {
      localStorage.setItem(`received_${lockedOrder._id}`, 'true');
    }

    localStorage.removeItem('semivra_active_order');
    localStorage.removeItem('semivra_order_time');

    // PERMANENTLY DESTROY THE LINK
    await fetch(`${API_URL}/api/sessions/${sessionToken}/close`, { method: 'POST' });

    setIsFinished(true);
    setLockedOrder(null);
    setCart([]);
  };

  const fetchProducts = async () => {
    try {
      // Fetch Products
      const res = await fetch(`${API_URL}/api/products?t=${new Date().getTime()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setProducts(data.products);

      // FIX: Fetch Categories so the dynamic Kitchen/Bar routing knows where to send items!
      const catRes = await fetch(`${API_URL}/api/categories?t=${new Date().getTime()}`, { cache: 'no-store' });
      const catData = await catRes.json();
      if (catData.success) setCategories(catData.categories);

      // Combos / promos (active only)
      const cbRes = await fetch(`${API_URL}/api/combos?t=${new Date().getTime()}`, { cache: 'no-store' });
      const cbData = await cbRes.json();
      if (cbData.success) setCombos(cbData.combos || []);

    } catch (err) {
      console.error("Failed to fetch menu data");
    }
  };

  // Add a combo to the cart as one line carrying its component products.
  const addComboToCart = (combo) => {
    setCart(prev => {
      const id = `combo-${combo._id}`;
      const existing = prev.find(i => i.cartItemId === id);
      if (existing) return prev.map(i => i.cartItemId === id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, {
        cartItemId: id, productId: combo._id, name: combo.name, price: combo.price, quantity: 1,
        department: 'Kitchen', selectedAddOns: [], isCombo: true,
        comboItems: (combo.items || []).map(it => ({ productId: it.productId, name: it.name, sizeName: it.sizeName || '', quantity: it.quantity || 1 })),
      }];
    });
  };

  const handleProductClick = (product) => {
    setSelectedAddOns([]); // Reset add-ons on new product click
    if ((product.sizes && product.sizes.length > 0) || (product.addOns && product.addOns.length > 0)) {
      setSelectedProduct(product);
      setSelectedSize({ name: product.baseSize || 'Regular', price: Number(product.basePrice || 0) });
    } else {
      addToCart(product, null, []);
    }
  };

  const toggleAddOn = (addOn) => {
    setSelectedAddOns(prev =>
      prev.some(a => a.name === addOn.name) ? prev.filter(a => a.name !== addOn.name) : [...prev, addOn]
    );
  };

  const addToCart = (product, size, addOns) => {
    const price = size ? size.price : (product.basePrice || 0);
    const sizeName = size ? size.name : 'Regular';
    // Create a unique ID so items with different add-ons don't stack into the same cart row
    const addOnNames = addOns.map(a => a.name).sort().join(',');
    const cartItemId = `${product._id}-${sizeName}-${addOnNames}`;

    const categoryObject = categories.find(c => c.name === product.category);
    const dept = categoryObject ? (categoryObject.department || 'Kitchen') : 'Kitchen';

    setCart(prev => {
      const existing = prev.find(item => item.cartItemId === cartItemId);
      if (existing) return prev.map(item => item.cartItemId === cartItemId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { cartItemId, productId: product._id, name: size ? `${product.name} (${sizeName})` : product.name, price, quantity: 1, department: dept, itemStatus: 'Received', selectedAddOns: addOns }];
    });
    setSelectedProduct(null); setSelectedSize(null); setSelectedAddOns([]);
  };

  // --- CART MATH & LOGIC ---
  const updateQuantity = (cartItemId, change) => {
    setCart(prev => {
      // First, update the math
      const updatedCart = prev.map(item => {
        if (item.cartItemId === cartItemId) {
          return { ...item, quantity: item.quantity + change };
        }
        return item;
      });

      // Then, filter out any items that dropped to 0 (This makes the Minus button remove the item)
      return updatedCart.filter(item => item.quantity > 0);
    });
  };

  const removeFromCart = (cartItemId) => {
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  // UPDATE TOTAL CALCULATION
  const total = cart.reduce((sum, item) => {
    const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + a.price, 0);
    return sum + ((item.price + addOnTotal) * item.quantity);
  }, 0);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted' && 'serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js');
      }
      return permission === 'granted';
    } catch (error) { return false; }
  };

  const confirmOrder = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const idempotencyKey = `${sessionToken}-${Date.now()}`;
    try {
      const res = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({
          items: cart,
          discountPercent: 0,
          isVatExempt: false,
          table: tableNum,
          customerName: customerName.trim(),
          sessionId: sessionToken,
          orderNotes: orderNotes.trim(),
        })
      });

      const data = await res.json();

      if (data.success) {
        setCart([]);
        setSuccessMessage(true);
        setTimeout(() => setSuccessMessage(false), 5000);

        localStorage.setItem('semivra_active_order', data.order._id);
        localStorage.setItem('semivra_order_time', Date.now().toString());
        setLockedOrder(data.order);
        setFlowState('status');

        requestNotificationPermission();
      } else {
        // Kitchen closed (403) or validation error — tell the customer and let them retry.
        alert(data.error || 'Sorry, we could not place your order right now. Please ask our staff at the counter.');
        setIsSubmitting(false);
      }
    } catch (error) {
      console.error("Order failed", error);
      alert('Network problem — your order was not sent. Please try again or ask our staff.');
      setIsSubmitting(false);
    }
  };

  // Only show products that are manually enabled AND have all recipe ingredients in stock
  const visibleProducts = useMemo(() => products.filter(isProductVisible), [products]);

  const allCategories = useMemo(() => ['All', ...new Set(visibleProducts.map(p => p.category))], [visibleProducts]);
  const displayedCategories = useMemo(() => activeCategory === 'All' ? allCategories.filter(c => c !== 'All') : [activeCategory], [activeCategory, allCategories]);

  const modalSizes = selectedProduct ? [{ name: selectedProduct.baseSize || 'Regular', price: Number(selectedProduct.basePrice || 0) }, ...(selectedProduct.sizes || [])] : [];
  const groupedSizes = modalSizes.reduce((acc, size) => {
    const lowerName = size.name.toLowerCase();
    if (lowerName.includes('hot')) {
      if (!acc.Hot) acc.Hot = []; acc.Hot.push({ ...size, displayName: size.name.replace(/hot\s*-?\s*/i, '').trim() });
    } else if (lowerName.includes('iced') || lowerName.includes('cold')) {
      if (!acc.Iced) acc.Iced = []; acc.Iced.push({ ...size, displayName: size.name.replace(/(iced|cold)\s*-?\s*/i, '').trim() });
    } else {
      if (!acc.Standard) acc.Standard = []; acc.Standard.push({ ...size, displayName: size.name });
    }
    return acc;
  }, {});

  // ==========================================
  //                RENDER VIEWS
  // ==========================================

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-2xl bg-brand/20 border border-brand/20 flex items-center justify-center mb-8">
          <Coffee size={28} className="text-brand" />
        </div>
        <div className="w-10 h-10 border-2 border-brand border-t-transparent rounded-full animate-spin mb-6" />
        <p className="text-brand/60 text-xs font-bold tracking-widest uppercase animate-pulse">Securing Session…</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-sidebar-bg border border-red-500/20 p-10 rounded-3xl max-w-sm w-full animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-5">
            <AlertCircle size={28} className="text-red-400" />
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-widest mb-3">Session Expired</h1>
          <p className="text-white/40 text-sm leading-relaxed">This ordering link has expired. Please ask staff to generate a new QR code for your table.</p>
        </div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-6">
        <div className="bg-sidebar-bg border border-brand/20 p-10 rounded-3xl max-w-sm w-full text-center animate-fade-in">
          <div className="w-20 h-20 rounded-full bg-brand/20 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={36} className="text-brand" />
          </div>
          <h2 className="text-3xl font-black text-white mb-3 uppercase tracking-widest">Thank You!</h2>
          <p className="text-white/50 font-medium mb-8">We hope you enjoy your order. Come back soon!</p>
          <div className="border-t border-white/5 pt-6">
            <p className="text-white/20 text-xs uppercase font-bold tracking-widest">You may now close this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (lockedOrder || flowState === 'status') {
    return (
      <div className={`min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center transition-colors duration-700 ${
        lockedOrder?.status === 'Ready' || lockedOrder?.status === 'Completed' ? 'bg-emerald-900' : 'bg-page-bg'
      }`}>
        <div className="bg-sidebar-bg p-8 rounded-3xl border border-white/10 shadow-2xl max-w-sm w-full relative overflow-hidden animate-fade-in">
          {(lockedOrder?.status === 'Pending' || lockedOrder?.status === 'Preparing') && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-72 h-72 border border-brand/10 rounded-full animate-ping" />
            </div>
          )}
          <div className="relative z-10">
            {lockedOrder?.status === 'Pending' && (
              <>
                <div className="text-6xl mb-6 animate-pulse">📡</div>
                <h1 className="text-2xl font-black text-white mb-3 uppercase tracking-widest">Sending Order…</h1>
                <p className="text-white/50 text-sm leading-relaxed">Please proceed to the cashier to confirm payment of <span className="text-brand font-bold">₱{(lockedOrder.total||0).toFixed(2)}</span>.</p>
              </>
            )}
            {lockedOrder?.status === 'Preparing' && (() => {
              const allItems = lockedOrder.items || [];
              const deliveredCount = allItems.filter(i => i.itemStatus === 'Delivered').length;
              const totalCount = allItems.length;
              const hasPartial = deliveredCount > 0 && deliveredCount < totalCount;
              const progressPct = totalCount > 0 ? Math.round((deliveredCount / totalCount) * 100) : 0;
              return (
                <>
                  <div className="text-6xl mb-4 inline-block animate-spin" style={{animationDuration:'3s'}}>🍳</div>
                  <h1 className="text-2xl font-black text-brand mb-2 uppercase tracking-widest">
                    {hasPartial ? 'Partially Served' : 'Now Preparing'}
                  </h1>
                  {totalCount > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-[10px] text-white/30 font-bold mb-1.5">
                        <span>{deliveredCount} of {totalCount} items served</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-1.5">
                        <div className="bg-brand h-1.5 rounded-full transition-all duration-700" style={{width:`${progressPct}%`}} />
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5 text-left mt-2 max-h-36 overflow-y-auto pr-1">
                    {allItems.map((item, i) => {
                      const done = item.itemStatus === 'Delivered';
                      return (
                        <div key={i} className={`flex items-center gap-2 text-xs font-semibold transition-all ${done ? 'text-white/25 line-through' : 'text-white/70'}`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-black ${done ? 'bg-green-500/20 text-green-400' : 'bg-white/8 text-white/20'}`}>
                            {done ? '✓' : '·'}
                          </span>
                          {item.quantity}x {item.name}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-white/30 text-xs mt-3">
                    {hasPartial ? 'More items on the way!' : 'Our team is crafting your order. Hang tight!'}
                  </p>
                </>
              );
            })()}
            {(lockedOrder?.status === 'Ready' || lockedOrder?.status === 'Completed') && (
              <>
                <div className="text-7xl mb-6 animate-bounce">✨</div>
                <h1 className="text-3xl font-black text-white mb-3 uppercase tracking-widest">Order Ready!</h1>
                <p className="text-emerald-300 font-bold mb-8">Please collect your items at the counter.</p>
                <button onClick={handleReceived} className="w-full bg-white text-emerald-900 font-black py-4 rounded-2xl hover:bg-emerald-50 transition shadow-xl active:scale-95 uppercase tracking-widest">
                  I Got My Order ✓
                </button>
              </>
            )}
            <div className="mt-8 pt-5 border-t border-white/5 flex justify-between items-center">
              <span className="text-white/30 font-bold text-xs uppercase tracking-widest">Order ID</span>
              <span className="bg-white/5 border border-white/10 px-3 py-1 rounded-lg text-brand font-mono font-bold text-sm">{lockedOrder?.orderNumber}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (flowState === 'landing') {
    return (
      <div className="min-h-[100dvh] bg-page-bg flex flex-col overflow-hidden relative">
        {/* gradient hero bg */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand/25 via-transparent to-transparent pointer-events-none" />

        <div className="relative z-10 flex flex-col flex-1 items-center justify-end px-6 pb-20 text-center">
          <div className="w-28 h-28 rounded-3xl bg-brand flex items-center justify-center mb-8 shadow-2xl shadow-brand/40">
            <Coffee size={48} className="text-white" />
          </div>
          <h1 className="text-5xl font-black text-white tracking-tight leading-none mb-2">{BIZ_NAME}</h1>
          <div className="flex items-center gap-3 text-white/30 text-sm font-bold uppercase tracking-widest mb-16">
            <div className="h-px w-8 bg-white/20" />
            Table {tableNum}
            <div className="h-px w-8 bg-white/20" />
          </div>
          <button
            onClick={() => setFlowState('name_input')}
            className="w-full max-w-xs bg-brand text-white font-black py-5 rounded-2xl text-lg shadow-2xl shadow-brand/30 hover:bg-brand-dark transition active:scale-95 uppercase tracking-widest"
          >
            Start Order
          </button>
          <p className="text-white/20 text-xs mt-5 font-medium">Scan QR at your table to order</p>
        </div>
      </div>
    );
  }

  if (flowState === 'name_input') {
    return (
      <div className="min-h-[100dvh] bg-page-bg flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-full max-w-sm">
          <button
            onClick={() => setFlowState('landing')}
            className="flex items-center gap-1.5 text-white/30 hover:text-white text-sm mb-10 transition font-bold"
          >
            <ChevronLeft size={16} /> Back
          </button>
          <h2 className="text-3xl font-black text-white mb-2">What's your name?</h2>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">We'll use this to call your order when it's ready.</p>
          <input
            type="text"
            placeholder="Your nickname…"
            aria-label="Your name"
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            className="w-full bg-white/5 border-2 border-white/10 focus:border-brand text-white text-center py-5 rounded-2xl outline-none mb-5 font-bold text-xl transition placeholder-white/20"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && customerName.trim().length > 0 && setFlowState('menu')}
          />
          <button
            onClick={() => setFlowState('menu')}
            disabled={customerName.trim().length === 0}
            className={`w-full font-black py-5 rounded-2xl text-lg transition shadow-2xl uppercase tracking-widest
              ${customerName.trim().length === 0 ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-dark shadow-brand/30 active:scale-95'}`}
          >
            Browse Menu →
          </button>
        </div>
      </div>
    );
  }

  // --- MAIN MENU SCREEN (flowState === 'menu') ---
  return (
    <div className="min-h-[100dvh] bg-page-bg text-white animate-fade-in">

      {/* SUCCESS FLASH */}
      {successMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-sidebar-bg border border-brand/30 p-10 rounded-3xl text-center max-w-xs w-full mx-4">
            <div className="w-16 h-16 rounded-full bg-brand/20 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={32} className="text-brand" />
            </div>
            <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-widest">Order Sent!</h2>
            <p className="text-white/50 text-sm">Your order is on its way to the kitchen.</p>
          </div>
        </div>
      )}

      {/* STICKY HEADER */}
      <header className="sticky top-0 z-30 bg-page-bg/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <h1 className="text-xl font-black text-white tracking-tight leading-none">{BIZ_NAME}</h1>
            <p className="text-white/30 text-xs font-bold uppercase tracking-widest mt-0.5">Table {tableNum} · {customerName}</p>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => setCartOpen(true)}
              className="relative flex items-center gap-2 bg-brand text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-brand/20 hover:bg-brand-dark transition"
            >
              <ShoppingCart size={15} />
              <span>₱{total.toFixed(2)}</span>
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white text-brand rounded-full text-[10px] font-black flex items-center justify-center">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            </button>
          )}
        </div>
        {/* Category ribbon */}
        <div className="flex gap-2 px-4 pb-3 pt-1 overflow-x-auto scrollbar-none">
          {allCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-bold flex-shrink-0 transition
                ${activeCategory === cat
                  ? 'bg-brand text-white shadow-md shadow-brand/20'
                  : 'bg-white/5 text-white/50 border border-white/5 hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </header>

      {/* PRODUCT GRID */}
      <main className="px-4 py-6 max-w-5xl mx-auto pb-32">
        {/* Combos / Promos */}
        {combos.filter(c => c.isActive !== false).length > 0 && (activeCategory === 'All') && (
          <div className="mb-10">
            <h2 className="text-base font-black text-brand mb-4 uppercase tracking-widest px-0.5">Combos &amp; Promos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {combos.filter(c => c.isActive !== false).map(c => (
                <div key={c._id} onClick={() => addComboToCart(c)}
                  className="bg-brand/10 rounded-2xl overflow-hidden border border-brand/30 hover:border-brand/60 cursor-pointer active:scale-[0.97] transition-all p-4 flex flex-col">
                  <h3 className="font-black text-white text-sm leading-tight">{c.name}</h3>
                  {c.description && <p className="text-white/40 text-xs mt-0.5 line-clamp-1">{c.description}</p>}
                  <p className="text-white/30 text-[10px] mt-1 line-clamp-2">{(c.items||[]).map(i => `${i.quantity>1?i.quantity+'× ':''}${i.name}`).join(' + ')}</p>
                  <p className="text-brand font-black text-base mt-auto pt-2">₱{Number(c.price).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {displayedCategories.length === 0
          ? <p className="text-center text-white/30 mt-20 font-bold">No items available.</p>
          : displayedCategories.map(category => {
              const catProducts = visibleProducts.filter(p => p.category === category);
              if (catProducts.length === 0) return null;
              return (
                <div key={category} className="mb-10">
                  {activeCategory === 'All' && (
                    <h2 className="text-base font-black text-white/60 mb-4 uppercase tracking-widest px-0.5">{category}</h2>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {catProducts.map(p => (
                      <MenuItemCard key={p._id} product={p} onAdd={handleProductClick} />
                    ))}
                  </div>
                </div>
              );
            })
        }
      </main>

      {/* FLOATING CART BUTTON — portal to bypass animate-fade-in stacking context */}
      {cart.length > 0 && !cartOpen && createPortal(
        <div className="fixed bottom-6 left-4 right-4 z-[9990] max-w-lg mx-auto animate-fade-in">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full flex items-center justify-between bg-brand text-white px-6 py-4 rounded-2xl font-black shadow-2xl shadow-brand/30 hover:bg-brand-dark transition active:scale-[0.98]"
          >
            <div className="flex items-center gap-2 text-sm">
              <ShoppingCart size={18} />
              <span>{cart.reduce((s,i)=>s+i.quantity,0)} item{cart.reduce((s,i)=>s+i.quantity,0)!==1?'s':''}</span>
            </div>
            <span className="text-xl font-black">₱{total.toFixed(2)}</span>
          </button>
        </div>,
        document.body
      )}

      {/* CART DRAWER — portal to bypass animate-fade-in stacking context */}
      {cartOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9990] bg-black/60 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-[9991] bg-sidebar-bg border-t border-white/10 rounded-t-3xl flex flex-col animate-fade-in max-h-[82dvh]">
            {/* Drawer handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-white/20 rounded-full" />
            </div>
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
              <h3 className="font-black text-white text-lg">Your Basket</h3>
              <button onClick={() => setCartOpen(false)} className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition">
                <X size={20} />
              </button>
            </div>
            {/* Cart items */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 custom-scrollbar">
              {cart.map(item => {
                const addOnTotal = (item.selectedAddOns||[]).reduce((s,a)=>s+a.price,0);
                const rowTotal = (item.price + addOnTotal) * item.quantity;
                return (
                  <div key={item.cartItemId} className="flex items-start gap-3 bg-white/5 rounded-2xl p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-bold text-white text-sm leading-tight">{item.name}</h4>
                        <button onClick={() => removeFromCart(item.cartItemId)} aria-label={`Remove ${item.name}`} className="text-white/30 hover:text-red-400 transition p-0.5 flex-shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                      {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                        <div className="space-y-0.5 mb-2">
                          {item.selectedAddOns.map((a,i) => (
                            <p key={i} className="text-brand/70 text-xs">+ {a.name} <span className="text-white/30">(+₱{a.price.toFixed(2)})</span></p>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-0.5 bg-black/30 rounded-xl p-1">
                          <button onClick={() => updateQuantity(item.cartItemId, -1)} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/60 hover:text-red-400 hover:bg-white/10 transition">
                            <Minus size={13} />
                          </button>
                          <span className="text-white font-bold w-6 text-center text-sm">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.cartItemId, 1)} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/60 hover:text-brand hover:bg-white/10 transition">
                            <Plus size={13} />
                          </button>
                        </div>
                        <span className="text-brand font-black text-base">₱{rowTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/60 font-bold text-sm">Total</span>
                <span className="text-white font-black text-2xl">₱{total.toFixed(2)}</span>
              </div>
              {/* Special instructions */}
              <div>
                <label className="text-[11px] text-white/40 font-bold uppercase tracking-wider block mb-1.5">Special Instructions (optional)</label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={orderNotes}
                  onChange={e => setOrderNotes(e.target.value)}
                  placeholder="e.g. No sugar, extra ice, allergy note…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-brand/50 resize-none placeholder-white/20 transition"
                  aria-label="Special instructions for your order"
                />
                {orderNotes.length > 0 && (
                  <p className="text-[10px] text-white/20 text-right mt-0.5">{orderNotes.length}/300</p>
                )}
              </div>
              <button
                onClick={async () => { await confirmOrder(); setCartOpen(false); }}
                disabled={isSubmitting}
                className="w-full bg-brand hover:bg-brand-dark text-white font-black py-4 rounded-2xl text-lg transition shadow-2xl shadow-brand/30 uppercase tracking-widest active:scale-95 disabled:opacity-60"
              >
                {isSubmitting ? 'Sending…' : 'Send to Kitchen'}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* SIZE / ADDON MODAL — portal to body to bypass any parent stacking context */}
      {selectedProduct && createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end justify-center z-[9999]">
          <div className="bg-sidebar-bg rounded-t-2xl w-full max-w-md border-t border-x border-white/10 flex flex-col max-h-[85dvh]">
            {/* Modal header */}
            <div className="flex items-start justify-between p-5 border-b border-white/5 flex-shrink-0">
              <div className="flex-1">
                <h3 className="text-xl font-black text-white leading-tight">{selectedProduct.name}</h3>
                {selectedProduct.description && <p className="text-white/40 text-xs mt-1 line-clamp-2">{selectedProduct.description}</p>}
              </div>
              <button onClick={() => setSelectedProduct(null)} className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition ml-3 flex-shrink-0">
                <X size={18} />
              </button>
            </div>
            {/* Sizes — scrollable middle */}
            <div className="flex-1 px-5 py-4 space-y-4 overflow-y-auto custom-scrollbar">
              {groupedSizes.Hot && (
                <div>
                  <p className="flex items-center gap-2 text-red-400 text-xs font-black uppercase tracking-widest mb-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Hot Options
                  </p>
                  <div className="space-y-2">
                    {groupedSizes.Hot.map((size, idx) => (
                      <label key={`hot-${idx}`} className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${selectedSize?.name === size.name ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="size" className="accent-brand" checked={selectedSize?.name === size.name} onChange={() => setSelectedSize(size)} />
                          <span className="font-bold text-white capitalize text-sm">{size.displayName}</span>
                        </div>
                        <span className="text-brand font-bold text-sm">₱{size.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {groupedSizes.Iced && (
                <div>
                  <p className="flex items-center gap-2 text-blue-400 text-xs font-black uppercase tracking-widest mb-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Iced Options
                  </p>
                  <div className="space-y-2">
                    {groupedSizes.Iced.map((size, idx) => (
                      <label key={`iced-${idx}`} className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${selectedSize?.name === size.name ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="size" className="accent-brand" checked={selectedSize?.name === size.name} onChange={() => setSelectedSize(size)} />
                          <span className="font-bold text-white capitalize text-sm">{size.displayName}</span>
                        </div>
                        <span className="text-brand font-bold text-sm">₱{size.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {groupedSizes.Standard && (
                <div>
                  {Object.keys(groupedSizes).length > 1 && <p className="text-white/40 text-xs font-black uppercase tracking-widest mb-2">Other Options</p>}
                  <div className="space-y-2">
                    {groupedSizes.Standard.map((size, idx) => (
                      <label key={`std-${idx}`} className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${selectedSize?.name === size.name ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="size" className="accent-brand" checked={selectedSize?.name === size.name} onChange={() => setSelectedSize(size)} />
                          <span className="font-bold text-white text-sm">{size.displayName}</span>
                        </div>
                        <span className="text-brand font-bold text-sm">₱{size.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {/* Required Modifier Groups */}
              {(selectedProduct.modifierGroups || []).length > 0 && (
                <div className="border-t border-white/5 pt-4 space-y-4">
                  {(selectedProduct.modifierGroups || []).map((mg, mgIdx) => (
                    <div key={mgIdx}>
                      <p className="text-white/80 text-xs font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                        {mg.name}
                        {mg.isRequired && <span className="text-red-400 text-[9px] font-black bg-red-900/30 px-1.5 py-0.5 rounded uppercase">Required</span>}
                      </p>
                      <div className="space-y-2">
                        {(mg.options || []).map((opt, optIdx) => {
                          const selKey = `${mg.name}: ${opt.name}`;
                          const isSelected = selectedAddOns.some(a => a.name === selKey);
                          return (
                            <label key={optIdx} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${isSelected ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}
                              onClick={() => {
                                if (mg.maxSelect === 1) {
                                  // Radio behavior: clear other options in this group first
                                  setSelectedAddOns(prev => [...prev.filter(a => !a.name.startsWith(mg.name + ': ')), { name: selKey, price: opt.price || 0 }]);
                                } else {
                                  // Checkbox behavior
                                  if (isSelected) setSelectedAddOns(prev => prev.filter(a => a.name !== selKey));
                                  else setSelectedAddOns(prev => [...prev, { name: selKey, price: opt.price || 0 }]);
                                }
                              }}>
                              <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-brand bg-brand' : 'border-white/30'}`}>
                                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                                </div>
                                <span className="font-bold text-white text-sm">{opt.name}</span>
                              </div>
                              {opt.price > 0 && <span className="text-brand font-bold text-sm">+₱{opt.price.toFixed(2)}</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedProduct.addOns && selectedProduct.addOns.length > 0 && (
                <div className="border-t border-white/5 pt-4">
                  <p className="text-white/60 text-xs font-black uppercase tracking-widest mb-3">Optional Add-Ons</p>
                  <div className="space-y-2">
                    {selectedProduct.addOns.map((addOn, idx) => (
                      <label key={`addon-${idx}`} className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${selectedAddOns.some(a => a.name === addOn.name) ? 'border-brand bg-brand/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                        <div className="flex items-center gap-3">
                          <input type="checkbox" className="accent-brand" checked={selectedAddOns.some(a => a.name === addOn.name)} onChange={() => toggleAddOn(addOn)} />
                          <span className="font-bold text-white text-sm">{addOn.name}</span>
                        </div>
                        <span className="text-brand font-bold text-sm">+₱{addOn.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Modal footer — always visible, never scrolled away */}
            <div className="flex gap-3 p-5 border-t border-white/5 flex-shrink-0">
              <button onClick={() => setSelectedProduct(null)} className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white font-bold py-3.5 rounded-2xl transition text-sm">
                Cancel
              </button>
              <button
                onClick={() => {
                  // Validate required modifier groups before adding to cart
                  const unmet = (selectedProduct.modifierGroups||[]).filter(mg => {
                    if (!mg.isRequired) return false;
                    const selected = selectedAddOns.filter(a => a.name.startsWith(mg.name+': ')).length;
                    return selected < (mg.minSelect||1);
                  });
                  if (unmet.length > 0) { alert(`Please choose: ${unmet.map(mg=>mg.name).join(', ')}`); return; }
                  addToCart(selectedProduct, selectedSize, selectedAddOns);
                }}
                className="flex-2 flex-1 bg-brand hover:bg-brand-dark text-white font-black py-3.5 rounded-2xl transition shadow-lg shadow-brand/20 text-sm">
                Add to Cart
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
