// The spreadsheet library, loaded once, with reading and saving reported to the
// progress panel (shared/progress.js). Every import that reads an Excel file
// and every export that saves one goes through here, so each shows up as it
// happens: "Reading the spreadsheet…", "Saving Purchases.xlsx…", then a tick.
import { startTask, endTask } from './progress';

let loaded = null;

const reporting = (label, fn) => (...args) => {
  const id = startTask(typeof label === 'function' ? label(...args) : label, { kind: 'file' });
  try {
    const out = fn(...args);
    endTask(id, { ok: true });
    return out;
  } catch (err) {
    endTask(id, { ok: false, message: err?.message || 'Failed' });
    throw err;
  }
};

export function wrapXlsx(XLSX) {
  return {
    ...XLSX,
    utils: XLSX.utils,
    read: reporting('Reading the spreadsheet…', XLSX.read),
    writeFile: reporting((wb, name) => `Saving ${name || 'the spreadsheet'}…`, XLSX.writeFile),
    writeFileXLSX: XLSX.writeFileXLSX ? reporting((wb, name) => `Saving ${name || 'the spreadsheet'}…`, XLSX.writeFileXLSX) : undefined,
  };
}

// Use in place of `await import('xlsx')`.
export function loadXlsx() {
  if (!loaded) loaded = import('xlsx').then(wrapXlsx);
  return loaded;
}
