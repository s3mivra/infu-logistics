// Imperative UI dialog API — the app's replacement for window.alert/confirm.
//
// WHY imperative rather than a hook: these are called from ~200 places, most of
// them deep inside async handlers that aren't components. A hook would force
// every one of those into a component boundary. Instead <UiProvider> registers
// its handlers here at mount, and any module can call ui.alert()/ui.confirm().
//
// Usage:
//   import * as ui from '../../shared/ui';
//   ui.alert('Saved.');                       // toast, fire-and-forget
//   if (!(await ui.confirm('Void order?'))) return;
//   ui.toast('Stock updated', { tone: 'success' });
//
// The `ui.` prefix is deliberate — it keeps these visually distinct from the
// native globals they replaced, and avoids colliding with the PWA `notify`.

let handlers = null;

// Called by UiProvider on mount. Not part of the public API.
export function __register(h) { handlers = h; }
export function __unregister() { handlers = null; }

// Toast — transient, non-blocking. tone: 'info' | 'success' | 'warn' | 'error'.
export function toast(message, { tone = 'info', duration } = {}) {
  const text = String(message ?? '');
  if (!text) return;
  // If the provider isn't mounted yet (very early boot, or a non-React caller),
  // fall back to the console rather than silently swallowing a user-facing
  // message. Never falls back to window.alert — that's what we're removing.
  if (!handlers) { console.warn('[ui.toast]', text); return; }
  handlers.toast({ message: text, tone, duration });
}

// ── Undo ─────────────────────────────────────────────────────────────────────
// Two shapes, because "undo" means different things depending on whether the
// action can be reversed after the fact.
//
// 1. deferred(run, opts)  — HOLD the action for a few seconds and only send it
//    if the user doesn't cancel. True undo with no reversal endpoint needed,
//    and nothing hits the books unless the window elapses. Use when a short
//    delay is harmless.
//
// 2. undoable(undo, opts) — the action ALREADY happened; "undo" calls a real
//    reversal (e.g. reopening a closed period). Use when the effect must be
//    immediate and a genuine reversal exists.
//
// Never fake the second with a no-op: an Undo button that doesn't reverse
// anything is worse than no button, because the user believes it worked.

const DEFAULT_WINDOW = 6;

/**
 * Run `action` after a grace period unless the user cancels.
 * Returns a promise resolving true if it ran, false if it was undone.
 */
export function deferred(action, { message, seconds = DEFAULT_WINDOW, undoMessage = 'Undone.' } = {}) {
  if (!handlers?.undo) {
    // No provider: do the safe thing and just run it, rather than dropping a
    // user-requested action on the floor.
    return Promise.resolve(action()).then(() => true);
  }
  return new Promise((resolve) => {
    handlers.undo({
      message: message || 'Applying…',
      seconds,
      onExpire: async () => { await action(); resolve(true); },
      onUndo: () => { toast(undoMessage, { tone: 'info' }); resolve(false); },
    });
  });
}

/**
 * Offer to reverse an action that has already been applied.
 * `undo` must actually reverse it.
 */
export function undoable(undo, { message, seconds = DEFAULT_WINDOW, undoMessage = 'Reverted.' } = {}) {
  if (!handlers?.undo) return Promise.resolve(false);
  return new Promise((resolve) => {
    handlers.undo({
      message: message || 'Done.',
      seconds,
      alreadyApplied: true,
      onExpire: () => resolve(false),
      onUndo: async () => {
        try { await undo(); toast(undoMessage, { tone: 'info' }); resolve(true); }
        catch (e) { toast('Could not undo that.', { tone: 'error' }); resolve(false); }
      },
    });
  });
}

// Infer a tone from the message text.
//
// WHY: the ~170 call sites this replaced were all plain alert(), which carries
// no severity. Blanket-tagging them 'error' paints success reports red (a real
// case: "✅ Created: 0 / Skipped: 10" rendered as a failure). Reading the text
// is imperfect but strictly better than one wrong tone for everything, and any
// call site can override by passing { tone }.
function inferTone(text) {
  const t = text.toLowerCase();
  if (/^\s*(✅|✔)/.test(text) || /\b(success|successful|saved|updated|created|posted|recorded|completed|done)\b/.test(t)) {
    // "failed to update" also contains "update" — let failure words win below.
    if (!/\b(fail|failed|error|cannot|could not|unable|invalid|denied|rejected)\b/.test(t)) return 'success';
  }
  if (/\b(fail|failed|error|cannot|could not|unable|invalid|denied|rejected|not found|no permission)\b/.test(t)) return 'error';
  if (/\b(required|please|must|missing|select|enter|warning|insufficient)\b/.test(t)) return 'warn';
  return 'info';
}

// Drop-in for the old alert(). Tone is inferred from the message unless given.
export function alert(message, opts = {}) {
  const text = String(message ?? '');
  toast(text, { ...opts, tone: opts.tone || inferTone(text) });
}

// Drop-in for window.confirm(), but async. Accepts either a plain string
// (matching the old call shape) or an options object for richer dialogs:
//   ui.confirm({ title: 'Void order?', message: 'Order #1042 for ₱3,450.',
//                confirmLabel: 'Void', tone: 'danger' })
// Resolves true if confirmed, false otherwise (including Esc / backdrop click).
export function confirm(input) {
  const opts = typeof input === 'string' ? { message: input } : (input || {});
  if (!handlers) {
    // Without a provider we cannot ask the user. Refuse rather than proceed —
    // every confirm() in this app guards a destructive or financial action, so
    // "assume yes" would be the dangerous default.
    console.warn('[ui.confirm] no provider mounted; treating as cancelled:', opts.message);
    return Promise.resolve(false);
  }
  return handlers.confirm(opts);
}
