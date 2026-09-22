import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, Download, AlertTriangle, Link2 } from 'lucide-react';
import * as ui from '../../shared/ui';
import { useRefreshTick } from '../../shared/refreshBus';

// A Google Sheet linked to Inventory (server: features/inventory-sheet.js).
//
// "Pull" opens the sheet in the ordinary import preview - nothing changes until
// the preview is confirmed. The daily check only tells you the sheet changed;
// it never applies it, because an import replaces stock counts and would undo
// every sale made since the sheet was edited.

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

export function useInventorySheet(apiFetch, enabled) {
  const [sheet, setSheet] = useState(null);
  const tick = useRefreshTick();
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await apiFetch('/api/inventory-sheet');
      const d = await r.json();
      if (d.success) setSheet(d.sheet);
    } catch { /* the panel says so when opened */ }
  }, [apiFetch, enabled]);
  useEffect(() => { reload(); }, [reload, tick]);
  return [sheet, setSheet, reload];
}

// Fetches the workbook and hands it to the same preview a file upload uses.
export async function pullSheet(apiFetch, parseImportFile) {
  const r = await apiFetch('/api/inventory-sheet/pull', { method: 'POST' });
  if (!r.ok) {
    let msg = 'Could not pull the sheet.';
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  await parseImportFile(new File([blob], 'google-sheet.xlsx', { type: blob.type }));
}

export function SheetChangedBanner({ sheet, onPull, busy }) {
  if (!sheet?.url || (!sheet.changedAt && !sheet.lastCheckError)) return null;
  const error = !sheet.changedAt;
  return (
    // Solid background: it sits on the Inventory panel's brand colour, where a
    // tinted one left the text unreadable in the darker themes.
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border-2 bg-sidebar-bg px-4 py-3 mb-4 ${error ? 'border-red-500/60' : 'border-amber-500/60'}`}>
      <AlertTriangle size={16} className={error ? 'text-danger' : 'text-warning'} />
      <p className="flex-1 min-w-[12rem] text-xs text-fg/85">
        {error
          ? <><span className="font-black">Couldn't read your stock sheet.</span> {sheet.lastCheckError}</>
          : <><span className="font-black">Your stock sheet changed</span> since your last pull ({when(sheet.changedAt)}). Pull it to review - nothing is applied until you confirm.</>}
      </p>
      {!error && (
        <button onClick={onPull} disabled={busy}
          className="px-4 py-2 rounded-lg bg-brand text-on-brand text-xs font-black uppercase tracking-wider hover:bg-brand-dark transition disabled:opacity-60">
          {busy ? 'Pulling…' : 'Pull and review'}
        </button>
      )}
    </div>
  );
}

export default function GoogleSheetModal({ apiFetch, sheet, setSheet, onPull, pulling, onClose }) {
  const [url, setUrl] = useState(sheet?.url || '');
  const [checkTime, setCheckTime] = useState(sheet?.checkTime || '');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState(null);

  const dirty = url.trim() !== (sheet?.url || '') || checkTime !== (sheet?.checkTime || '');

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch('/api/inventory-sheet', { method: 'PUT', body: JSON.stringify({ url: url.trim(), checkTime }) });
      const d = await r.json();
      if (d.success) { setSheet(d.sheet); setMsg({ tone: 'ok', text: url.trim() ? 'Saved. The sheet was read successfully.' : 'Sheet unlinked.' }); }
      else setMsg({ tone: 'err', text: d.error || 'Could not save.' });
    } catch { setMsg({ tone: 'err', text: 'Could not save. Check the connection.' }); }
    finally { setSaving(false); }
  };

  const check = async () => {
    setChecking(true); setMsg(null);
    try {
      const r = await apiFetch('/api/inventory-sheet/check', { method: 'POST' });
      const d = await r.json();
      if (!d.success) { setMsg({ tone: 'err', text: d.error || 'Could not check.' }); return; }
      setSheet(d.sheet);
      setMsg(d.error ? { tone: 'err', text: d.error }
        : d.changed ? { tone: 'warn', text: 'The sheet changed since your last pull. Pull it to review.' }
        : { tone: 'ok', text: 'No change since your last pull.' });
    } catch { setMsg({ tone: 'err', text: 'Could not check. Check the connection.' }); }
    finally { setChecking(false); }
  };

  const tone = { ok: 'text-success', warn: 'text-warning', err: 'text-danger' };
  const input = 'w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-fg/70 px-3 py-2.5 rounded-xl outline-none transition text-sm';
  const linked = !!sheet?.url;

  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="gsheet-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
          <Link2 size={16} className="text-brand-text" />
          <h2 id="gsheet-title" className="flex-1 text-fg font-black text-sm uppercase tracking-widest">Google Sheet</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-fg/70 hover:text-fg hover:bg-white/10"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-fg/75 leading-relaxed">
            Link the Google Sheet you keep your stock in. In Google Sheets, click <b>Share</b> and set
            "Anyone with the link" to <b>Viewer</b>, then paste the link here. The sheet uses the same columns as the import template.
          </p>

          <div>
            <label htmlFor="gsheet-url" className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Sheet link</label>
            <input id="gsheet-url" className={input} value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…" inputMode="url" autoComplete="off" />
          </div>

          <div>
            <label htmlFor="gsheet-time" className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Check for changes every day at</label>
            <div className="flex items-center gap-2">
              <input id="gsheet-time" type="time" className={`${input} max-w-[10rem]`} value={checkTime} onChange={(e) => setCheckTime(e.target.value)} />
              {checkTime && <button onClick={() => setCheckTime('')} className="text-xs text-fg/70 underline hover:text-fg">No daily check</button>}
            </div>
            <p className="text-[10px] text-fg/70 mt-1 leading-snug">
              At this time the system looks at the sheet and, if it changed, tells you in the bell. It never changes your stock by itself.
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={save} disabled={!dirty || saving}
              className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-brand text-on-brand hover:bg-brand-dark transition disabled:opacity-50">
              {saving ? 'Reading sheet…' : url.trim() || !linked ? 'Save link' : 'Unlink sheet'}
            </button>
          </div>

          {msg && <p role="status" className={`text-xs font-bold ${tone[msg.tone]}`}>{msg.text}</p>}

          {linked && (
            <div className="border-t border-white/10 pt-4 space-y-3">
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-fg/70">Last pulled</dt><dd className="text-fg">{when(sheet.lastPulledAt)}</dd>
                <dt className="text-fg/70">Last checked</dt><dd className="text-fg">{when(sheet.lastCheckedAt)}</dd>
                <dt className="text-fg/70">Status</dt>
                <dd className={sheet.lastCheckError ? 'text-danger' : sheet.changedAt ? 'text-warning' : 'text-success'}>
                  {sheet.lastCheckError ? 'Could not read the sheet' : sheet.changedAt ? 'Changed - pull to review' : 'Up to date'}
                </dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button onClick={onPull} disabled={pulling || dirty}
                  className="flex-1 min-w-[10rem] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-brand text-on-brand hover:bg-brand-dark transition disabled:opacity-50">
                  <Download size={14} className="rotate-180" /> {pulling ? 'Pulling…' : 'Pull now'}
                </button>
                <button onClick={check} disabled={checking || dirty}
                  className="flex-1 min-w-[10rem] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 text-fg/85 hover:text-fg hover:border-white/30 transition disabled:opacity-50">
                  <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check now'}
                </button>
              </div>
              <p className="text-[10px] text-fg/70 leading-snug">
                Pull now opens the sheet in the import preview, the same as uploading a file. The quantities in the sheet replace the counts in the
                system, so pull right after you count - not after sales you have not counted.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Keeps the pull's busy state and error handling in one place for the panel and the banner.
export function usePull(apiFetch, parseImportFile, reload) {
  const [pulling, setPulling] = useState(false);
  const pull = async () => {
    setPulling(true);
    try { await pullSheet(apiFetch, parseImportFile); }
    catch (e) { ui.alert(e.message); }
    finally { setPulling(false); reload(); }
  };
  return [pull, pulling];
}
