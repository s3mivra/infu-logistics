// Negative peso amounts read in red, on every screen. Every amount is written
// by formatPeso (shared/money.js), so a negative always starts with "−₱";
// this marks the element holding such an amount with .neg-amount, which
// index.css colours. One watcher for the whole app instead of a change on
// every table. Wrap a part in data-keep-colour to opt it out.
const NEG = /^\s*−₱/;

function mark(node) {
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!el || el.closest('[data-keep-colour]')) return;
  const check = (e) => {
    if (NEG.test(e.textContent || '') && e.childElementCount === 0) e.classList.add('neg-amount');
    else e.classList.remove('neg-amount');
  };
  if (node.nodeType === 3) { check(el); return; }
  check(el);
  el.querySelectorAll?.('*').forEach((c) => { if (c.childElementCount === 0) check(c); });
}

export function startRedNegatives(root = document.body) {
  if (typeof MutationObserver === 'undefined' || !root) return () => {};
  mark(root);
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') mark(m.target);
      else m.addedNodes.forEach(mark);
    }
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  return () => mo.disconnect();
}
