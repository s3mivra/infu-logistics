// Markdown -> styled PDF (pdfkit). Flow-based layout so text never overlaps.
// Handles: h1/h2/h3, paragraphs with **bold** / `code`, bullet & numbered lists,
// pipe tables, blockquotes, fenced code blocks, horizontal rules.
//
// Usage: node scripts_temp/md_to_pdf.cjs <input.md> <output.pdf>
const PDFDocument = require('./node_modules/pdfkit');
const fs = require('fs');

const C = {
  brand: '#5E7A3D', brandDark: '#3F5429', ink: '#202020', muted: '#6B7280',
  line: '#D9DEE0', headBg: '#ECF1E3', codeBg: '#F2F2EE', quoteBar: '#B8C99A', zebra: '#FAFBF8',
};

const [, , INPUT, OUTPUT] = process.argv;
if (!INPUT || !OUTPUT) { console.error('Usage: node md_to_pdf.cjs <in.md> <out.pdf>'); process.exit(1); }

// Transliterate glyphs the built-in Helvetica/Courier (WinAnsi) can't draw, so
// nothing renders as a blank box.
const TR = [
  [/[₱]/g, 'PHP '], [/[→➔▶]/g, '->'], [/[←]/g, '<-'],
  [/[—–]/g, '-'], [/[•]/g, '-'], [/[…]/g, '...'],
  [/[‘’]/g, "'"], [/[“”]/g, '"'], [/[✓✔]/g, '[x]'],
  [/[⚠️]/g, '!'],
];
const tr = (s) => { let t = String(s); for (const [re, v] of TR) t = t.replace(re, v); return t.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ''); };

const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 56, right: 56 }, bufferPages: true,
  info: { Title: 'Semivra Libellus POS Manual', Author: 's3mivra' } });
doc.pipe(fs.createWriteStream(OUTPUT));

const ML = doc.page.margins.left;
const uW = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottom = () => doc.page.height - doc.page.margins.bottom;
const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };

