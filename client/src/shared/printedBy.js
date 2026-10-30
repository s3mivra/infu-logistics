import { formatDateTime } from './dates.js';

// "Printed by <name> · <when> · Page x of y" at the foot of every page of
// every PDF report, so a printout on a desk says who made it and when. The
// dashboard keeps the signed-in name here (setPrintedBy) as people switch.
let who = '';
export const setPrintedBy = (name) => { who = String(name || '').trim(); };
export const printedByLine = () => `Printed by ${who || 'unknown user'} · ${formatDateTime(new Date())}`;

/** Writes the line on every page of a jsPDF document. */
export function stampPrintedBy(doc) {
  const n = doc.getNumberOfPages();
  const line = printedByLine();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110);
    doc.text(`${line} · Page ${i} of ${n}`, w / 2, h - 4, { align: 'center' });
  }
  doc.setTextColor(0);
}

/**
 * jsPDF with the line added once, just before the document is saved or
 * turned into a file/preview - so every report gets it without each one
 * having to remember.
 */
export function withPrintedBy(JsPDF) {
  function Stamped(...args) {
    const doc = new JsPDF(...args);
    let stamped = false;
    const stampOnce = () => { if (!stamped) { stamped = true; try { stampPrintedBy(doc); } catch { /* a report without it beats no report */ } } };
    for (const m of ['save', 'output']) {
      const orig = doc[m].bind(doc);
      doc[m] = (...a) => { stampOnce(); return orig(...a); };
    }
    return doc;
  }
  Object.setPrototypeOf(Stamped, JsPDF);
  Stamped.prototype = JsPDF.prototype;
  return Stamped;
}
