'use strict';
/**
 * Reads all keys from the ctx object in AdminDashboard.jsx and
 * replaces the `const { ... } = ctx;` block in every tab file with
 * a complete destructure that includes every key ctx currently exposes.
 *
 * Run this any time you add keys to ctx.
 */
const fs   = require('fs');
const path = require('path');

const DASH = path.join(__dirname, '..', 'client', 'src', 'pages', 'AdminDashboard.jsx');
const TABS = path.join(__dirname, '..', 'client', 'src', 'components', 'tabs');

// ── 1. Extract ctx keys from AdminDashboard ──────────────────────────────────
const dashSrc = fs.readFileSync(DASH, 'utf8');

// Find the ctx block
const ctxStart = dashSrc.indexOf('const ctx = {');
const ctxEnd   = dashSrc.indexOf('\n  };', ctxStart) + 4;
if (ctxStart === -1) { console.error('ctx block not found'); process.exit(1); }

const ctxBlock = dashSrc.slice(ctxStart, ctxEnd);

// Extract valid identifier names (skip comments, operators, string content)
const identRe = /\b([a-zA-Z_\$][a-zA-Z0-9_\$]+)\b/g;
const rawKeys  = new Set();
// Remove comment lines first
const ctxNoComments = ctxBlock.replace(/\/\/[^\n]*/g, '');
let m;
while ((m = identRe.exec(ctxNoComments)) !== null) rawKeys.add(m[1]);

// Filter out ctx syntax keywords / non-identifier tokens
const syntaxWords = new Set([
  'const','ctx','let','var','function','return','true','false','null','undefined',
  'if','else','for','while','do','switch','case','break','continue','new','delete',
  'typeof','instanceof','void','this','class','extends','super','import','export',
  'async','await','yield','of','in','from','as','static','get','set',
]);

const ctxKeys = [...rawKeys].filter(k => !syntaxWords.has(k) && k.length > 1);
ctxKeys.sort();

console.log(`Found ${ctxKeys.length} ctx keys.`);

// ── 2. Build the new destructure block ───────────────────────────────────────
// Group into lines of ~5 keys each for readability
const KEYS_PER_LINE = 5;
const keyLines = [];
for (let i = 0; i < ctxKeys.length; i += KEYS_PER_LINE) {
  keyLines.push('    ' + ctxKeys.slice(i, i + KEYS_PER_LINE).join(', ') + ',');
}

const newDestructure = `  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  const {
${keyLines.join('\n')}
  } = ctx;`;

// ── 3. Replace destructure block in each tab file ────────────────────────────
const tabFiles = fs.readdirSync(TABS).filter(f => f.endsWith('.jsx'));

tabFiles.forEach(f => {
  const filePath = path.join(TABS, f);
  const src      = fs.readFileSync(filePath, 'utf8');

  // Find the `const {` that starts the ctx destructure
  // It starts after the function signature line containing `{ ctx }`
  const funcLine = src.indexOf('export default function');
  if (funcLine === -1) { console.warn(`No export default function in ${f}, skipping`); return; }

  // Find the first `const {` after the function signature
  const constStart = src.indexOf('  const {\n', funcLine);
  if (constStart === -1) { console.warn(`No const block in ${f}, skipping`); return; }

  // Find the closing `  } = ctx;`
  const ctxCloseMarker = '  } = ctx;';
  const constEnd = src.indexOf(ctxCloseMarker, constStart);
  if (constEnd === -1) { console.warn(`No } = ctx; in ${f}, skipping`); return; }

  const ctxCloseEnd = constEnd + ctxCloseMarker.length;

  const newSrc = src.slice(0, constStart) + newDestructure + src.slice(ctxCloseEnd);
  fs.writeFileSync(filePath, newSrc, 'utf8');
  console.log(`  ✓ Updated ${f}`);
});

console.log('\nDone. All tab destructures are now in sync with ctx.');
