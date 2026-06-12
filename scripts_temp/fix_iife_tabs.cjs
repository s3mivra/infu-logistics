'use strict';
// Fixes IIFE tabs where const/let declarations and an inner `return (` ended up
// inside the component's `return (` call. We hoist everything before the final `return (`.

const fs   = require('fs');
const path = require('path');
const TABS = path.join(__dirname, '..', 'client', 'src', 'components', 'tabs');

['HistoryTab.jsx', 'AuditTab.jsx'].forEach(filename => {
  const file = path.join(TABS, filename);
  const src  = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  // Find the component's outer `  return (` line
  let outerReturnIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{2}return \($/.test(lines[i])) { outerReturnIdx = i; break; }
  }
  if (outerReturnIdx === -1) { console.warn('No outer return found in', filename); return; }

  // Find the inner `return (` (the original IIFE's return)
  let innerReturnIdx = -1;
  for (let i = outerReturnIdx + 1; i < lines.length; i++) {
    if (/^\s{8}return \($/.test(lines[i]) || /^\s{6}return \($/.test(lines[i])) {
      innerReturnIdx = i; break;
    }
  }
  if (innerReturnIdx === -1) { console.warn('No inner return found in', filename); return; }

  // The block between outerReturn+1 and innerReturn-1 is the "hoisted" code
  // (const declarations, helper fns, etc.)
  const hoisted = lines.slice(outerReturnIdx + 1, innerReturnIdx);

  // Remove them from their current position and insert before the outer `  return (`
  lines.splice(outerReturnIdx + 1, innerReturnIdx - outerReturnIdx - 1);

  // Now insert the hoisted lines BEFORE `  return (`
  lines.splice(outerReturnIdx, 0, ...hoisted);

  // The outer return is now pushed down; replace it with the inner return text
  // Find the new outer return position
  const newOuterIdx = outerReturnIdx + hoisted.length;
  // It should now read `  return (` — leave it as is.
  // Remove the inner `return (` that's now right after
  // Actually after splicing, the inner return became the outer return — nothing to do.

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`Fixed ${filename}: hoisted ${hoisted.length} lines before return`);
});
