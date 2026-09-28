import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Trash2, Download } from 'lucide-react';
import * as ui from './ui';

// Supporting documents on one record (a bill, a journal entry, a voucher...).
// Lists what is attached, opens it, and - for someone allowed to - attaches a
// PDF or photo, or removes one they attached. Files go up as base64 in JSON,
// capped at 5 MB, the same rule the server enforces.
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_BYTES = 5 * 1024 * 1024;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Attachments({ entity, entityId, apiFetch, canAttach = false, currentUserId = '', isSuperAdmin = false, title = 'Documents' }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  const load = useCallback(async () => {
    if (!entityId) return;
    try {
      const d = await (await apiFetch(`/api/attachments?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}`)).json();
      setRows(d.success ? d.attachments : []);
    } catch { setRows([]); }
  }, [apiFetch, entity, entityId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return ui.alert('Files are limited to 5 MB.');
    setBusy(true);
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const d = await (await apiFetch('/api/attachments', { method: 'POST', body: JSON.stringify({ entity, entityId, filename: file.name, mime: file.type, dataBase64 }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not attach the file.');
      load();
    } catch { ui.alert('Could not read or send the file.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  const open = async (a) => {
    try {
      const res = await apiFetch(`/api/attachments/${a._id}/file`);
      if (!res.ok) return ui.alert('Could not open the document.');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url; link.download = a.filename; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { ui.alert('Could not open the document.'); }
  };

  const remove = async (a) => {
    if (!(await ui.confirm(`Remove ${a.filename}? This is recorded in the audit log.`))) return;
    const d = await (await apiFetch(`/api/attachments/${a._id}`, { method: 'DELETE' })).json().catch(() => ({}));
    if (!d.success) return ui.alert(d.error || 'Could not remove it.');
    load();
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-bold text-fg/70 uppercase tracking-widest flex items-center gap-1"><Paperclip size={11} /> {title}{rows?.length ? ` (${rows.length})` : ''}</span>
        {canAttach && (
          <>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={e => upload(e.target.files?.[0])} aria-label={`Attach a document to this ${entity}`} />
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-[11px] font-bold text-brand-text hover:underline disabled:opacity-50">{busy ? 'Attaching…' : '+ Attach'}</button>
          </>
        )}
      </div>
      {rows === null ? <p className="text-[11px] text-fg/65">Loading…</p>
        : rows.length === 0 ? <p className="text-[11px] text-fg/65">None attached.</p>
        : (
          <ul className="space-y-1">
            {rows.map(a => (
              <li key={a._id} className="flex items-center gap-2 text-[11px] bg-white/5 border border-white/10 rounded-lg px-2 py-1.5">
                <button type="button" onClick={() => open(a)} className="flex-1 min-w-0 text-left text-fg hover:underline truncate" title={a.filename}>{a.filename}</button>
                <span className="text-fg/65 shrink-0">{kb(a.size)} · {a.uploadedBy}</span>
                <button type="button" onClick={() => open(a)} aria-label={`Download ${a.filename}`} className="text-fg/70 hover:text-fg"><Download size={12} /></button>
                {(isSuperAdmin || String(a.uploadedById) === String(currentUserId)) && (
                  <button type="button" onClick={() => remove(a)} aria-label={`Remove ${a.filename}`} className="text-danger"><Trash2 size={12} /></button>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
