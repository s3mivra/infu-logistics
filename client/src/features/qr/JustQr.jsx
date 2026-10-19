// "Just QR" - the ordering code on screen, from the login page, with nobody
// signed in.
//
// Logistics: the code opens the client portal, which is public anyway (clients
// sign in there), so any device can show it.
//
// Café: the code is a live ordering session, so only a device a manager has
// enabled can make one (Settings → QR display). The device keeps its key in
// its own storage; see server/features/qr-sessions.js. A code that has been
// scanned, or has run out, is replaced by a fresh one on its own.
import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCode } from 'react-qr-code';
import { X, RefreshCw } from 'lucide-react';

export const QR_DEVICE_KEY = 'semivra_qr_device';
export const readDeviceKey = () => { try { return localStorage.getItem(QR_DEVICE_KEY) || ''; } catch { return ''; } };
export const writeDeviceKey = (k) => { try { k ? localStorage.setItem(QR_DEVICE_KEY, k) : localStorage.removeItem(QR_DEVICE_KEY); } catch { /* private mode */ } };

const POLL_MS = 3000;

export default function JustQr({ apiUrl, businessType, bizName, onClose }) {
  const isLog = businessType === 'log';
  const [code, setCode] = useState(null);            // { url, sessionId, expiresAt }
  const [state, setState] = useState(isLog ? 'ready' : 'loading'); // loading | ready | notEnabled | error
  const [note, setNote] = useState('');
  const sessionRef = useRef(null);
  const [mgr, setMgr] = useState({ name: '', password: '', label: 'Counter tablet' });
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState('');

  const headers = useCallback(() => ({ 'x-qr-device': readDeviceKey() }), []);

  const fresh = useCallback(async (why = '') => {
    if (!readDeviceKey()) { setState('notEnabled'); return; }
    try {
      const res = await fetch(`${apiUrl}/api/qr-devices/session`, { method: 'POST', headers: headers() });
      if (res.status === 429) return;          // a code was just made; the next poll picks it up
      const d = await res.json().catch(() => ({}));
      if (res.status === 403) { writeDeviceKey(''); setState('notEnabled'); setNote('This device was switched off in Settings.'); return; }
      if (!d.success) { setState('error'); setNote(d.error || 'Could not make a code.'); return; }
      sessionRef.current = d.sessionId;
      setCode({ url: `${window.location.origin}/menu/${d.table}?session=${d.sessionId}`, sessionId: d.sessionId, expiresAt: new Date(d.expiresAt).getTime() });
      setState('ready');
      setNote(why);
    } catch {
      setState('error'); setNote('No connection to the server. Retrying…');
    }
  }, [apiUrl, headers]);

  // A manager turns this device on right here - no session is left behind.
  const enableHere = async (e) => {
    e.preventDefault();
    setEnabling(true); setEnableError('');
    try {
      const res = await fetch(`${apiUrl}/api/qr-devices/enable-here`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mgr),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.success) { setEnableError(d.error || 'Could not turn this device on.'); return; }
      writeDeviceKey(d.key);
      try { localStorage.setItem('semivra_qr_device_id', d.device._id); } catch { /* private mode */ }
      setMgr({ name: '', password: '', label: mgr.label });
      setState('loading'); setNote('');
      fresh();
    } catch {
      setEnableError('No connection to the server.');
    } finally { setEnabling(false); }
  };

  // Café: the first code, then keep it current.
  useEffect(() => {
    if (isLog) return undefined;
    fresh();
    const t = setInterval(async () => {
      const id = sessionRef.current;
      if (!id) { fresh(); return; }
      try {
        const res = await fetch(`${apiUrl}/api/qr-devices/session/${id}`, { headers: headers() });
        const d = await res.json().catch(() => ({}));
        if (res.status === 403) { writeDeviceKey(''); setState('notEnabled'); setNote('This device was switched off in Settings.'); return; }
        if (d.claimed) fresh('The last code was scanned - here is a new one for the next person.');
        else if (d.expired) fresh('');
      } catch { /* offline for a moment - the next tick tries again */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [isLog, fresh, apiUrl, headers]);

  // Escape closes, as everywhere else.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = isLog ? `${window.location.origin}/client/portal` : code?.url;

  return (
    <div role="dialog" aria-modal="true" aria-label="Order by QR code"
      className="fixed inset-0 z-[80] bg-page-bg flex flex-col items-center justify-center p-6 text-center">
      <button onClick={onClose} aria-label="Close"
        className="absolute top-4 right-4 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-fg/80 hover:text-fg transition">
        <X size={22} />
      </button>

      <p className="text-brand-text font-black uppercase tracking-[0.25em] text-xs mb-2">{bizName}</p>
      <h1 className="text-3xl sm:text-4xl font-black text-fg mb-2">
        {isLog ? 'Scan to open your client portal' : 'Scan to see the menu and order'}
      </h1>
      <p className="text-fg/70 text-sm mb-6 max-w-md">
        {isLog ? 'Sign in with your client account to place and track orders.' : 'Point your phone camera at the code. No app needed.'}
      </p>

      {state === 'ready' && url && (
        <div className="bg-white p-5 rounded-2xl shadow-2xl">
          <QRCode value={url} size={Math.min(360, Math.floor(Math.min(window.innerWidth * 0.7, window.innerHeight * 0.5)))} />
        </div>
      )}
      {state === 'loading' && <p className="text-fg/70 flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Making a code…</p>}
      {state === 'notEnabled' && (
        <form onSubmit={enableHere} className="w-full max-w-sm bg-surface border border-white/10 rounded-2xl p-5 text-left space-y-3">
          <p className="text-fg font-bold">Turn this device on for Just QR</p>
          <p className="text-fg/75 text-sm">
            Anyone who scans this code can send orders to the kitchen, so a manager turns each tablet on once. Nobody stays signed in.
          </p>
          {note && <p className="text-warning text-sm">{note}</p>}
          <input value={mgr.name} onChange={e => setMgr(m => ({ ...m, name: e.target.value }))} placeholder="Manager name" aria-label="Manager name" autoComplete="off"
            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg outline-none focus:border-brand" />
          <input type="password" value={mgr.password} onChange={e => setMgr(m => ({ ...m, password: e.target.value }))} placeholder="Password" aria-label="Manager password" autoComplete="off"
            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg outline-none focus:border-brand" />
          <input value={mgr.label} onChange={e => setMgr(m => ({ ...m, label: e.target.value }))} placeholder="Name for this tablet" aria-label="Name for this tablet" maxLength={60}
            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-sm text-fg outline-none focus:border-brand" />
          {enableError && <p className="text-danger text-sm" role="alert">{enableError}</p>}
          <button type="submit" disabled={enabling || !mgr.name.trim() || !mgr.password}
            className="w-full bg-brand hover:bg-brand-dark text-on-brand font-black py-3 rounded-xl uppercase tracking-widest text-sm disabled:opacity-50">
            {enabling ? 'Turning on…' : 'Turn on and show the QR'}
          </button>
          <p className="text-fg/70 text-xs">It can be switched off any time in Settings → QR display.</p>
        </form>
      )}
      {state === 'error' && <p className="text-danger">{note}</p>}

      {state === 'ready' && note && <p className="text-fg/75 text-sm mt-5">{note}</p>}
      {/* The address alone never changes - every code from this tablet opens the
          same counter table - so the session's short code is shown with it:
          that is the part that changes with each new QR. */}
      {state === 'ready' && url && (
        <p className="text-fg/65 text-xs mt-4 break-all max-w-md">
          {url.split('?')[0]}
          {!isLog && code?.sessionId && <> · code <span className="font-mono font-bold text-fg/80">{code.sessionId.slice(0, 6).toUpperCase()}</span></>}
        </p>
      )}
    </div>
  );
}
