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
  const [code, setCode] = useState(null);            // { url, expiresAt }
  const [state, setState] = useState(isLog ? 'ready' : 'loading'); // loading | ready | notEnabled | error
  const [note, setNote] = useState('');
  const sessionRef = useRef(null);

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
      setCode({ url: `${window.location.origin}/menu/${d.table}?session=${d.sessionId}`, expiresAt: new Date(d.expiresAt).getTime() });
      setState('ready');
      setNote(why);
    } catch {
      setState('error'); setNote('No connection to the server. Retrying…');
    }
  }, [apiUrl, headers]);

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
        <div className="max-w-md bg-surface border border-white/10 rounded-2xl p-5 text-left">
          <p className="text-fg font-bold mb-2">This device is not set up to show the QR yet.</p>
          <p className="text-fg/75 text-sm">
            A QR code here lets anyone who scans it send orders to the kitchen, so it only works on a device a manager
            has turned on. Sign in as a manager, open <b>Settings → QR display</b>, and press
            <b> Let this device show the QR</b>. You only do it once per tablet.
          </p>
        </div>
      )}
      {state === 'error' && <p className="text-danger">{note}</p>}

      {state === 'ready' && note && <p className="text-fg/75 text-sm mt-5">{note}</p>}
      {state === 'ready' && url && <p className="text-fg/65 text-xs mt-4 break-all max-w-md">{url.split('?')[0]}</p>}
    </div>
  );
}
