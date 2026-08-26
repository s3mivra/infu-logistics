import { useState } from 'react';

// #7 - manage Storage Locations and Stock Categories. Pure CRUD over the
// context-provided save/delete handlers; kept in its own component so the small
// add/edit form state doesn't bloat InventoryTab.
export default function StockTaxonomyPanel({
  stockLocations = [], stockCategories = [],
  saveStockLocation, deleteStockLocation, saveStockCategory, deleteStockCategory,
}) {
  const [locName, setLocName] = useState('');
  const [locNote, setLocNote] = useState('');
  const [catName, setCatName] = useState('');
  const [catPrefix, setCatPrefix] = useState('');
  const [busy, setBusy] = useState(false);

  const addLoc = async () => {
    if (!locName.trim() || busy) return;
    setBusy(true);
    const ok = await saveStockLocation({ name: locName.trim(), note: locNote.trim() });
    setBusy(false);
    if (ok) { setLocName(''); setLocNote(''); }
  };
  const addCat = async () => {
    if (!catName.trim() || busy) return;
    setBusy(true);
    const ok = await saveStockCategory({ name: catName.trim(), prefix: catPrefix.trim() });
    setBusy(false);
    if (ok) { setCatName(''); setCatPrefix(''); }
  };

  const card = 'bg-card-bg border border-white/10 rounded-xl p-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded p-2 text-fg text-sm outline-none focus:border-accent';
  const rowBtn = 'text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded transition min-h-[32px]';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Storage locations */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">Storage Locations</h3>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input value={locName} onChange={e => setLocName(e.target.value)} placeholder="Location name (e.g. Main Warehouse)" className={input} />
          <input value={locNote} onChange={e => setLocNote(e.target.value)} placeholder="Note (optional)" className={input} />
          <button onClick={addLoc} disabled={busy || !locName.trim()} className="bg-accent text-white px-4 py-2 rounded font-bold text-xs uppercase tracking-wider disabled:opacity-40 shrink-0 min-h-[40px]">Add</button>
        </div>
        {stockLocations.length === 0 ? (
          <p className="text-fg/40 text-xs py-4 text-center uppercase tracking-widest">No locations yet</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {stockLocations.map(l => (
              <li key={l._id} className="flex items-center justify-between py-2.5 gap-2">
                <div className="min-w-0">
                  <p className="text-fg font-bold text-sm truncate">{l.name}{l.isActive === false && <span className="ml-2 text-[9px] text-red-400 uppercase">inactive</span>}</p>
                  {l.note && <p className="text-fg/50 text-[11px] truncate">{l.note}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => saveStockLocation({ isActive: l.isActive === false }, l._id)} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>{l.isActive === false ? 'Enable' : 'Disable'}</button>
                  <button onClick={() => deleteStockLocation(l._id)} className={`${rowBtn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>Del</button>
                </div>
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
        {stockCategories.length === 0 ? (
          <p className="text-fg/40 text-xs py-4 text-center uppercase tracking-widest">No categories yet</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {stockCategories.map(c => (
              <li key={c._id} className="flex items-center justify-between py-2.5 gap-2">
                <div className="min-w-0">
                  <p className="text-fg font-bold text-sm truncate">
                    {c.name}
                    {c.prefix && <span className="ml-2 text-[10px] font-mono bg-brand/20 text-brand px-1.5 py-0.5 rounded">{c.prefix}</span>}
                    {c.isActive === false && <span className="ml-2 text-[9px] text-red-400 uppercase">inactive</span>}
                  </p>
                  {c.note && <p className="text-fg/50 text-[11px] truncate">{c.note}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => saveStockCategory({ isActive: c.isActive === false }, c._id)} className={`${rowBtn} bg-white/5 text-fg/70 hover:bg-white/10`}>{c.isActive === false ? 'Enable' : 'Disable'}</button>
                  <button onClick={() => deleteStockCategory(c._id)} className={`${rowBtn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>Del</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
