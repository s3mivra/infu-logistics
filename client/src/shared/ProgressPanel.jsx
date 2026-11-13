import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { subscribeProgress, startTask, endTask } from './progress';

// The panel in the corner that says what the app is doing (shared/progress.js):
// each running import, export or slow request, how far along it is when that
// is known, how long it has taken, and - past a point - that it is slower than
// it should be. A finished task shows a tick or a cross briefly.
export const SLOW_AFTER_S = 8;      // "still working"
export const LAG_AFTER_S = 30;      // "taking longer than usual"

export function lagNote(seconds) {
  if (seconds >= LAG_AFTER_S) return 'Taking longer than usual - the connection or the server may be slow. It is still running.';
  if (seconds >= SLOW_AFTER_S) return 'Still working…';
  return '';
}

export default function ProgressPanel() {
  const [tasks, setTasks] = useState([]);
  const [, setNow] = useState(0);
  useEffect(() => subscribeProgress(setTasks), []);
  // A second hand, only while something runs.
  const running = tasks.some((t) => !t.endedAt);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // A file picked anywhere in the app: say so at once - a big sheet can take
  // seconds to read, and the screen would otherwise look frozen. The reader
  // (shared/xlsx.js) or the next request takes over; this ends on its own.
  useEffect(() => {
    const onChange = (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      const name = input.files[0].name;
      const id = startTask(`Reading ${name}…`, { kind: 'file' });
      setTimeout(() => endTask(id), 4000);
    };
    document.addEventListener('change', onChange, true);
    return () => document.removeEventListener('change', onChange, true);
  }, []);

  if (!tasks.length) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed bottom-4 left-4 z-[10050] w-[min(22rem,calc(100vw-2rem))] space-y-2 pointer-events-none">
      {tasks.map((t) => {
        const secs = Math.floor(((t.endedAt || Date.now()) - t.startedAt) / 1000);
        const pct = t.total > 0 ? Math.min(100, Math.round((t.done / t.total) * 100)) : null;
        const note = !t.endedAt ? lagNote(secs) : '';
        const lag = secs >= LAG_AFTER_S && !t.endedAt;
        return (
          <div key={t.id} className={`pointer-events-auto rounded-xl border shadow-2xl px-3 py-2.5 bg-sidebar-bg ${t.endedAt ? (t.ok ? 'border-success/40' : 'border-red-500/50') : lag ? 'border-amber-500/50' : 'border-white/15'}`}>
            <div className="flex items-center gap-2">
              {!t.endedAt ? (lag ? <AlertTriangle size={15} className="text-warning shrink-0" /> : <Loader2 size={15} className="animate-spin text-brand-text shrink-0" />)
                : t.ok ? <CheckCircle size={15} className="text-success shrink-0" /> : <XCircle size={15} className="text-danger shrink-0" />}
              <span className="text-xs font-bold text-fg flex-1 truncate" title={t.label}>{t.label}</span>
              <span className="text-[10px] text-fg/60 tabular-nums shrink-0">
                {pct !== null && !t.endedAt ? `${pct}% · ` : ''}{secs}s
              </span>
            </div>
            {!t.endedAt && (
              <div className="mt-1.5 h-1 rounded bg-white/10 overflow-hidden">
                {pct !== null
                  ? <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                  : <div className="h-full w-1/3 bg-brand/70 animate-[progressSlide_1.2s_ease-in-out_infinite]" />}
              </div>
            )}
            {pct !== null && !t.endedAt && t.total > 1 && <p className="mt-1 text-[10px] text-fg/60">{t.done} of {t.total}</p>}
            {note && <p className={`mt-1 text-[10px] ${lag ? 'text-warning' : 'text-fg/60'}`}>{note}</p>}
            {t.endedAt && !t.ok && t.message && <p className="mt-1 text-[10px] text-danger">{t.message}</p>}
          </div>
        );
      })}
    </div>
  );
}
