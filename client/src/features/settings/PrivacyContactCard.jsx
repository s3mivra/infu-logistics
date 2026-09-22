import { useEffect, useState } from 'react';

// Who the public Privacy Notice (/privacy) and Terms (/terms) name, and who a
// customer or employee contacts about their personal information - the Data
// Protection Officer the Data Privacy Act asks every business to designate.
const FIELDS = [
  { key: 'registeredName', label: 'Registered business name', hint: 'As registered with DTI / SEC. Leave blank until registration is done - the trading name is used.', max: 200 },
  { key: 'tradeName', label: 'Trading name', hint: 'The name customers know you by, if different.', max: 200 },
  { key: 'address', label: 'Business address', max: 400 },
  { key: 'dpoName', label: 'Data Protection Officer', hint: 'Usually the owner or a trusted manager.', max: 120 },
  { key: 'dpoEmail', label: 'Privacy contact email', type: 'email', max: 200 },
  { key: 'dpoPhone', label: 'Privacy contact phone', type: 'tel', max: 40 },
  { key: 'effectiveDate', label: 'Notice effective date', type: 'date', max: 10 },
];

export default function PrivacyContactCard({ value, onSave }) {
  const stored = value && typeof value === 'object' ? value : {};
  const [form, setForm] = useState(stored);
  const [saving, setSaving] = useState(false);
  const storedJson = JSON.stringify(stored);

  // Pick up a save from another device (settingsUpdated -> fetchSettings).
  useEffect(() => { setForm(JSON.parse(storedJson)); }, [storedJson]);

  const dirty = FIELDS.some(f => (form[f.key] || '') !== (stored[f.key] || ''));
  const save = async () => {
    setSaving(true);
    try { await onSave(Object.fromEntries(FIELDS.map(f => [f.key, (form[f.key] || '').trim()]))); }
    finally { setSaving(false); }
  };

  const input = 'w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-fg/70 px-3 py-2.5 rounded-xl outline-none transition text-sm';
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-fg/65 mb-2 px-1">Privacy contact</p>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
        <p className="text-xs text-fg/75 leading-relaxed">
          Shown on your public <a href="/privacy" target="_blank" rel="noopener" className="underline font-bold text-brand-text">Privacy Notice</a> and{' '}
          <a href="/terms" target="_blank" rel="noopener" className="underline font-bold text-brand-text">Terms of Use</a>, which customers reach from the QR menu,
          the client portal and the login screen. Required under the Data Privacy Act even before the business is registered.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(f => (
            <div key={f.key} className={f.key === 'address' ? 'sm:col-span-2' : ''}>
              <label htmlFor={`privacy-${f.key}`} className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">{f.label}</label>
              <input id={`privacy-${f.key}`} type={f.type || 'text'} maxLength={f.max} className={input}
                value={form[f.key] || ''} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} />
              {f.hint && <p className="text-[10px] text-fg/70 mt-1 leading-snug">{f.hint}</p>}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={!dirty || saving}
            className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-brand text-on-brand hover:bg-brand-dark transition disabled:opacity-50 min-h-[38px]">
            {saving ? 'Saving…' : 'Save privacy contact'}
          </button>
        </div>
      </div>
    </div>
  );
}
