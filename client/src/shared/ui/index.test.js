import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as ui from './index.js';

// Captures what the provider would have rendered.
let toasts;
let confirmCalls;
beforeEach(() => {
  toasts = [];
  confirmCalls = [];
  ui.__register({
    toast: (t) => toasts.push(t),
    confirm: (o) => { confirmCalls.push(o); return Promise.resolve(true); },
  });
});

describe('ui.alert tone inference', () => {
  const toneOf = (msg) => { ui.alert(msg); return toasts.at(-1).tone; };

  it('reads plain failures as errors', () => {
    expect(toneOf('Failed to log spoilage.')).toBe('error');
    expect(toneOf('Invalid name or password')).toBe('error');
    expect(toneOf('Could not reach the server')).toBe('error');
  });

  it('does NOT mistake "failed to update" for a success', () => {
    // The trap: the string contains "update", a success word.
    expect(toneOf('Failed to update the product.')).toBe('error');
    expect(toneOf('Could not save changes')).toBe('error');
  });

  it('reads genuine successes as success', () => {
    expect(toneOf('✅ Created: 4')).toBe('success');
    expect(toneOf('Order posted.')).toBe('success');
    expect(toneOf('Inventory updated')).toBe('success');
    expect(toneOf('AP payment recorded.')).toBe('success');
  });

  it('reads validation nudges as warnings', () => {
    expect(toneOf('Please assign a reason for all items.')).toBe('warn');
    expect(toneOf('Item name is required.')).toBe('warn');
    expect(toneOf('Insufficient funds')).toBe('warn');
  });

  it('falls back to info for neutral text', () => {
    expect(toneOf('No valid rows to import.')).toBe('info');
  });

  it('lets an explicit tone win over inference', () => {
    ui.alert('Failed to update.', { tone: 'info' });
    expect(toasts.at(-1).tone).toBe('info');
  });

  it('ignores empty messages entirely', () => {
    ui.alert('');
    ui.alert(null);
    expect(toasts).toHaveLength(0);
  });
});

describe('ui.deferred — hold the action, cancel means it never runs', () => {
  let captured;
  beforeEach(() => {
    captured = null;
    ui.__register({
      toast: (t) => toasts.push(t),
      confirm: () => Promise.resolve(true),
      undo: (opts) => { captured = opts; },
    });
  });

  it('runs the action when the window expires', async () => {
    let ran = false;
    const p = ui.deferred(() => { ran = true; }, { message: 'Writing off…' });
    expect(ran).toBe(false);          // nothing yet — that's the whole point
    await captured.onExpire();
    await expect(p).resolves.toBe(true);
    expect(ran).toBe(true);
  });

  it('NEVER runs the action if undone', async () => {
    let ran = false;
    const p = ui.deferred(() => { ran = true; }, { message: 'Writing off…' });
    captured.onUndo();
    await expect(p).resolves.toBe(false);
    expect(ran).toBe(false);
  });

  it('still performs the action when no provider is mounted', async () => {
    ui.__unregister();
    let ran = false;
    await expect(ui.deferred(() => { ran = true; })).resolves.toBe(true);
    // Dropping a user-requested write because the UI layer is missing would be
    // worse than performing it without the undo window.
    expect(ran).toBe(true);
  });
});

describe('ui.undoable — action already applied, undo must really reverse it', () => {
  let captured;
  beforeEach(() => {
    captured = null;
    ui.__register({
      toast: (t) => toasts.push(t),
      confirm: () => Promise.resolve(true),
      undo: (opts) => { captured = opts; },
    });
  });

  it('calls the reversal when undone', async () => {
    let reversed = false;
    const p = ui.undoable(async () => { reversed = true; }, { message: 'Locked.' });
    await captured.onUndo();
    await expect(p).resolves.toBe(true);
    expect(reversed).toBe(true);
  });

  it('does nothing when the window simply expires', async () => {
    let reversed = false;
    const p = ui.undoable(async () => { reversed = true; }, { message: 'Locked.' });
    captured.onExpire();
    await expect(p).resolves.toBe(false);
    expect(reversed).toBe(false);
  });

  it('reports a failed reversal instead of pretending it worked', async () => {
    const p = ui.undoable(async () => { throw new Error('server said no'); }, { message: 'Locked.' });
    await captured.onUndo();
    await expect(p).resolves.toBe(false);
    expect(toasts.at(-1).message).toMatch(/could not undo/i);
    expect(toasts.at(-1).tone).toBe('error');
  });

  it('resolves false with no provider rather than claiming an undo happened', async () => {
    ui.__unregister();
    await expect(ui.undoable(async () => {})).resolves.toBe(false);
  });
});

describe('ui.confirm', () => {
  it('accepts a plain string like the window.confirm it replaced', async () => {
    await ui.confirm('Delete this?');
    expect(confirmCalls.at(-1)).toEqual({ message: 'Delete this?' });
  });

  it('passes a rich options object straight through', async () => {
    await ui.confirm({ title: 'Void order?', message: 'Order #1042 for ₱3,450.', tone: 'danger' });
    expect(confirmCalls.at(-1).title).toBe('Void order?');
    expect(confirmCalls.at(-1).tone).toBe('danger');
  });

  it('resolves FALSE when no provider is mounted, never true', async () => {
    // Every confirm() guards a destructive or financial action, so an
    // unmounted provider must fail closed.
    ui.__unregister();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(ui.confirm('Delete everything?')).resolves.toBe(false);
  });
});