const runsOf = (text) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p) => {
  if (/^\*\*[\s\S]+\*\*$/.test(p)) return { t: p.slice(2, -2), f: 'Helvetica-Bold', c: null };
  if (/^`[^`]+`$/.test(p)) return { t: p.slice(1, -1), f: 'Courier', c: C.brandDark };
  return { t: p, f: 'Helvetica', c: null };
});

// Flowing paragraph of styled runs starting at x=ML+indent, wrapping in the column.
function flow(text, { size = 9.5, color = C.ink, indent = 0, gap = 5, lead = '' } = {}) {
  const runs = runsOf(text);
  const width = uW() - indent;
  doc.x = ML + indent;
  if (lead) { doc.font('Helvetica-Bold').fontSize(size).fillColor(C.brand).text(tr(lead), { continued: true, width }); }
  runs.forEach((r, i) => {
    doc.font(r.f).fontSize(size).fillColor(r.c || color)
      .text(tr(r.t), { continued: i < runs.length - 1, width, lineGap: 1.5 });
  });
  doc.x = ML;
  doc.y += gap;
}

function heading(level, text) {
  const t = tr(text);
  if (level === 1) {
    if (doc.y > doc.page.margins.top + 2) doc.addPage();
    doc.x = ML; doc.font('Helvetica-Bold').fontSize(19).fillColor(C.brandDark).text(t, { width: uW() });
    doc.moveTo(ML, doc.y + 2).lineTo(ML + uW(), doc.y + 2).lineWidth(2).strokeColor(C.brand).stroke();
    doc.y += 14;
  } else if (level === 2) {
    need(46); doc.y += 8; doc.x = ML; doc.font('Helvetica-Bold').fontSize(13.5).fillColor(C.brand).text(t, { width: uW() }); doc.y += 5;
  } else {
    need(30); doc.y += 5; doc.x = ML; doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text(t, { width: uW() }); doc.y += 3;
  }
}

function rule() { need(16); doc.moveTo(ML, doc.y + 5).lineTo(ML + uW(), doc.y + 5).lineWidth(0.7).strokeColor(C.line).stroke(); doc.y += 14; }

function blockquote(text) {
  const indent = 12, width = uW() - indent;
  const h = doc.font('Helvetica-Oblique').fontSize(9).heightOfString(tr(text.replace(/\*\*/g, '')), { width }) + 8;
  need(h);
  const y0 = doc.y;
  doc.save().rect(ML, y0, 3, h).fill(C.quoteBar).restore();
  doc.x = ML + indent;
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(tr(text.replace(/\*\*/g, '')), { width });
  doc.x = ML; doc.y = y0 + h + 4;
}

function codeBlock(rows) {
  const lh = 11.5, pad = 7, w = uW();
  const h = rows.length * lh + pad * 2;
  need(h);
  const y0 = doc.y;
  doc.save().rect(ML, y0, w, h).fill(C.codeBg).restore();
  doc.font('Courier').fontSize(8.5).fillColor(C.ink);
  rows.forEach((r, i) => doc.text(tr(r) || ' ', ML + pad, y0 + pad + i * lh, { width: w - pad * 2, lineBreak: false }));
  doc.x = ML; doc.y = y0 + h + 10;
}

function table(header, rows) {
  const ncol = header.length, w = uW(), pad = 6;
  // weight first column a bit wider for readability
  const weights = header.map((_, i) => (i === 0 ? 1.5 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((x) => (x / wsum) * w);
  const rowH = (cells, font) => Math.max(12, ...cells.map((c, i) =>
    doc.font(font).fontSize(8.5).heightOfString(tr(c.replace(/\*\*/g, '')) || ' ', { width: colW[i] - pad * 2 }))) + pad * 2;

  const drawRow = (cells, isHead, zebra) => {
    const font = isHead ? 'Helvetica-Bold' : 'Helvetica';
    const h = rowH(cells, font);
    if (doc.y + h > bottom()) { doc.addPage(); }
    const y0 = doc.y;
    if (isHead) doc.save().rect(ML, y0, w, h).fill(C.headBg).restore();
    else if (zebra) doc.save().rect(ML, y0, w, h).fill(C.zebra).restore();
    let x = ML;
    cells.forEach((c, i) => {
      doc.font(font).fontSize(8.5).fillColor(isHead ? C.brandDark : C.ink)
        .text(tr(c.replace(/\*\*/g, '')), x + pad, y0 + pad, { width: colW[i] - pad * 2 });
      x += colW[i];
    });
    doc.save().lineWidth(0.5).strokeColor(C.line).moveTo(ML, y0 + h).lineTo(ML + w, y0 + h).stroke().restore();
    doc.x = ML; doc.y = y0 + h;
  };

  need(48);
  drawRow(header, true, false);
  rows.forEach((r, i) => {
    // pad/truncate row to header column count
    const cells = header.map((_, ci) => r[ci] || '');
    drawRow(cells, false, i % 2 === 1);
  });
  doc.y += 10;
}

// ── Parse ──
const lines = fs.readFileSync(INPUT, 'utf8').replace(/\r\n/g, '\n').split('\n');
let i = 0;
while (i < lines.length) {
  const ln = lines[i];
  if (/^```/.test(ln.trim())) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]); i++; codeBlock(buf); continue; }
  if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    const parse = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const header = parse(ln); i += 2; const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(parse(lines[i++]));
    table(header, rows); continue;
  }
  const t = ln.trim();
  if (t === '') { i++; continue; }
  if (/^#\s/.test(t)) { heading(1, t.replace(/^#\s+/, '')); i++; continue; }
  if (/^##\s/.test(t)) { heading(2, t.replace(/^##\s+/, '')); i++; continue; }
  if (/^#{3,}\s/.test(t)) { heading(3, t.replace(/^#{3,}\s+/, '')); i++; continue; }
  if (/^(---|___|\*\*\*)\s*$/.test(t)) { rule(); i++; continue; }
  if (/^>\s?/.test(t)) { blockquote(t.replace(/^>\s?/, '')); i++; continue; }
  let m;
  if ((m = ln.match(/^(\s*)[-*]\s+(.*)/))) { flow(m[2], { indent: m[1].length >= 2 ? 24 : 10, gap: 3, lead: '-  ' }); i++; continue; }
  if ((m = ln.match(/^(\s*)(\d+)\.\s+(.*)/))) { flow(m[3], { indent: 12, gap: 3, lead: m[2] + '.  ' }); i++; continue; }
  flow(t);
  i++;
}

// Footer: page numbers
const range = doc.bufferedPageRange();
for (let p = 0; p < range.count; p++) {
  doc.switchToPage(range.start + p);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted)
    .text(`Semivra Libellus POS Manual   ·   Page ${p + 1} of ${range.count}`,
      ML, doc.page.height - 42, { width: uW(), align: 'center', lineBreak: false });
}

doc.end();
console.log('Wrote', OUTPUT, '-', range.count, 'pages');
