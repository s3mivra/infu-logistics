import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, RefreshCw, Link2 } from 'lucide-react';
import * as ui from '../../shared/ui';

// Client links, for the office to copy and send on - nothing here creates,
// renews or edits a link. The sign-in link is the same for every client. An
// onboarding link sets a client's own username and password, so only a
// superadmin issues one (Admin Panel → Client Accounts); once issued it shows
// here until it is used or expires.
export default function ClientLinks({ apiFetch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await (await apiFetch('/api/client-accounts/links')).json();
      setData(d.success ? d : { error: d.error || 'Could not load the links.' });
    } catch { setData({ error: 'Network error.' }); }
    finally { setLoading(false); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const copy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? '' : c)), 1800);
    } catch {
      // No clipboard (an insecure page, an old browser): show it to copy by hand.
      ui.alert(text);
    }
  };

  const origin = window.location.origin;
  const signIn = data?.signInPath ? `${origin}${data.signInPath}` : '';
  const needle = q.trim().toLowerCase();
  const rows = (data?.clients || []).filter(c => !needle || `${c.name} ${c.clientCode}`.toLowerCase().includes(needle));

  const CopyButton = ({ id, text, label }) => (
    <button type="button" onClick={() => copy(id, text)} aria-label={`${label}: copy`}
      className={`h-8 px-3 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition ${copied === id ? 'bg-green-700 text-white' : 'bg-white/10 text-fg hover:bg-white/15'}`}>
      {copied === id ? <Check size={12} /> : <Copy size={12} />} {copied === id ? 'Copied' : 'Copy'}
    </button>
  );

  return (
    <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/10">
        <Link2 size={16} className="text-brand-text" />
        <div className="mr-auto">
          <h3 className="text-fg font-black text-sm">Client links</h3>
          <p className="text-fg/70 text-xs">Copy and send. A new onboarding link is issued by an admin.</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a client…" aria-label="Find a client"
          className="bg-page-bg border border-white/10 rounded-lg px-3 py-1.5 text-fg text-xs w-44" />
        <button type="button" onClick={load} aria-label="Refresh links"
          className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 text-fg/75 flex items-center justify-center"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {data?.error && <p className="px-4 py-3 text-danger text-sm">{data.error}</p>}

      {signIn && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="mr-auto min-w-0">
            <p className="text-[10px] text-fg/70 font-bold uppercase tracking-wider">Portal sign-in - the same for every client</p>
            <p className="text-fg text-xs font-mono break-all">{signIn}</p>
          </div>
          <CopyButton id="signin" text={signIn} label="Portal sign-in link" />
        </div>
      )}

      {data?.clients && (rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-fg/70 text-sm">{data.clients.length ? 'No client matches that.' : 'No client accounts yet.'}</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map(c => {
            const link = c.onboardingPath ? `${origin}${c.onboardingPath}` : '';
            return (
              <li key={c._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="mr-auto min-w-0">
                  <p className="text-fg text-sm font-bold">{c.name} {c.clientCode && <span className="text-fg/65 font-mono text-xs">{c.clientCode}</span>}</p>
                  <p className="text-fg/70 text-xs">
                    {link
                      ? `Onboarding link valid until ${new Date(c.onboardingExpiresAt).toLocaleDateString()}`
                      : c.hasLogin ? 'Has a login - send the portal sign-in link.' : 'No login yet and no onboarding link - ask an admin to issue one.'}
                  </p>
                </div>
                {link && <CopyButton id={c._id} text={link} label={`Onboarding link for ${c.name}`} />}
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}
