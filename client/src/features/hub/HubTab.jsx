import { formatDate } from '../../shared/dates.js';
import { useState, useEffect, useCallback, Fragment } from 'react';
import { statusTone } from '../../shared/statusTone';
import { Network, Link2, Link2Off, Send, Download, Copy, Check, RefreshCw, Plus, LayoutGrid, BarChart3, ExternalLink, Boxes, Share2, Landmark, AlertTriangle } from 'lucide-react';

import { todayStr } from '../../shared/businessDay.js';
import SearchSelect from '../../shared/ui/SearchSelect';
import RangePresets from '../../shared/RangePresets';
import { useRefreshTick } from '../../shared/refreshBus';
import BranchNetworkPanel from './BranchNetworkPanel';
import PagedRows from '../../shared/PagedRows';
import { groupShipments, displayQty, lineValue, exportTransferSlip, exportAllTransfers } from '../../shared/transferSlips';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
// Shared colours (shared/statusTone.js): same meaning, same colour, on every screen.
const statusColor = new Proxy({}, { get: (_, k) => statusTone(k) });

// Transfer Request (negotiation) statuses are a different vocabulary from
// CrossTransfer's shipment statuses above - same color language, own words.
const negoStatusColor = {
  Pending: 'bg-yellow-500/15 text-warning',
  CounterPending: 'bg-orange-500/15 text-warning',
  AwaitingFinal: 'bg-blue-500/15 text-info',
  Approved: 'bg-green-500/15 text-success',
  Declined: 'bg-red-500/15 text-danger',
  Cancelled: 'bg-white/10 text-fg/70',
};

