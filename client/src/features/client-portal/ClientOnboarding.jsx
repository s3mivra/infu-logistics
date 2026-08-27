import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Package, Eye, EyeOff, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

// '' is meaningful: it means same-origin (nginx proxies /api), so use ?? not ||
// - an UNSET var still falls back to the dev LAN box.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';
const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Semivra').toUpperCase();

// Self-service onboarding (#10) - reached via a one-time link the superadmin
// copies from the Command Center for an auto-promoted (source:'pos') client
// that has no login of its own yet. No auth on this page at all: the token in
// the URL IS the proof of authorization, same trust model as a password-reset
// email link.
export default function ClientOnboarding() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', username: '', password: '', confirm: '', showPassword: false });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/client-onboard/${token}`);
        const data = await res.json();
        if (!data.success) { setLoadError(data.error || 'This link is invalid or has expired.'); return; }
        setForm(f => ({ ...f, name: data.client.name || '', phone: data.client.phone || '', email: data.client.email || '' }));
      } catch {
        setLoadError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.username.trim() || !form.password) { setError('Choose a username and password.'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/client-onboard/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
          username: form.username.trim(), password: form.password,
        }),
      });
      const data = await res.json();
      if (data.success) setDone(true);
      else setError(data.error || 'Could not complete setup.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const input = 'w-full bg-page-bg border border-white/10 rounded-xl px-4 py-3 text-fg font-bold outline-none focus:border-brand/60 transition placeholder-fg/25';
  const label = 'text-xs text-fg/50 font-bold uppercase tracking-wider block mb-1.5';

  return (
    <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-4">
      <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand/20 flex items-center justify-center mb-4">
            <Package size={26} className="text-brand" />
          </div>
          <h2 className="text-xl font-black text-fg uppercase tracking-widest">{BIZ_NAME}</h2>
          <p className="text-fg/40 text-xs mt-1 text-center">Finish setting up your client account</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-fg/40"><Loader2 size={22} className="animate-spin" /></div>
        ) : loadError ? (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{loadError}</span>
          </div>
        ) : done ? (
          <div className="text-center py-4">
            <CheckCircle2 size={40} className="text-green-400 mx-auto mb-3" />
            <p className="text-fg font-bold mb-1">You're all set!</p>
            <p className="text-fg/50 text-sm mb-5">Your account is ready. Sign in any time to place and track orders.</p>
            <Link to="/client-login" className="inline-block bg-brand hover:bg-brand/90 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition">Go to Sign In</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
            <div>
              <label className={label}>Full Name</label>
              <input className={input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Phone</label>
                <input className={input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Email</label>
                <input type="email" className={input} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <div className="border-t border-white/10 pt-3">
              <label className={label}>Choose a Username *</label>
              <input autoComplete="username" className={input} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            </div>
            <div>
              <label className={label}>Choose a Password * (min 6 characters)</label>
              <div className="relative">
                <input type={form.showPassword ? 'text' : 'password'} autoComplete="new-password" className={`${input} pr-11`} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                <button type="button" onClick={() => setForm(f => ({ ...f, showPassword: !f.showPassword }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg">
                  {form.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className={label}>Confirm Password *</label>
              <input type={form.showPassword ? 'text' : 'password'} autoComplete="new-password" className={input} value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} />
            </div>
            <button type="submit" disabled={submitting} className="w-full bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 mt-2">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null} Finish Setup
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
