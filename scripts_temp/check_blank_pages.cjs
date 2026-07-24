// Blank-page detector for a pdfkit PDF.
// Parses page objects, inflates their /Contents FlateDecode streams, and reports
// any page whose content stream has no text/graphics operators.
// Usage: node scripts_temp/check_blank_pages.cjs <file.pdf>
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const raw = fs.readFileSync(file);
const s = raw.toString('latin1');

// Map objNum -> { dict, streamBuf|null }
const objs = {};
const re = /(\d+)\s+0\s+obj/g;
let m;
const starts = [];
while ((m = re.exec(s))) starts.push({ num: +m[1], at: m.index, bodyAt: m.index + m[0].length });
for (let i = 0; i < starts.length; i++) {
  const cur = starts[i];
  const endIdx = s.indexOf('endobj', cur.bodyAt);
  const body = s.slice(cur.bodyAt, endIdx);
  let streamBuf = null;
  const sm = /stream\r?\n/.exec(body);
  if (sm) {
    const dictPart = body.slice(0, sm.index);
    const dataStart = cur.bodyAt + sm.index + sm[0].length;
    const esIdx = s.indexOf('endstream', dataStart);
    let dataEnd = esIdx;
    // trim trailing EOL before endstream
    streamBuf = raw.slice(dataStart, dataEnd);
    objs[cur.num] = { dict: dictPart, streamBuf, flate: /FlateDecode/.test(dictPart) };
  } else {
    objs[cur.num] = { dict: body, streamBuf: null, flate: false };
  }
}

// Find page objects and their content refs (in document order via /Pages /Kids).
const pageObjNums = Object.keys(objs).map(Number).filter((n) => /\/Type\s*\/Page\b(?!s)/.test(objs[n].dict));

// Order via Kids if present
let ordered = pageObjNums;
const pagesObj = Object.keys(objs).map(Number).find((n) => /\/Type\s*\/Pages\b/.test(objs[n].dict));
if (pagesObj) {
  const kids = objs[pagesObj].dict.match(/\/Kids\s*\[([^\]]*)\]/);
  if (kids) {
    const refNums = [...kids[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => +x[1]);
    const valid = refNums.filter((n) => pageObjNums.includes(n));
    if (valid.length) ordered = valid;
  }
}

const opsRe = /(Tj|TJ|\bre\b|\bf\b|\bS\b|\bDo\b|\bsc\b|\bscn\b|\bg\b|\brg\b)/;
let blanks = 0;
const report = [];
ordered.forEach((pn, idx) => {
  const contentsRef = objs[pn].dict.match(/\/Contents\s+(\d+)\s+0\s+R/);
  const contentsArr = objs[pn].dict.match(/\/Contents\s*\[([^\]]*)\]/);
  let refs = [];
  if (contentsRef) refs = [+contentsRef[1]];
  else if (contentsArr) refs = [...contentsArr[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => +x[1]);
  let content = '';
  for (const r of refs) {
    const o = objs[r];
    if (!o || !o.streamBuf) continue;
    try { content += o.flate ? zlib.inflateSync(o.streamBuf).toString('latin1') : o.streamBuf.toString('latin1'); }
    catch (e) { content += '[inflate-failed]'; }
  }
  const hasOps = opsRe.test(content);
  if (!hasOps) { blanks++; report.push(`  Page ${idx + 1} (obj ${pn}): BLANK  (content bytes: ${content.length})`); }
});

console.log(`Total pages: ${ordered.length}`);
console.log(`Blank pages: ${blanks}`);
if (report.length) console.log(report.join('\n'));
else console.log('  (no blank pages)');
