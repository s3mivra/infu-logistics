// Pop-ups close when their dimmed background is clicked (each one wires an
// onClick on its `fixed inset-0` backdrop). Two ways that bit people:
//
//  1. Too sensitive. Selecting text in a field and letting go of the mouse
//     past the pop-up's edge fires a click on the BACKDROP (the browser sends
//     it to what both ends of the drag share) - and the pop-up closed, taking
//     what was typed with it. A backdrop click now only counts when the press
//     also started on the backdrop.
//  2. Typing lost. Once anything has been typed or changed inside a pop-up, a
//     stray click outside no longer closes it; its own Close / Cancel (or Esc)
//     still does. A short note says so.
//
// Installed once for the whole app (main.jsx), so every pop-up gets it
// without being touched. It works in the capture phase on `window`, ahead of
// React's own listener on the root, and only ever swallows a click that lands
// directly on a backdrop - clicks inside the pop-up are never affected.
import { toast } from './index.js';

const isBackdrop = (el) => !!el && el.nodeType === 1 && el.classList.contains('fixed') && el.classList.contains('inset-0');
const backdropOf = (el) => {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (isBackdrop(n)) return n;
  return null;
};

export function installBackdropGuard(win = typeof window !== 'undefined' ? window : null) {
  if (!win || win.__backdropGuard) return;
  win.__backdropGuard = true;
  const edited = new WeakSet();   // backdrops whose fields were changed while open
  let pressedOn = null;

  const markEdited = (e) => {
    const t = e.target;
    if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') && !t.isContentEditable) return;
    const b = backdropOf(t);
    if (b) edited.add(b);
  };
  win.addEventListener('input', markEdited, true);
  win.addEventListener('change', markEdited, true);
  win.addEventListener('pointerdown', (e) => { pressedOn = e.target; }, true);

  win.addEventListener('click', (e) => {
    const t = e.target;
    if (!isBackdrop(t)) return;               // a click inside the pop-up - never touched
    const startedHere = pressedOn === t;
    pressedOn = null;
    if (!startedHere) { e.stopPropagation(); return; }   // a drag that ended outside
    if (edited.has(t)) {
      e.stopPropagation();
      try { toast('You have typed in this window - use its Close or Cancel button to leave.'); } catch { /* no toast host */ }
    }
  }, true);
}
