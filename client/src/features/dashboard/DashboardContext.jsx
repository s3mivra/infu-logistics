import { createContext, useContext } from 'react';

// Shared dashboard state/handlers.
//
// AdminDashboard already builds a single `ctx` object holding every piece of
// state and every handler the tabs need. Publishing it through a Context means
// extracted components (modals, panels) can read it directly instead of being
// handed a `ctx` prop through each intermediate layer — which is what let the
// dashboard grow into one 6,000-line file in the first place.
//
// Tabs still accept a `ctx` prop today; both paths read the same object, so the
// migration can happen file by file without a flag day.
const DashboardContext = createContext(null);

export function DashboardProvider({ value, children }) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  // A null here means the component rendered outside the provider — a wiring
  // mistake worth failing loudly on rather than a screenful of
  // "cannot read property of null" further down.
  if (!ctx) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return ctx;
}

export default DashboardContext;