// ── Network Map ──────────────────────────────────────────────────────────────
// Visual topology of this deployment and everything linked to it. Every business
// is its own deployment/database (see hub.js - there is no shared DB), so this
// is the only place the whole shape is visible at once: which business is the
// main host, which branches hang off it, or that this one stands alone.
//
// Drawn from /api/hub/info alone, which is cheap and always loaded. Liveness is
// overlaid only if the on-demand network fan-out has been run - an un-probed
// partner reads "unknown" rather than being wrongly coloured healthy.
//
// NOTE on `role`: a LinkedBusiness row stores THIS instance's role in the
// relationship, not the partner's. role==='hub' means "we are the hub, so this
// partner is our subhost"; role==='client' means "we are the client, so this
// partner is our main host".
function NetworkMap({ info, network, card }) {
  const active = (info?.links || []).filter(l => l.status === 'active');
  const mains = active.filter(l => l.role === 'client'); // partners that host us
  const subs = active.filter(l => l.role === 'hub');     // partners we host

  const liveness = new Map((network?.partners || []).map(p => [p.partnerSlug, p.ok]));
  const tone = (slug) => (!liveness.has(slug) ? 'text-fg/70' : liveness.get(slug) ? 'text-success' : 'text-danger');

  const NW = 152, NH = 46, GAP = 26;
  const rowW = (n) => n * NW + Math.max(0, n - 1) * GAP;
  const W = Math.max(720, rowW(mains.length), rowW(subs.length)) + 48;
  const xs = (n) => { const s = (W - rowW(n)) / 2; return Array.from({ length: n }, (_, i) => s + i * (NW + GAP)); };
  const Y = { main: 26, self: 150, sub: 274 };
  const H = 344;

  const mx = xs(mains.length), sx = xs(subs.length), selfX = (W - NW) / 2;
  const cx = (x) => x + NW / 2;

  const Node = ({ x, y, title, sub, t }) => (
    <g className={t}>
      <rect x={x} y={y} width={NW} height={NH} rx={9} fill="rgba(255,255,255,0.04)" stroke="currentColor" strokeWidth="1.5" />
      <text x={cx(x)} y={y + 20} textAnchor="middle" fill="currentColor" className="text-[11px] font-black">{title}</text>
      <text x={cx(x)} y={y + 34} textAnchor="middle" fill="currentColor" opacity="0.55" className="text-[9px]">{sub}</text>
    </g>
  );

  const RowLabel = ({ y, children }) => (
    <text x={14} y={y} fill="currentColor" opacity="0.35" className="text-[9px] font-black uppercase tracking-widest text-fg">{children}</text>
  );

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-fg font-black uppercase tracking-wider text-sm flex items-center gap-2">
          <Share2 size={15} className="text-brand-text" /> Network Map
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-fg/70 uppercase tracking-widest">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Online</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Unreachable</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-fg/30" /> Not probed</span>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="py-8 text-center">
          <div className="inline-block px-6 py-4 rounded-xl border border-accent/40 bg-accent/5">
            <p className="text-brand-text font-black text-sm">{info?.tenant || 'This Business'}</p>
            <p className="text-fg/70 text-[10px] uppercase tracking-widest mt-1">Standalone</p>
          </div>
          <p className="text-fg/70 text-xs mt-3">Not linked to any other branch. Generate an invite code above to add one.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }} role="img" aria-label="Network topology">
            {mains.map((m, i) => (
              <line key={`ml${m._id}`} x1={cx(mx[i])} y1={Y.main + NH} x2={cx(selfX)} y2={Y.self}
                stroke="currentColor" strokeWidth="1.5" className="text-info" opacity="0.5" />
            ))}
            {subs.map((s, i) => (
              <line key={`sl${s._id}`} x1={cx(selfX)} y1={Y.self + NH} x2={cx(sx[i])} y2={Y.sub}
                stroke="currentColor" strokeWidth="1.5" className="text-special" opacity="0.5" />
            ))}

            {mains.length > 0 && <RowLabel y={Y.main - 8}>Main Host</RowLabel>}
            <RowLabel y={Y.self - 8}>This Business</RowLabel>
            {subs.length > 0 && <RowLabel y={Y.sub - 8}>Branches</RowLabel>}

            {mains.map((m, i) => (
              <Node key={m._id} x={mx[i]} y={Y.main} t={tone(m.partnerSlug)}
                title={m.partnerName || m.partnerSlug} sub={m.partnerSlug} />
            ))}
            <Node x={selfX} y={Y.self} t="text-brand-text" title={info?.tenant || 'This Business'} sub="you" />
            {subs.map((s, i) => (
              <Node key={s._id} x={sx[i]} y={Y.sub} t={tone(s.partnerSlug)}
                title={s.partnerName || s.partnerSlug} sub={s.partnerSlug} />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

export default function HubTab({ ctx }) {
  // fetchERPData reloads the shared inventory the rest of the dashboard reads.
  // A transfer moves real stock, so anything that completes one has to pull it
  // again or the Inventory tab keeps showing pre-transfer quantities until the
  // user reloads the page.
  const { apiFetch: authFetch, isSuperAdmin, inventory = [], peso, fetchERPData, can = () => true } = ctx;
  // History shown one shipment per row; which ones are opened to their lines.
  const [openShipments, setOpenShipments] = useState({});
  const pdfDeps = { loadPdfLibs: ctx.loadPdfLibs, addLogoToPDF: ctx.addLogoToPDF, bizName: ctx.BIZ_NAME };

  const [info, setInfo]           = useState(null);

  // This deployment's branch code ("AC-A001"). It is what a consolidated report
  // groups on: the middle letter is the physical location, so two inventories
  // at one address (AC-A001, AC-A002) roll up together while staying separate
  // sets of books. Validated server-side - a typo would quietly file this
  // branch under "Unassigned".
  const [branchCode, setBranchCode] = useState('');
  const [branchCodeSaved, setBranchCodeSaved] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);
  const loadBranchCode = useCallback(async () => {
    try {
      const r = await authFetch('/api/settings');
      const d = await r.json();
      if (d.success) { setBranchCode(d.settings?.branchCode || ''); setBranchCodeSaved(d.settings?.branchCode || ''); }
    } catch { /* the rest of the tab still works */ }
  }, [authFetch]);
  useEffect(() => { loadBranchCode(); }, [loadBranchCode]);

  const saveBranchCode = async () => {
    setBranchBusy(true); setErr('');
    try {
      const r = await authFetch('/api/settings/branchCode', { method: 'PATCH', body: JSON.stringify({ value: branchCode }) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'Could not save the branch code.'); return; }
      setBranchCodeSaved(d.setting?.value || '');
      setBranchCode(d.setting?.value || '');
    } catch { setErr('Network error saving the branch code.'); }
    finally { setBranchBusy(false); }
  };
  const [transfers, setTransfers] = useState([]);
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState('');
  const [copied, setCopied]       = useState(false);

  // Network Overview (#12): unified inventory + branch comparison + central
  // reporting, pulled live from every linked partner's own API. Loaded on
  // demand (not on every Hub visit) - it fans out a network call per partner.
  const [network, setNetwork]           = useState(null); // { own, partners }
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkView, setNetworkView]   = useState('inventory'); // 'inventory' | 'compare' | 'switch' | 'books'
  // A view this person may not open is never the one showing.
  useEffect(() => {
    if (can(`screen.hub.${networkView}`)) return;
    const first = ['inventory', 'compare', 'switch', 'books'].find(v => can(`screen.hub.${v}`));
    if (first) setNetworkView(first);
  }, [networkView, can]);

  // Consolidated Books: one P&L + Balance Sheet across every linked branch,
  // built from each branch's trial balance (see /api/hub/network-financials).
  // Separate from the network summary above because it spans a date range and
  // is a heavier call - loaded only when the user asks for it.
  const thisYear = new Date().getFullYear();
  const [fin, setFin] = useState(null);
  const [finLoading, setFinLoading] = useState(false);
  const [finStart, setFinStart] = useState(`${thisYear}-01-01`);
  const [finEnd, setFinEnd] = useState(todayStr);

  // invite / redeem
  const [inviteCode, setInviteCode]   = useState('');
  const [redeemCode, setRedeemCode]   = useState('');
  const [redeemBusy, setRedeemBusy]   = useState(false);
  const [redeemErr, setRedeemErr]     = useState('');

  // send transfer form
  const [sendFrom, setSendFrom]       = useState('__self__');
  const [sendPartner, setSendPartner] = useState('');
  const [sendQty, setSendQty]         = useState('');
  const [sendNote, setSendNote]       = useState('');
  const [sendCart, setSendCart]       = useState([]); // [{itemId,itemName,unit,qty,note}]
  const [sendSearch, setSendSearch]   = useState('');
  const [sendBusy, setSendBusy]       = useState(false);
  const [sendErr, setSendErr]         = useState('');

  // accept modal
  const [acceptTarget, setAcceptTarget]     = useState(null); // CrossTransfer doc
  const [acceptItemId, setAcceptItemId]     = useState('');
  const [acceptCreateNew, setAcceptCreateNew] = useState(false);
  const [acceptBusy, setAcceptBusy]         = useState(false);
  const [acceptErr, setAcceptErr]           = useState('');

  // ── TRANSFER REQUESTS (negotiated asks) ──────────────────────────────────
  // The "New Transfer" panel below can ALSO file an ask instead of a push -
  // 'send' is the existing flow (we ship stock we have); 'ask' is new (we
  // request stock we don't have, and the other business can decline, accept
  // as-is, or counter with what they can actually give).
  const [transferMode, setTransferMode] = useState('send'); // 'send' | 'ask'
  const [askPartner, setAskPartner]     = useState('');
  const [askItemName, setAskItemName]   = useState('');
  const [askUnit, setAskUnit]           = useState('');

  // "+ New item not yet in Inventory" - Send Stock normally requires picking
  // a REAL inventory item (it decrements actual stock on send), but a brand
  // new/untracked product has nothing to pick. Toggling this creates the
  // Inventory record first (starting stock = the qty typed here), then adds
  // it to the cart exactly like any other pick.
  const [sendManualMode, setSendManualMode] = useState(false);
  const [sendNewName, setSendNewName]       = useState('');
  const [sendNewUnit, setSendNewUnit]       = useState('pcs');
  const [sendNewCost, setSendNewCost]       = useState('');
  const [sendNewBusy, setSendNewBusy]       = useState(false);
  const [askCart, setAskCart]           = useState([]); // [{itemName,unit,qty,note}]
  const [askBusy, setAskBusy]           = useState(false);
  const [askErr, setAskErr]             = useState('');

  const [transferRequests, setTransferRequests] = useState([]);
  const loadTransferRequests = useCallback(async () => {
    try {
      const r = await authFetch('/api/hub/transfer-requests');
      const d = await r.json();
      if (r.ok) setTransferRequests(d.requests || []);
    } catch {}
  }, [authFetch]);
  const refreshTickA = useRefreshTick();
  useEffect(() => { loadTransferRequests(); }, [loadTransferRequests, refreshTickA]);

  // Counter-offer modal: lets the party being asked adjust quantities down or
  // drop a line entirely - never add a new one (this is "what we can give",
  // not a chance to substitute something else).
  const [counterTarget, setCounterTarget] = useState(null); // TransferRequest doc
  const [counterLines, setCounterLines]   = useState([]);   // editable copy of .lines
  const [counterNote, setCounterNote]     = useState('');
  const [counterBusy, setCounterBusy]     = useState(false);
  const [counterErr, setCounterErr]       = useState('');
  const [declineTarget, setDeclineTarget] = useState(null); // TransferRequest doc
  const [declineReason, setDeclineReason] = useState('');
  const [declineBusy, setDeclineBusy]     = useState(false);


  const sendAsk = async () => {
    if (!askPartner || askCart.length === 0) return;
    setAskBusy(true); setAskErr('');
    try {
      const r = await authFetch('/api/hub/transfer-requests', {
        method: 'POST',
        body: JSON.stringify({ partnerSlug: askPartner, weAreAskingThemToSend: true, items: askCart }),
      });
      const d = await r.json();
      if (!r.ok) { setAskErr(d.error); return; }
      setAskCart([]);
      if (d.warning) setAskErr(`⚠ ${d.warning}`);
      loadTransferRequests();
    } catch (e) { setAskErr(e.message); }
    finally { setAskBusy(false); }
  };

  const actOnRequest = async (id, action, body = {}) => {
    const r = await authFetch(`/api/hub/transfer-requests/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { alert(d.error || `Could not ${action}.`); return null; }
    loadTransferRequests();
    if (action === 'finalize' || action === 'approve-as-is') fetchERPData?.();
    return d;
  };

  const openCounter = (doc) => {
    setCounterTarget(doc);
    setCounterLines(doc.lines.map(l => ({ ...l })));
    setCounterNote('');
    setCounterErr('');
  };
  const updateCounterQty = (idx, qty) => setCounterLines(ls => ls.map((l, i) => i === idx ? { ...l, qty: parseFloat(qty) || 0 } : l));
  const removeCounterLine = (idx) => setCounterLines(ls => ls.filter((_, i) => i !== idx));
  const submitCounter = async () => {
    const lines = counterLines.filter(l => l.qty > 0);
    if (!lines.length) { setCounterErr('At least one line with a quantity greater than zero.'); return; }
    setCounterBusy(true); setCounterErr('');
    try {
      const d = await actOnRequest(counterTarget._id, 'counter', { lines, note: counterNote.trim() });
      if (d) setCounterTarget(null); else setCounterErr('Could not send the counter-offer.');
    } finally { setCounterBusy(false); }
  };

  const submitDecline = async () => {
    setDeclineBusy(true);
    try {
      const d = await actOnRequest(declineTarget._id, 'decline', { reason: declineReason.trim() });
      if (d) setDeclineTarget(null);
    } finally { setDeclineBusy(false); }
  };

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

  const refreshTick = useRefreshTick();
  useEffect(() => { load(); }, [load, refreshTick]);

  const loadNetwork = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const r = await authFetch('/api/hub/network-summary');
      const d = await r.json();
      if (r.ok) setNetwork(d);
    } catch {}
    finally { setNetworkLoading(false); }
  }, [authFetch]);

  const loadFinancials = useCallback(async () => {
    setFinLoading(true); setErr('');
    try {
      const r = await authFetch(`/api/hub/network-financials?start=${finStart}&end=${finEnd}`);
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not build consolidated books.'); return; }
      setFin(d);
    } catch { setErr('Network error building consolidated books.'); }
    finally { setFinLoading(false); }
  }, [authFetch, finStart, finEnd]);

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

  const removeFromCart = (idx) => setSendCart(c => c.filter((_, i) => i !== idx));
  // Request Stock, the same way: tap one of your products to ask for one more,
  // or type a name they may have that you don't stock.
  const askAdd = (itemName, unit) => setAskCart(c => {
    const key = String(itemName).trim().toUpperCase();
    const at = c.findIndex(l => String(l.itemName).trim().toUpperCase() === key);
    if (at >= 0) return c.map((l, i) => (i === at ? { ...l, qty: Number(l.qty || 0) + 1 } : l));
    return [...c, { itemName: String(itemName).trim(), unit: unit || 'pcs', qty: 1, note: '' }];
  });
  const setAskLine = (idx, patch) => setAskCart(c => c.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const dropAskLine = (idx) => setAskCart(c => c.filter((_, i) => i !== idx));
  // Manual-order style: tap a product to add one; tap again (or +) for more.
  const quickAdd = (inv) => setSendCart(c => {
    const at = c.findIndex(l => l.itemId === inv._id);
    if (at >= 0) return c.map((l, i) => (i === at ? { ...l, qty: Number(l.qty || 0) + 1 } : l));
    return [...c, { itemId: inv._id, itemName: inv.itemName, unit: inv.unit, qty: 1, note: '' }];
  });
  const setLine = (idx, patch) => setSendCart(c => c.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const stockOf = (id) => Number(inventory.find(i => i._id === id)?.stockQty ?? NaN);

  // Creates the new Inventory item (starting stock = the qty being sent),
  // then adds it to the cart exactly like picking an existing one - Send
  // Stock always ships a REAL inventory item, so a brand-new product has to
  // become one before it can go in the cart at all.
  const addNewItemToCart = async () => {
    const name = sendNewName.trim();
    const qty = parseFloat(sendQty);
    if (!name || !(qty > 0)) return;
    setSendNewBusy(true); setSendErr('');
    try {
      const res = await authFetch('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          itemName: name, unit: sendNewUnit.trim() || 'pcs',
          stockQty: qty, unitCost: parseFloat(sendNewCost) || 0,
        }),
      });
      const data = await res.json();
      if (!data.success) { setSendErr(data.error || 'Failed to create the new item.'); return; }
      const item = data.item;
      setSendCart(c => [...c, { itemId: item._id, itemName: item.itemName, unit: item.unit, qty, note: sendNote.trim() }]);
      fetchERPData?.(); // so it also shows up in the dropdown for the next line
      setSendManualMode(false);
      setSendNewName(''); setSendNewUnit('pcs'); setSendNewCost(''); setSendQty(''); setSendNote('');
    } catch { setSendErr('Failed to create the new item. Check your connection.'); }
    finally { setSendNewBusy(false); }
  };

  const sendTransfer = async () => {
    if (!sendPartner || sendCart.length === 0) return;
    setSendBusy(true); setSendErr('');
    const warnings = [];
    try {
      // One request for the whole cart: one shipment, one slip to approve,
      // one reference - not a separate transfer per item.
      const r = await authFetch('/api/hub/transfers/send', {
        method: 'POST',
        body: JSON.stringify({ partnerSlug: sendPartner, items: sendCart.map(line => ({ itemId: line.itemId, qty: line.qty, note: line.note })) }),
      });
      const d = await r.json();
      if (!r.ok) { setSendErr(d.error); return; }
      if (d.warning) warnings.push(d.warning);
      if (d.errors?.length) warnings.push(...d.errors);
      setSendCart([]);
      if (warnings.length) setSendErr(`⚠ ${warnings.join('; ')}`);
      else setSendErr('⚠ Transfer slip filed - it must be approved below before the partner is notified.');
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
      // Accepting receives stock into inventory - pull it so the new quantity
      // (and, for an auto-created item, the item itself) shows up immediately.
      fetchERPData?.();
    } catch (e) { setAcceptErr(e.message); }
    finally { setAcceptBusy(false); }
  };

  const act = async (id, action) => {
    await authFetch(`/api/hub/transfers/${id}/${action}`, { method: 'POST', body: '{}' });
    load();
    fetchERPData?.();
  };

  // Approve/reject act on a whole SHIPMENT (every line filed together), not one
  // line - the slip is signed off as a unit, the way a requisition is.
  const [slipBusy, setSlipBusy] = useState('');
  const actOnSlip = async (shipmentRef, action, reason) => {
    setSlipBusy(shipmentRef); setErr('');
    try {
      const r = await authFetch(`/api/hub/transfers/${action}`, {
        method: 'POST',
        body: JSON.stringify({ shipmentRef, ...(reason ? { reason } : {}) }),
      });
      const d = await r.json();
      // An unreachable partner leaves the slip untouched so approving again
      // retries cleanly - say so rather than silently doing nothing.
      if (!r.ok) { setErr(d.error || `Could not ${action} the transfer slip.`); return; }
      load();
      // An approved shipment is on its way out - refresh so the Inventory tab
      // reflects it rather than showing stale on-hand figures.
      fetchERPData?.();
    } catch (e) { setErr(e.message); }
    finally { setSlipBusy(''); }
  };

  const card  = 'bg-surface border border-white/10 rounded-xl p-4 mb-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded-lg p-2.5 text-fg text-sm outline-none focus:border-accent';
  const btn   = (v = 'primary') => `px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider min-h-[40px] disabled:opacity-40 transition ${
    v === 'primary' ? 'bg-accent text-on-brand hover:opacity-90' :
    v === 'ghost'   ? 'border border-white/15 text-fg hover:bg-white/5' :
    v === 'red'     ? 'border border-red-500/30 text-danger hover:bg-red-500/10' : ''
  }`;

  const partners = info?.links || [];
  const pendingInbound = transfers.filter(t => t.direction === 'inbound' && t.status === 'Pending');
  // Outbound slips still awaiting approval, grouped by the shipment they were
  // filed under so a multi-item transfer is approved as one slip.
  const awaitingApproval = Object.values(
    transfers
      .filter(t => t.direction === 'outbound' && t.status === 'Requested')
      .reduce((acc, t) => {
        const k = t.shipmentRef || t.reference;
        (acc[k] ||= { shipmentRef: k, partnerName: t.partnerName || t.partnerSlug, requestedBy: t.requestedBy, createdAt: t.createdAt, lines: [] }).lines.push(t);
        return acc;
      }, {})
  );

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-10">

      {/* ── My Business ID ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Network size={16} className="text-brand-text" />
          <h3 className="text-fg font-black uppercase tracking-wider text-sm">My Business ID</h3>
        </div>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-page-bg border border-white/10 rounded-lg px-4 py-3 text-brand-text font-mono font-black text-lg tracking-widest">
            {info?.tenant ?? '…'}
          </code>
          <button onClick={load} className={btn('ghost')}><RefreshCw size={14} /></button>
        </div>
        <p className="text-fg/70 text-xs mt-2">Share this ID so other businesses can find you. They enter your invite code - not this ID directly.</p>
      </div>

      {/* ── Connected Partners ── */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">
          Connected Partners <span className="text-fg/70 font-normal normal-case tracking-normal">({partners.length})</span>
        </h3>
        {partners.length === 0 ? (
          <p className="text-fg/70 text-xs py-4 text-center uppercase tracking-widest">No connections yet</p>
        ) : (
          <div className="space-y-2">
            {partners.map(p => (
              <div key={p._id} className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Link2 size={13} className="text-brand-text" />
                    <span className="text-fg font-bold text-sm">{p.partnerName || p.partnerSlug}</span>
                    {/* `role` is OUR side of the relationship, not theirs:
                        role==='hub' means we are the hub, so this partner is
                        our subhost; role==='client' means we are the client,
                        so this partner is our main host. Label accordingly. */}
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded ${p.role === 'hub' ? 'bg-purple-500/15 text-special' : 'bg-blue-500/15 text-info'}`}>
                      {p.role === 'hub' ? 'SUBHOST' : 'MAIN HOST'}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${p.status === 'active' ? 'bg-green-500/15 text-success' : 'bg-red-500/15 text-danger'}`}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-fg/70 text-xs mt-0.5 ml-5">{p.partnerSlug}</p>
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

      {/* Branch identity. Without a code this deployment reports as
          "Unassigned" in the consolidated books - its money still counts, but
          it cannot roll up with the other inventories at its own address. */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div>
            <h3 className="text-fg font-black uppercase tracking-wider text-sm">Branch Code</h3>
            <p className="text-[11px] text-fg/70 mt-1">
              Identifies this inventory in consolidated reports.
            </p>
          </div>
          {branchCodeSaved
            ? <span className="text-[10px] font-black uppercase bg-green-500/15 text-success px-2 py-1 rounded">{branchCodeSaved}</span>
            : <span className="text-[10px] font-black uppercase bg-amber-500/15 text-warning px-2 py-1 rounded">Not set</span>}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text" value={branchCode} placeholder="AC-A001"
            onChange={e => setBranchCode(e.target.value.toUpperCase())}
            className={`${input} font-mono max-w-[180px]`} />
          <button onClick={saveBranchCode} disabled={branchBusy || branchCode === branchCodeSaved} className={btn()}>
            {branchBusy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="text-[11px] text-fg/70 mt-2">
          <span className="font-mono text-fg/65">AC</span> business ·
          <span className="font-mono text-fg/65"> A</span> location ·
          <span className="font-mono text-fg/65"> 001</span> which inventory there.
          A second counter at the same address is <span className="font-mono text-fg/65">AC-A002</span>;
          a different address is <span className="font-mono text-fg/65">AC-B001</span>.
        </p>
      </div>

      <NetworkMap info={info} network={network} card={card} />

      {/* ── Network Overview: unified inventory, branch comparison, central
          reporting, and a switcher to each linked business's own dashboard.
          Only meaningful once at least one partner is linked. ── */}
      {partners.length > 0 && (
        <div className={card}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h3 className="text-fg font-black uppercase tracking-wider text-sm flex items-center gap-2">
              <LayoutGrid size={15} className="text-brand-text" /> Network Overview
            </h3>
            <button onClick={loadNetwork} disabled={networkLoading} className={btn('ghost')}>
              {networkLoading ? 'Loading…' : network ? <RefreshCw size={13} /> : 'Load Network Data'}
            </button>
          </div>

          {network && (
            <>
              <div className="flex bg-page-bg p-1 rounded-xl mb-4 gap-1">
                {[
                  ['inventory', 'Unified Inventory', Boxes],
                  ['compare', 'Compare Branches', BarChart3],
                  ['switch', 'Switch Branch', ExternalLink],
                  ['books', 'Consolidated Books', Landmark],
                ].filter(([id]) => can(`screen.hub.${id}`)).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setNetworkView(id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${networkView === id ? 'bg-accent text-on-brand' : 'text-fg/75 hover:text-fg'}`}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>

              {/* Unified Inventory - same item name, summed across every branch */}
              {networkView === 'inventory' && (() => {
                const branches = [{ label: 'This Business', tenant: network.own.tenant, inv: network.own.inventory }, ...network.partners.filter(p => p.ok).map(p => ({ label: p.partnerName || p.partnerSlug, tenant: p.tenant, inv: p.inventory || [] }))];
                const merged = new Map(); // itemName -> { unit, perBranch: {label: qty} }
                for (const b of branches) {
                  for (const item of b.inv) {
                    const key = item.itemName.toLowerCase();
                    if (!merged.has(key)) merged.set(key, { itemName: item.itemName, unit: item.unit, perBranch: {} });
                    merged.get(key).perBranch[b.label] = item.stockQty;
                  }
                }
                const rows = [...merged.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
                return rows.length === 0 ? (
                  <p className="text-fg/70 text-xs py-6 text-center uppercase tracking-widest">No inventory to show</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-fg/70 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2">Item</th>
                          {branches.map(b => <th key={b.label} className="text-right py-2 pl-3">{b.label}</th>)}
                          <th className="text-right py-2 pl-3 text-fg/70">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => {
                          const total = branches.reduce((s, b) => s + (r.perBranch[b.label] || 0), 0);
                          return (
                            <tr key={r.itemName} className="border-b border-white/5">
                              <td className="py-2 font-bold text-fg">{r.itemName}</td>
                              {branches.map(b => (
                                <td key={b.label} className="py-2 pl-3 text-right tabular-nums text-fg/70">
                                  {r.perBranch[b.label] != null ? `${r.perBranch[b.label]} ${r.unit}` : '-'}
                                </td>
                              ))}
                              <td className="py-2 pl-3 text-right tabular-nums font-black text-brand-text">{total} {r.unit}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Compare Branches - today's + this month's revenue/orders side by side */}
              {networkView === 'compare' && (() => {
                const branches = [{ label: 'This Business', today: network.own.today, month: network.own.month }, ...network.partners.map(p => ({ label: p.partnerName || p.partnerSlug, today: p.today, month: p.month, ok: p.ok, error: p.error }))];
                const best = Math.max(...branches.filter(b => b.today).map(b => b.today.revenue));
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-fg/70 text-[10px] uppercase tracking-widest border-b border-white/10">
                          <th className="text-left py-2">Branch</th>
                          <th className="text-right py-2 pl-3">Today Revenue</th>
                          <th className="text-right py-2 pl-3">Today Orders</th>
                          <th className="text-right py-2 pl-3">This Month Revenue</th>
                          <th className="text-right py-2 pl-3">This Month Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map(b => (
                          <tr key={b.label} className="border-b border-white/5">
                            <td className="py-2 font-bold text-fg flex items-center gap-1.5">
                              {b.label}
                              {b.today && b.today.revenue === best && best > 0 && <span className="text-[9px] font-black bg-green-500/15 text-success px-1.5 py-0.5 rounded uppercase">Top</span>}
                            </td>
                            {b.today ? (
                              <>
                                <td className="py-2 pl-3 text-right tabular-nums font-bold text-fg">{peso(b.today.revenue)}</td>
                                <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{b.today.orders}</td>
                                <td className="py-2 pl-3 text-right tabular-nums font-bold text-fg">{peso(b.month.revenue)}</td>
                                <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{b.month.orders}</td>
                              </>
                            ) : (
                              <td colSpan={4} className="py-2 pl-3 text-right text-danger italic">{b.error || 'Unreachable'}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Switch Branch - each linked business is its own separate deployment/
                  login (see partnerUrl), so this opens its own dashboard in a new
                  tab rather than pretending to be one merged session. */}
              {networkView === 'switch' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 px-3 bg-page-bg border border-white/8 rounded-lg">
                    <span className="text-fg font-bold text-sm">This Business ({network.own.tenant})</span>
                    <span className="text-[10px] font-black bg-accent/15 text-brand-text px-2 py-0.5 rounded uppercase">Current</span>
                  </div>
                  {network.partners.map(p => (
                    <a key={p.partnerSlug} href={p.dashboardUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between py-2 px-3 bg-page-bg border border-white/8 rounded-lg hover:border-accent/40 transition">
                      <span className="text-fg font-bold text-sm">{p.partnerName || p.partnerSlug}</span>
                      <span className="flex items-center gap-1.5 text-brand-text text-xs font-bold">Open <ExternalLink size={12} /></span>
                    </a>
                  ))}
                </div>
              )}

              {/* Consolidated Books - one P&L + Balance Sheet across every
                  branch, summed from each branch's trial balance. Unlike the
                  views above, an unreachable branch is surfaced as a hard
                  warning: a consolidated statement missing a branch is a wrong
                  statement, not a partial one. */}
              {networkView === 'books' && (
                <div className="space-y-4">
                  <div className="flex items-end gap-2 flex-wrap">
                    <RangePresets value={{ start: finStart, end: finEnd }} onChange={r => { setFinStart(r.start); setFinEnd(r.end); }} onRun={loadFinancials} />
                    <div>
                      <label className="text-[10px] text-fg/70 uppercase tracking-widest font-black block mb-1">From</label>
                      <input type="date" value={finStart} onChange={e => setFinStart(e.target.value)} className={input} />
                    </div>
                    <div>
                      <label className="text-[10px] text-fg/70 uppercase tracking-widest font-black block mb-1">To</label>
                      <input type="date" value={finEnd} onChange={e => setFinEnd(e.target.value)} className={input} />
                    </div>
                    <button onClick={loadFinancials} disabled={finLoading} className={btn()}>
                      {finLoading ? 'Building…' : 'Build Books'}
                    </button>
                  </div>

                  {!fin ? (
                    <p className="text-fg/70 text-xs py-6 text-center uppercase tracking-widest">
                      Pick a period and build the consolidated books
                    </p>
                  ) : (
                    <>
                      {!fin.complete && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                          <AlertTriangle size={15} className="text-danger mt-0.5 shrink-0" />
                          <div className="text-xs">
                            <p className="text-danger font-black uppercase tracking-wider">Incomplete - not a final statement</p>
                            <p className="text-fg/65 mt-1">
                              These branches could not be reached, and the totals below <span className="font-bold">exclude</span> them:
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {fin.unreachable.map(u => (
                                <li key={u.slug} className="text-fg/75">• <span className="text-fg/80 font-bold">{u.name}</span> - {u.error}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      {fin.unknownAccounts?.length > 0 && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs">
                          <AlertTriangle size={15} className="text-warning mt-0.5 shrink-0" />
                          <div>
                            <p className="text-warning font-black uppercase tracking-wider">Unmapped accounts</p>
                            <p className="text-fg/65 mt-1">
                              A branch posted to accounts this business does not have, so they are excluded from the totals:{' '}
                              <span className="text-fg/80">{fin.unknownAccounts.map(a => `${a.code} ${a.name}`).join(', ')}</span>
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Group position, before the statements. An owner opens
                          this to answer three questions - how much money is
                          there, who owes us, who do we owe - and should not
                          have to read a balance sheet to get them. Computed on
                          the merged rows server-side, so these always agree
                          with the consolidated balance sheet below. */}
                      {Math.abs(fin.interBranch?.unmatched || 0) >= 0.01 && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs">
                          <AlertTriangle size={15} className="text-warning mt-0.5 shrink-0" />
                          <div>
                            <p className="text-warning font-black uppercase tracking-wider">Transfers not yet matched</p>
                            <p className="text-fg/60 mt-1">
                              {peso(fin.interBranch.unmatched)} of stock moved between your businesses has not been received on the other side yet,
                              or was valued differently on each side. It is included in the group's assets until it is.
                            </p>
                          </div>
                        </div>
                      )}

                      {fin.position && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          {[
                            ['Cash on hand & in bank', fin.position.cash, 'text-brand-text'],
                            ['Owed to us (A/R)', fin.position.receivables, 'text-fg'],
                            ['We owe (A/P)', fin.position.payables, 'text-warning'],
                            ['Net income, period', fin.position.netIncome,
                              fin.position.netIncome < 0 ? 'text-danger' : 'text-brand-text'],
                          ].map(([label, value, tone]) => (
                            <div key={label} className="bg-page-bg border border-white/8 rounded-xl p-3">
                              <p className="text-[10px] font-black text-fg/70 uppercase tracking-widest">{label}</p>
                              <p className={`text-xl font-black tabular-nums mt-1 ${tone}`}>{peso(value)}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Per-branch contribution, grouped by LOCATION.
                          Two inventories can sit at one address (AC-A001 and
                          AC-A002), so the location subtotal answers "how did
                          the mall site do?" - a question the flat branch list
                          cannot. Branches with no code are gathered under
                          Unassigned rather than dropped: they hold real money,
                          and omitting them would understate the total. */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-fg/70 text-[10px] uppercase tracking-widest border-b border-white/10">
                              <th className="text-left py-2">Branch</th>
                              <th className="text-left py-2 pl-3">Code</th>
                              <th className="text-right py-2 pl-3">Cash</th>
                              <th className="text-right py-2 pl-3">A/R</th>
                              <th className="text-right py-2 pl-3">A/P</th>
                              <th className="text-right py-2 pl-3">Net Income</th>
                              <th className="text-right py-2 pl-3">Total Assets</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(fin.byLocation || []).map(group => (
                              <Fragment key={group.locationKey}>
                                <tr className="bg-white/[0.03]">
                                  <td colSpan={2} className="py-1.5 text-[10px] font-black uppercase tracking-widest text-fg/75 whitespace-nowrap">
                                    {group.locationKey === 'Unassigned'
                                      ? 'No branch code set'
                                      : `Location ${group.location}`}
                                    <span className="ml-2 font-normal normal-case tracking-normal text-fg/65">
                                      {group.branchCount} {group.branchCount === 1 ? 'inventory' : 'inventories'}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pl-3 text-right tabular-nums font-black text-fg/70">{peso(group.totals.cash)}</td>
                                  <td className="py-1.5 pl-3 text-right tabular-nums font-black text-fg/70">{peso(group.totals.receivables)}</td>
                                  <td className="py-1.5 pl-3 text-right tabular-nums font-black text-fg/70">{peso(group.totals.payables)}</td>
                                  <td className="py-1.5 pl-3 text-right tabular-nums font-black text-fg/70">{peso(group.totals.netIncome)}</td>
                                  <td className="py-1.5 pl-3 text-right tabular-nums font-black text-fg/70">{peso(group.totals.totalAssets)}</td>
                                </tr>
                                {group.branches.map(b => (
                                  <tr key={b.slug} className="border-b border-white/5">
                                    <td className="py-2 pl-3 text-fg/80">
                                      {b.name}
                                      {b.self && <span className="ml-2 text-[9px] font-black bg-accent/15 text-brand-text px-1.5 py-0.5 rounded uppercase">You</span>}
                                    </td>
                                    <td className="py-2 pl-3">
                                      {b.branchCodeValid
                                        ? <span className="font-mono text-fg/75">{b.branchCode}</span>
                                        : <span className="text-warning text-[10px]">not set</span>}
                                    </td>
                                    <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{peso(b.cash)}</td>
                                    <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{peso(b.receivables)}</td>
                                    <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{peso(b.payables)}</td>
                                    <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{peso(b.netIncome)}</td>
                                    <td className="py-2 pl-3 text-right tabular-nums text-fg/70">{peso(b.totalAssets)}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Consolidated P&L */}
                        <div className="bg-page-bg border border-white/8 rounded-xl p-3">
                          <p className="text-[10px] font-black text-fg/70 uppercase tracking-widest mb-2">Consolidated P&amp;L</p>
                          {[
                            ['Revenue', fin.pnl.totals.revenue],
                            ['Less: Contra Revenue', -fin.pnl.totals.contra],
                            ['Net Revenue', fin.pnl.totals.netRevenue, true],
                            ['Cost of Goods Sold', -fin.pnl.totals.cogs],
                            ['Gross Profit', fin.pnl.totals.grossProfit, true],
                            ['Operating Expenses', -fin.pnl.totals.opex],
                            ['Other Income', fin.pnl.totals.otherincome],
                            ['Other Expense', -fin.pnl.totals.otherexpense],
                          ].map(([label, val, strong]) => (
                            <div key={label} className={`flex justify-between py-1 text-xs ${strong ? 'border-t border-white/10 mt-1 pt-1.5' : ''}`}>
                              <span className={strong ? 'text-fg font-bold' : 'text-fg/75'}>{label}</span>
                              <span className={`tabular-nums ${strong ? 'text-fg font-black' : 'text-fg/70'}`}>{peso(val)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between py-1.5 mt-1 border-t-2 border-accent/30">
                            <span className="text-fg font-black text-sm">Net Income</span>
                            <span className={`tabular-nums font-black text-sm ${fin.pnl.totals.netIncome >= 0 ? 'text-success' : 'text-danger'}`}>
                              {peso(fin.pnl.totals.netIncome)}
                            </span>
                          </div>
                        </div>

                        {/* Consolidated Balance Sheet */}
                        <div className="bg-page-bg border border-white/8 rounded-xl p-3">
                          <p className="text-[10px] font-black text-fg/70 uppercase tracking-widest mb-2">
                            Consolidated Balance Sheet
                          </p>
                          {[
                            ['Total Assets', fin.balanceSheet.totals.assets, true],
                            ['Total Liabilities', fin.balanceSheet.totals.liabilities],
                            ['Total Equity', fin.balanceSheet.totals.equity],
                            ['Liabilities + Equity', fin.balanceSheet.totals.liabilitiesAndEquity, true],
                          ].map(([label, val, strong]) => (
                            <div key={label} className={`flex justify-between py-1 text-xs ${strong ? 'border-t border-white/10 mt-1 pt-1.5' : ''}`}>
                              <span className={strong ? 'text-fg font-bold' : 'text-fg/75'}>{label}</span>
                              <span className={`tabular-nums ${strong ? 'text-fg font-black' : 'text-fg/70'}`}>{peso(val)}</span>
                            </div>
                          ))}
                          <div className={`mt-2 text-[10px] font-black uppercase tracking-widest px-2 py-1.5 rounded text-center ${
                            fin.balanceSheet.totals.balanced ? 'bg-green-500/15 text-success' : 'bg-red-500/15 text-danger'}`}>
                            {fin.balanceSheet.totals.balanced ? 'Balanced' : 'Out of balance'}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Shared catalog across linked branches ── */}
      {partners.some(p => p.status === 'active') || isSuperAdmin ? (
        <BranchNetworkPanel authFetch={authFetch} partners={partners} peso={peso} can={can} card={card} input={input} btn={btn} />
      ) : null}

      {/* ── Connect ── */}
      {isSuperAdmin && (
        <div className={card}>
          <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-4">Connect a Business</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Generate invite */}
            <div>
              <p className="text-fg/75 text-xs uppercase tracking-widest font-bold mb-2">Generate Invite Code</p>
              <p className="text-fg/70 text-xs mb-3">Share this code with another business. They redeem it to link with you. Code expires in 24 h.</p>
              {inviteCode ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-page-bg border border-white/10 rounded-lg px-3 py-2.5 text-brand-text font-mono font-bold text-sm tracking-widest">
                    {inviteCode}
                  </code>
                  <button onClick={copyCode} className={btn('ghost')}>
                    {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  </button>
                </div>
              ) : (
                <button onClick={generateInvite} disabled={busy} className={btn()}>
                  <Plus size={13} className="inline mr-1" />Generate Code
                </button>
              )}
              {inviteCode && (
                <button onClick={() => { setInviteCode(''); generateInvite(); }} disabled={busy} className="mt-2 text-xs text-fg/70 hover:text-fg underline">
                  Generate new code
                </button>
              )}
            </div>

            {/* Redeem code */}
            <div>
              <p className="text-fg/75 text-xs uppercase tracking-widest font-bold mb-2">Redeem a Code</p>
              <p className="text-fg/70 text-xs mb-3">Enter the invite code from your hub/partner to link this business as a client.</p>
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
              {redeemErr && <p className="text-danger text-xs mt-2">{redeemErr}</p>}
            </div>
          </div>
          {err && <p className="text-danger text-xs mt-3">{err}</p>}
        </div>
      )}

      {/* ── New Transfer ── */}
      {partners.length > 0 && (
        <div className={card}>
          <div className="flex items-center gap-2 mb-2">
            <Send size={15} className="text-brand-text" />
            <h3 className="text-fg font-black uppercase tracking-wider text-sm">New Transfer</h3>
          </div>
          {/* Two directions through the same panel: SEND pushes stock you
              already have (existing flow, unchanged - internal approval, then
              the partner is notified and accepts). ASK requests stock you
              DON'T have, from a partner - they can decline, accept exactly as
              asked, or counter with what they can actually give before
              anything ships. See the Transfer Requests queue below for the
              negotiation once one is filed. */}
          <div className="flex gap-1.5 mb-3 bg-page-bg border border-white/8 rounded-xl p-1 w-fit">
            <button onClick={() => setTransferMode('send')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${transferMode === 'send' ? 'bg-accent text-on-brand' : 'text-fg/75 hover:text-fg'}`}>
              Send Stock
            </button>
            <button onClick={() => setTransferMode('ask')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${transferMode === 'ask' ? 'bg-accent text-on-brand' : 'text-fg/75 hover:text-fg'}`}>
              Request Stock
            </button>
          </div>

          {transferMode === 'send' ? (
            <>
              <p className="text-fg/70 text-[11px] mb-4">
                Ships stock to <span className="text-fg/70 font-bold">another business</span> in your network - it leaves your books and lands on theirs.
                Moving stock between your own locations is the Transfer tab under Inventory.
                Filing this creates a slip that must be approved before the partner is notified.
              </p>

              {/* FROM / TO */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-[10px] text-fg/70 uppercase font-bold block mb-1">From (Source)</label>
                  <select value={sendFrom} onChange={e => setSendFrom(e.target.value)} className={input}>
                    <option value="__self__">This Business ({info?.tenant ?? '…'})</option>
                    {partners.filter(p => p.status === 'active').map(p => (
                      <option key={p._id} value={p.partnerSlug}>{p.partnerName || p.partnerSlug}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg/70 uppercase font-bold block mb-1">To (Destination)</label>
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
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-fg/70 uppercase font-bold">Add Item</p>
                  {/* A brand-new/untracked product has nothing to pick from
                      the dropdown below - toggling this creates its
                      Inventory record first, so the shipment still ships a
                      real, stock-backed item. */}
                  <button onClick={() => setSendManualMode(m => !m)} className="text-[10px] font-bold uppercase tracking-wider text-brand-text hover:underline">
                    {sendManualMode ? '← Pick from Inventory instead' : '+ New product not yet in Inventory'}
                  </button>
                </div>
                {sendManualMode ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <input value={sendNewName} onChange={e => setSendNewName(e.target.value)} className={input} placeholder="New product name" />
                      <input value={sendNewUnit} onChange={e => setSendNewUnit(e.target.value)} className={input} placeholder="Unit (pcs, kg…)" />
                      <input
                        type="number" min="0.001" step="any" value={sendQty}
                        onChange={e => setSendQty(e.target.value)}
                        className={input} placeholder="Starting Qty"
                      />
                      <input
                        type="number" min="0" step="0.01" value={sendNewCost}
                        onChange={e => setSendNewCost(e.target.value)}
                        className={input} placeholder="Unit Cost (optional)"
                      />
                    </div>
                    <button
                      onClick={addNewItemToCart}
                      disabled={sendNewBusy || !sendNewName.trim() || !(parseFloat(sendQty) > 0)}
                      className={`mt-2 ${btn('ghost')} text-xs`}
                    >{sendNewBusy ? 'Creating…' : '+ Create & Add to Transfer'}</button>
                  </>
                ) : (
                  <>
                    <input value={sendSearch} onChange={e => setSendSearch(e.target.value)} className={input} placeholder="Search products - tap one to add it" aria-label="Search products to send" />
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
                      {inventory
                        .filter(i => !sendSearch.trim() || String(i.itemName || '').toLowerCase().includes(sendSearch.trim().toLowerCase()))
                        .slice(0, 60)
                        .map(i => {
                          const inCart = sendCart.find(l => l.itemId === i._id);
                          const out = !(Number(i.stockQty) > 0);
                          return (
                            <button key={i._id} type="button" onClick={() => quickAdd(i)} disabled={out}
                              className={`relative text-left rounded-xl border p-2.5 transition ${inCart ? 'border-brand bg-brand/10' : 'border-white/8 bg-white/3 hover:border-white/20'} ${out ? 'opacity-40 cursor-not-allowed' : ''}`}>
                              <p className="text-xs font-bold text-fg leading-tight line-clamp-2 pr-5">{i.itemName}</p>
                              <p className={`text-[10px] mt-1 tabular-nums ${out ? 'text-danger' : 'text-fg/65'}`}>{out ? 'Out of stock' : `${i.stockQty} ${i.unit} on hand`}</p>
                              {inCart && <span className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-brand text-on-brand text-[10px] font-black flex items-center justify-center">{inCart.qty}</span>}
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>

              {/* Cart: change quantities and notes in place, like a manual order. */}
              {sendCart.length > 0 && (
                <div className="border border-white/8 rounded-xl overflow-hidden mb-3">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/3 border-b border-white/8">
                    <p className="text-[10px] text-fg/70 uppercase font-black tracking-widest">To send · {sendCart.length} item{sendCart.length > 1 ? 's' : ''}</p>
                    <button type="button" onClick={() => setSendCart([])} className="text-[10px] font-bold uppercase text-fg/60 hover:text-danger">Clear</button>
                  </div>
                  {sendCart.map((line, i) => {
                    const have = stockOf(line.itemId);
                    const over = Number.isFinite(have) && Number(line.qty) > have;
                    return (
                      <div key={line.itemId || i} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/5 last:border-0">
                        <div className="flex-1 min-w-[140px]">
                          <p className="text-xs font-bold text-fg">{line.itemName}</p>
                          <p className={`text-[10px] ${over ? 'text-danger' : 'text-fg/60'}`}>{Number.isFinite(have) ? `${have} ${line.unit} on hand${over ? ' - not enough' : ''}` : line.unit}</p>
                        </div>
                        <div className="flex items-center rounded-lg border border-white/10 overflow-hidden">
                          <button type="button" aria-label={`One less ${line.itemName}`} onClick={() => (Number(line.qty) <= 1 ? removeFromCart(i) : setLine(i, { qty: Number(line.qty) - 1 }))} className="px-2.5 py-1 text-fg/80 hover:bg-white/10 font-black">−</button>
                          <input type="number" min="0.001" step="any" inputMode="decimal" value={line.qty} aria-label={`Quantity of ${line.itemName}`}
                            onChange={e => setLine(i, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                            onBlur={() => { if (!(Number(line.qty) > 0)) removeFromCart(i); }}
                            className="w-16 bg-transparent text-center text-xs text-fg tabular-nums outline-none" />
                          <button type="button" aria-label={`One more ${line.itemName}`} onClick={() => setLine(i, { qty: Number(line.qty || 0) + 1 })} className="px-2.5 py-1 text-fg/80 hover:bg-white/10 font-black">+</button>
                        </div>
                        <input value={line.note || ''} onChange={e => setLine(i, { note: e.target.value })} placeholder="Note" aria-label={`Note for ${line.itemName}`}
                          className="w-32 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-fg outline-none focus:border-brand" />
                        <button type="button" onClick={() => removeFromCart(i)} aria-label={`Remove ${line.itemName}`} className="text-danger text-[10px] font-bold uppercase">Remove</button>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={sendTransfer}
                disabled={sendBusy || !sendPartner || sendCart.length === 0 || sendCart.some(l => !(Number(l.qty) > 0))}
                className={btn()}
              >
                {sendBusy ? 'Sending…' : `Send ${sendCart.length > 0 ? `${sendCart.length} item${sendCart.length > 1 ? 's' : ''}` : 'Transfer'}`}
              </button>
              {sendErr && <p className={`text-xs mt-2 ${sendErr.startsWith('⚠') ? 'text-warning' : 'text-danger'}`}>{sendErr}</p>}
            </>
          ) : (
            <>
              <p className="text-fg/70 text-[11px] mb-4">
                Asks <span className="text-fg/70 font-bold">another business</span> to send you stock you don't have. They can decline,
                accept it exactly as asked, or counter with what they can actually give - nothing ships until it's agreed on both sides.
                You won't see their inventory, so type what you need by name.
              </p>

              <div className="mb-4">
                <label className="text-[10px] text-fg/70 uppercase font-bold block mb-1">Ask (Business)</label>
                <select value={askPartner} onChange={e => setAskPartner(e.target.value)} className={input}>
                  <option value="">- Select business -</option>
                  {partners.filter(p => p.status === 'active').map(p => (
                    <option key={p._id} value={p.partnerSlug}>{p.partnerName || p.partnerSlug}</option>
                  ))}
                </select>
              </div>

              <div className="bg-page-bg border border-white/8 rounded-xl p-3 mb-3">
                <input value={askItemName} onChange={e => setAskItemName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && askItemName.trim()) { askAdd(askItemName, askUnit); setAskItemName(''); } }}
                  className={input} placeholder="Search your products, or type what you need - tap to add" aria-label="Search or name a product to ask for" />
                {(() => {
                  const q = askItemName.trim().toLowerCase();
                  const list = inventory.filter(i => !q || String(i.itemName || '').toLowerCase().includes(q)).slice(0, 60);
                  const exact = q && inventory.some(i => String(i.itemName || '').trim().toLowerCase() === q);
                  return (
                    <>
                      {q && !exact && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => { askAdd(askItemName, askUnit); setAskItemName(''); }} className={`${btn('ghost')} text-xs`}>+ Ask for "{askItemName.trim()}"</button>
                          <input value={askUnit} onChange={e => setAskUnit(e.target.value)} className={`${input} w-28`} placeholder="Unit (pcs…)" aria-label="Unit" />
                        </div>
                      )}
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
                        {list.map(i => {
                          const inCart = askCart.find(l => String(l.itemName).trim().toUpperCase() === String(i.itemName).trim().toUpperCase());
                          const low = !(Number(i.stockQty) > 0);
                          return (
                            <button key={i._id} type="button" onClick={() => askAdd(i.itemName, i.unit)}
                              className={`relative text-left rounded-xl border p-2.5 transition ${inCart ? 'border-brand bg-brand/10' : 'border-white/8 bg-white/3 hover:border-white/20'}`}>
                              <p className="text-xs font-bold text-fg leading-tight line-clamp-2 pr-5">{i.itemName}</p>
                              <p className={`text-[10px] mt-1 tabular-nums ${low ? 'text-warning' : 'text-fg/65'}`}>You have {Number(i.stockQty) || 0} {i.unit}</p>
                              {inCart && <span className="absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-brand text-on-brand text-[10px] font-black flex items-center justify-center">{inCart.qty}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>

              {askCart.length > 0 && (
                <div className="border border-white/8 rounded-xl overflow-hidden mb-3">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/3 border-b border-white/8">
                    <p className="text-[10px] text-fg/70 uppercase font-black tracking-widest">To ask for · {askCart.length} item{askCart.length > 1 ? 's' : ''}</p>
                    <button type="button" onClick={() => setAskCart([])} className="text-[10px] font-bold uppercase text-fg/60 hover:text-danger">Clear</button>
                  </div>
                  {askCart.map((line, i) => (
                    <div key={`${line.itemName}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/5 last:border-0">
                      <div className="flex-1 min-w-[140px]">
                        <p className="text-xs font-bold text-fg">{line.itemName}</p>
                        <p className="text-[10px] text-fg/60">{line.unit}</p>
                      </div>
                      <div className="flex items-center rounded-lg border border-white/10 overflow-hidden">
                        <button type="button" aria-label={`One less ${line.itemName}`} onClick={() => (Number(line.qty) <= 1 ? dropAskLine(i) : setAskLine(i, { qty: Number(line.qty) - 1 }))} className="px-2.5 py-1 text-fg/80 hover:bg-white/10 font-black">−</button>
                        <input type="number" min="0.001" step="any" inputMode="decimal" value={line.qty} aria-label={`Quantity of ${line.itemName}`}
                          onChange={e => setAskLine(i, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                          onBlur={() => { if (!(Number(line.qty) > 0)) dropAskLine(i); }}
                          className="w-16 bg-transparent text-center text-xs text-fg tabular-nums outline-none" />
                        <button type="button" aria-label={`One more ${line.itemName}`} onClick={() => setAskLine(i, { qty: Number(line.qty || 0) + 1 })} className="px-2.5 py-1 text-fg/80 hover:bg-white/10 font-black">+</button>
                      </div>
                      <input value={line.note || ''} onChange={e => setAskLine(i, { note: e.target.value })} placeholder="Note" aria-label={`Note for ${line.itemName}`}
                        className="w-32 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-fg outline-none focus:border-brand" />
                      <button type="button" onClick={() => dropAskLine(i)} aria-label={`Remove ${line.itemName}`} className="text-danger text-[10px] font-bold uppercase">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={sendAsk} disabled={askBusy || !askPartner || askCart.length === 0 || askCart.some(l => !(Number(l.qty) > 0))} className={btn()}>
                {askBusy ? 'Sending…' : `Ask for ${askCart.length > 0 ? `${askCart.length} item${askCart.length > 1 ? 's' : ''}` : 'Stock'}`}
              </button>
              {askErr && <p className={`text-xs mt-2 ${askErr.startsWith('⚠') ? 'text-warning' : 'text-danger'}`}>{askErr}</p>}
            </>
          )}
        </div>
      )}

      {/* ── Transfer Requests (negotiation queue) ──
          Three groups: what needs YOUR response now, what's awaiting the
          OTHER side, and closed ones for reference. Every card carries the
          full negotiation history so it's clear what changed and why. */}
      {transferRequests.length > 0 && (() => {
        const needsMe = transferRequests.filter(r =>
          (r.status === 'Pending' && r.filedBySlug !== info?.tenant) ||
          (r.status === 'CounterPending' && r.filedBySlug === info?.tenant) ||
          (r.status === 'AwaitingFinal' && r.filedBySlug !== info?.tenant)
        );
        const waitingOnThem = transferRequests.filter(r => !needsMe.includes(r) && ['Pending', 'CounterPending', 'AwaitingFinal'].includes(r.status));
        const closed = transferRequests.filter(r => ['Approved', 'Declined', 'Cancelled'].includes(r.status));

        const RequestCard = ({ r, actionable }) => {
          const iAmFiler = r.filedBySlug === info?.tenant;
          const otherName = r.fromSlug === info?.tenant ? r.toName : r.fromName;
          return (
            <div className="bg-page-bg border border-white/8 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-fg font-bold text-sm">
                    {r.fromSlug === info?.tenant ? 'To' : 'From'} <span className="text-brand-text">{otherName}</span>
                    <span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${negoStatusColor[r.status] || 'bg-white/10 text-fg/70'}`}>{r.status}</span>
                    {r.round > 1 && <span className="ml-1.5 text-[9px] text-fg/65 font-bold uppercase">round {r.round}</span>}
                  </p>
                  <p className="text-fg/70 text-[10px]">{iAmFiler ? 'You asked' : 'They asked'} · {r.requestedBy || 'someone'} · {formatDate(r.createdAt)}</p>
                </div>
                {actionable && (
                  <div className="flex gap-1.5 shrink-0">
                    {r.status === 'Pending' && !iAmFiler && (
                      <>
                        <button onClick={() => actOnRequest(r._id, 'approve-as-is')} className={`${btn()} text-[10px] py-1.5 px-2.5 min-h-0`}>Approve As-Is</button>
                        <button onClick={() => openCounter(r)} className={`${btn('ghost')} text-[10px] py-1.5 px-2.5 min-h-0`}>Counter</button>
                        <button onClick={() => setDeclineTarget(r)} className={`${btn('red')} text-[10px] py-1.5 px-2.5 min-h-0`}>Decline</button>
                      </>
                    )}
                    {r.status === 'Pending' && iAmFiler && (
                      <button onClick={() => actOnRequest(r._id, 'cancel')} className={`${btn('ghost')} text-[10px] py-1.5 px-2.5 min-h-0`}>Withdraw</button>
                    )}
                    {r.status === 'CounterPending' && iAmFiler && (
                      <>
                        <button onClick={() => actOnRequest(r._id, 'accept-counter')} className={`${btn()} text-[10px] py-1.5 px-2.5 min-h-0`}>Accept Counter</button>
                        <button onClick={() => setDeclineTarget(r)} className={`${btn('red')} text-[10px] py-1.5 px-2.5 min-h-0`}>Decline</button>
                      </>
                    )}
                    {r.status === 'AwaitingFinal' && !iAmFiler && (
                      <>
                        <button onClick={() => actOnRequest(r._id, 'finalize')} className={`${btn()} text-[10px] py-1.5 px-2.5 min-h-0`}>Final Approve</button>
                        <button onClick={() => setDeclineTarget(r)} className={`${btn('red')} text-[10px] py-1.5 px-2.5 min-h-0`}>Decline</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <ul className="mt-2 space-y-1">
                {r.lines.map((l, i) => (
                  <li key={i} className="text-xs text-fg/65 flex justify-between gap-3 border-t border-white/5 pt-1">
                    <span className="text-fg/80 font-bold truncate">{l.itemName}{l.note && <span className="text-fg/65 font-normal italic"> · {l.note}</span>}</span>
                    <span className="tabular-nums shrink-0">{l.qty} {l.unit}</span>
                  </li>
                ))}
              </ul>
              {r.round > 1 && (
                <p className="text-[10px] text-fg/65 mt-1.5 italic">
                  Originally asked: {r.originalLines.map(l => `${l.qty} ${l.unit} ${l.itemName}`).join(', ')}
                </p>
              )}
              {r.history?.length > 1 && (
                <details className="mt-1.5">
                  <summary className="text-[9px] text-fg/65 uppercase tracking-widest font-bold cursor-pointer hover:text-fg/75">History ({r.history.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {r.history.map((h, i) => (
                      <li key={i} className="text-[10px] text-fg/70">
                        <span className="font-bold text-fg/65">{h.action}</span> by {h.by || h.slug} {h.note && `- "${h.note}"`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        };

        return (
          <div className={card}>
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw size={15} className="text-brand-text" />
              <h3 className="text-fg font-black uppercase tracking-wider text-sm">Transfer Requests</h3>
              {needsMe.length > 0 && <span className="text-[9px] font-black uppercase bg-brand/20 text-brand-text px-2 py-0.5 rounded-full">{needsMe.length} need{needsMe.length === 1 ? 's' : ''} you</span>}
            </div>

            {needsMe.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-text">Needs Your Response</p>
                {needsMe.map(r => <RequestCard key={r._id} r={r} actionable />)}
              </div>
            )}
            {waitingOnThem.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg/70">Awaiting The Other Side</p>
                {waitingOnThem.map(r => <RequestCard key={r._id} r={r} actionable={false} />)}
              </div>
            )}
            {closed.length > 0 && (
              <details>
                <summary className="text-[10px] font-black uppercase tracking-widest text-fg/70 cursor-pointer hover:text-fg/65">Closed ({closed.length})</summary>
                <div className="space-y-2 mt-2">
                  {closed.map(r => <RequestCard key={r._id} r={r} actionable={false} />)}
                </div>
              </details>
            )}
          </div>
        );
      })()}

      {/* ── Outbound slips awaiting approval ──
          Stock only leaves this business once someone signs the slip off - the
          same gate the internal Inventory → Transfer tab uses, and the same
          shape as a requisition or PO approval. Until then the partner has not
          been told anything. */}
      {awaitingApproval.length > 0 && (
        <div className="bg-orange-500/8 border border-orange-500/20 rounded-xl p-4 mb-4">
          <h3 className="text-warning font-black uppercase tracking-wider text-sm mb-1 flex items-center gap-2">
            <Send size={14} /> {awaitingApproval.length} Transfer Slip{awaitingApproval.length > 1 ? 's' : ''} Awaiting Approval
          </h3>
          <p className="text-fg/70 text-[11px] mb-3">The partner business is only notified once a slip is approved.</p>
          <div className="space-y-3">
            {awaitingApproval.map(slip => (
              <div key={slip.shipmentRef} className="bg-surface rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-fg font-bold text-sm">
                      To <span className="text-brand-text">{slip.partnerName}</span>
                      <span className="text-fg/65 font-mono text-[10px] ml-2">{slip.shipmentRef}</span>
                    </p>
                    <p className="text-fg/70 text-[11px]">
                      {slip.lines.length} line{slip.lines.length > 1 ? 's' : ''}
                      {slip.requestedBy ? ` · filed by ${slip.requestedBy}` : ''}
                      {slip.createdAt ? ` · ${formatDate(slip.createdAt)}` : ''}
                    </p>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex gap-2 shrink-0">
                      <button disabled={slipBusy === slip.shipmentRef} onClick={() => actOnSlip(slip.shipmentRef, 'approve')} className={btn()}>
                        {slipBusy === slip.shipmentRef ? 'Approving…' : 'Approve & Send'}
                      </button>
                      <button disabled={slipBusy === slip.shipmentRef} onClick={() => actOnSlip(slip.shipmentRef, 'reject')} className={btn('red')}>Reject</button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-1">
                  {slip.lines.map(l => (
                    <li key={l._id} className="text-xs text-fg/65 flex justify-between gap-3 border-t border-white/5 pt-1">
                      <span className="text-fg/80 font-bold truncate" title={String((l.itemName) ?? '')}>{l.itemName}</span>
                      <span className="tabular-nums shrink-0">{l.qtyBase} {l.unit}</span>
                    </li>
                  ))}
                </ul>
                {!isSuperAdmin && <p className="text-fg/65 text-[10px] mt-2 italic">Waiting on someone with approval rights.</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pending Inbound (action required) ── */}
      {pendingInbound.length > 0 && (
        <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-4 mb-4">
          <h3 className="text-warning font-black uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
            <Download size={14} /> {pendingInbound.length} Inbound Transfer{pendingInbound.length > 1 ? 's' : ''} - Action Required
          </h3>
          <div className="space-y-3">
            {pendingInbound.map(t => (
              <div key={t._id} className="flex items-center justify-between gap-3 bg-surface rounded-lg p-3">
                <div>
                  <p className="text-fg font-bold text-sm">{t.itemName}</p>
                  <p className="text-fg/75 text-xs">{t.qtyBase} {t.unit} from <span className="text-fg/80 font-bold">{t.partnerName || t.partnerSlug}</span></p>
                  {t.note && <p className="text-fg/70 text-xs italic">{t.note}</p>}
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
          <div className="flex items-center gap-2">
            {transfers.length > 0 && (
              <button onClick={() => exportAllTransfers(groupShipments(transfers), pdfDeps)} className={btn('ghost')} title="Every shipment: a summary, then each one's slip">
                <Download size={13} /> Export PDF
              </button>
            )}
            <button onClick={load} className={btn('ghost')}><RefreshCw size={13} /></button>
          </div>
        </div>
        {transfers.length === 0 ? (
          <p className="text-fg/70 text-xs py-6 text-center uppercase tracking-widest">No transfers yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/70 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="w-6" />
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Ref</th>
                  <th className="text-left py-2">Dir</th>
                  <th className="text-left py-2">Partner</th>
                  <th className="text-left py-2">Items</th>
                  <th className="text-right py-2">Value</th>
                  <th className="text-left py-2 pl-3">Status</th>
                  <th className="text-right py-2">Slip</th>
                </tr>
              </thead>
              <tbody>
                <PagedRows items={groupShipments(transfers)} label="shipments" render={sh => {
                  const open = !!openShipments[sh.key];
                  const toggle = () => setOpenShipments(o => ({ ...o, [sh.key]: !o[sh.key] }));
                  const firstStatus = sh.lines[0]?.status;
                  return (
                    <Fragment key={sh.key}>
                      <tr className="border-b border-white/5 hover:bg-white/2 cursor-pointer" onClick={toggle} data-testid="shipment-row">
                        <td className="py-2 text-fg/60">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="py-2 text-fg/70 text-xs whitespace-nowrap">{formatDate(sh.date)}</td>
                        <td className="py-2 text-fg/75 text-xs font-mono whitespace-nowrap">{sh.ref}</td>
                        <td className="py-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sh.direction === 'outbound' ? 'bg-blue-500/15 text-info' : 'bg-purple-500/15 text-special'}`}>
                            {sh.direction === 'outbound' ? '↑ OUT' : '↓ IN'}
                          </span>
                        </td>
                        <td className="py-2 text-fg/70 text-xs">{sh.partnerName}</td>
                        <td className="py-2 text-fg text-xs">
                          <span className="font-black">{sh.lines.length} item{sh.lines.length === 1 ? '' : 's'}</span>
                          <span className="text-fg/60"> · {sh.lines.slice(0, 2).map(l => l.itemName).join(', ')}{sh.lines.length > 2 ? '…' : ''}</span>
                        </td>
                        <td className="py-2 text-right text-fg tabular-nums font-bold text-xs">{peso ? peso(sh.value) : sh.value.toFixed(2)}</td>
                        <td className="py-2 pl-3">
                          <span className={`text-[10px] font-black px-2 py-1 rounded ${sh.status.mixed ? 'bg-white/10 text-fg/80' : (statusColor[firstStatus] || 'bg-white/10 text-fg/70')}`}>{sh.status.label}</span>
                        </td>
                        <td className="py-2 text-right">
                          <button onClick={e => { e.stopPropagation(); exportTransferSlip(sh, pdfDeps); }} title="Print this shipment's transfer slip"
                            className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/8 text-fg/80 hover:bg-white/15 min-h-[28px] inline-flex items-center gap-1">
                            <FileText size={11} /> Slip
                          </button>
                        </td>
                      </tr>
                      {open && sh.lines.map(t => (
                        <tr key={t._id} className="border-b border-white/5 bg-white/[0.02]">
                          <td />
                          <td className="py-1.5 text-fg/60 text-[11px] font-mono" colSpan={2}>{t.reference}</td>
                          <td className="py-1.5 text-fg/60 text-[11px]">{t.itemCode || ''}</td>
                          <td className="py-1.5 text-fg font-bold text-xs" colSpan={2}>{t.itemName}{t.note ? <span className="block text-fg/60 font-normal text-[11px]">{t.note}</span> : null}</td>
                          <td className="py-1.5 text-right text-fg tabular-nums text-xs">
                            <span className="font-bold">{displayQty(t)}</span>
                            <span className="block text-fg/60 text-[11px]">{peso ? peso(lineValue(t)) : lineValue(t).toFixed(2)}</span>
                          </td>
                          <td className="py-1.5 pl-3">
                            <span className={`text-[10px] font-black px-2 py-1 rounded ${statusColor[t.status] || 'bg-white/10 text-fg/70'}`}>{t.status}</span>
                          </td>
                          <td className="py-1.5 text-right">
                            {t.direction === 'inbound' && t.status === 'Pending' && (
                              <div className="flex gap-1 justify-end">
                                <button onClick={() => openAccept(t)} className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-accent/15 text-brand-text hover:bg-accent/25 min-h-[28px]">Accept</button>
                                <button onClick={() => act(t._id, 'reject')} className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-red-500/10 text-danger hover:bg-red-500/20 min-h-[28px]">Reject</button>
                              </div>
                            )}
                            {t.direction === 'outbound' && ['Pending', 'Requested'].includes(t.status) && (
                              <button onClick={() => act(t._id, 'cancel')} className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-white/8 text-fg/75 hover:bg-white/15 min-h-[28px]">
                                {t.status === 'Requested' ? 'Withdraw' : 'Cancel'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                }} />
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Accept modal ── */}
      {acceptTarget && (
        <div className="fixed inset-0 z-[9998] bg-black/85 backdrop-blur-sm flex justify-center p-4 overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setAcceptTarget(null); }}
          role="dialog" aria-modal="true" aria-label="Accept transfer">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-elev-3 my-auto">
            <h3 className="text-fg font-black text-base mb-1">Accept Transfer</h3>
            <p className="text-fg/75 text-sm mb-4">
              Receiving <span className="text-fg font-bold">{acceptTarget.qtyBase} {acceptTarget.unit}</span> of{' '}
              <span className="text-fg font-bold">{acceptTarget.itemName}</span> from{' '}
              <span className="text-brand-text font-bold">{acceptTarget.partnerName || acceptTarget.partnerSlug}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-fg/70 uppercase font-bold block mb-1">Add to existing inventory item</label>
                <SearchSelect value={acceptItemId} onChange={e => { setAcceptItemId(e.target.value); if (e.target.value) setAcceptCreateNew(false); }} className={input} disabled={acceptCreateNew}
                  placeholder="Type to find the item"
                  options={inventory.map(i => ({ value: i._id, label: i.itemName, hint: `${i.stockQty} ${i.unit}` }))} />
              </div>
              <div className="flex items-center gap-2 text-sm text-fg/65">
                <div className="flex-1 h-px bg-white/10" />or<div className="flex-1 h-px bg-white/10" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-fg">
                <input type="checkbox" checked={acceptCreateNew} onChange={e => { setAcceptCreateNew(e.target.checked); if (e.target.checked) setAcceptItemId(''); }} className="accent-accent" />
                Auto-create new inventory item for this
              </label>
            </div>

            {acceptErr && <p className="text-danger text-xs mt-3">{acceptErr}</p>}

            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setAcceptTarget(null)} className={btn('ghost')}>Cancel</button>
              <button onClick={doAccept} disabled={acceptBusy || (!acceptItemId && !acceptCreateNew)} className={btn()}>
                {acceptBusy ? 'Accepting…' : 'Confirm Accept'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Counter-offer modal ──
          Only adjusting quantities down or dropping a line entirely - this is
          "what we can actually give", not a chance to substitute something
          else. Adding a new item isn't offered here on purpose. */}
      {counterTarget && (
        <div className="fixed inset-0 z-[9998] bg-black/85 backdrop-blur-sm flex justify-center p-4 overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setCounterTarget(null); }}
          role="dialog" aria-modal="true" aria-label="Counter-offer">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-elev-3 my-auto">
            <h3 className="text-fg font-black text-base mb-1">Counter-Offer</h3>
            <p className="text-fg/75 text-sm mb-4">
              Adjust what you can actually give <span className="text-brand-text font-bold">{counterTarget.fromSlug === info?.tenant ? counterTarget.toName : counterTarget.fromName}</span>.
              Reduce a quantity or remove a line - it goes back to them to accept or decline.
            </p>

            <div className="space-y-2 mb-3">
              {counterLines.map((l, i) => (
                <div key={i} className="flex items-center gap-2 bg-page-bg border border-white/8 rounded-xl p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-fg font-bold text-sm truncate" title={String((l.itemName) ?? '')}>{l.itemName}</p>
                    {l.note && <p className="text-fg/65 text-[10px] italic truncate">{l.note}</p>}
                  </div>
                  <input
                    type="number" min="0" step="any" value={l.qty}
                    onChange={e => updateCounterQty(i, e.target.value)}
                    className="w-24 bg-page-bg border border-white/10 rounded-lg px-2 py-1.5 text-fg text-sm text-right outline-none focus:border-accent"
                  />
                  <span className="text-fg/70 text-xs w-10">{l.unit}</span>
                  <button onClick={() => removeCounterLine(i)} className="text-danger text-[10px] font-bold uppercase px-1">✕</button>
                </div>
              ))}
              {counterLines.length === 0 && <p className="text-fg/65 text-xs italic text-center py-3">Every line removed - add at least one back to counter.</p>}
            </div>

            <input value={counterNote} onChange={e => setCounterNote(e.target.value)} className={input} placeholder="Note (optional) - e.g. why the quantity changed" />

            {counterErr && <p className="text-danger text-xs mt-3">{counterErr}</p>}

            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setCounterTarget(null)} className={btn('ghost')}>Cancel</button>
              <button onClick={submitCounter} disabled={counterBusy || counterLines.every(l => !(l.qty > 0))} className={btn()}>
                {counterBusy ? 'Sending…' : 'Send Counter-Offer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Decline modal ── */}
      {declineTarget && (
        <div className="fixed inset-0 z-[9998] bg-black/85 backdrop-blur-sm flex justify-center p-4 overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setDeclineTarget(null); }}
          role="dialog" aria-modal="true" aria-label="Decline transfer request">
          <div className="bg-surface border border-red-500/25 rounded-2xl p-6 w-full max-w-md shadow-elev-3 my-auto">
            <h3 className="text-fg font-black text-base mb-1">Decline Request</h3>
            <p className="text-fg/75 text-sm mb-4">
              This closes the negotiation with <span className="text-brand-text font-bold">{declineTarget.fromSlug === info?.tenant ? declineTarget.toName : declineTarget.fromName}</span>.
              Your reason is visible to them.
            </p>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
              className={`${input} resize-none`} placeholder="Reason (optional but helpful)" />
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setDeclineTarget(null)} className={btn('ghost')}>Cancel</button>
              <button onClick={submitDecline} disabled={declineBusy} className={btn('red')}>
                {declineBusy ? 'Declining…' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
