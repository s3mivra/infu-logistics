import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Eye, EyeOff, AlertCircle, Loader2, LogIn } from 'lucide-react';
import { saveSession, loadSession, clientIdOf } from './clientSession';

// '' is meaningful: it means same-origin (nginx proxies /api), so use ?? not ||
// — an UNSET var still falls back to the dev LAN box.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';
const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Semivra').toUpperCase();

export default function ClientLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', showPassword: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in (e.g. reopened the tab, or hit the login URL from a
  // bookmark)? Go straight back to the order page instead of asking again.
  useEffect(() => {
    const session = loadSession();
    if (session) navigate(`/client/portal/${clientIdOf(session.info) || ''}`, { replace: true });
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/client-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      });
      const data = await res.json();
      if (data.success) {
        saveSession(data.token, data.client);
        const uid = data.client?._id || data.client?.clientCode || '';
        navigate(`/client/portal/${uid}`);
      } else {
        setError(data.error || 'Login failed. Please check your credentials.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-8"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand/20 flex items-center justify-center mb-4">
            <Package size={26} className="text-brand" />
          </div>
          <h2 className="text-xl font-black text-fg uppercase tracking-widest">{BIZ_NAME}</h2>
          <p className="text-fg/40 text-xs mt-1">Client Portal - Sign in to order</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-5">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3 mb-5">
          <input
            type="text"
            placeholder="Username"
            aria-label="Username"
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            className="w-full bg-white border border-white/10 focus:border-brand text-black placeholder-black/30 px-4 py-3 rounded-xl outline-none transition text-sm font-medium"
            required
            autoFocus
            autoComplete="username"
          />
          <div className="relative">
            <input
              type={form.showPassword ? 'text' : 'password'}
              placeholder="Password"
              aria-label="Password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full bg-white border border-white/10 focus:border-brand text-black placeholder-black/30 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest"
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, showPassword: !f.showPassword }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/70 transition"
              aria-label={form.showPassword ? 'Hide password' : 'Show password'}
            >
              {form.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand hover:bg-brand-dark text-white font-black py-3 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
