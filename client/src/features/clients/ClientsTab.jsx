import { Fragment, useCallback, useEffect, useState } from 'react';
import { HAS_CLIENT_LOGIN, BUSINESS_NAME } from '../../shared/businessType.js';
import { downloadClientRecord } from '../ops/OpsExtras';
import { Users, Search, ChevronDown, ChevronRight, RefreshCw, AlertCircle, Upload, FileText, Download, Link2, UserPlus, Trash2, Mail } from 'lucide-react';
import * as ui from '../../shared/ui';
import { buildBillingDocHTML, printBillingDoc } from '../../shared/billingDocument';
import { socket } from '../../shared/staffSocket.js';
import { useDashboard } from '../dashboard/DashboardContext';
import RangePresets from '../../shared/RangePresets';
import { useRefreshTick } from '../../shared/refreshBus';

// Order changes arrive on the dashboard's signed-in connection. This tab used
// to open its own, without a token, which the server places in no room - so
// the balances below never updated live. See shared/staffSocket.js.

// Clients - who we sell to, what they owe, and how close they are to their limit.
//
// Previously this lived only inside the SuperAdmin panel as a registration form,
// so answering "how much does this client owe me?" meant visiting three tabs.
// SuperAdmin keeps account creation; this is the operational view.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

export default function ClientsTab() {
  const { apiFetch, downloadDataset, systemSettings = {}, can = () => false, isSuperAdmin = false } = useDashboard();
  // Accounting staff cannot set a credit line, but can ask for one: it goes to
  // an approver's queue (Ledger → Price Changes). Superadmins edit directly.
  const requestCreditChange = async (c) => {
    const lim = prompt(`New credit limit for ${c.name} (blank = no limit). Now: ${c.creditLimit == null ? 'no limit' : '₱' + c.creditLimit.toLocaleString('en-PH')}`, c.creditLimit == null ? '' : String(c.creditLimit));
    if (lim === null) return;
    const terms = prompt('Credit terms in days (blank to leave as is):', c.creditTermsDays != null ? String(c.creditTermsDays) : '');
    if (terms === null) return;
    const reason = prompt('Why? The approver reads this.');
    if (!reason || !reason.trim()) return;
    const body = { creditLimit: lim.trim() === '' ? null : lim.trim(), reason: reason.trim() };
    if (terms.trim() !== '') body.creditTermsDays = terms.trim();
    try {
      const d = await (await apiFetch(`/api/client-accounts/${c._id}/credit-request`, { method: 'POST', body: JSON.stringify(body) })).json();
      ui.alert(d.success ? (d.applied ? 'Credit line updated.' : (d.message || 'Sent for approval.')) : (d.error || 'Could not send the request.'));
    } catch { ui.alert('Network error.'); }
  };
  const [importing, setImporting] = useState(false);
  // Invitation and sign-in links exist only where clients sign in (logistics).
  const canInvite = HAS_CLIENT_LOGIN && can('clients.invite');
  const canLinks = HAS_CLIENT_LOGIN && can('clients.links');
  // Quick invite: only a name. The client opens the link and fills in the
  // rest (phone, email, username, password) themselves.
  // Add a client with its details. The login is never chosen here: the client
  // gets a link and sets their own username and password.
  const blankClient = { name: '', phone: '', email: '', paymentMethod: 'Cash', contactNotes: '', tier: '' };

  // Price tiers (Dealer, Wholesale, ...). A tier is kept on the client as one of
  // its segments; only the owner sets it, since it changes what they pay.
  const [tiers, setTiers] = useState([]);
  useEffect(() => {
    apiFetch('/api/price-tiers').then(r => r.json()).then(d => {
      if (d.success) setTiers((d.tiers || []).filter(t => t.isActive !== false).map(t => t.name));
    }).catch(() => {});
  }, [apiFetch]);
  const tierOf = (c) => (c.segments || []).find(s => tiers.includes(s)) || '';
  const setClientTier = async (c, tier) => {
    // Keep any other tags; swap only the tier.
    const segments = [...(c.segments || []).filter(s => !tiers.includes(s)), ...(tier ? [tier] : [])];
    try {
      const d = await (await apiFetch(`/api/client-accounts/${c._id}`, { method: 'PATCH', body: JSON.stringify({ segments }) })).json();
      if (!d.success) { ui.alert(d.error || 'Could not change the tier.'); return; }
      ui.toast(tier ? `${c.name} is now on ${tier} pricing.` : `${c.name} is back on list prices.`, { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
  };

  // Everyday details, edited here rather than in the owner's Admin Panel
  // (which keeps what is about logging in: passwords and sign-in links).
  // Only what was actually changed is sent, so a blank box never wipes a
  // detail this screen simply did not have.
  const [edit, setEdit] = useState(null);   // { id, was: {...}, now: {...} }
  const EDIT_FIELDS = ['name', 'phone', 'email', 'paymentMethod', 'creditTermsDays', 'contactNotes', 'isActive', 'isAffiliate'];
  const openEdit = async (c) => {
    let full = {};
    try {
      const d = await (await apiFetch('/api/client-accounts')).json();
      full = (d.clients || d.accounts || []).find(x => String(x._id) === String(c._id)) || {};
    } catch { /* fall back to what the row has */ }
    const was = {
      name: full.name ?? c.name ?? '', phone: full.phone ?? '', email: full.email ?? '',
      paymentMethod: full.paymentMethod ?? c.paymentMethod ?? 'Cash',
      creditTermsDays: full.creditTermsDays ?? c.creditTermsDays ?? '', contactNotes: full.contactNotes ?? '',
      isActive: (full.isActive ?? c.isActive) !== false,
      isAffiliate: (full.isAffiliate ?? c.isAffiliate) === true,
    };
    setEdit({ id: c._id, was, now: { ...was } });
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    const changed = Object.fromEntries(EDIT_FIELDS.filter(k => String(edit.now[k]) !== String(edit.was[k])).map(k => [k, edit.now[k]]));
    if (!Object.keys(changed).length) return setEdit(null);
    if ('name' in changed && !String(changed.name).trim()) return ui.alert('The client needs a name.');
    try {
      const d = await (await apiFetch(`/api/client-accounts/${edit.id}`, { method: 'PATCH', body: JSON.stringify(changed) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save the changes.');
      ui.toast('Client details saved.', { tone: 'success' });
      setEdit(null);
      load();
    } catch { ui.alert('Network error.'); }
  };

  // Each client's own link, shown in their row: the setup link while they have
  // not chosen a login, the sign-in page once they have.
  const [links, setLinks] = useState(null);   // clientId -> row from /links
  const loadLinks = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/client-accounts/links')).json();
      if (d.success) setLinks({ signInPath: d.signInPath, byId: Object.fromEntries((d.clients || []).map(x => [String(x._id), x])) });
    } catch { /* the row just shows no link */ }
  }, [apiFetch]);
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); ui.toast('Link copied.', { tone: 'success' }); }
    catch { ui.alert(text); }
  };
  const newSetupLink = async (c) => {
    try {
      const d = await (await apiFetch(`/api/client-accounts/${c._id}/onboard-link`, { method: 'POST' })).json();
      if (!d.success) { ui.alert(d.error || 'Could not make a link.'); return; }
      await copyText(`${window.location.origin}/client-onboard/${d.token}`);
      loadLinks();
    } catch { ui.alert('Network error.'); }
  };
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(blankClient);
  const [adding, setAdding] = useState(false);
  const [addedLink, setAddedLink] = useState('');
  const addClient = async (e) => {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    setAdding(true);
    try {
      const { tier, ...rest } = addForm;
      const d = await (await apiFetch('/api/client-accounts', { method: 'POST', body: JSON.stringify({ ...rest, segments: tier ? [tier] : [] }) })).json();
      if (!d.success) { ui.alert(d.error || 'Could not add the client.'); return; }
      const link = d.onboardingPath ? `${window.location.origin}${d.onboardingPath}` : '';
      setAddedLink(link);
      setAddForm(blankClient);
      if (link) {
        try { await navigator.clipboard.writeText(link); ui.toast(`${d.client.name} added - link copied, send it to them.`, { tone: 'success' }); }
        catch { ui.toast(`${d.client.name} added. Copy the link below.`); }
      }
      load(); if (links) loadLinks();
    } catch { ui.alert('Network error.'); }
    finally { setAdding(false); }
  };
  const deleteClient = async (c) => {
    if (!(await ui.confirm(`Delete ${c.name}? This can't be undone. A client with orders, deposits or quotes can't be deleted - deactivate it instead.`))) return;
    try {
      const d = await (await apiFetch(`/api/client-accounts/${c._id}`, { method: 'DELETE' })).json();
      if (!d.success) { ui.alert(d.error || 'Could not delete the client.'); return; }
      ui.toast(`${c.name} deleted.`, { tone: 'success' });
      setExpanded(null);
      load();
    } catch { ui.alert('Network error.'); }
  };
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const createInvite = async (e) => {
    e.preventDefault();
    const name = inviteName.trim();   // may be blank: the client then types their own
    setInviting(true);
    try {
      const d = await (await apiFetch('/api/client-accounts/invite', {
        method: 'POST', body: JSON.stringify({ name }),
      })).json();
      const made = d.success && d.client;
      if (!made) { ui.alert(d.error || 'Could not create the link.'); return; }
      const link = `${window.location.origin}${made.onboardingPath}`;
      setInviteLink(link);
      setInviteName('');
      try { await navigator.clipboard.writeText(link); ui.toast('Link copied - send it to the client.', { tone: 'success' }); }
      catch { ui.toast('Copy the link below and send it to the client.'); }
      load();
    } catch { ui.alert('Network error.'); }
    finally { setInviting(false); }
  };
  const [data, setData] = useState({ clients: [], showMoney: false, mode: 'off' });
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [orders, setOrders] = useState({});   // clientId -> orders[]
  // The statement of account being looked at: which client, over what period.
  // Defaults to the current month, which is what a client asks for.
  const [soaFor, setSoaFor] = useState(null);
  const [soa, setSoa] = useState(null);
  const [soaRange, setSoaRange] = useState(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const d = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { start: d(first), end: d(now) };
  });
  const [soaLoading, setSoaLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/clients/summary');
      const d = await res.json();
      if (d.success) setData({ clients: d.clients || [], showMoney: !!d.showMoney, mode: d.mode });
    } catch { /* leave the last good view in place */ }
    finally { setLoading(false); }
  }, [apiFetch]);

  const refreshTick = useRefreshTick();
  useEffect(() => { load(); }, [load, refreshTick]);

  // Keep payment method (and status) live when staff change it in Orders/POS.
  // orderUpdated carries the full updated order object; patch it in-place so
  // the client row reflects the change without a full reload.
  useEffect(() => {
    const onOrderUpdated = (updated) => {
      if (!updated?._id) return;
      setOrders(prev => {
        const next = { ...prev };
        for (const [clientId, list] of Object.entries(next)) {
          const idx = list.findIndex(o => String(o._id) === String(updated._id));
          if (idx !== -1) {
            const newList = [...list];
            newList[idx] = { ...newList[idx], ...updated };
            next[clientId] = newList;
          }
        }
        return next;
      });
      // Also refresh the summary totals (owing/committed may have changed).
      load();
    };
    socket.on('orderUpdated', onOrderUpdated);
    return () => socket.off('orderUpdated', onOrderUpdated);
  }, [load]);

  // Orders are fetched only when a row is opened, so the summary stays one call.
  const toggle = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!links && canLinks) loadLinks();
    if (orders[id]) return;
    try {
      const res = await apiFetch(`/api/clients/${id}/orders`);
      const d = await res.json();
      if (d.success) setOrders(o => ({ ...o, [id]: d.orders || [] }));
    } catch { /* row simply stays empty */ }
  };

  // The statement itself. Refetched whenever the period changes, because the
  // opening balance depends entirely on where the window starts.
  const loadStatement = useCallback(async (client, range) => {
    setSoaLoading(true);
    try {
      const res = await apiFetch(`/api/clients/${client._id}/statement?start=${range.start}&end=${range.end}`);
      const d = await res.json();
      setSoa(d.success ? d : null);
    } catch { setSoa(null); }
    finally { setSoaLoading(false); }
  }, [apiFetch]);

  const openStatement = (client) => {
    setSoaFor(client);
    setSoa(null);
    loadStatement(client, soaRange);
  };

  const fmtDay = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  // The statement as plain text, in the office's own mail app (a mailto link):
  // addressed to the client, ready to read over and send. The period's lines
  // are listed; a long statement is cut short and says so, because a mail
  // link can only carry so much - the printed one is always complete.
  const emailStatement = async () => {
    if (!soa) return;
    const money = (n) => `PHP ${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const shown = soa.rows.slice(-25);
    const lines = [
      `Dear ${soa.client.registeredName || soa.client.name},`,
      '',
      `Here is your statement of account for ${fmtDay(soa.period.start)} to ${fmtDay(soa.period.end)}.`,
      '',
      `Balance brought forward: ${money(soa.openingBalance)}`,
      ...(soa.rows.length > shown.length ? [`(${soa.rows.length - shown.length} earlier entries not listed - ask us for the full statement)`] : []),
      ...shown.map(r => `${fmtDay(r.at)}  ${r.reference || ''}  ${r.description || ''}  ${r.charge ? `+${money(r.charge)}` : ''}${r.payment ? `-${money(r.payment)}` : ''}  balance ${money(r.balance)}`.replace(/\s+/g, ' ')),
      '',
      `Charges this period: ${money(soa.totals.charges)}`,
      `Payments received: ${money(soa.totals.payments)}`,
      ...(soa.deposits > 0 ? [`Less deposits on hand: ${money(soa.deposits)}`] : []),
      `AMOUNT DUE: ${money(soa.netDue)}`,
      '',
      `Overdue more than 30 days: ${money((soa.aged.d31_60 || 0) + (soa.aged.d61_90 || 0) + (soa.aged.d90_plus || 0))}`,
      '',
      'Please tell us if anything here does not match your records.',
      '',
      BUSINESS_NAME,
    ];
    const subject = `Statement of account - ${soa.client.name} - as of ${fmtDay(soa.period.end)}`;
    const body = lines.join('\n');
    const openMailApp = () => { window.location.href = `mailto:${encodeURIComponent(soa.client.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; };
    // With a mail account set up on the server the app sends it itself, to the
    // address on the client's record. Without one - or without an address on
    // file - it opens the office's own mail app with the statement written out.
    if (!soa.client.email || !can('clients.edit')) return openMailApp();
    if (!(await ui.confirm({ title: `Email this statement to ${soa.client.email}?`, message: `${soa.client.name} · amount due ${money(soa.netDue)}`, confirmLabel: 'Send' }))) return;
    try {
      const d = await (await apiFetch(`/api/clients/${soa.client._id}/statement/email`, { method: 'POST', body: JSON.stringify({ subject, text: body }) })).json();
      if (d.success) return ui.toast(`Statement sent to ${d.to}.`, { tone: 'success' });
      if (d.notSetUp) return openMailApp();
      ui.alert(d.error || 'Could not send it.');
    } catch { ui.alert('Network error.'); }
  };

  // Printed on the shop's own letterhead, with the running balance column the
  // client will check against their own books.
  const printStatement = () => {
    if (!soa) return;
    printBillingDoc(buildBillingDocHTML({
      docTitle: 'STATEMENT OF ACCOUNT',
      dateLabel: 'Statement date',
      dateStr: fmtDay(soa.period.end),
      settings: systemSettings,
      metaFields: [
        { label: 'Account', value: soa.client.registeredName || soa.client.name },
        { label: 'Client Code', value: soa.client.clientCode || '' },
        ...(soa.client.tin ? [{ label: 'TIN', value: soa.client.tin }] : []),
        ...(soa.client.registeredAddress ? [{ label: 'Registered Address', value: soa.client.registeredAddress }] : []),
        { label: 'Period', value: `${fmtDay(soa.period.start)} - ${fmtDay(soa.period.end)}` },
      ],
      subFields: [
        ...(soa.client.creditTermsDays != null ? [{ label: 'Terms', value: `${soa.client.creditTermsDays} days` }] : []),
        ...(soa.client.phone ? [{ label: 'Contact', value: soa.client.phone }] : []),
      ],
      schedRows: [
        { label: 'Current:', value: peso(soa.aged.current) },
        { label: '31-60 days:', value: peso(soa.aged.d31_60) },
        { label: '61-90 days:', value: peso(soa.aged.d61_90) },
        { label: 'Over 90 days:', value: peso(soa.aged.d90_plus) },
      ],
      itemColumns: [
        { label: 'Date', key: 'date' },
        { label: 'Reference', key: 'ref' },
        { label: 'Particulars', key: 'particulars' },
        { label: 'Charges', key: 'charge', align: 'right', money: true },
        { label: 'Payments / credits', key: 'payment', align: 'right', money: true },
        { label: 'Balance', key: 'balance', align: 'right', money: true },
      ],
      items: [
        { date: fmtDay(soa.period.start), ref: '', particulars: 'Balance brought forward', charge: null, payment: null, balance: soa.openingBalance },
        ...soa.rows.map(r => ({
          date: fmtDay(r.at), ref: r.reference || '', particulars: r.description || '',
          charge: r.charge || null, payment: r.payment || null, balance: r.balance,
        })),
      ],
      totals: [
        { label: 'Charges this period', value: soa.totals.charges },
        { label: 'Payments received', value: soa.totals.payments },
        ...(soa.deposits > 0 ? [{ label: 'Less deposits on hand', value: soa.deposits }] : []),
        { label: 'AMOUNT DUE', value: soa.netDue, grand: true },
      ],
      termsTitle: 'Please note',
      terms: [
        'This statement covers the period shown above. Balances carried forward are from earlier periods.',
        'Please settle the amount due on or before the terms agreed on your account.',
        'If any entry does not agree with your records, tell us within 7 days of receiving this statement.',
      ],
      signatures: ['PREPARED BY: Signature over Printed Name / Date', 'RECEIVED BY: Signature over Printed Name / Date'],
      copies: ['ORIGINAL'],
    }));
  };

  const term = q.trim().toLowerCase();
  const rows = term
    ? data.clients.filter(c =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.username || '').toLowerCase().includes(term) ||
        (c.clientCode || '').toLowerCase().includes(term))
    : data.clients;

  const overLimitCount = data.clients.filter(c => c.overLimit).length;

  // Bulk import. No credentials come out of the sheet - each client gets an
  // onboarding link and chooses its own username and password, so a
  // spreadsheet never decides who can sign in as whom.
  const importClients = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (rows.length === 0) { ui.alert('That sheet has no rows.'); return; }
      const ok = await ui.confirm(
        `Import ${rows.length} client(s)?` + '\n\n' +
        (HAS_CLIENT_LOGIN ? 'No passwords are set. Each one gets a 7-day link and picks their own username and password.' : 'They are added as customers to bill.'),
      );
      if (!ok) return;

      const d = await (await apiFetch('/api/client-accounts/import', {
        method: 'POST', body: JSON.stringify({ rows }),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Import failed.'); return; }

      // The links are the only way into these accounts, so they are shown
      // rather than buried - the operator has to send them on.
      const links = (d.clients || [])
        .map(c => `${c.name}: ${window.location.origin}${c.onboardingPath}`)
        .join('\n');
      const bad = (d.skipped || []).map(x => `Row ${x.row}: ${x.error}`);
      ui.alert(
        `Added ${d.created} client(s).` + '\n\n' + d.note +
        (links ? '\n\nOnboarding links (send these on):\n' + links : '') +
        (bad.length ? '\n\nNot added:\n- ' + bad.join('\n- ') : ''),
      );
      load();
    } catch (err) {
      console.error('client import', err);
      ui.alert('Could not read that file. Use the downloaded template.');
    } finally { setImporting(false); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
          <Users size={19} className="text-brand-text" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-fg leading-none">Clients</h1>
          <p className="text-fg/70 text-xs font-bold mt-1">
            {data.clients.length} account{data.clients.length === 1 ? '' : 's'}
            {data.showMoney && overLimitCount > 0 && (
              <span className="text-danger"> · {overLimitCount} over limit</span>
            )}
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/65" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search clients…"
            className="bg-surface border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60 transition w-full sm:w-64"
          />
        </div>
        {can('clients.create') && (
          <button onClick={() => { setShowAdd(v => !v); setAddedLink(''); }} aria-expanded={showAdd}
            className={`flex items-center gap-1.5 text-[10px] px-3 py-2.5 rounded-xl font-bold uppercase tracking-wider transition ${showAdd ? 'bg-brand text-on-brand' : 'bg-brand/10 hover:bg-brand/20 text-brand-text'}`}>
            <UserPlus size={13} /> Add client
          </button>
        )}
        {canInvite && (
          <button onClick={() => { setShowInvite(v => !v); setInviteLink(''); }} aria-expanded={showInvite}
            className={`flex items-center gap-1.5 text-[10px] px-3 py-2.5 rounded-xl font-bold uppercase tracking-wider transition ${showInvite ? 'bg-brand text-on-brand' : 'bg-brand/10 hover:bg-brand/20 text-brand-text'}`}>
            <Link2 size={13} /> New client link
          </button>
        )}
        <button onClick={() => downloadDataset?.('clients')}
          className="flex items-center gap-1.5 text-[10px] bg-brand/10 hover:bg-brand/20 text-brand-text px-3 py-2.5 rounded-xl font-bold uppercase tracking-wider transition">
          <Download size={13} /> Export
        </button>
        <button onClick={() => downloadDataset?.('clients', { template: true })}
          title="Blank workbook with the same columns"
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2.5 rounded-xl font-bold uppercase tracking-wider transition">
          <FileText size={13} /> Template
        </button>
        <label className={`flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2.5 rounded-xl font-bold uppercase tracking-wider transition ${importing ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
          <Upload size={13} /> {importing ? 'Reading…' : 'Import'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; importClients(f); }} />
        </label>
        <button onClick={load} disabled={loading}
          className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/70 hover:text-fg flex items-center justify-center transition disabled:opacity-40"
          aria-label="Refresh clients">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {showAdd && can('clients.create') && (
        <form onSubmit={addClient} className="bg-surface border border-white/10 rounded-2xl p-4 space-y-3">
          <p className="text-xs text-fg/70 font-bold">
            {HAS_CLIENT_LOGIN ? 'New client. They get a link (good for 7 days) to choose their own username and password.' : 'New customer to bill.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <input required value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Client name *" aria-label="Client name" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60" />
            <input value={addForm.phone} onChange={e => setAddForm({ ...addForm, phone: e.target.value })} placeholder="Phone" aria-label="Phone" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60" />
            <input type="email" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="Email" aria-label="Email" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60" />
            <select value={addForm.paymentMethod} onChange={e => setAddForm({ ...addForm, paymentMethod: e.target.value })} aria-label="Payment method" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60">
              {[['Cash', 'Cash on Delivery'], ['E-Wallet', 'E-Wallet'], ['Bank Transfer', 'Bank Transfer'], ['Credit Card', 'Credit Card']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {can('clients.edit') && tiers.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-bold text-fg/70">
              Price tier
              <select value={addForm.tier} onChange={e => setAddForm({ ...addForm, tier: e.target.value })} aria-label="Price tier"
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/60">
                <option value="">List price (no tier)</option>
                {tiers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <input value={addForm.contactNotes} onChange={e => setAddForm({ ...addForm, contactNotes: e.target.value })} placeholder="Notes (address, contact person...)" aria-label="Notes" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60" />
          <div className="flex flex-wrap gap-2 items-center">
            <button type="submit" disabled={adding || !addForm.name.trim()}
              className="bg-brand text-on-brand font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider disabled:opacity-50">
              {adding ? 'Adding…' : 'Add & copy link'}
            </button>
            {addedLink && (<>
              <input readOnly value={addedLink} onFocus={e => e.target.select()} aria-label="Client link"
                className="flex-1 min-w-[180px] bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg text-xs" />
              <button type="button" onClick={() => navigator.clipboard?.writeText(addedLink).then(() => ui.toast('Link copied.', { tone: 'success' }), () => {})}
                className="border border-white/15 text-fg/80 hover:bg-white/5 px-3 py-2 rounded-xl text-xs font-bold">Copy again</button>
            </>)}
          </div>
          <p className="text-[11px] text-fg/65">Credit line and terms are set from the client's credit request, not here.</p>
        </form>
      )}
      {showInvite && canInvite && (
        <form onSubmit={createInvite} className="bg-surface border border-white/10 rounded-2xl p-4 space-y-3">
          <p className="text-xs text-fg/70 font-bold">
            Type the client's name, or leave it blank and they will fill it in themselves. They open the link (good for 7 days) and enter their phone, email, username and password.
          </p>
          <div className="flex flex-wrap gap-2">
            <input value={inviteName} onChange={e => setInviteName(e.target.value)} autoFocus
              placeholder="Client name (optional)" aria-label="Client name (optional)"
              className="flex-1 min-w-[180px] bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm placeholder-fg/70 outline-none focus:border-brand/60" />
            <button type="submit" disabled={inviting}
              className="bg-brand text-on-brand font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider disabled:opacity-50">
              {inviting ? 'Creating…' : inviteName.trim() ? 'Create & copy link' : 'Create link with no name'}
            </button>
          </div>
          {inviteLink && (
            <div className="flex flex-wrap gap-2 items-center">
              <input readOnly value={inviteLink} onFocus={e => e.target.select()} aria-label="Client link"
                className="flex-1 min-w-[180px] bg-page-bg border border-white/10 rounded-xl px-3 py-2 text-fg text-xs" />
              <button type="button" onClick={() => navigator.clipboard?.writeText(inviteLink).then(() => ui.toast('Link copied.', { tone: 'success' }), () => {})}
                className="border border-white/15 text-fg/80 hover:bg-white/5 px-3 py-2 rounded-xl text-xs font-bold">Copy again</button>
            </div>
          )}
        </form>
      )}

      {!data.showMoney && (
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-fg/70 text-xs font-bold">
          <AlertCircle size={14} />
          Balances and credit limits are hidden - they need the accounting permission.
        </div>
      )}

      <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            {/* Every other table in the app heads its columns on the panel's own
                ground; a solid green bar here made Clients look like a different app. */}
            <tr className="bg-surface-2 text-fg/80 text-[10px] uppercase tracking-widest border-b border-white/10">
              <th className="text-left py-3 px-4">Client</th>
              <th className="text-left py-3">Code</th>
              <th className="text-right py-3">Orders</th>
              <th className="text-right py-3">Last Order</th>
              {data.showMoney && <>
                <th className="text-right py-3">Owes you</th>
                <th className="text-right py-3">Committed</th>
                <th className="text-right py-3" title="Paid ahead of any order, not yet applied">Deposits</th>
                <th className="text-right py-3 px-4">Limit / Left</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={data.showMoney ? 8 : 4} className="py-14 text-center text-fg/65 font-bold">
                  {loading ? 'Loading…' : q ? 'No clients match that search.' : 'No client accounts yet - add one in the Admin Panel.'}
                </td>
              </tr>
            ) : rows.map(c => (
              <Fragment key={c._id}>
                <tr
                  onClick={() => toggle(c._id)}
                  className={`border-b border-white/5 cursor-pointer hover:bg-white/5 transition ${c.overLimit ? 'bg-red-500/5' : ''}`}>
                  <td className="py-3 px-4 font-bold text-fg">
                    <span className="inline-flex items-center gap-2">
                      {expanded === c._id ? <ChevronDown size={13} className="text-fg/65" /> : <ChevronRight size={13} className="text-fg/65" />}
                      {c.name}
                      {!c.isActive && <span className="text-[8px] font-black bg-white/10 text-fg/65 px-1.5 py-0.5 rounded uppercase">Inactive</span>}
                      {c.overLimit && <span className="text-[8px] font-black bg-red-700 text-white px-1.5 py-0.5 rounded uppercase">Over</span>}
                      {c.source === 'pos' && <span className="text-[8px] font-black bg-white/10 text-fg/70 px-1.5 py-0.5 rounded uppercase" title="Auto-promoted repeat walk-in">Walk-in</span>}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-fg/100 text-xs">{c.clientCode}</td>
                  <td className="py-3 text-right tabular-nums text-fg/100">{c.orderCount}</td>
                  <td className="py-3 text-right text-fg/100 text-xs whitespace-nowrap">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' }) : '-'}
                  </td>
                  {data.showMoney && <>
                    <td className="py-3 text-right tabular-nums font-black text-fg/100">{c.aged?.total ? peso(c.aged.total) : '-'}</td>
                    <td className="py-3 text-right tabular-nums text-brand-text">{c.exposure ? peso(c.exposure) : '-'}</td>
                    <td className="py-3 text-right tabular-nums text-success">{c.deposits ? peso(c.deposits) : '-'}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-xs">
                      {c.creditLimit === null || c.creditLimit === undefined
                        ? <span className="text-fg/100">No limit</span>
                        : <span className={c.overLimit ? 'text-danger font-bold' : 'text-fg/100'}>
                            ₱{c.creditLimit.toLocaleString('en-PH')} <span className="text-fg/100">/</span> ₱{(c.available ?? 0).toLocaleString('en-PH')}
                          </span>}
                    </td>
                  </>}
                </tr>

                {expanded === c._id && (
                  <tr className="bg-page-bg/40">
                    <td colSpan={data.showMoney ? 8 : 4} className="px-4 py-3">
                      {!isSuperAdmin && can('accounting.manage') && (
                        <div className="flex justify-end mb-2">
                          <button onClick={(e) => { e.stopPropagation(); requestCreditChange(c); }}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 text-fg/80 hover:bg-white/10">Request credit change</button>
                        </div>
                      )}
                      {data.showMoney && c.aged && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {[['Current', c.aged.current], ['31-60', c.aged.d31_60], ['61-90', c.aged.d61_90], ['91+', c.aged.d90_plus]].map(([lbl, amt]) => (
                            <span key={lbl} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                              <span className="text-fg/70 font-bold">{lbl}</span>
                              <span className={`font-black tabular-nums ml-2 ${amt > 0 ? 'text-fg' : 'text-fg/65'}`}>{peso(amt)}</span>
                            </span>
                          ))}
                          {typeof c.lifetimeValue === 'number' && (
                            <span className="bg-brand/10 border border-brand/25 rounded-lg px-3 py-1.5 text-xs">
                              <span className="text-brand-text font-bold">Lifetime</span>
                              <span className="text-brand-text font-black tabular-nums ml-2">{peso(c.lifetimeValue)}</span>
                            </span>
                          )}
                        </div>
                      )}
                      {(() => {
                        const link = links?.byId?.[c._id];
                        const setupUrl = link?.onboardingPath ? `${window.location.origin}${link.onboardingPath}` : '';
                        const signInUrl = link?.hasLogin ? `${window.location.origin}${links.signInPath}` : '';
                        const tier = tierOf(c);
                        const chip = 'flex items-center gap-1.5 text-[10px] px-3 py-2 rounded-xl font-bold uppercase tracking-wider transition';
                        return (
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            {/* Price tier */}
                            {can('clients.edit') && tiers.length > 0 ? (
                              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-fg/70">
                                Price tier
                                <select value={tier} onChange={e => setClientTier(c, e.target.value)} aria-label={`Price tier for ${c.name}`}
                                  className="bg-white/5 border border-white/10 rounded-xl px-2 py-1.5 text-fg text-xs font-bold normal-case tracking-normal outline-none focus:border-brand/60">
                                  <option value="">List price</option>
                                  {tiers.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </label>
                            ) : tier ? (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-fg/70 bg-white/5 border border-white/10 rounded-xl px-3 py-2">Tier: {tier}</span>
                            ) : null}
                            {/* Their link */}
                            {canLinks && links && (
                              setupUrl ? (
                                <button onClick={() => copyText(setupUrl)} title={`Setup link - good until ${new Date(link.onboardingExpiresAt).toLocaleDateString('en-PH')}`}
                                  className={`${chip} bg-brand/10 hover:bg-brand/20 text-brand-text`}>
                                  <Link2 size={13} /> Copy setup link
                                </button>
                              ) : signInUrl ? (
                                <button onClick={() => copyText(signInUrl)} className={`${chip} border border-white/15 text-fg/80 hover:bg-white/5`}>
                                  <Link2 size={13} /> Copy sign-in link
                                </button>
                              ) : isSuperAdmin ? (
                                <button onClick={() => newSetupLink(c)} className={`${chip} border border-white/15 text-fg/80 hover:bg-white/5`}>
                                  <Link2 size={13} /> New setup link
                                </button>
                              ) : (
                                <span className="text-[10px] font-bold text-fg/65">Setup link expired - ask the owner for a new one</span>
                              )
                            )}
                            {can('clients.edit') && (
                              <button onClick={() => (edit?.id === c._id ? setEdit(null) : openEdit(c))} aria-expanded={edit?.id === c._id}
                                className={`${chip} border border-white/15 text-fg/80 hover:bg-white/5`}>
                                Edit details
                              </button>
                            )}
                            {data.showMoney && (
                              <button onClick={() => openStatement(c)} className={`${chip} bg-brand/10 hover:bg-brand/20 text-brand-text`}>
                                <FileText size={13} /> Statement of account
                              </button>
                            )}
                            {can('clients.edit') && (
                              <button onClick={() => downloadClientRecord(apiFetch, c)} title="Everything held about this client, in one file - for when they ask"
                                className={`${chip} border border-white/15 text-fg/80 hover:bg-white/5`}>
                                <Download size={13} /> Their record
                              </button>
                            )}
                            {can('clients.delete') && orders[c._id] && orders[c._id].length === 0 && (
                              <button onClick={() => deleteClient(c)} className={`${chip} border border-danger/40 text-danger hover:bg-danger/10 ml-auto`}>
                                <Trash2 size={13} /> Delete client
                              </button>
                            )}
                          </div>
                        );
                      })()}
                      {edit?.id === c._id && (() => {
                        const box = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/60';
                        const set = (k) => (e) => setEdit(x => ({ ...x, now: { ...x.now, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));
                        return (
                          <form onSubmit={saveEdit} onClick={e => e.stopPropagation()} className="bg-surface border border-white/10 rounded-xl p-3 mb-3 space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Name
                                <input value={edit.now.name} onChange={set('name')} maxLength={120} className={`${box} mt-1 normal-case tracking-normal`} /></label>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Phone
                                <input value={edit.now.phone} onChange={set('phone')} maxLength={40} className={`${box} mt-1 normal-case tracking-normal`} /></label>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Email
                                <input type="email" value={edit.now.email} onChange={set('email')} maxLength={120} className={`${box} mt-1 normal-case tracking-normal`} /></label>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Usual payment
                                <select value={edit.now.paymentMethod} onChange={set('paymentMethod')} className={`${box} mt-1 normal-case tracking-normal`}>
                                  {[['Cash', 'Cash on Delivery'], ['E-Wallet', 'E-Wallet'], ['Bank Transfer', 'Bank Transfer'], ['Credit Card', 'Credit Card']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select></label>
                              {/* Payment terms are part of the credit line: an approver's to change. */}
                              {can('pricing.approve') && (
                                <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Payment terms (days)
                                  <input type="number" min="0" step="1" value={edit.now.creditTermsDays} onChange={set('creditTermsDays')} placeholder="e.g. 30" className={`${box} mt-1 normal-case tracking-normal`} /></label>
                              )}
                              <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Notes
                                <input value={edit.now.contactNotes} onChange={set('contactNotes')} maxLength={300} className={`${box} mt-1 normal-case tracking-normal`} /></label>
                            </div>
                            <label className="flex items-center gap-2 text-xs font-bold text-fg/80">
                              <input type="checkbox" checked={!!edit.now.isActive} onChange={set('isActive')} /> Active - can order and be sold to
                            </label>
                            <label className="flex items-center gap-2 text-xs font-bold text-fg/80">
                              <input type="checkbox" checked={!!edit.now.isAffiliate} onChange={set('isAffiliate')} /> Affiliate or satellite - a related business; what it owes is totalled apart from customers on Receivables
                            </label>
                            <p className="text-[11px] text-fg/65">A credit limit is changed with its own approval{HAS_CLIENT_LOGIN ? "; passwords and sign-in links are in the owner's Admin Panel" : ''}.</p>
                            <div className="flex gap-2">
                              <button type="submit" className="bg-brand text-on-brand px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider">Save</button>
                              <button type="button" onClick={() => setEdit(null)} className="bg-white/5 text-fg/80 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider">Cancel</button>
                            </div>
                          </form>
                        );
                      })()}
                      {!orders[c._id] ? (
                        <p className="text-fg/65 text-xs font-bold py-2">Loading orders…</p>
                      ) : orders[c._id].length === 0 ? (
                        <p className="text-fg/65 text-xs font-bold py-2">No orders yet. Orders for this client show here once placed.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-fg/100 text-[9px] uppercase tracking-wider border-b border-white/5">
                              <th className="text-left py-1.5">Order</th>
                              <th className="text-left py-1.5">Date</th>
                              <th className="text-left py-1.5">Status</th>
                              <th className="text-left py-1.5">Payment</th>
                              <th className="text-right py-1.5">Items</th>
                              <th className="text-right py-1.5">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders[c._id].map(o => (
                              <tr key={o._id} className="border-b border-white/5">
                                <td className="py-1.5 font-mono text-fg/65">{o.billingNumber || o.orderNumber}</td>
                                <td className="py-1.5 text-fg/80">{new Date(o.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                                <td className="py-1.5 text-fg/80">{o.status}</td>
                                <td className="py-1.5 text-fg/80">
                                  {o.paymentMethod}
                                  {o.paymentMethod !== 'Cash' && !o.arSettled && o.status === 'Completed' && (
                                    <span className="ml-1.5 text-[8px] font-black bg-yellow-500/20 text-warning px-1 py-0.5 rounded uppercase">Unsettled</span>
                                  )}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-fg/80">{o.itemCount}</td>
                                <td className="py-1.5 text-right tabular-nums font-bold text-fg">
                                  {peso(o.total)}
                                  {/* Otherwise this row and the statement disagree, and
                                      nobody can tell which one to believe. */}
                                  {o.refundedAmount > 0 && (
                                    <span className="block text-[9px] font-bold text-fg/65">less {peso(o.refundedAmount)} refunded</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {soaFor && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={() => setSoaFor(null)}>
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-3xl my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
              <div className="min-w-0">
                <h2 className="font-black text-fg text-lg truncate">Statement of account</h2>
                <p className="text-fg/65 text-xs font-bold truncate">{soaFor.name}{soaFor.clientCode ? ` · ${soaFor.clientCode}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <RangePresets value={soaRange} onChange={r => { setSoaRange(r); loadStatement(soaFor, r); }} />
                <input type="date" value={soaRange.start}
                  onChange={e => { const r = { ...soaRange, start: e.target.value }; setSoaRange(r); loadStatement(soaFor, r); }}
                  className="bg-white/5 border border-white/10 focus:border-brand rounded-lg px-2 py-1.5 text-xs text-fg outline-none" />
                <span className="text-fg/65 text-xs">to</span>
                <input type="date" value={soaRange.end}
                  onChange={e => { const r = { ...soaRange, end: e.target.value }; setSoaRange(r); loadStatement(soaFor, r); }}
                  className="bg-white/5 border border-white/10 focus:border-brand rounded-lg px-2 py-1.5 text-xs text-fg outline-none" />
              </div>
            </div>

            <div className="p-5 max-h-[65vh] overflow-y-auto">
              {soaLoading || !soa ? (
                <p className="text-fg/65 text-sm font-bold py-6 text-center">{soaLoading ? 'Building the statement…' : 'Nothing to show for this period.'}</p>
              ) : (
                <>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-fg/70 text-[9px] uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-1.5">Date</th>
                        <th className="text-left py-1.5">Reference</th>
                        <th className="text-left py-1.5">Particulars</th>
                        <th className="text-right py-1.5">Charges</th>
                        <th className="text-right py-1.5">Payments / credits</th>
                        <th className="text-right py-1.5">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-white/5">
                        <td className="py-1.5 text-fg/80">{fmtDay(soa.period.start)}</td>
                        <td />
                        <td className="py-1.5 text-fg/70 italic">Balance brought forward</td>
                        <td /><td />
                        <td className="py-1.5 text-right tabular-nums font-bold text-fg">{peso(soa.openingBalance)}</td>
                      </tr>
                      {soa.rows.map((r, i) => (
                        <tr key={`${r.reference}-${i}`} className="border-b border-white/5">
                          <td className="py-1.5 text-fg/80 whitespace-nowrap">{fmtDay(r.at)}</td>
                          <td className="py-1.5 font-mono text-fg/65">{r.reference}</td>
                          <td className="py-1.5 text-fg/80">{r.description}</td>
                          <td className="py-1.5 text-right tabular-nums text-fg/80">{r.charge ? peso(r.charge) : ''}</td>
                          <td className="py-1.5 text-right tabular-nums text-success">{r.payment ? peso(r.payment) : ''}</td>
                          <td className="py-1.5 text-right tabular-nums font-bold text-fg">{peso(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap gap-2 mt-4">
                    {[['Current', soa.aged.current], ['31-60', soa.aged.d31_60], ['61-90', soa.aged.d61_90], ['91+', soa.aged.d90_plus]].map(([lbl, amt]) => (
                      <span key={lbl} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                        <span className="text-fg/70 font-bold">{lbl}</span>
                        <span className={`font-black tabular-nums ml-2 ${amt > 0 ? 'text-fg' : 'text-fg/65'}`}>{peso(amt)}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10">
              <div className="text-sm">
                <span className="text-fg/65 font-bold text-xs uppercase tracking-wider mr-2">Amount due</span>
                <span className="font-black text-fg tabular-nums">{peso(soa?.netDue || 0)}</span>
                {soa?.deposits > 0 && <span className="text-fg/65 text-xs font-bold ml-2">after {peso(soa.deposits)} on deposit</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSoaFor(null)} className="text-sm font-bold px-4 py-2 rounded-xl text-fg/70 hover:text-fg transition">Close</button>
                {/* Opens the office's own mail app with the statement written out.
                    Nothing is sent from here, and no mail account is set up in the app. */}
                <button onClick={emailStatement} disabled={!soa} title={soa && !soa.client.email ? 'This client has no email on file - you can type the address in your mail app' : 'Open your mail app with this statement'}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 disabled:opacity-50 font-bold text-sm px-4 py-2 rounded-xl transition">
                  <Mail size={15} /> Email
                </button>
                <button onClick={printStatement} disabled={!soa}
                  className="flex items-center gap-2 bg-brand text-on-brand disabled:opacity-50 font-bold text-sm px-4 py-2 rounded-xl hover:bg-brand-dark transition">
                  <FileText size={15} /> Print
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
