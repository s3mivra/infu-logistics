import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import * as ui from '../../shared/ui';

// Email the app sends on its own: the day's summary and low-stock list to the
// owner, and payment reminders to clients. Each is off until switched on here,
// and none can run until a mail account is set up. The superadmin sets that up
// right here (Mail account, below); everyone else only ever sees whether email
// is on - none of the technical side.
const box = 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
const call = async (apiFetch, path, method = 'GET', body) => (await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json();

// The automatic emails a superadmin can preview or test-send on demand.
const TEST_KINDS = [
  ['summary', 'Daily summary'], ['lowStock', 'Low-stock alert'], ['weekly', 'Week in review'],
  ['monthly', 'Month in review'], ['reminder', 'Payment reminder'],
];

// Superadmin only: the account the app sends from. The password is never
// shown back - only whether one is saved; leave it blank to keep it.
function MailAccountForm({ apiFetch, onSaved }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ host: 'smtp.gmail.com', port: 587, user: '', pass: '', from: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await call(apiFetch, '/api/mail/account');
      if (!r.success) return;
      setD(r);
      if (r.account) setF({ host: r.account.host, port: r.account.port, user: r.account.user, pass: '', from: r.account.from });
    } catch { /* stays hidden */ }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const put = async (body) => {
    setBusy(true);
    try {
      const r = await call(apiFetch, '/api/mail/account', 'PUT', body);
      if (!r.success) return ui.alert(r.error || 'Could not save.');
      ui.toast(body.clear ? 'Mail account removed.' : 'Mail account saved.', { tone: 'success' });
      await load(); onSaved?.();
    } catch { ui.alert('Network error.'); } finally { setBusy(false); }
  };
  const field = (k, label, props = {}) => (
    <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70 block">{label}
      <input value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} className={`${box} w-full mt-1 normal-case tracking-normal`} {...props} /></label>
  );
  const saved = d.account;
  return (
    <div className="border border-white/10 rounded-xl p-3 space-y-2 bg-white/[0.02]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Mail account <span className="normal-case tracking-normal font-normal text-fg/60">· superadmin only - the owner does not see this</span></p>
      {d.source === 'server' && <p className="text-xs text-warning">The server has its own mail settings, and those are used. What you save here applies only if they are removed.</p>}
      {d.passwordUnreadable && <p className="text-xs text-danger font-bold">The saved password can no longer be read (the server's secret was changed). Type the app password again and save.</p>}
      <form onSubmit={e => { e.preventDefault(); put({ ...f, port: Number(f.port) || 587 }); }} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {field('host', 'Mail server', { placeholder: 'smtp.gmail.com', autoComplete: 'off' })}
        {field('port', 'Port', { type: 'number', min: 1, max: 65535, placeholder: '587' })}
        {field('user', 'Login (email)', { type: 'email', placeholder: 'you@gmail.com', autoComplete: 'off' })}
        {field('pass', saved?.hasPassword ? 'App password (saved - leave blank to keep)' : 'App password', { type: 'password', autoComplete: 'new-password', placeholder: saved?.hasPassword ? '••••••••' : 'For Gmail: an app password, not the real one' })}
        <div className="sm:col-span-2">{field('from', 'Send from', { placeholder: 'Infusions Quarters <you@gmail.com>' })}</div>
        <div className="sm:col-span-2 flex gap-2 flex-wrap items-center">
          <button type="submit" disabled={busy} className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-50">Save account</button>
          {saved && <button type="button" disabled={busy} onClick={async () => { if (await ui.confirm({ title: 'Remove the mail account?', message: 'The app stops sending email until one is set up again.', confirmLabel: 'Remove' })) put({ clear: true }); }}
            className="px-3 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 font-bold text-xs uppercase tracking-wider disabled:opacity-50">Remove</button>}
          <span className="text-[10px] text-fg/60">Gmail: Google Account → Security → turn on 2-Step Verification → App passwords. Then use "Send a test" below.</span>
        </div>
      </form>
    </div>
  );
}

export default function MailSettingsCard({ apiFetch, isSuperAdmin = false }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [testKind, setTestKind] = useState('summary');
  const [preview, setPreview] = useState(null);
  const load = useCallback(async () => {
    try {
      const d = await call(apiFetch, '/api/mail/status');
      if (d.success) { setState(d); setForm(d.settings); }
    } catch { /* the card simply does not show */ }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);
  if (!state || !form) return null;

  const save = async (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    setBusy('save');
    try {
      const d = await call(apiFetch, '/api/mail/settings', 'PUT', next);
      if (!d.success) { ui.alert(d.error || 'Could not save.'); setForm(state.settings); return; }
      setState(s => ({ ...s, settings: d.settings })); setForm(d.settings);
    } catch { ui.alert('Network error.'); } finally { setBusy(''); }
  };
  const run = async (path, done) => {
    setBusy(path);
    try {
      const d = await call(apiFetch, path, 'POST');
      if (!d.success) return ui.alert(d.error || 'That did not work.');
      ui.alert(done(d));
    } catch { ui.alert('Network error.'); } finally { setBusy(''); }
  };
  const Toggle = ({ k, title, desc }) => (
    <label className="flex items-start gap-3 py-2 border-t border-white/5 first:border-0">
      <input type="checkbox" className="mt-1" checked={!!form[k]} disabled={!state.configured || !!busy} onChange={e => save({ [k]: e.target.checked })} />
      <span><span className="block text-sm font-bold text-fg">{title}</span><span className="block text-xs text-fg/70">{desc}</span></span>
    </label>
  );
  return (
    <div className="bg-surface border border-white/10 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-black text-fg flex items-center gap-2"><Mail size={16} className="text-brand-text" /> Email</h3>
      {isSuperAdmin && <MailAccountForm apiFetch={apiFetch} onSaved={load} />}
      {!state.configured ? (
        <p className="text-xs text-fg/80 leading-relaxed">
          {isSuperAdmin
            ? 'Email is not set up yet. Fill in the mail account above, save, then send a test.'
            : 'Email is not set up yet, so the app sends none. Ask your administrator to connect a mail account. Until then, statements can still be sent from your own mail app.'}
        </p>
      ) : (
        <p className="text-xs text-fg/70">Sent from <span className="font-bold text-fg/80">{state.from}</span>. Everything below is off until you switch it on.</p>
      )}
      <form onSubmit={e => { e.preventDefault(); save({}); }} className="flex items-end gap-2 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70 flex-1 min-w-[220px]">Owner's email
          <input type="email" value={form.ownerEmail} onChange={e => setForm(f => ({ ...f, ownerEmail: e.target.value }))} placeholder="where the summary and alerts go" className={`${box} w-full mt-1 normal-case tracking-normal`} /></label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Send at
          <select value={form.sendHour} onChange={e => setForm(f => ({ ...f, sendHour: Number(e.target.value) }))} className={`${box} block mt-1`}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{((h + 11) % 12) + 1}:00 {h < 12 ? 'AM' : 'PM'}</option>)}
          </select></label>
        <button type="submit" disabled={!!busy} className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-50">Save</button>
      </form>
      <div>
        <Toggle k="dailySummary" title="Daily summary to the owner" desc="Sales today and this month, what customers owe and what is overdue, and what is running low." />
        <Toggle k="lowStock" title="Low-stock alert to the owner" desc="Only on days something is at or below its alert level. Grouped by the supplier each item was last bought from, with a suggested quantity." />
        <Toggle k="weeklyReport" title="Week in review to the owner" desc="Monday evening: last week's sales against the week before, best sellers, discounts, refunds and what is owed." />
        <Toggle k="monthlyReport" title="Month in review to the owner" desc="On the 1st: the same review for last month, against the month before." />
        <Toggle k="reminders" title="Payment reminders to clients" desc={`To the email on each client's record, for invoices overdue or due within ${form.reminderDaysBefore} day(s). The same client is not reminded again within a week.`} />
      </div>
      {form.reminders && (
        <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Remind this many days before the due date
          <input type="number" min="0" max="30" value={form.reminderDaysBefore} onChange={e => setForm(f => ({ ...f, reminderDaysBefore: e.target.value }))} onBlur={() => save({ reminderDaysBefore: Number(form.reminderDaysBefore) || 0 })} className={`${box} block mt-1 w-24`} /></label>
      )}
      {state.configured && (
        <div className="flex gap-2 flex-wrap pt-1">
          <button type="button" disabled={!!busy || !state.settings.ownerEmail} onClick={() => run('/api/mail/test', d => `A test message was sent to ${d.to}. If it does not arrive in a minute or two, check the spam folder.`)}
            className="px-3 py-2 rounded-lg border border-white/15 text-fg/80 hover:bg-white/5 font-bold text-xs uppercase tracking-wider disabled:opacity-50">Send a test</button>
          <button type="button" disabled={!!busy} onClick={async () => { if (await ui.confirm({ title: "Send today's emails now?", message: 'Everything switched on above is sent now, including reminders to clients.', confirmLabel: 'Send now' })) run('/api/mail/run-now', d => `Sent. Summary: ${d.summary ? (d.summary.ok ? 'yes' : d.summary.error) : 'off'}. Low stock: ${d.lowStock ? (d.lowStock.nothing ? 'nothing low' : d.lowStock.ok ? 'yes' : d.lowStock.error) : 'off'}. Reminders: ${d.reminders ? `${d.reminders.sent} client(s)` : 'off'}. Week: ${d.weekly ? (d.weekly.ok ? 'yes' : d.weekly.error) : 'off'}. Month: ${d.monthly ? (d.monthly.ok ? 'yes' : d.monthly.error) : 'off'}.`); }}
            className="px-3 py-2 rounded-lg border border-white/15 text-fg/80 hover:bg-white/5 font-bold text-xs uppercase tracking-wider disabled:opacity-50">Send today's now</button>
        </div>
      )}
      {/* Superadmin only: see any automatic email as it would be sent today,
          and send a [TEST] copy to the owner - switched on or not. A test never
          goes to a client and marks nothing as sent. */}
      {isSuperAdmin && (
        <div className="border-t border-white/10 pt-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-fg/70">Test send <span className="normal-case tracking-normal font-normal text-fg/60">· superadmin only</span></p>
          <div className="flex items-end gap-2 flex-wrap">
            <select aria-label="Which email" value={testKind} onChange={e => { setTestKind(e.target.value); setPreview(null); }} className={box}>
              {TEST_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={async () => {
              setBusy('preview');
              try {
                const d = await call(apiFetch, '/api/mail/test-preview', 'POST', { kind: testKind });
                if (!d.success) return ui.alert(d.error || 'Could not build it.');
                setPreview(d);
              } catch { ui.alert('Network error.'); } finally { setBusy(''); }
            }} className="px-3 py-2 rounded-lg border border-white/15 text-fg/80 hover:bg-white/5 font-bold text-xs uppercase tracking-wider disabled:opacity-50">Preview</button>
            <button type="button" disabled={!!busy || !state.configured || !state.settings.ownerEmail}
              title={!state.configured ? 'Set up the mail account above first' : !state.settings.ownerEmail ? 'Save the owner email first' : ''}
              onClick={async () => {
                setBusy('test-send');
                try {
                  const d = await call(apiFetch, '/api/mail/test-send', 'POST', { kind: testKind });
                  ui.alert(d.success ? `A [TEST] copy was sent to ${d.to}.` : (d.error || 'It was not sent.'));
                } catch { ui.alert('Network error.'); } finally { setBusy(''); }
              }} className="bg-brand text-on-brand px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-50">Send test to owner</button>
          </div>
          {!state.configured && <p className="text-xs text-fg/60">Sending needs the mail account above; Preview works now.</p>}
          {preview && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs">
              {preview.empty ? <p className="text-fg/75">{preview.empty}</p> : (
                <>
                  <p className="text-fg font-bold break-words">{preview.subject}</p>
                  {preview.wouldGoTo && <p className="text-fg/60 mt-0.5">To the client: {preview.wouldGoTo}</p>}
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-fg/85 max-h-80 overflow-y-auto">{preview.text}</pre>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
