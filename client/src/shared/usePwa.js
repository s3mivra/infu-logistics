import { useState, useEffect, useCallback } from 'react';
import {
  canInstall, onInstallAvailabilityChange, promptInstall,
  getQueuedOrders, flushQueue, getRejectedOrders, dismissRejectedOrder,
} from './pwa';

/* React hook exposing PWA runtime state to components:
 *  - isOnline:        live navigator connectivity
 *  - installable:     a custom "Install app" button can be shown
 *  - install():       triggers the native install prompt
 *  - queuedCount:     number of orders waiting to sync
 *  - refreshQueue():  re-read the queue count (call after queueing an order)
 *  - syncQueue(sender): replay queued orders when back online
 */
export function usePwa() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [installable, setInstallable] = useState(canInstall());
  const [queuedCount, setQueuedCount] = useState(getQueuedOrders().length);
  // Offline orders the server refused. Shown to staff until dismissed - each
  // may be a sale the customer already paid for that is NOT in the system.
  const [rejectedOrders, setRejectedOrders] = useState(getRejectedOrders());

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const off = onInstallAvailabilityChange(setInstallable);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      off();
    };
  }, []);

  const refreshQueue = useCallback(() => {
    setQueuedCount(getQueuedOrders().length);
    setRejectedOrders(getRejectedOrders());
  }, []);

  const syncQueue = useCallback(async (sender) => {
    const result = await flushQueue(sender);
    setQueuedCount(getQueuedOrders().length);
    setRejectedOrders(getRejectedOrders());
    return result;
  }, []);

  const dismissRejected = useCallback((id) => {
    dismissRejectedOrder(id);
    setRejectedOrders(getRejectedOrders());
  }, []);

  const install = useCallback(async () => {
    const accepted = await promptInstall();
    setInstallable(canInstall());
    return accepted;
  }, []);

  return { isOnline, installable, install, queuedCount, refreshQueue, syncQueue, rejectedOrders, dismissRejected };
}
