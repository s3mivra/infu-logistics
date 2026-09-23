import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, Download, AlertTriangle, Link2 } from 'lucide-react';
import * as ui from '../../shared/ui';
import { useRefreshTick } from '../../shared/refreshBus';
import { mergeStockTabs } from '../../shared/mergeSheetTabs';

// A Google Sheet linked to the app (server: features/inventory-sheet.js).
//
// `base` says which one: /api/inventory-sheet for the stock count sheet,
// /api/setup-sheet for the setup workbook linked in Settings. The linking,
// the tab choice and the daily check are the same either way; only what the
// caller does with the pulled workbook differs.
//
// "Pull" opens the sheet in the ordinary import preview - nothing changes until
// the preview is confirmed. The daily check only tells you the sheet changed;
// it never applies it, because an import replaces stock counts and would undo
// every sale made since the sheet was edited.

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

export function useInventorySheet(apiFetch, enabled, base = '/api/inventory-sheet') {
  const [sheet, setSheet] = useState(null);
  const tick = useRefreshTick();
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await apiFetch(base);
      const d = await r.json();
      if (d.success) setSheet(d.sheet);
    } catch { /* the panel says so when opened */ }
  }, [apiFetch, enabled, base]);
  useEffect(() => { reload(); }, [reload, tick]);
  return [sheet, setSheet, reload];
}

