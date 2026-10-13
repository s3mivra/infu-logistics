import { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { ShieldCheck } from 'lucide-react';
import * as ui from '../../shared/ui';

// Two-step sign-in for your own account: after the password, the six digits an
// authenticator app shows. Off until you turn it on. The owner can also switch
// it off for someone who lost their phone (and their backup codes).
const box = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const btn = 'px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-50';
const call = async (apiFetch, path, method = 'GET', body) => (await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json();

export default function TwoStepCard({ apiFetch, isSuperAdmin }) {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);         // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);         // backup codes, shown once
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [reset, setReset] = useState({ id: '', password: '' });

  const load = useCallback(async () => {
    try { const d = await call(apiFetch, '/api/users/me/two-step'); if (d.success) setStatus(d); } catch { /* the card simply does not show */ }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    let alive = true;
    call(apiFetch, '/api/users').then(d => { if (alive && d.success) setUsers((d.users || []).filter(u => u.totpEnabled)); }).catch(() => {});
    return () => { alive = false; };
  }, [apiFetch, isSuperAdmin, status?.enabled]);

  const run = async (fn) => { setBusy(true); try { await fn(); } catch { ui.alert('Network error.'); } finally { setBusy(false); } };
  const start = () => run(async () => {
    const d = await call(apiFetch, '/api/users/me/two-step/setup', 'POST');
    if (!d.success) return ui.alert(d.error || 'Could not start.');
    setSetup(d); setCode('');
  });
  const confirm = (e) => { e.preventDefault(); run(async () => {
    const d = await call(apiFetch, '/api/users/me/two-step/enable', 'POST', { code });
    if (!d.success) return ui.alert(d.error || 'That code is not right.');
    setSetup(null); setCodes(d.backupCodes); load();
  }); };
  const turnOff = (e) => { e.preventDefault(); run(async () => {
    const d = await call(apiFetch, '/api/users/me/two-step/disable', 'POST', { password });
    if (!d.success) return ui.alert(d.error || 'Could not turn it off.');
    setPassword(''); setCodes(null); load();
    ui.toast('Two-step sign-in is off.', { tone: 'success' });
  }); };
  const resetOther = (e) => { e.preventDefault(); run(async () => {
    const d = await call(apiFetch, `/api/users/${reset.id}/two-step/reset`, 'POST', { confirmPassword: reset.password });
    if (!d.success) return ui.alert(d.error || 'Could not switch it off.');
    ui.toast(`Two-step sign-in is off for ${d.name}. They sign in with just their password now.`, { tone: 'success' });
    setReset({ id: '', password: '' });
    setUsers(list => list.filter(u => String(u._id) !== reset.id));
  }); };

  if (!status) return null;
  return (
    <div className="bg-surface border border-white/10 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-black text-fg flex items-center gap-2"><ShieldCheck size={16} className="text-brand-text" /> Two-step sign-in</h3>

      {codes ? (
        <div className="space-y-2">
          <p className="text-sm font-bold text-success">It is on. Keep these backup codes somewhere that is not your phone.</p>
          <p className="text-xs text-fg/70">Each one signs you in once if you lose the phone. They are shown only now.</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-sm text-fg bg-white/5 border border-white/10 rounded-lg p-3 max-w-xs">
            {codes.map(c => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => ui.toast('Copied.', { tone: 'success' }), () => {})} className={`${btn} border border-white/15 text-fg/80 hover:bg-white/5`}>Copy</button>
            <button type="button" onClick={() => setCodes(null)} className={`${btn} bg-brand text-on-brand`}>I have saved them</button>
          </div>
        </div>
      ) : status.enabled ? (
        <div className="space-y-2">
          <p className="text-xs text-fg/80">On for your account. Signing in takes your password and the code from your authenticator app. <span className="font-bold">{status.backupCodesLeft}</span> backup code(s) left.</p>
          <form onSubmit={turnOff} className="flex items-end gap-2 flex-wrap">
            <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Your password, to turn it off
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className={`${box} block mt-1`} /></label>
            <button type="submit" disabled={busy || !password} className={`${btn} border border-danger/40 text-danger hover:bg-danger/10`}>Turn off</button>
          </form>
        </div>
      ) : setup ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-xs text-fg/80">1. Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy) and scan this.</p>
          <div className="bg-white p-3 rounded-lg inline-block"><QRCode value={setup.otpauthUrl} size={160} /></div>
          <p className="text-[11px] text-fg/70">Cannot scan? Type this key into the app: <span className="font-mono text-fg break-all">{setup.secret}</span></p>
          <p className="text-xs text-fg/80">2. Type the 6-digit code the app now shows.</p>
          <div className="flex gap-2 flex-wrap">
            <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="Code from the app" maxLength={7} className={`${box} w-32 tracking-widest text-center`} />
            <button type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6} className={`${btn} bg-brand text-on-brand`}>Turn on</button>
            <button type="button" onClick={() => setSetup(null)} className={`${btn} text-fg/70 hover:text-fg`}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-fg/80 leading-relaxed">Off. Turn it on and signing in will take your password and a 6-digit code from an app on your phone - so a password someone saw or guessed is not enough on its own. You need the phone each time you sign in.</p>
          <button type="button" onClick={start} disabled={busy} className={`${btn} bg-brand text-on-brand`}>Set it up</button>
        </div>
      )}

      {isSuperAdmin && users.length > 0 && (
        <form onSubmit={resetOther} className="border-t border-white/10 pt-3 space-y-2">
          <p className="text-xs font-bold text-fg">Someone lost their phone?</p>
          <p className="text-[11px] text-fg/70">Switch two-step sign-in off for them. They then sign in with just their password and can set it up again.</p>
          <div className="flex items-end gap-2 flex-wrap">
            <select value={reset.id} onChange={e => setReset(r => ({ ...r, id: e.target.value }))} aria-label="Whose two-step sign-in to switch off" className={box}>
              <option value="">Who?</option>
              {users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
            <input type="password" value={reset.password} onChange={e => setReset(r => ({ ...r, password: e.target.value }))} placeholder="Your own password" aria-label="Your own password" autoComplete="current-password" className={box} />
            <button type="submit" disabled={busy || !reset.id || !reset.password} className={`${btn} border border-white/15 text-fg/80 hover:bg-white/5`}>Switch it off</button>
          </div>
        </form>
      )}
    </div>
  );
}
