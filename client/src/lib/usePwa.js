import { useState, useEffect, useCallback } from 'react';
import {
  canInstall, onInstallAvailabilityChange, promptInstall,
  getQueuedOrders, flushQueue,
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

  const refreshQueue = useCallback(() => setQueuedCount(getQueuedOrders().length), []);

  const syncQueue = useCallback(async (sender) => {
    const result = await flushQueue(sender);
    setQueuedCount(getQueuedOrders().length);
    return result;
  }, []);

  const install = useCallback(async () => {
    const accepted = await promptInstall();
    setInstallable(canInstall());
    return accepted;
  }, []);

  return { isOnline, installable, install, queuedCount, refreshQueue, syncQueue };
}
