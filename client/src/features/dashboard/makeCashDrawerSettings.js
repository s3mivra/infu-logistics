import { Lock } from 'lucide-react';
import * as ui from '../../shared/ui';

// Shared cash drawer settings.
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeCashDrawerSettings(deps) {
  const {
    systemSettings, apiFetch, fetchSettings, setSharedDrawer,
  } = deps;

  // ── Shared cash drawer settings ────────────────────────────────────────────
  // Off by default, so an existing deployment keeps per-cashier floats until
  // someone deliberately switches. Only ever affects the NEXT session opened -
  // shifts already open or closed are untouched, and each carries its own
  // `scope` so the two models stay tellable apart in history forever.
  const toggleSharedDrawer = async () => {
    const next = systemSettings.sharedDrawer !== true;
    if (next && !await ui.confirm('Switch to one shared cash drawer? The float is declared once by whoever opens up, everyone rings on the same till, and one person counts at close. Shifts already open are left as they are.')) return;
    try {
      const res = await apiFetch('/api/settings/sharedDrawer', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json();
      if (d.success) { fetchSettings(); setSharedDrawer(next); }
    } catch (err) { console.error('toggleSharedDrawer', err); }
  };
  // Ask who is ringing after every sale. Off by default: it is the right
  // setting for a busy shared bar and the wrong one for a single-operator
  // counter, and only the shop can say which it is.
  const toggleAskOperatorEachSale = async () => {
    const next = systemSettings.askOperatorEachSale !== true;
    if (next && !await ui.confirm('Lock the register after every sale? Whoever rings the next one enters their PIN first. Attribution becomes exact, at the cost of a PIN on every sale. If nobody has a PIN yet the register stays open.')) return;
    try {
      const res = await apiFetch('/api/settings/askOperatorEachSale', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json();
      if (d.success) fetchSettings();
    } catch (err) { console.error('toggleAskOperatorEachSale', err); }
  };
  const toggleBlindClose = async () => {
    const next = systemSettings.blindClose === false;
    if (!next && !await ui.confirm('Show the expected total before counting? Whoever counts will be able to read the figure they are meant to reach, so a short drawer can quietly be written up as an exact one.')) return;
    try {
      const res = await apiFetch('/api/settings/blindClose', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json(); if (d.success) fetchSettings();
    } catch (err) { console.error('toggleBlindClose', err); }
  };
  // Maximum hours a drawer session may stay open; 0 turns the boundary off.
  // A duration rather than a midnight cut-off, because a 24/7 counter is at its
  // busiest at the hour a clock-time close would fire.
  const saveDrawerMaxHours = async (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 168) return ui.alert('Enter between 0 hours (off) and 168 (one week).');
    try {
      const res = await apiFetch('/api/settings/drawerMaxHours', { method: 'PATCH', body: JSON.stringify({ value: n }) });
      const d = await res.json();
      if (d.success) fetchSettings(); else ui.alert(d.error || 'Could not save that.');
    } catch (err) { console.error('saveDrawerMaxHours', err); }
  };

  const saveVarianceThreshold = async (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return ui.alert('The threshold must be zero or a positive amount.');
    try {
      const res = await apiFetch('/api/settings/varianceThreshold', { method: 'PATCH', body: JSON.stringify({ value: n }) });
      const d = await res.json();
      if (d.success) fetchSettings(); else ui.alert(d.error || 'Could not save that.');
    } catch (err) { console.error('saveVarianceThreshold', err); }
  };

  // Superadmin-only: enable/disable the automatic midnight close & day archive.
  const toggleAutoClose = async () => {
    const next = systemSettings.autoCloseEnabled === false; // currently off → turning on
    if (!next && !await ui.confirm('Disable automatic midnight close?\n\nThe day will stay OPEN past midnight and a superadmin must close & archive it manually.')) return;
    try {
      const res = await apiFetch('/api/settings/autoCloseEnabled', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json(); if (d.success) fetchSettings();
    } catch (err) { console.error('toggleAutoClose', err); }
  };

  // Toggle whether product images are shown across the app (menu, portal, product list).
  // Generic setting writer for non-boolean settings (credit limit mode, global
  // limit). The toggle* helpers above stay as they are - they encode their own
  // confirm/labelling rules.
  const saveSetting = async (key, value) => {
    try {
      const res = await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: 'PATCH', body: JSON.stringify({ value }),
      });
      const d = await res.json();
      if (d.success) fetchSettings();
      else ui.alert(d.error || 'Could not save setting.');
    } catch (err) { console.error('saveSetting', err); ui.alert('Could not save setting.'); }
  };

  const toggleImages = async () => {
    const next = systemSettings.imagesEnabled === false; // currently off -> turning on
    try {
      const res = await apiFetch('/api/settings/imagesEnabled', { method: 'PATCH', body: JSON.stringify({ value: next }) });
      const d = await res.json(); if (d.success) fetchSettings();
    } catch (err) { console.error('toggleImages', err); }
  };

  return {
    toggleSharedDrawer, toggleBlindClose, saveVarianceThreshold, saveDrawerMaxHours, toggleAskOperatorEachSale, toggleAutoClose, toggleImages, saveSetting,
  };
}
