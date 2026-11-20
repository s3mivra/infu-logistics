import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Gift } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import RangePresets from '../../shared/RangePresets';
import { presetRange } from '../../shared/businessDay.js';
import { useSessionState } from '../../shared/useSessionState';
import { formatDate } from '../../shared/dates.js';
import * as ui from '../../shared/ui';

// What was given away: complimentary orders in a range, who they were for,
// why, who approved them, and what they would have sold for and cost.
const words = (code) => String(code || '').replace(/_/g, ' ');
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ComplimentaryReport() {
  const { apiFetch, loadPdfLibs, addLogoToPDF, BIZ_NAME } = useDashboard();
  const [range, setRange] = useSessionState('comp.range', () => presetRange('thisMonth'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r = range) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ ...(r?.start ? { start: r.start } : {}), ...(r?.end ? { end: r.end } : {}) });
      const d = await (await apiFetch(`/api/reports/complimentary?${q}`)).json();
      if (d.success) setData(d); else ui.alert(d.error || 'Could not load the report.');
    } catch { /* keep the last view */ }
    finally { setLoading(false); }
  }, [apiFetch, range]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const exportPDF = async () => {
    if (!data) return;
    const { jsPDF, autoTable } = await loadPdfLibs();
    const doc = new jsPDF('landscape');
    await addLogoToPDF?.(doc);
    doc.setFontSize(16); doc.text(`${BIZ_NAME} - Complimentary`, 14, 14);
    doc.setFontSize(9);
    doc.text(`${data.start || 'All time'}${data.end ? ` to ${data.end}` : ''}  ·  ${data.totals.count} order(s)  ·  value ${peso(data.totals.value)}  ·  cost ${peso(data.totals.cost)}`, 14, 20);
    autoTable(doc, {
      startY: 25,
      head: [['Date', 'Order', 'For', 'Reason', 'Approved by', 'Items', 'Value', 'Cost']],
      body: data.rows.map(r => [formatDate(r.date), r.orderNumber, r.forWhom, r.note ? `${words(r.reason)} - ${r.note}` : words(r.reason), r.approvedBy || '-', r.items, peso(r.value), peso(r.cost)]),
      foot: [[{ content: 'TOTAL', colSpan: 6 }, peso(data.totals.value), peso(data.totals.cost)]],
      styles: { fontSize: 7.5, cellPadding: 1.8 }, headStyles: { fillColor: [30, 30, 30] }, footStyles: { fillColor: [45, 45, 45], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 5: { cellWidth: 80 }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    });
    const sub = (title, list, y) => {
      autoTable(doc, {
        startY: y, head: [[title, 'Orders', 'Value', 'Cost']],
        body: list.map(g => [words(g.name), String(g.count), peso(g.value), peso(g.cost)]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [60, 60, 60] }, tableWidth: 130,
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      });
      return doc.lastAutoTable.finalY + 6;
    };
    let y = (doc.lastAutoTable?.finalY || 25) + 8;
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 16; }
    y = sub('By reason', data.byReason, y);
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 16; }
    sub('By person', data.byPerson, y);
    doc.save(`Complimentary-${data.start || 'all'}${data.end ? `-to-${data.end}` : ''}.pdf`);
  };

  const tile = 'bg-surface border border-white/10 rounded-xl p-4';
  return (
    <div className="space-y-4 animate-fade-in" data-testid="complimentary-report">
      <div className="flex flex-wrap items-end gap-2">
        <h3 className="text-lg font-black text-fg mr-auto flex items-center gap-2"><Gift size={18} /> Complimentary</h3>
        <RangePresets value={range} onChange={r => setRange(p => ({ ...p, ...r }))} onRun={() => load()} />
        <label className="text-xs font-bold text-fg/70">From
          <input type="date" value={range?.start || ''} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
        </label>
        <label className="text-xs font-bold text-fg/70">To
          <input type="date" value={range?.end || ''} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className="block bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg mt-1" />
        </label>
        <button onClick={() => load()} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-lg font-bold text-sm"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Show</button>
        {data && <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-fg/80 rounded-lg font-bold text-sm"><Download size={14} /> PDF</button>}
      </div>
      <p className="text-xs text-fg/65">What was given away: complimentary orders that were completed, what they would have sold for, and what they cost.</p>
      {data && (<>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={tile}><p className="text-[10px] font-black uppercase tracking-widest text-fg/70">Orders</p><p className="text-2xl font-black text-fg">{data.totals.count}</p></div>
          <div className={tile}><p className="text-[10px] font-black uppercase tracking-widest text-fg/70">Selling value</p><p className="text-2xl font-black text-fg">{peso(data.totals.value)}</p></div>
          <div className={tile}><p className="text-[10px] font-black uppercase tracking-widest text-fg/70">Cost</p><p className="text-2xl font-black text-warning">{peso(data.totals.cost)}</p></div>
        </div>
        <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className="text-fg/70 text-[10px] font-black uppercase tracking-wider border-b border-white/10">
              <tr><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">For</th><th className="px-4 py-2.5">Reason</th><th className="px-4 py-2.5">Approved by</th><th className="px-4 py-2.5">Items</th><th className="px-4 py-2.5 text-right">Value</th><th className="px-4 py-2.5 text-right">Cost</th></tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-fg/65">No complimentary orders in this range.</td></tr>}
              {data.rows.map(r => (
                <tr key={r.orderId} className="border-b border-white/5">
                  <td className="px-4 py-2 text-fg/70 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="px-4 py-2 font-bold text-fg whitespace-nowrap">{r.orderNumber}</td>
                  <td className="px-4 py-2 text-fg">{r.forWhom}</td>
                  <td className="px-4 py-2 text-fg/80">{words(r.reason)}{r.note && <span className="block text-fg/60 text-[11px]">{r.note}</span>}</td>
                  <td className="px-4 py-2 text-fg/70">{r.approvedBy || '-'}</td>
                  <td className="px-4 py-2 text-fg/70 max-w-[280px]">{r.items}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-bold text-fg">{peso(r.value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-warning">{peso(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[['By reason', data.byReason], ['By person', data.byPerson]].map(([title, list]) => (
            <div key={title} className="bg-surface border border-white/10 rounded-xl p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-2">{title}</p>
              {list.length === 0 ? <p className="text-xs text-fg/60">None</p> : list.map(g => (
                <div key={g.name} className="flex justify-between text-xs py-1 border-b border-white/5 last:border-0">
                  <span className="text-fg">{words(g.name)} <span className="text-fg/60">· {g.count}</span></span>
                  <span className="tabular-nums text-fg font-bold">{peso(g.value)} <span className="text-warning font-normal">({peso(g.cost)} cost)</span></span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}
