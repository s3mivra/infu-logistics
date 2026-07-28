import { useCallback, useEffect, useRef, useState } from 'react';
import { __register, __unregister } from './index';

// Renders the app's own toasts and confirm dialog, and registers the imperative
// handlers in ./index so any module can call ui.alert()/ui.confirm().
//
// Mounted once, at the App root — so it also covers the customer menu and the
// client portal, not just the admin dashboard.

const TONE = {
  info:    { bar: 'bg-brand',       text: 'text-brand',       icon: 'ℹ' },
  success: { bar: 'bg-green-500',   text: 'text-green-400',   icon: '✓' },
  warn:    { bar: 'bg-yellow-500',  text: 'text-yellow-400',  icon: '!' },
  error:   { bar: 'bg-red-500',     text: 'text-red-400',     icon: '✕' },
};

function Toast({ t, onClose }) {
  const tone = TONE[t.tone] || TONE.info;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-stretch gap-0 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-elev-3 animate-scale-in max-w-[92vw] sm:max-w-sm"
    >
      <div className={`w-1.5 shrink-0 ${tone.bar}`} />
      <div className="flex items-start gap-2 px-4 py-3">
        <span className={`${tone.text} font-black text-sm leading-5 shrink-0`}>{tone.icon}</span>
        <p className="text-fg text-sm font-bold leading-5 break-words">{t.message}</p>
      </div>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className="px-3 text-fg/30 hover:text-fg transition shrink-0 text-lg font-bold"
      >
        ✕
      </button>
    </div>
  );
}

// A toast with a countdown and a real Undo button.
//
// `alreadyApplied` distinguishes the two modes: either we're holding the action
// back (and the countdown is the delay before it runs), or it already ran and
// the countdown is how long the reversal stays offered.
function UndoToast({ req, onDone }) {
  const [left, setLeft] = useState(req.seconds);
  // Guard against the timer and the button both firing — whichever happens
  // first must win exactly once, or the action could run twice.
  const settled = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setLeft(s => s - 1), 1000);
    const done = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      req.onExpire?.();
      onDone();
    }, req.seconds * 1000);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, [req, onDone]);

  const undo = () => {
    if (settled.current) return;
    settled.current = true;
    req.onUndo?.();
    onDone();
  };

  const pct = Math.max(0, Math.min(100, (left / req.seconds) * 100));

  return (
    <div role="status" aria-live="polite"
      className="pointer-events-auto overflow-hidden rounded-xl border border-white/10 bg-surface shadow-elev-3 animate-scale-in max-w-[92vw] sm:max-w-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <p className="text-fg text-sm font-bold leading-5 break-words flex-1">{req.message}</p>
        <button
          onClick={undo}
          className="shrink-0 text-xs font-black uppercase tracking-wider bg-brand/15 border border-brand/30 text-brand px-3 py-1.5 rounded-lg hover:bg-brand hover:text-white transition"
        >
          Undo{left > 0 ? ` ${Math.max(0, left)}` : ''}
        </button>
      </div>
      {/* Countdown bar — makes the remaining window visible, not just numeric. */}
      <div className="h-1 bg-white/5">
        <div className="h-full bg-brand transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConfirmDialog({ req, onResolve }) {
  const confirmRef = useRef(null);

  // Focus the confirm button on open so the dialog is keyboard-usable, and wire
  // Esc to cancel. Enter is intentionally NOT bound to confirm — every one of
  // these guards a destructive action, and a stray Enter shouldn't fire it.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onResolve(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolve]);

  const danger = req.tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm p-0 sm:p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onResolve(false); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ui-confirm-title"
    >
      <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-elev-3 animate-scale-in overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h2 id="ui-confirm-title" className={`font-black text-lg ${danger ? 'text-red-400' : 'text-fg'}`}>
            {req.title || 'Please confirm'}
          </h2>
          {req.message && (
            <p className="text-fg/70 text-sm font-bold mt-2 leading-relaxed whitespace-pre-line break-words">
              {req.message}
            </p>
          )}
          {req.detail && (
            <p className="text-fg/40 text-xs mt-3 leading-relaxed whitespace-pre-line break-words">
              {req.detail}
            </p>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6 pt-2">
          <button
            onClick={() => onResolve(false)}
            className="flex-1 py-3.5 bg-surface-2 border border-white/10 text-fg/60 font-bold rounded-xl hover:text-fg transition text-sm uppercase tracking-wider min-h-[48px]"
          >
            {req.cancelLabel || 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            onClick={() => onResolve(true)}
            className={`flex-1 py-3.5 font-black rounded-xl transition text-sm uppercase tracking-wider min-h-[48px] active-press ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-brand text-white hover:bg-brand/90'
            }`}
          >
            {req.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [undos, setUndos] = useState([]);
  // One confirm at a time; a second call while one is open queues behind it.
  const [queue, setQueue] = useState([]);
  const idRef = useRef(0);

  const pushToast = useCallback(({ message, tone, duration }) => {
    const id = ++idRef.current;
    setToasts((list) => [...list, { id, message, tone }]);
    const ms = duration ?? (tone === 'error' ? 6000 : 3500);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms);
  }, []);

  const pushConfirm = useCallback((opts) => new Promise((resolve) => {
    setQueue((q) => [...q, { ...opts, resolve, id: ++idRef.current }]);
  }), []);

  const pushUndo = useCallback((opts) => {
    const id = ++idRef.current;
    setUndos((list) => [...list, { ...opts, id }]);
  }, []);

  useEffect(() => {
    __register({ toast: pushToast, confirm: pushConfirm, undo: pushUndo });
    return () => __unregister();
  }, [pushToast, pushConfirm, pushUndo]);

  const current = queue[0];
  const resolveCurrent = useCallback((value) => {
    setQueue((q) => {
      const [head, ...rest] = q;
      head?.resolve(value);
      return rest;
    });
  }, []);

  return (
    <>
      {children}
      <div className="fixed top-4 right-4 z-[99998] flex flex-col gap-2 pointer-events-none items-end">
        {undos.map((u) => (
          <UndoToast key={u.id} req={u} onDone={() => setUndos((l) => l.filter((x) => x.id !== u.id))} />
        ))}
        {toasts.map((t) => (
          <Toast key={t.id} t={t} onClose={() => setToasts((l) => l.filter((x) => x.id !== t.id))} />
        ))}
      </div>
      {current && <ConfirmDialog key={current.id} req={current} onResolve={resolveCurrent} />}
    </>
  );
}
