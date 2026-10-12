import React from 'react';
import { Clock, Network } from 'lucide-react';
import { queueClock, getQueuedClock } from '../../shared/pwa';
import * as auth from '../auth/auth';
import * as ui from '../../shared/ui';

// Staff clock in and clock out.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeTimeClock(deps) {
  const {
    setClockStatus, setClockStatusLoaded, apiFetch, setClockEntries, setClockEntriesTotal, setClockEntriesPage, clockStatus, setClockModalOpen,
  } = deps;

  // ── Clock in/out ─────────────────────────────────────────────────────────────
  // Apply any queued offline clock events on top of a base status so the gate /
  // button reflect the staff member's optimistic state until the queue syncs.
  const applyQueuedClock = (base) => {
    let s = { ...base };
    for (const e of getQueuedClock()) {
      if (e.type === 'in')  s = { ...s, isClockedIn: true,  onBreak: false };
      if (e.type === 'out') s = { ...s, isClockedIn: false, onBreak: false };
    }
    return s;
  };
  // Clock status is one PERSON's, and on a shared tablet the person changes
  // without anyone signing out. One cache for the whole device meant the
  // offline fallback could show the last person's status to the next one, so
  // it is kept per user. Read from auth rather than from React state, because
  // right after a PIN switch the state has not caught up yet but auth has.
  const clockStateKey = () => `semivra_clock_state:${auth.getUser()?._id || 'anon'}`;
  const fetchClockStatus = async () => {
    // OFFLINE: rebuild status from the last cached server snapshot + queued events.
    if (!navigator.onLine) {
      let st = null;
      try {
        const cached = JSON.parse(localStorage.getItem(clockStateKey()) || 'null')
          || { isClockedIn: false, entry: null, onBreak: false, breakUsedMinutes: 0, breakRemainingMinutes: 60 };
        st = applyQueuedClock(cached);
        setClockStatus(st);
      } catch { /* ignore */ }
      finally { setClockStatusLoaded(true); }
      return st;
    }
    try {
      const res = await apiFetch('/api/clock/status'); const d = await res.json();
      if (d.success) {
        const st = {
          isClockedIn: d.isClockedIn, entry: d.entry,
          onBreak: !!d.onBreak, breakStartedAt: d.breakStartedAt || null,
          breakUsedMinutes: d.breakUsedMinutes || 0, breakRemainingMinutes: d.breakRemainingMinutes ?? 60,
        };
        setClockStatus(st);
        try { localStorage.setItem(clockStateKey(), JSON.stringify(st)); } catch { /* ignore */ }
        return st;
      }
    }
    catch (err) { console.error('fetchClockStatus', err); }
    finally { setClockStatusLoaded(true); }
    return null;
  };
  const fetchClockEntries = async (page = 1) => {
    try { const res = await apiFetch(`/api/clock/entries?page=${page}&limit=30`); const d = await res.json(); if (d.success) { setClockEntries(d.entries||[]); setClockEntriesTotal(d.total||0); setClockEntriesPage(page); } }
    catch (err) { console.error('fetchClockEntries', err); }
  };
  const handleClockIn = async () => {
    if (!navigator.onLine) {
      queueClock('in');
      setClockStatus((s) => ({ ...s, isClockedIn: true, onBreak: false }));
      ui.alert('Clocked in (offline - will sync when back online).');
      return;
    }
    try {
      const res = await apiFetch('/api/clock/in', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) { fetchClockStatus(); ui.alert('Clocked in.'); return; }
      // The server is the record of who is clocked in. When it refuses, ask it
      // what is actually true instead of repeating the refusal: an entry left
      // open from an earlier shift, or a screen that had not caught up after a
      // switch, left someone stuck behind a gate offering a button the server
      // would never accept. If they are in, the gate lifts - and they are told
      // since when, because an entry open since yesterday is worth a look.
      const st = await fetchClockStatus();
      if (st?.isClockedIn) {
        const since = st.entry?.clockIn ? new Date(st.entry.clockIn) : null;
        ui.alert(since
          ? `You were already clocked in, since ${since.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`
          : 'You were already clocked in.');
      } else {
        ui.alert(d.error || 'Clock-in failed.');
      }
    }
    catch { ui.alert('Network error.'); }
  };
  // Pressing the clock button while working opens the choice modal (break vs end shift).
  const handleClockButton = () => {
    if (!clockStatus.isClockedIn) return handleClockIn();
    if (clockStatus.onBreak) return endBreak();      // currently on break → resume
    setClockModalOpen(true);                          // working → show options
  };
  const startBreak = async () => {
    try {
      const res = await apiFetch('/api/clock/break/start', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) { setClockModalOpen(false); fetchClockStatus(); }
      else ui.alert(d.error || 'Could not start break.');
    } catch { ui.alert('Network error.'); }
  };
  const endBreak = async () => {
    try {
      const res = await apiFetch('/api/clock/break/end', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) { fetchClockStatus(); } else ui.alert(d.error || 'Could not end break.');
    } catch { ui.alert('Network error.'); }
  };
  const handleClockOut = async () => {
    if (!navigator.onLine) {
      queueClock('out');
      setClockStatus((s) => ({ ...s, isClockedIn: false, onBreak: false }));
      setClockModalOpen(false);
      ui.alert('Clocked out (offline - will sync when back online).');
      return;
    }
    try {
      const res = await apiFetch('/api/clock/out', { method: 'POST', body: '{}' });
      const d = await res.json();
      if (d.success) {
        setClockModalOpen(false); fetchClockStatus();
        const m = d.entry?.workedMinutes ?? d.entry?.durationMinutes ?? 0;
        const b = d.entry?.breakMinutes || 0;
        ui.alert(`Clocked out. Worked ${Math.floor(m/60)}h ${m%60}m${b ? ` (${b}m break)` : ''}.`);
      } else ui.alert(d.error||'Clock-out failed.');
    } catch { ui.alert('Network error.'); }
  };

  return {
    fetchClockStatus, handleClockIn, handleClockButton, fetchClockEntries, handleClockOut, startBreak, endBreak,
  };
}
