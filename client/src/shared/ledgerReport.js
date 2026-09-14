// The journal and audit log as report tables, ready for jsPDF autoTable.
//
// Pure: no React, no browser APIs, no PDF library. The caller supplies the
// money formatter and draws the table, so the rows, the totals and the
// "nothing recorded" case are defined once and can be checked outside the
// browser.

// The server streams both reports as CSV. Quoted fields, doubled quotes and
// embedded newlines are all handled, since descriptions contain commas.
export const parseCsvText = (text) => {
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c !== '')) out.push(row); }
  return out;
};

const amount = (v, money) => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : money(Number(v)));

export const LEDGER_REPORT_SPEC = {
  journal: {
    label: 'General Journal (PDF)', title: 'GENERAL JOURNAL', path: '/api/journal/export', filePrefix: 'journal',
    head: ['Date', 'Reference', 'Description', 'Account', 'Account Name', 'Debit', 'Credit'],
    formatRow: (r, money) => [r[0], r[1], r[2], r[3], r[4], amount(r[5], money), amount(r[6], money)],
    // A journal that does not show its totals cannot be checked for balance
    // without re-adding it by hand.
    totals: (rows, money) => {
      const dr = rows.reduce((t, r) => t + (Number(r[5]) || 0), 0);
      const cr = rows.reduce((t, r) => t + (Number(r[6]) || 0), 0);
      return ['', '', '', '', 'Totals', money(dr), money(cr)];
    },
    columnStyles: { 2: { cellWidth: 70 }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  },
  auditlog: {
    label: 'Audit Log (PDF)', title: 'AUDIT LOG', path: '/api/audit-logs/export', filePrefix: 'audit_log',
    head: ['When', 'User', 'Action', 'Target', 'Notes'],
    formatRow: (r) => [r[0] ? new Date(r[0]).toLocaleString() : '', r[1], r[2], r[3], r[4]],
    columnStyles: { 4: { cellWidth: 100 } },
  },
};

// CSV text → { spec, lines, head, body, foot } for autoTable.
export const ledgerReportTable = (kind, csvText, money) => {
  const spec = LEDGER_REPORT_SPEC[kind];
  const [, ...rows] = parseCsvText(csvText);
  return {
    spec,
    lines: rows.length,
    head: [spec.head],
    body: rows.length
      ? rows.map(r => spec.formatRow(r, money))
      : [[{ content: 'Nothing recorded in this period.', colSpan: spec.head.length }]],
    foot: spec.totals && rows.length ? [spec.totals(rows, money)] : null,
  };
};
