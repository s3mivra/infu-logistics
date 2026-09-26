import { CheckCircle, AlertTriangle, Info } from 'lucide-react';

// What a setup-workbook import did, sheet by sheet, and - when it carried a set
// of books in - whether they agree with themselves. Shared by the "Start from
// templates" card and the Settings card that pulls the workbook from Google.
export default function SetupImportReport({ report }) {
  if (!report) return null;
  const checks = report.checks || [];
  return (
    <div className="border border-white/10 rounded-xl p-4 space-y-3 text-sm">
      <p className="font-bold text-fg">Import finished</p>
      {report.results.map((r) => (
        <div key={r.sheet}>
          <p className={r.ok ? 'text-fg' : 'text-danger'}>
            <b>{r.sheet}:</b> {r.ok ? `${r.created} added` : r.error}{r.ok && r.skipped.length ? `, ${r.skipped.length} not added` : ''}
          </p>
          {r.skipped.length > 0 && (
            <ul className="mt-1 ml-4 list-disc text-xs text-fg/75 space-y-0.5">
              {r.skipped.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}
              {r.skipped.length > 20 && <li>…and {r.skipped.length - 20} more</li>}
            </ul>
          )}
          {r.extra && <p className="text-xs text-fg/70 mt-0.5">{r.extra}</p>}
        </div>
      ))}
      {report.inventory > 0 && (
        <p className="text-fg"><b>Inventory:</b> {report.inventory} row(s) opened in the stock count preview - confirm them there.</p>
      )}
      {checks.length > 0 && (
        <div className="border-t border-white/10 pt-3 space-y-1.5">
          <p className="font-bold text-fg">Do the books agree?</p>
          {checks.map((c, i) => {
            const Icon = c.ok === true ? CheckCircle : c.ok === false ? AlertTriangle : Info;
            const tone = c.ok === true ? 'text-success' : c.ok === false ? 'text-warning' : 'text-fg/65';
            return (
              <p key={i} className="flex gap-2 text-xs text-fg/85 leading-snug">
                <Icon size={14} className={`${tone} shrink-0 mt-px`} aria-label={c.ok === true ? 'Agrees' : c.ok === false ? 'Does not agree' : 'Note'} />
                <span>{c.text}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
