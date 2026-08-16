import { useState, useEffect, useCallback } from 'react';
import { Network, Link2, Link2Off, Send, Download, Copy, Check, RefreshCw, Plus } from 'lucide-react';

const statusColor = {
  Pending:  'bg-yellow-500/15 text-yellow-400',
  Accepted: 'bg-blue-500/15 text-blue-400',
  Released: 'bg-blue-500/15 text-blue-400',
  Received: 'bg-green-500/15 text-green-500',
  Rejected: 'bg-red-500/15 text-red-400',
};

export default function HubTab({ ctx }) {
  const { apiFetch: authFetch, isSuperAdmin, inventory = [], peso } = ctx;

  const [info, setInfo]           = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState('');
  const [copied, setCopied]       = useState(false);

  // invite / redeem
  const [inviteCode, setInviteCode]   = useState('');
  const [redeemCode, setRedeemCode]   = useState('');
  const [redeemBusy, setRedeemBusy]   = useState(false);
  const [redeemErr, setRedeemErr]     = useState('');

  // send transfer form
  const [sendFrom, setSendFrom]       = useState('__self__');
  const [sendPartner, setSendPartner] = useState('');
  const [sendItem, setSendItem]       = useState('');
  const [sendQty, setSendQty]         = useState('');
  const [sendNote, setSendNote]       = useState('');
  const [sendCart, setSendCart]       = useState([]); // [{itemId,itemName,unit,qty,note}]
  const [sendBusy, setSendBusy]       = useState(false);
  const [sendErr, setSendErr]         = useState('');

  // accept modal
  const [acceptTarget, setAcceptTarget]     = useState(null); // CrossTransfer doc
  const [acceptItemId, setAcceptItemId]     = useState('');
  const [acceptCreateNew, setAcceptCreateNew] = useState(false);
  const [acceptBusy, setAcceptBusy]         = useState(false);
  const [acceptErr, setAcceptErr]           = useState('');

  const load = useCallback(async () => {
    try {
      const [iRes, tRes] = await Promise.all([
        authFetch('/api/hub/info'),
        authFetch('/api/hub/transfers'),
      ]);
      const [iD, tD] = await Promise.all([iRes.json(), tRes.json()]);
      if (iRes.ok) setInfo(iD);
      if (tRes.ok) setTransfers(tD.transfers || []);
    } catch {}
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const generateInvite = async () => {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/hub/invite', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { setErr(d.error); return; }
      setInviteCode(d.code);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(inviteCode); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  const redeem = async () => {
    if (!redeemCode.trim()) return;
    setRedeemBusy(true); setRedeemErr('');
    try {
      const r = await authFetch('/api/hub/redeem', { method: 'POST', body: JSON.stringify({ code: redeemCode.trim() }) });
      const d = await r.json();
      if (!r.ok) { setRedeemErr(d.error); return; }
      setRedeemCode('');
      load();
    } catch (e) { setRedeemErr(e.message); }
    finally { setRedeemBusy(false); }
  };

  const disconnect = async (partnerSlug) => {
    if (!confirm(`Disconnect from ${partnerSlug}?`)) return;
    await authFetch(`/api/hub/links/${partnerSlug}`, { method: 'DELETE' });
    load();
  };

  const addToCart = () => {
    const qty = parseFloat(sendQty);
    if (!sendItem || !(qty > 0)) return;
    const inv = inventory.find(i => i._id === sendItem);
    if (!inv) return;
    setSendCart(c => [...c, { itemId: sendItem, itemName: inv.itemName, unit: inv.unit, qty, note: sendNote.trim() }]);
    setSendItem(''); setSendQty(''); setSendNote('');
  };

  const removeFromCart = (idx) => setSendCart(c => c.filter((_, i) => i !== idx));

  const sendTransfer = async () => {
    if (!sendPartner || sendCart.length === 0) return;
    setSendBusy(true); setSendErr('');
    const warnings = [];
    try {
      for (const line of sendCart) {
        const r = await authFetch('/api/hub/transfers/send', {
          method: 'POST',
          body: JSON.stringify({ partnerSlug: sendPartner, itemId: line.itemId, qtyBase: line.qty, note: line.note }),
        });
        const d = await r.json();
        if (!r.ok) { setSendErr(d.error); return; }
        if (d.warning) warnings.push(d.warning);
      }
      setSendCart([]);
      if (warnings.length) setSendErr(`⚠ ${warnings.join('; ')}`);
      load();
    } catch (e) { setSendErr(e.message); }
    finally { setSendBusy(false); }
  };

  const openAccept = (t) => { setAcceptTarget(t); setAcceptItemId(''); setAcceptCreateNew(false); setAcceptErr(''); };

  const doAccept = async () => {
    if (!acceptTarget) return;
    if (!acceptCreateNew && !acceptItemId) { setAcceptErr('Choose an inventory item or create a new one.'); return; }
    setAcceptBusy(true); setAcceptErr('');
    try {
      const r = await authFetch(`/api/hub/transfers/${acceptTarget._id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ itemId: acceptItemId || undefined, createNew: acceptCreateNew }),
      });
      const d = await r.json();
      if (!r.ok) { setAcceptErr(d.error); return; }
      setAcceptTarget(null);
      load();
    } catch (e) { setAcceptErr(e.message); }
    finally { setAcceptBusy(false); }
  };

  const act = async (id, action) => {
    await authFetch(`/api/hub/transfers/${id}/${action}`, { method: 'POST', body: '{}' });
    load();
  };

  const card  = 'bg-card-bg border border-white/10 rounded-xl p-4 mb-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-accent';
  const btn   = (v = 'primary') => `px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[40px] disabled:opacity-40 transition ${
    v === 'primary' ? 'bg-accent text-white hover:opacity-90' :
    v === 'ghost'   ? 'border border-white/15 text-fg hover:bg-white/5' :
    v === 'red'     ? 'border border-red-500/30 text-red-400 hover:bg-red-500/10' : ''
  }`;

  const partners = info?.links || [];
  const pendingInbound = transfers.filter(t => t.direction === 'inbound' && t.status === 'Pending');

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-10">

      {/* ── My Business ID ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Network size={16} className="text-accent" />
          <h3 className="text-fg font-black uppercase tracking-wider text-sm">My Business ID</h3>
        </div>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-page-bg border border-white/10 rounded-lg px-4 py-3 text-accent font-mono font-black text-lg tracking-widest">
            {info?.tenant ?? '…'}
          </code>
          <button onClick={load} className={btn('ghost')}><RefreshCw size={14} /></button>
        </div>
        <p className="text-fg/40 text-xs mt-2">Share this ID so other businesses can find you. They enter your invite code - not this ID directly.</p>
      </div>

      {/* ── Connected Partners ── */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">
          Connected Partners <span className="text-fg/40 font-normal normal-case tracking-normal">({partners.length})</span>
        </h3>
        {partners.length === 0 ? (
          <p className="text-fg/40 text-xs py-4 text-center uppercase tracking-widest">No connections yet</p>
        ) : (
          <div className="space-y-2">
            {partners.map(p => (
              <div key={p._id} className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Link2 size={13} className="text-accent" />
                    <span className="text-fg font-bold text-sm">{p.partnerName || p.partnerSlug}</span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded ${p.role === 'hub' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
                      {p.role === 'hub' ? 'HUB' : 'CLIENT'}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${p.status === 'active' ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-400'}`}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-fg/40 text-xs mt-0.5 ml-5">{p.partnerSlug}</p>
                </div>
                {isSuperAdmin && (
                  <button onClick={() => disconnect(p.partnerSlug)} className={btn('red')} title="Disconnect">
                    <Link2Off size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Connect ── */}
      {isSuperAdmin && (
        <div className={card}>
          <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-4">Connect a Business</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Generate invite */}
            <div>
              <p className="text-fg/50 text-xs uppercase tracking-widest font-bold mb-2">Generate Invite Code</p>
              <p className="text-fg/40 text-xs mb-3">Share this code with another business. They redeem it to link with you. Code expires in 24 h.</p>
              {inviteCode ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-accent font-mono font-bold text-sm tracking-widest">
                    {inviteCode}
                  </code>
                  <button onClick={copyCode} className={btn('ghost')}>
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>
              ) : (
                <button onClick={generateInvite} disabled={busy} className={btn()}>
                  <Plus size={13} className="inline mr-1" />Generate Code
                </button>
              )}
              {inviteCode && (
                <button onClick={() => { setInviteCode(''); generateInvite(); }} disabled={busy} className="mt-2 text-xs text-fg/40 hover:text-fg underline">
                  Generate new code
                </button>
              )}
            </div>

            {/* Redeem code */}
            <div>
              <p className="text-fg/50 text-xs uppercase tracking-widest font-bold mb-2">Redeem a Code</p>
              <p className="text-fg/40 text-xs mb-3">Enter the invite code from your hub/partner to link this business as a client.</p>
              <div className="flex gap-2">
                <input
                  className={input}
                  placeholder="SLUG-XXXXXXXXXX"
                  value={redeemCode}
                  onChange={e => setRedeemCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && redeem()}
                />
                <button onClick={redeem} disabled={redeemBusy || !redeemCode.trim()} className={btn()}>
                  {redeemBusy ? '…' : 'Link'}
                </button>
              </div>
              {redeemErr && <p className="text-red-400 text-xs mt-2">{redeemErr}</p>}
            </div>
          </div>
          {err && <p className="text-red-400 text-xs mt-3">{err}</p>}
        </div>
      )}

      {/* ── New Transfer ── */}
      {partners.length > 0 && (
        <div className={card}>
          <div className="flex items-center gap-2 mb-4">
            <Send size={15} className="text-accent" />
            <h3 className="text-fg font-black uppercase tracking-wider text-sm">New Transfer</h3>
          </div>

          {/* FROM / TO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">From (Source)</label>
              <select value={sendFrom} onChange={e => setSendFrom(e.target.value)} className={input}>
                <option value="__self__">This Business ({info?.tenant ?? '…'})</option>
                {partners.filter(p => p.status === 'active').map(p => (
                  <option key={p._id} value={p.partnerSlug}>{p.partnerName || p.partnerSlug}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">To (Destination)</label>
              <select value={sendPartner} onChange={e => setSendPartner(e.target.value)} className={input}>
                <option value="">- Select business -</option>
                {partners.filter(p => p.status === 'active' && (sendFrom === '__self__' || p.partnerSlug !== sendFrom)).map(p => (
                  <option key={p._id} value={p.partnerSlug}>{p.partnerName || p.partnerSlug}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Add item row */}
          <div className="bg-page-bg border border-white/8 rounded-xl p-3 mb-3">
            <p className="text-[10px] text-fg/40 uppercase font-bold mb-2">Add Item</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={sendItem} onChange={e => setSendItem(e.target.value)} className={input}>
                <option value="">- Select product -</option>
                {inventory.map(i => (
                  <option key={i._id} value={i._id}>{i.itemName} · {i.stockQty} {i.unit}</option>
                ))}
              </select>
              <input
                type="number" min="0.001" step="any" value={sendQty}
                onChange={e => setSendQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addToCart()}
                className={input}
                placeholder={sendItem && inventory.find(i => i._id === sendItem) ? `Qty (${inventory.find(i => i._id === sendItem).unit})` : 'Quantity'}
              />
              <input value={sendNote} onChange={e => setSendNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addToCart()} className={input} placeholder="Note (optional)" />
            </div>
            <button
              onClick={addToCart}
              disabled={!sendItem || !(parseFloat(sendQty) > 0)}
              className={`mt-2 ${btn('ghost')} text-xs`}
            >+ Add to Transfer</button>
          </div>

          {/* Cart */}
          {sendCart.length > 0 && (
            <div className="border border-white/8 rounded-xl overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-fg/40 text-[9px] uppercase tracking-widest border-b border-white/8 bg-white/3">
                    <th className="text-left py-2 px-3">Product</th>
                    <th className="text-right py-2 px-3">Qty</th>
                    <th className="text-left py-2 px-3">Note</th>
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {sendCart.map((line, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-2 px-3 font-bold text-fg">{line.itemName}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-fg">{line.qty} {line.unit}</td>
                      <td className="py-2 px-3 text-fg/50 italic">{line.note || '-'}</td>
                      <td className="py-2 px-3 text-right">
                        <button onClick={() => removeFromCart(i)} className="text-red-400/60 hover:text-red-400 text-[10px] font-bold uppercase">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={sendTransfer}
            disabled={sendBusy || !sendPartner || sendCart.length === 0}
            className={btn()}
          >
            {sendBusy ? 'Sending…' : `Send ${sendCart.length > 0 ? `${sendCart.length} item${sendCart.length > 1 ? 's' : ''}` : 'Transfer'}`}
          </button>
          {sendErr && <p className={`text-xs mt-2 ${sendErr.startsWith('⚠') ? 'text-yellow-400' : 'text-red-400'}`}>{sendErr}</p>}
        </div>
      )}

      {/* ── Pending Inbound (action required) ── */}
      {pendingInbound.length > 0 && (
        <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-4 mb-4">
          <h3 className="text-yellow-400 font-black uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
            <Download size={14} /> {pendingInbound.length} Inbound Transfer{pendingInbound.length > 1 ? 's' : ''} - Action Required
          </h3>
          <div className="space-y-3">
            {pendingInbound.map(t => (
              <div key={t._id} className="flex items-center justify-between gap-3 bg-card-bg rounded-lg p-3">
                <div>
                  <p className="text-fg font-bold text-sm">{t.itemName}</p>
                  <p className="text-fg/50 text-xs">{t.qtyBase} {t.unit} from <span className="text-fg/80 font-bold">{t.partnerName || t.partnerSlug}</span></p>
                  {t.note && <p className="text-fg/40 text-xs italic">{t.note}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openAccept(t)} className={btn()}>Accept</button>
                  <button onClick={() => act(t._id, 'reject')} className={btn('red')}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── All Transfers ── */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-fg font-black uppercase tracking-wider text-sm">Transfer History</h3>
          <button onClick={load} className={btn('ghost')}><RefreshCw size={13} /></button>
        </div>
        {transfers.length === 0 ? (
          <p className="text-fg/40 text-xs py-6 text-center uppercase tracking-widest">No transfers yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/40 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2">Ref</th>
                  <th className="text-left py-2">Dir</th>
                  <th className="text-left py-2">Partner</th>
                  <th className="text-left py-2">Item</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-left py-2 pl-3">Status</th>
                  <th className="text-right py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map(t => (
                  <tr key={t._id} className="border-b border-white/5 hover:bg-white/2">
                    <td className="py-2 text-fg/50 text-xs font-mono">{t.reference}</td>
                    <td className="py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.direction === 'outbound' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
                        {t.direction === 'outbound' ? '↑ OUT' : '↓ IN'}
                      </span>
                    </td>
                    <td className="py-2 text-fg/70 text-xs">{t.partnerName || t.partnerSlug}</td>
                    <td className="py-2 text-fg font-bold text-xs">{t.itemName}</td>
                    <td className="py-2 text-right text-fg tabular-nums font-bold text-xs">{t.qtyBase} {t.unit}</td>
                    <td className="py-2 pl-3">
                      <span className={`text-[10px] font-black px-2 py-1 rounded ${statusColor[t.status] || 'bg-white/10 text-fg/40'}`}>{t.status}</span>
                    </td>
                    <td className="py-2 text-right">
                      {t.direction === 'inbound' && t.status === 'Pending' && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openAccept(t)} className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 min-h-[28px]">Accept</button>
                          <button onClick={() => act(t._id, 'reject')} className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 min-h-[28px]">Reject</button>
                        </div>
                      )}
                      {t.direction === 'outbound' && t.status === 'Pending' && (
                        <button onClick={() => act(t._id, 'cancel')} className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/8 text-fg/50 hover:bg-white/15 min-h-[28px]">Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Accept modal ── */}
      {acceptTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card-bg border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-fg font-black text-base mb-1">Accept Transfer</h3>
            <p className="text-fg/50 text-sm mb-4">
              Receiving <span className="text-fg font-bold">{acceptTarget.qtyBase} {acceptTarget.unit}</span> of{' '}
              <span className="text-fg font-bold">{acceptTarget.itemName}</span> from{' '}
              <span className="text-accent font-bold">{acceptTarget.partnerName || acceptTarget.partnerSlug}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">Add to existing inventory item</label>
                <select value={acceptItemId} onChange={e => { setAcceptItemId(e.target.value); if (e.target.value) setAcceptCreateNew(false); }} className={input} disabled={acceptCreateNew}>
                  <option value="">- Choose item -</option>
                  {inventory.map(i => <option key={i._id} value={i._id}>{i.itemName} · {i.stockQty} {i.unit}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 text-sm text-fg/60">
                <div className="flex-1 h-px bg-white/10" />or<div className="flex-1 h-px bg-white/10" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-fg">
                <input type="checkbox" checked={acceptCreateNew} onChange={e => { setAcceptCreateNew(e.target.checked); if (e.target.checked) setAcceptItemId(''); }} className="accent-accent" />
                Auto-create new inventory item for this
              </label>
            </div>

            {acceptErr && <p className="text-red-400 text-xs mt-3">{acceptErr}</p>}

            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setAcceptTarget(null)} className={btn('ghost')}>Cancel</button>
              <button onClick={doAccept} disabled={acceptBusy || (!acceptItemId && !acceptCreateNew)} className={btn()}>
                {acceptBusy ? 'Accepting…' : 'Confirm Accept'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
