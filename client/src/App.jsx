import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, Component, useEffect } from 'react';

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
          <h1 className="text-white text-xl font-bold mb-2">Something went wrong</h1>
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
    document.documentElement.setAttribute('data-theme', import.meta.env.VITE_THEME || 'default');
  }, []);

  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}

export default App;