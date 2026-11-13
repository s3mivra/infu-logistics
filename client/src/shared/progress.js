// What the app is busy with right now, for the progress panel (ProgressPanel).
//
// Imports and exports can take a while - a big sheet to read, a year of sales
// to post, a report to build - and without a sign of life it is impossible to
// tell "working" from "stuck". Every one of them reports here, mostly without
// knowing it: through apiFetch (server requests), shared/xlsx.js (reading and
// saving spreadsheets), the PDF loader, and a file being picked. A task that
// knows its size (batch 2 of 4) reports that too.
//
// A task: { id, label, done, total, startedAt, endedAt, ok, message }.

let nextId = 1;
const tasks = new Map();
const listeners = new Set();
const emit = () => { const list = [...tasks.values()]; listeners.forEach((fn) => fn(list)); };

export const subscribeProgress = (fn) => { listeners.add(fn); fn([...tasks.values()]); return () => listeners.delete(fn); };

// How long a finished task stays on screen, so a quick one is still seen.
const LINGER_MS = 2500;

export function startTask(label, { total = 0, kind = 'work' } = {}) {
  const id = nextId++;
  tasks.set(id, { id, label, kind, done: 0, total, startedAt: Date.now(), endedAt: null, ok: null, message: '' });
  emit();
  return id;
}

export function updateTask(id, patch) {
  const t = tasks.get(id);
  if (!t || t.endedAt) return;
  tasks.set(id, { ...t, ...patch });
  emit();
}

export function endTask(id, { ok = true, message = '' } = {}) {
  const t = tasks.get(id);
  if (!t || t.endedAt) return;
  tasks.set(id, { ...t, endedAt: Date.now(), ok, message, done: t.total || t.done });
  emit();
  setTimeout(() => { tasks.delete(id); emit(); }, ok ? LINGER_MS : LINGER_MS * 3);
}

// Runs fn as a task; the task ends however fn ends. fn receives a reporter:
//   step(done, total?, label?) - for work done in counted pieces.
export async function track(label, fn, opts = {}) {
  const id = startTask(label, opts);
  const step = (done, total, nextLabel) => updateTask(id, {
    done, ...(total !== undefined ? { total } : {}), ...(nextLabel ? { label: nextLabel } : {}),
  });
  try {
    const value = await fn(step);
    endTask(id, { ok: true });
    return value;
  } catch (err) {
    endTask(id, { ok: false, message: err?.message || 'Failed' });
    throw err;
  }
}

// Lets the browser paint (the panel) before heavy work that blocks it.
export const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// For tests.
export const _resetProgress = () => { tasks.clear(); emit(); };
