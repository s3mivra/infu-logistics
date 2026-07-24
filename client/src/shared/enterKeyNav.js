// Global "Enter moves to next field" behavior — installed once for the whole
// app (both fb and log; this file has no business-type branching) instead of
// wiring it into every individual form component.
//
// Scope: most "forms" in this codebase are plain divs with a submit button,
// not native <form> elements, so we can't just rely on closest('form'). We
// walk up from the focused field to find the smallest reasonable container
// that holds it (a real <form>, a dialog/modal wrapper, or otherwise the
// nearest ancestor that contains more than one focusable field), and move
// focus to the next visible, enabled input/select within that container.
//
// Deliberately excludes <textarea> (Enter must still insert a newline there)
// and any field whose own Enter handler already called preventDefault (e.g. a
// search box that submits on Enter) — that existing behavior is left alone.

const FOCUSABLE_SELECTOR = 'input, select';

function isVisible(el) {
  return !!el && !el.disabled && el.offsetParent !== null;
}

function findScope(el) {
  let node = el.closest('form, [role="dialog"]');
  if (node) return node;
  // Walk up looking for the smallest ancestor with more than one focusable
  // field in it — a reasonable proxy for "this section's field group".
  node = el.parentElement;
  let depth = 0;
  while (node && depth < 10) {
    const fields = node.querySelectorAll(FOCUSABLE_SELECTOR);
    if (fields.length > 1) return node;
    node = node.parentElement;
    depth++;
  }
  return document.body;
}

function handleKeydown(e) {
  if (e.key !== 'Enter' || e.defaultPrevented) return;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return;
  if (el.tagName === 'INPUT' && ['submit', 'button', 'checkbox', 'radio', 'file'].includes(el.type)) return;

  const scope = findScope(el);
  const fields = Array.from(scope.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
  const idx = fields.indexOf(el);
  if (idx === -1 || idx === fields.length - 1) return; // last field — leave Enter's default behavior alone

  e.preventDefault();
  fields[idx + 1].focus();
}

let installed = false;
export function installEnterKeyNav() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', handleKeydown);
}
