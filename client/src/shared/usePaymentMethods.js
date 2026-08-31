import { useState, useEffect, useCallback } from 'react';

// The one place every ordering surface (QR menu, client portal, and - via
// AdminDashboard's own copy of this pattern - the POS) gets its tender list
// from. A COA sub-account under a payment-relevant parent (Cash on Hand, Cash
// in Bank, E-Wallet, Checks on Hand, On Account) IS a payment method, so
// adding one in the Payment Routing screen must show up here.
//
// EVENT-DRIVEN, NOT POLLED: fetched once on mount and cached in this hook's
// state; the only thing that triggers a refetch afterwards is the
// 'paymentMethodsUpdated' socket event, emitted server-side from the COA
// account CRUD routes (create / rename / delete / activate-deactivate). No
// interval, no re-fetch on every render - a screen sitting open for hours
// costs one request unless something actually changed.
//
// `socket` is passed in rather than imported, because the QR menu and the
// client portal each already hold their own socket.io connection (see the
// `menuUpdated` / `settingsUpdated` listeners already in those files) - this
// hook rides the same connection instead of opening a second one.
export function usePaymentMethods(apiFetch, socket) {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchMethods = useCallback(async () => {
    try {
      const res = await (apiFetch ? apiFetch('/api/payment-methods/active') : fetch(`${import.meta.env.VITE_API_URL || ''}/api/payment-methods/active`));
      const data = await res.json();
      if (data.success) setMethods(data.methods || []);
    } catch {
      // Keep whatever was cached - a transient fetch failure must not blank
      // out a tender list someone is actively checking out against.
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchMethods();
    if (!socket) return;
    socket.on('paymentMethodsUpdated', fetchMethods);
    return () => socket.off('paymentMethodsUpdated', fetchMethods);
  }, [fetchMethods, socket]);

  // Grouped for the pill-group UI both ClientOrderPage and the POS use
  // ('In-Store', 'E-Wallets', 'Credit') - computed here so callers don't each
  // reimplement the same reduce.
  const grouped = methods.reduce((acc, m) => {
    (acc[m.group] ||= []).push(m);
    return acc;
  }, {});

  return { methods, grouped, loading, refetch: fetchMethods };
}
