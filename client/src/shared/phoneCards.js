// On a phone, each table row shows as a card: every cell on its own line,
// labelled with its column's heading. This labels the cells (data-label from
// the table's own <th>s); index.css does the rest under 640px. Watches for
// tables as they render, so every table in the app gets it without a change
// of its own. A table marked data-keep-table stays a table.
function label(table) {
  if (table.hasAttribute('data-keep-table')) return;
  const heads = [...(table.tHead?.rows[0]?.cells || [])];
  if (!heads.length) return;
  const names = [];
  for (const th of heads) for (let i = 0; i < (th.colSpan || 1); i++) names.push((th.textContent || '').trim());
  table.classList.add('phone-cards');
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let c = 0;
      for (const td of row.cells) {
        const n = names[c] || '';
        if (td.getAttribute('data-label') !== n) td.setAttribute('data-label', n);
        c += td.colSpan || 1;
      }
    }
  }
}

export function startPhoneCards(root = document.body) {
  if (typeof MutationObserver === 'undefined' || !root) return () => {};
  let queued = false;
  const run = () => { queued = false; root.querySelectorAll('table').forEach(label); };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  mo.observe(root, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
