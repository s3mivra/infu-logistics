import { useState } from 'react';

// #7 - manage Storage Locations and Stock Categories. Pure CRUD over the
// context-provided save/delete handlers; kept in its own component so the small
// add/edit form state doesn't bloat InventoryTab.
export default function StockTaxonomyPanel({
  stockLocations = [], stockCategories = [], inventory = [],
  saveStockLocation, deleteStockLocation, saveStockCategory, deleteStockCategory,
}) {
  const [locName, setLocName] = useState('');
  const [locShortCode, setLocShortCode] = useState('');
  const [locNote, setLocNote] = useState('');
  const [catName, setCatName] = useState('');
  const [catPrefix, setCatPrefix] = useState('');
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState('');

  // Inline-edit state - which row (by _id) is currently being edited, plus its
  // own draft fields. Only one location + one category can be edited at once.
  const [editingLocId, setEditingLocId] = useState('');
  const [editLocName, setEditLocName] = useState('');
  const [editLocShortCode, setEditLocShortCode] = useState('');
  const [editLocNote, setEditLocNote] = useState('');
  const [editingCatId, setEditingCatId] = useState('');
  const [editCatName, setEditCatName] = useState('');
  const [editCatPrefix, setEditCatPrefix] = useState('');
  const [editCatNote, setEditCatNote] = useState('');

  // Items can carry a free-text stockCategory tag (e.g. from import) that was
  // never turned into a real StockCategory record - those show up in the
  // Live Stock filter but not here. Surface them so they can be registered
  // with one click instead of retyping the name.
  const registeredNames = new Set(stockCategories.map(c => c.name.toLowerCase()));
  const unregistered = [...new Set(
    inventory.map(i => (i.stockCategory || '').trim()).filter(Boolean)
  )].filter(n => !registeredNames.has(n.toLowerCase())).sort();

  const registerCat = async (name) => {
    setRegistering(name);
    await saveStockCategory({ name, prefix: '' });
    setRegistering('');
  };

  const addLoc = async () => {
    if (!locName.trim() || busy) return;
    setBusy(true);
    const ok = await saveStockLocation({ name: locName.trim(), shortCode: locShortCode.trim(), note: locNote.trim() });
    setBusy(false);
    if (ok) { setLocName(''); setLocShortCode(''); setLocNote(''); }
  };
  const addCat = async () => {
    if (!catName.trim() || busy) return;
    setBusy(true);
    const ok = await saveStockCategory({ name: catName.trim(), prefix: catPrefix.trim() });
    setBusy(false);
    if (ok) { setCatName(''); setCatPrefix(''); }
  };

  const startEditLoc = (l) => {
    setEditingLocId(l._id);
    setEditLocName(l.name);
    setEditLocShortCode(l.shortCode || '');
    setEditLocNote(l.note || '');
  };
  const cancelEditLoc = () => setEditingLocId('');
  const saveEditLoc = async () => {
    if (!editLocName.trim() || busy) return;
    setBusy(true);
    const ok = await saveStockLocation({ name: editLocName.trim(), shortCode: editLocShortCode.trim(), note: editLocNote.trim() }, editingLocId);
    setBusy(false);
    if (ok) setEditingLocId('');
  };

  const startEditCat = (c) => {
    setEditingCatId(c._id);
    setEditCatName(c.name);
    setEditCatPrefix(c.prefix || '');
    setEditCatNote(c.note || '');
  };
  const cancelEditCat = () => setEditingCatId('');
  const saveEditCat = async () => {
    if (!editCatName.trim() || busy) return;
    setBusy(true);
    const ok = await saveStockCategory({ name: editCatName.trim(), prefix: editCatPrefix.trim(), note: editCatNote.trim() }, editingCatId);
    setBusy(false);
    if (ok) setEditingCatId('');
  };

  const card = 'bg-surface border border-white/10 rounded-xl p-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded p-2 text-fg text-sm outline-none focus:border-accent';
  const rowBtn = 'text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded transition min-h-[32px]';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Storage locations */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-1">Storage Locations</h3>
        <p className="text-fg/50 text-[11px] mb-3">The shortcut shows in the Inventory list instead of the full name, e.g. <span className="font-bold text-fg/70">Main Warehouse</span> → <span className="font-bold text-fg/70">WH</span>.</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input value={locName} onChange={e => setLocName(e.target.value)} placeholder="Location name (e.g. Main Warehouse)" className={input} />
          <input value={locShortCode} onChange={e => setLocShortCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="Shortcut" className={`${input} sm:max-w-[110px] uppercase font-mono`} maxLength={6} />
          <input value={locNote} onChange={e => setLocNote(e.target.value)} placeholder="Note (optional)" className={input} />
          <button onClick={addLoc} disabled={busy || !locName.trim()} className="bg-accent text-white px-4 py-2 rounded font-bold text-xs uppercase tracking-wider disabled:opacity-40 shrink-0 min-h-[40px]">Add</button>
        </div>
        {stockLocations.length === 0 ? (
          <p className="text-fg/40 text-xs py-4 text-center uppercase tracking-widest">No locations yet</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {stockLocations.map(l => (
              <li key={l._id} className="py-2.5">
                {editingLocId === l._id ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={editLocName} onChange={e => setEditLocName(e.target.value)} placeholder="Location name" className={input} />
                    <input value={editLocShortCode} onChange={e => setEditLocShortCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="Shortcut" className={`${input} sm:max-w-[110px] uppercase font-mono`} maxLength={6} />
                    <input value={editLocNote} onChange={e => setEditLocNote(e.target.value)} placeholder="Note (optional)" className={input} />
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={saveEditLoc} disabled={busy || !editLocName.trim()} className={`${rowBtn} bg-accent text-white disabled:opacity-40`}>Save</button>
                      <button onClick={cancelEditLoc} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-fg font-bold text-sm truncate">
                        {l.name}
                        {l.shortCode && <span className="ml-2 text-[10px] font-mono bg-brand/20 text-brand px-1.5 py-0.5 rounded">{l.shortCode}</span>}
                        {l.isActive === false && <span className="ml-2 text-[9px] text-red-400 uppercase">inactive</span>}
                      </p>
                      {l.note && <p className="text-fg/50 text-[11px] truncate">{l.note}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => startEditLoc(l)} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>Edit</button>
                      <button onClick={() => saveStockLocation({ isActive: l.isActive === false }, l._id)} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>{l.isActive === false ? 'Enable' : 'Disable'}</button>
                      <button onClick={() => deleteStockLocation(l._id)} className={`${rowBtn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>Del</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Stock categories */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-1">Stock Categories</h3>
        <p className="text-fg/50 text-[11px] mb-3">A prefix auto-numbers new item codes, e.g. prefix <span className="font-bold text-fg/70">P1</span> → P10001, P10002.</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input value={catName} onChange={e => setCatName(e.target.value)} placeholder="Category name (e.g. Beans)" className={input} />
          <input value={catPrefix} onChange={e => setCatPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="Prefix" className={`${input} sm:max-w-[110px] uppercase font-mono`} maxLength={4} />
          <button onClick={addCat} disabled={busy || !catName.trim()} className="bg-accent text-white px-4 py-2 rounded font-bold text-xs uppercase tracking-wider disabled:opacity-40 shrink-0 min-h-[40px]">Add</button>
        </div>
        {unregistered.length > 0 && (
          <div className="mb-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5">
            <p className="text-[10px] text-yellow-400 uppercase font-bold mb-1.5">Used on items but not registered</p>
            <ul className="space-y-1">
              {unregistered.map(n => (
                <li key={n} className="flex items-center justify-between gap-2">
                  <span className="text-fg/80 text-xs truncate">{n}</span>
                  <button onClick={() => registerCat(n)} disabled={registering === n} className={`${rowBtn} bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 disabled:opacity-40 shrink-0`}>
                    {registering === n ? '…' : 'Register'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {stockCategories.length === 0 ? (
          <p className="text-fg/40 text-xs py-4 text-center uppercase tracking-widest">No categories yet</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {stockCategories.map(c => (
              <li key={c._id} className="py-2.5">
                {editingCatId === c._id ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={editCatName} onChange={e => setEditCatName(e.target.value)} placeholder="Category name" className={input} />
                    <input value={editCatPrefix} onChange={e => setEditCatPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="Prefix" className={`${input} sm:max-w-[110px] uppercase font-mono`} maxLength={4} />
                    <input value={editCatNote} onChange={e => setEditCatNote(e.target.value)} placeholder="Note (optional)" className={input} />
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={saveEditCat} disabled={busy || !editCatName.trim()} className={`${rowBtn} bg-accent text-white disabled:opacity-40`}>Save</button>
                      <button onClick={cancelEditCat} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-fg font-bold text-sm truncate">
                        {c.name}
                        {c.prefix && <span className="ml-2 text-[10px] font-mono bg-brand/20 text-brand px-1.5 py-0.5 rounded">{c.prefix}</span>}
                        {c.isActive === false && <span className="ml-2 text-[9px] text-red-400 uppercase">inactive</span>}
                      </p>
                      {c.note && <p className="text-fg/50 text-[11px] truncate">{c.note}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => startEditCat(c)} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>Edit</button>
                      <button onClick={() => saveStockCategory({ isActive: c.isActive === false }, c._id)} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>{c.isActive === false ? 'Enable' : 'Disable'}</button>
                      <button onClick={() => deleteStockCategory(c._id)} className={`${rowBtn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>Del</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
