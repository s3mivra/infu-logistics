// PDF reports in the progress panel (shared/progress.js): a document started
// shows "Building the PDF…" until it is saved or opened, then a tick. Wraps the
// jsPDF constructor the same way shared/printedBy.js does, so every report built
// through the dashboard's loadPdfLibs() reports without being changed.
import { startTask, updateTask, endTask } from './progress';

// A document nobody saved (the report failed part-way) is cleared after this.
const ABANDONED_MS = 10 * 60 * 1000;

export function withPdfProgress(JsPDF) {
  function Tracked(...args) {
    const doc = new JsPDF(...args);
    const id = startTask('Building the PDF…', { kind: 'file' });
    const giveUp = setTimeout(() => endTask(id, { ok: false, message: 'The report did not finish.' }), ABANDONED_MS);
    let finished = false;
    const finish = (label) => {
      if (finished) return;
      finished = true;
      clearTimeout(giveUp);
      if (label) updateTask(id, { label });
      endTask(id, { ok: true });
    };
    const save = doc.save.bind(doc);
    doc.save = (name, ...rest) => { const out = save(name, ...rest); finish(`Saved ${name || 'the PDF'}`); return out; };
    const output = doc.output.bind(doc);
    doc.output = (...a) => { const out = output(...a); finish('PDF ready'); return out; };
    return doc;
  }
  Object.setPrototypeOf(Tracked, JsPDF);
  Tracked.prototype = JsPDF.prototype;
  return Tracked;
}
