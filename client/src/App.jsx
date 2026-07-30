import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, Component, useEffect, useState } from 'react';

// Guards against the #1 mis-deployment: a client built for one BUSINESS_TYPE
// pointed at a server running the other (fb ↔ log). Fetches the server's mode
// from /health once and shows a loud fixed banner on mismatch. Fails OPEN — any
// fetch error is ignored so a flaky/unreachable health check never blocks the app.
function ModeMismatchBanner() {
  const [serverType, setServerType] = useState(null);
  const clientType = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();
  useEffect(() => {
    const api = import.meta.env.VITE_API_URL ?? '';
    fetch(`${api}/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.businessType) setServerType(String(d.businessType).toLowerCase()); })
      .catch(() => { /* fail open */ });
  }, []);
  if (!serverType || serverType === clientType) return null;
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#b91c1c', color: '#fff',
      padding: '10px 16px', font: '700 13px system-ui, sans-serif', textAlign: 'center', letterSpacing: '0.02em' }}>
      ⚠️ Configuration mismatch: this app was built for <b>{clientType.toUpperCase()}</b> but the server is running <b>{serverType.toUpperCase()}</b>.
      Set VITE_BUSINESS_TYPE and the server’s BUSINESS_TYPE to the same value and rebuild the client.
    </div>
  );
}

import UiProvider from './shared/ui/UiProvider';

const CustomerMenu = lazy(() => import('./features/menu/CustomerMenu'));
const AdminDashboard = lazy(() => import('./features/dashboard/AdminDashboard'));
const SuperAdminPanel = lazy(() => import('./features/super-admin/SuperAdminPanel'));
const QRCodeComponent = lazy(() => import('./features/qr/QRCode'));
const ClientLogin = lazy(() => import('./features/client-portal/ClientLogin'));
const ClientOrderPage = lazy(() => import('./features/client-portal/ClientOrderPage'));
//fix
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center text-center px-6">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-fg text-xl font-bold mb-2">Something went wrong</h1>
          <p className="text-gray-400 text-sm mb-6">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="bg-brand text-white px-6 py-2 rounded-lg font-bold"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  useEffect(() => {
    // Theme is a per-DEVICE preference, not a business setting: the same shop can
    // have a dark tablet at the register and a light one in a sunlit warehouse.
    // A saved choice wins; VITE_THEME remains the shipped default.
    // The client portal owns its own appearance (see clientTheme.js) — a shop
    // restyling its POS must not restyle its customers' portals, so skip the
    // staff theme entirely on portal routes.
    if (window.location.pathname.startsWith('/client')) return;
    let saved = null;
    try { saved = localStorage.getItem('dash.theme'); } catch { /* private mode */ }
    document.documentElement.setAttribute('data-theme', saved || import.meta.env.VITE_THEME || 'default');
  }, []);

  return (
    <ErrorBoundary>
      {/* UiProvider wraps the whole app (not just the dashboard) so the customer
          menu and client portal get the same toasts/confirms instead of the
          browser's native dialogs. */}
      <UiProvider>
      <ModeMismatchBanner />
      <Router>
        <Suspense fallback={
          <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mb-4 border-brand"></div>
            <p className="text-brand font-bold tracking-widest uppercase">Loading System...</p>
          </div>
        }>
          <Routes>
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route path="/menu/:table" element={<CustomerMenu />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/admin-panel" element={<SuperAdminPanel />} />
            <Route path="/generate-qr" element={<QRCodeComponent />} />
            <Route path="/client-login" element={<ClientLogin />} />
            <Route path="/client-order" element={<ClientOrderPage />} />
            {/* Logistics client portal */}
            <Route path="/client/portal" element={<ClientLogin />} />
            <Route path="/client/portal/:userid" element={<ClientOrderPage />} />
          </Routes>
        </Suspense>
      </Router>
      </UiProvider>
    </ErrorBoundary>
  );
}

export default App;