// Fetches the workbook, keeps the chosen tabs (merged into one), and hands the
// result to the same preview a file upload uses.
export async function pullWorkbook(apiFetch, base = '/api/inventory-sheet') {
  const r = await apiFetch(`${base}/pull`, { method: 'POST' });
  if (!r.ok) {
    let msg = 'Could not pull the sheet.';
    try { msg = (await r.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const XLSX = await import('xlsx');
  return { XLSX, wb: XLSX.read(await r.arrayBuffer(), { type: 'array', cellDates: true, cellNF: true }) };
}

// The stock sheet: the chosen tabs, merged, into the count preview.
export async function pullSheet(apiFetch, parseImportFile, tabs = 'all') {
  const { XLSX, wb } = await pullWorkbook(apiFetch);
  const { workbook, used, skipped, duplicates } = mergeStockTabs(XLSX, wb, tabs);
  if (!workbook) {
    throw new Error(tabs === 'all'
      ? 'None of the tabs has stock columns (Product, and Qty Unit or Unit Cost). Use the columns from the import template.'
      : `None of the chosen tabs can be imported: ${skipped.map(x => `${x.name} (${x.reason})`).join('; ')}.`);
  }
  // Say what is about to be read when it is not simply "the tabs you chose".
  const notes = [];
  if (tabs !== 'all' && skipped.length) notes.push(`Skipped: ${skipped.map(x => `${x.name} (${x.reason})`).join('; ')}.`);
  if (duplicates.length) {
    notes.push(`Listed on more than one tab: ${duplicates.slice(0, 8).join(', ')}${duplicates.length > 8 ? ` and ${duplicates.length - 8} more` : ''}. `
      + 'The import adds these together as separate lots - fix the sheet first if they should be counted once.');
  }
  if (notes.length) {
    const ok = await ui.confirm({
      title: `Read ${used.length} tab${used.length === 1 ? '' : 's'}: ${used.join(', ')}?`,
      message: notes.join(' '), confirmLabel: 'Open the preview',
    });
    if (!ok) return;
  }
  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true });
  await parseImportFile(new File([out], 'google-sheet.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
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

export default function GoogleSheetModal({
  apiFetch, sheet, setSheet, onPull, pulling, onClose,
  base = '/api/inventory-sheet',
  title = 'Google Sheet',
  intro = 'Link the Google Sheet you keep your stock in.',
  pullLabel = 'Pull now',
  pullNote = 'Pull now opens the sheet in the import preview, the same as uploading a file. The quantities in the sheet replace the counts in the system, so pull right after you count - not after sales you have not counted.',
}) {
  const [url, setUrl] = useState(sheet?.url || '');
  const [checkTime, setCheckTime] = useState(sheet?.checkTime || '');
  // 'all', or the names ticked. availableTabs is what the sheet had when last read.
  const [tabs, setTabs] = useState(sheet?.tabs || 'all');
  const [available, setAvailable] = useState(sheet?.availableTabs || []);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState(null);

  const dirty = url.trim() !== (sheet?.url || '') || checkTime !== (sheet?.checkTime || '')
    || JSON.stringify(tabs) !== JSON.stringify(sheet?.tabs || 'all');
  const noneTicked = Array.isArray(tabs) && tabs.length === 0;

  // Reads the tab names of the link in the box - works before it is saved.
  const loadTabs = async () => {
    setLoadingTabs(true); setMsg(null);
    try {
      const r = await apiFetch(`${base}/tabs`, { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      const d = await r.json();
      if (!d.success) { setMsg({ tone: 'err', text: d.error || 'Could not read the tabs.' }); return; }
      setAvailable(d.tabs);
    } catch { setMsg({ tone: 'err', text: 'Could not read the tabs. Check the connection.' }); }
    finally { setLoadingTabs(false); }
  };
  const toggleTab = (name) => setTabs(t => (Array.isArray(t) ? (t.includes(name) ? t.filter(x => x !== name) : [...t, name]) : [name]));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(base, { method: 'PUT', body: JSON.stringify({ url: url.trim(), checkTime, tabs }) });
      const d = await r.json();
      if (d.success) { setSheet(d.sheet); setAvailable(d.sheet.availableTabs || []); setTabs(d.sheet.tabs || 'all'); setMsg({ tone: 'ok', text: url.trim() ? 'Saved. The sheet was read successfully.' : 'Sheet unlinked.' }); }
      else setMsg({ tone: 'err', text: d.error || 'Could not save.' });
    } catch { setMsg({ tone: 'err', text: 'Could not save. Check the connection.' }); }
    finally { setSaving(false); }
  };

  const check = async () => {
    setChecking(true); setMsg(null);
    try {
      const r = await apiFetch(`${base}/check`, { method: 'POST' });
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
          <h2 id="gsheet-title" className="flex-1 text-fg font-black text-sm uppercase tracking-widest">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-fg/70 hover:text-fg hover:bg-white/10"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-fg/75 leading-relaxed">
            {intro} In Google Sheets, click <b>Share</b> and set "Anyone with the link" to <b>Viewer</b>, then paste the link here.
          </p>

          <div>
            <label htmlFor="gsheet-url" className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Sheet link</label>
            <input id="gsheet-url" className={input} value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…" inputMode="url" autoComplete="off" />
          </div>

          <fieldset>
            <legend className="text-[10px] font-bold text-fg/70 uppercase tracking-widest mb-1.5">Tabs to read</legend>
            <div className="flex flex-wrap gap-2 mb-2">
              {[{ v: 'all', label: 'All tabs' }, { v: 'some', label: 'Only the tabs I choose' }].map(o => {
                const on = o.v === 'all' ? tabs === 'all' : Array.isArray(tabs);
                return (
                  <button key={o.v} type="button" aria-pressed={on}
                    onClick={() => {
                      setTabs(o.v === 'all' ? 'all' : (Array.isArray(tabs) ? tabs : []));
                      if (o.v === 'some' && !available.length && url.trim()) loadTabs();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${on ? 'bg-brand text-on-brand border-brand' : 'bg-white/5 text-fg/80 border-white/10 hover:text-fg'}`}>
                    {o.label}
                  </button>
                );
              })}
            </div>
            {Array.isArray(tabs) && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                {available.length === 0 ? (
                  <p className="text-xs text-fg/70">{loadingTabs ? 'Reading the tabs…' : 'Read the sheet to list its tabs.'}</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {available.map(name => (
                      <label key={name} className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-brand" checked={tabs.includes(name)} onChange={() => toggleTab(name)} />
                        {name}
                      </label>
                    ))}
                  </div>
                )}
                {/* A ticked tab the sheet no longer has - renamed or deleted. */}
                {available.length > 0 && tabs.filter(t => !available.includes(t)).map(t => (
                  <p key={t} className="text-xs text-danger flex items-center gap-2">
                    "{t}" is not in the sheet any more.
                    <button type="button" onClick={() => toggleTab(t)} className="underline font-bold">Untick it</button>
                  </p>
                ))}
                <button type="button" onClick={loadTabs} disabled={loadingTabs || !url.trim()}
                  className="text-xs font-bold text-brand-text underline disabled:opacity-50">
                  {loadingTabs ? 'Reading…' : available.length ? 'Refresh the list' : 'Read the tabs'}
                </button>
              </div>
            )}
            <p className="text-[10px] text-fg/70 mt-1 leading-snug">
              Only these tabs are checked for changes and brought into the import. With "All tabs", a tab without stock columns (like notes) is skipped when you pull.
            </p>
          </fieldset>

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
            <button onClick={save} disabled={!dirty || saving || noneTicked}
              className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-brand text-on-brand hover:bg-brand-dark transition disabled:opacity-50">
              {saving ? 'Reading sheet…' : url.trim() || !linked ? 'Save link' : 'Unlink sheet'}
            </button>
          </div>

          {msg && <p role="status" className={`text-xs font-bold ${tone[msg.tone]}`}>{msg.text}</p>}

          {linked && (
            <div className="border-t border-white/10 pt-4 space-y-3">
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-fg/70">Tabs</dt><dd className="text-fg break-words">{sheet.tabs === 'all' || !sheet.tabs ? 'All tabs' : sheet.tabs.join(', ')}</dd>
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
                  <Download size={14} className="rotate-180" /> {pulling ? 'Pulling…' : pullLabel}
                </button>
                <button onClick={check} disabled={checking || dirty}
                  className="flex-1 min-w-[10rem] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 text-fg/85 hover:text-fg hover:border-white/30 transition disabled:opacity-50">
                  <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check now'}
                </button>
              </div>
              <p className="text-[10px] text-fg/70 leading-snug">{pullNote}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Keeps the pull's busy state and error handling in one place for the panel and the banner.
export function usePull(apiFetch, parseImportFile, reload, tabs) {   // the stock sheet
  const [pulling, setPulling] = useState(false);
  const pull = async () => {
    setPulling(true);
    try { await pullSheet(apiFetch, parseImportFile, tabs || 'all'); }
    catch (e) { ui.alert(e.message); }
    finally { setPulling(false); reload(); }
  };
  return [pull, pulling];
}
