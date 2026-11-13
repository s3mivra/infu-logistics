import { useState } from 'react';
import { UserSearch, Download, Eraser } from 'lucide-react';
import * as ui from '../../shared/ui';
import { loadXlsx } from '../../shared/xlsx';

// A person's data, on request (Data Privacy Act): find a client, a walk-in
// customer or a staff member, see what is held about them, export it, or erase
// it (server: features/privacy.js). Erasing anonymises - sales and their
// amounts stay as the business's records - and keeps what the law requires,
// saying so. Needs the privacy permission; exporting also needs Export All;
// erasing asks for the password and the word ERASE.
const box = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const btn = 'px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-50 flex items-center gap-1.5';
const qs = (p) => new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')).toString();
const whoOf = (p) => ({ type: p.type, id: p.id, name: p.name, phone: p.phone });

export default function PrivacyCard({ apiFetch, can }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(null);
  const [picked, setPicked] = useState(null);     // { person, profile, counts, who }
  const [busy, setBusy] = useState('');
  const [eraseOpen, setEraseOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const canExport = can?.('screen.ledger.exportall');

  const call = async (path, opts) => (await apiFetch(path, opts)).json();
  const search = async (e) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setBusy('search'); setPicked(null);
    try { const d = await call(`/api/privacy/search?${qs({ q: q.trim() })}`); setPeople(d.success ? d.people : []); if (!d.success) ui.alert(d.error || 'Search failed.'); }
    catch { ui.alert('Network error.'); } finally { setBusy(''); }
  };
  const open = async (p) => {
    setBusy('open'); setEraseOpen(false); setTyped('');
    try {
      const d = await call(`/api/privacy/person?${qs(whoOf(p))}`);
      if (!d.success) return ui.alert(d.error || 'Could not load.');
      setPicked({ ...d, who: whoOf(p) });
    } catch { ui.alert('Network error.'); } finally { setBusy(''); }
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const d = await call(`/api/privacy/person?${qs({ ...picked.who, export: '1' })}`);
      if (!d.success) return ui.alert(d.error || 'Could not export.');
      const XLSX = await loadXlsx();
      const wb = XLSX.utils.book_new();
      const add = (name, rows) => { if (rows && rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name); };
      add('Person', [{ person: d.data.person, type: d.data.type, exportedAt: d.data.gatheredAt }]);
      if (d.data.profile) add('Profile', [d.data.profile]);
      add('Orders', d.data.orders); add('Reservations', d.data.reservations); add('Quotations', d.data.quotations);
      add('Payroll', d.data.payroll); add('Attendance', d.data.attendance);
      XLSX.writeFile(wb, `Personal_data_${String(d.data.person).replace(/[^\w-]+/g, '_').slice(0, 40)}.xlsx`);
    } catch { ui.alert('Network error.'); } finally { setBusy(''); }
  };

  const eraseText = () => {
    const c = picked.counts;
    return picked.person.type === 'staff'
      ? 'Their sign-in is closed (password, PIN and two-step cleared) and their government numbers are removed once payroll no longer needs them. Their name stays on sales and the audit log.'
      : `Their name, phone, address and notes come off ${c.orders} order(s)${c.reservations ? `, ${c.reservations} reservation(s)` : ''}${c.quotations ? `, ${c.quotations} quotation(s)` : ''}${picked.person.type === 'client' ? ' and their account is closed' : ''}. Amounts and order numbers stay. SC/PWD details on recent sales are kept for tax rules.`;
  };
  const erase = async () => {
    if (typed !== 'ERASE') return;
    const password = await ui.confirmWithPassword({ title: 'Your password', message: 'Enter your password to erase this person\'s data.', confirmLabel: 'Erase' });
    if (!password) return;
    setBusy('erase');
    try {
      const d = await call('/api/privacy/erase', { method: 'POST', body: JSON.stringify({ ...picked.who, confirm: 'ERASE', password }) });
      if (!d.success) return ui.alert(d.error || 'Could not erase.');
      ui.alert(`Erased.${d.kept?.length ? ` Kept by law: ${d.kept.join(' ')}` : ''}`);
      setPicked(null); setPeople(null); setEraseOpen(false); setTyped('');
    } catch { ui.alert('Network error.'); } finally { setBusy(''); }
  };

  return (
    <div className="bg-surface border border-white/10 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2"><UserSearch size={18} className="text-brand-text" /><h3 className="text-fg font-black">A person's data</h3></div>
      <p className="text-xs text-fg/70">When a client, customer or staff member asks for a copy of their data, or for it to be erased. Search by name, phone, e-mail or client code.</p>
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, e-mail or code" className={`${box} flex-1`} />
        <button type="submit" disabled={busy === 'search' || q.trim().length < 2} className={`${btn} bg-brand text-on-brand`}>{busy === 'search' ? 'Searching…' : 'Search'}</button>
      </form>

      {people && !picked && (
        people.length === 0 ? <p className="text-xs text-fg/60">No one found.</p> : (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {people.map((p, i) => (
              <li key={`${p.type}-${p.id || p.name}-${p.phone || ''}-${i}`}>
                <button onClick={() => open(p)} className="w-full text-left px-3 py-2 hover:bg-white/5">
                  <span className="text-sm text-fg font-bold">{p.label}</span>
                  <span className="block text-[11px] text-fg/60">{p.type === 'client' ? 'Client account' : p.type === 'staff' ? 'Staff account' : p.detail}{p.type === 'client' && p.detail ? ` · ${p.detail}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {picked && (
        <div className="space-y-3 rounded-lg border border-white/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-fg font-black">{picked.person.label}</p>
              <p className="text-[11px] text-fg/70">
                {picked.person.type === 'staff'
                  ? `${picked.counts.payroll} payroll line(s), ${picked.counts.attendance} clock record(s)`
                  : `${picked.counts.orders} order(s), ${picked.counts.reservations} reservation(s), ${picked.counts.quotations} quotation(s)`}
              </p>
            </div>
            <button onClick={() => setPicked(null)} className="text-xs text-fg/60 hover:text-fg">Back</button>
          </div>
          {picked.profile && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {Object.entries(picked.profile).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-fg/60">{k}</dt><dd className="text-fg break-words">{String(v)}</dd></div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={exportData} disabled={!canExport || busy === 'export'} title={canExport ? 'Everything held about them, as a spreadsheet' : 'Needs the Export All permission'} className={`${btn} bg-white/10 text-fg`}>
              <Download size={13} /> {busy === 'export' ? 'Exporting…' : 'Export (Excel)'}
            </button>
            <button onClick={() => setEraseOpen((o) => !o)} className={`${btn} bg-red-700 text-white`}>
              <Eraser size={13} /> Erase…
            </button>
          </div>
          {eraseOpen && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 space-y-2">
              <p className="text-xs text-fg">{eraseText()} This cannot be undone.</p>
              <div className="flex gap-2">
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type ERASE" aria-label="Type ERASE to confirm" className={`${box} flex-1`} />
                <button onClick={erase} disabled={typed !== 'ERASE' || busy === 'erase'} className={`${btn} bg-red-700 text-white`}>{busy === 'erase' ? 'Erasing…' : 'Erase now'}</button>
              </div>
            </div>
          )}
          {!canExport && <p className="text-[10px] text-fg/60">Exporting needs the Export All permission.</p>}
        </div>
      )}
    </div>
  );
}
