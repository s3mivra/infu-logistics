import { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import * as ui from '../../shared/ui';
import { formatPeso as peso } from '../../shared/money.js';

// Payroll > Tax & contribution rules. What "Compute" uses (server
// lib/payrollCalc.js): the BIR withholding tax brackets - if the taxable pay
// is over X, tax = fixed amount + rate of the part over X - which kinds of pay
// are taxable, and the SSS, PhilHealth and Pag-IBIG rates. Filled with the
// current government figures; change them here when the government does.
const FREQS = [['semiMonthly', 'Twice a month'], ['monthly', 'Monthly'], ['weekly', 'Weekly']];
const cell = 'w-full bg-page-bg border border-white/10 rounded px-2 py-1.5 text-xs text-right tabular-nums text-fg focus:border-brand/50 focus:outline-none';
const pct = (r) => String(Math.round(Number(r) * 10000) / 100);

export default function PayrollRules({ apiFetch, onClose }) {
  const [rules, setRules] = useState(null);
  const [freq, setFreq] = useState('semiMonthly');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const d = await (await apiFetch('/api/payroll/rules')).json();
    if (d.success) setRules(d.rules); else ui.alert(d.error || 'Could not load the rules.');
  };
  useEffect(() => { load().catch(() => ui.alert('Network error.')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rules) return null;
  const table = rules.taxTables[freq] || [];
  const setRow = (i, k, v) => setRules({ ...rules, taxTables: { ...rules.taxTables, [freq]: table.map((r, j) => (j === i ? { ...r, [k]: v } : r)) } });
  const setGroup = (g, k, v) => setRules({ ...rules, [g]: { ...rules[g], [k]: v } });
  const setType = (i, patch) => setRules({ ...rules, payTypes: rules.payTypes.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  const save = async (reset = false) => {
    if (reset && !(await ui.confirm({ title: 'Put back the government defaults?', message: 'Every table and rate here goes back to the figures the app ships with.', confirmLabel: 'Put back' }))) return;
    setBusy(true);
    try {
      const body = reset ? { reset: true } : {
        ...rules,
        taxTables: Object.fromEntries(Object.entries(rules.taxTables).map(([f, rows]) => [f, rows.map(r => ({ over: Number(r.over), base: Number(r.base), rate: Number(r.rate) }))])),
      };
      const d = await (await apiFetch('/api/payroll/rules', { method: 'PUT', body: JSON.stringify(body) })).json();
      if (!d.success) { ui.alert(d.error || 'Not saved.'); return; }
      setRules(d.rules);
      ui.toast(reset ? 'Rules put back to the government defaults.' : 'Payroll rules saved. Compute uses them from now on.', { tone: 'success' });
    } catch { ui.alert('Network error - not saved.'); } finally { setBusy(false); }
  };

  const num = (g, k, label, asPct) => (
    <label className="block text-[10px] font-bold uppercase tracking-wider text-fg/70">{label}
      <input type="number" step="any" min="0" className={`${cell} mt-1`} aria-label={label}
        value={asPct ? pct(rules[g][k]) : rules[g][k]}
        onChange={e => setGroup(g, k, asPct ? Number(e.target.value) / 100 : Number(e.target.value))} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label="Tax and contribution rules" className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto space-y-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-fg text-lg">Tax &amp; contribution rules</h2>
            <p className="text-xs text-fg/70">What Compute uses. Filled with the current BIR, SSS, PhilHealth and Pag-IBIG figures.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-fg/70 hover:text-fg"><X size={18} /></button>
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-black uppercase tracking-wider text-fg">Withholding tax table</h3>
            <div role="tablist" className="flex gap-1">
              {FREQS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={freq === k} onClick={() => setFreq(k)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${freq === k ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/70'}`}>{label}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-fg/70">Each row: if taxable pay is over the amount, tax = the fixed amount + the rate of the part over it.</p>
          <div className="overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-xs" data-keep-table>
              <thead><tr className="text-[9px] font-black uppercase tracking-widest text-fg/70 border-b border-white/10">
                <th className="text-left px-3 py-2">If taxable pay is over</th><th className="text-right px-3 py-2">Tax = fixed</th><th className="text-right px-3 py-2">+ rate % of the excess</th><th className="text-left px-3 py-2">Example</th><th className="w-8" />
              </tr></thead>
              <tbody>
                {table.map((r, i) => {
                  const next = table[i + 1];
                  return (
                    <tr key={i} className="border-b border-white/5">
                      <td className="px-3 py-1.5"><input type="number" min="0" step="any" aria-label={`Bracket ${i + 1} over`} className={cell} value={r.over} onChange={e => setRow(i, 'over', e.target.value)} /></td>
                      <td className="px-3 py-1.5"><input type="number" min="0" step="any" aria-label={`Bracket ${i + 1} fixed tax`} className={cell} value={r.base} onChange={e => setRow(i, 'base', e.target.value)} /></td>
                      <td className="px-3 py-1.5"><input type="number" min="0" max="100" step="any" aria-label={`Bracket ${i + 1} rate`} className={cell} value={pct(r.rate)} onChange={e => setRow(i, 'rate', Number(e.target.value) / 100)} /></td>
                      <td className="px-3 py-1.5 text-[10px] text-fg/65">
                        {Number(r.rate) === 0 && Number(r.base) === 0 ? `Up to ${next ? peso(next.over) : 'any amount'}: no tax`
                          : `${peso(r.over)}${next ? ` to ${peso(next.over)}` : ' and up'}: ${peso(r.base)} + ${pct(r.rate)}% over ${peso(r.over)}`}
                      </td>
                      <td className="px-2">{table.length > 1 && <button type="button" aria-label="Remove bracket" onClick={() => setRules({ ...rules, taxTables: { ...rules.taxTables, [freq]: table.filter((_, j) => j !== i) } })} className="text-fg/60 hover:text-danger"><Trash2 size={12} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setRules({ ...rules, taxTables: { ...rules.taxTables, [freq]: [...table, { over: '', base: '', rate: '' }] } })}
            className="flex items-center gap-1 text-xs text-brand-text hover:text-fg"><Plus size={12} /> Add bracket</button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-black uppercase tracking-wider text-fg">Kinds of pay: taxable or not</h3>
          <p className="text-[11px] text-fg/70">Non-taxable pay is added to the payslip but left out of the tax. "Regular" pay is what SSS, PhilHealth and Pag-IBIG are figured on.</p>
          <div className="border border-white/10 rounded-lg divide-y divide-white/5">
            {rules.payTypes.map((t, i) => (
              <div key={t.key} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                <input value={t.label} aria-label="Kind of pay" onChange={e => setType(i, { label: e.target.value })}
                  className="flex-1 min-w-[12rem] bg-page-bg border border-white/10 rounded px-2 py-1.5 text-xs text-fg" />
                <label className="flex items-center gap-1.5 text-xs text-fg"><input type="checkbox" checked={!!t.taxable} onChange={e => setType(i, { taxable: e.target.checked })} /> Taxable</label>
                <label className="flex items-center gap-1.5 text-xs text-fg/80"><input type="checkbox" checked={!!t.regular} onChange={e => setType(i, { regular: e.target.checked })} /> Regular pay</label>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-black uppercase tracking-wider text-fg">Contributions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {num('sss', 'eeRate', 'SSS employee %', true)}
            {num('sss', 'erRate', 'SSS employer %', true)}
            {num('sss', 'mscMin', 'SSS salary credit floor')}
            {num('sss', 'mscMax', 'SSS salary credit ceiling')}
            {num('philhealth', 'rate', 'PhilHealth total %', true)}
            {num('philhealth', 'floor', 'PhilHealth floor')}
            {num('philhealth', 'ceiling', 'PhilHealth ceiling')}
            {num('pagibig', 'eeRate', 'Pag-IBIG employee %', true)}
            {num('pagibig', 'erRate', 'Pag-IBIG employer %', true)}
            {num('pagibig', 'maxBase', 'Pag-IBIG maximum pay')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-fg/70">Overtime rate (×)
              <input type="number" step="any" min="1" className={`${cell} mt-1`} value={rules.overtimeMultiplier} onChange={e => setRules({ ...rules, overtimeMultiplier: Number(e.target.value) })} />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-fg/70">Hours in a work day
              <input type="number" step="any" min="1" className={`${cell} mt-1`} value={rules.hoursPerDay} onChange={e => setRules({ ...rules, hoursPerDay: Number(e.target.value) })} />
            </label>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
          <button type="button" onClick={() => save(true)} disabled={busy} className="mr-auto text-[10px] text-fg/70 hover:text-fg underline">Put back government defaults</button>
          <button type="button" onClick={onClose} className="text-[10px] border border-white/15 text-fg/70 hover:text-fg px-4 py-2 rounded-lg font-bold uppercase tracking-wider">Cancel</button>
          <button type="button" onClick={() => save(false)} disabled={busy} className="text-[10px] bg-brand text-on-brand px-4 py-2 rounded-lg font-bold uppercase tracking-wider disabled:opacity-40">Save rules</button>
        </div>
      </div>
    </div>
  );
}
