import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAV_GROUPS, LEDGER_TAB_GROUPS, REPORT_TAB_GROUPS, TYPE_ONLY_REPORT_PAGES, paletteDestinations, visibleNavGroups } from './navRegistry';

// Can you get to every screen, and does every screen exist?
//
// The registry is what the sidebar and the Ctrl+K palette are drawn from, but
// the pages themselves are `activeTab === 'x'` and `ledgerSubTab === 'y'`
// branches in the tab components. Nothing but this test keeps the two in step:
// a page registered with no branch is a dead menu entry, and a branch with no
// entry is a screen nobody can click to.
const src = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const dash = src('AdminDashboard.jsx');
const ledgerSrc = src('../ledger/LedgerTab.jsx');

const ledgerPages = LEDGER_TAB_GROUPS.flatMap(([, items]) => items.map(([id]) => id));
const reportPages = REPORT_TAB_GROUPS.flatMap(([, items]) => items.map(([id]) => id));
// Most ledger pages live in their own file next to LedgerTab (AdvancesTab,
// CollectionsTab, ...), each still opening on its own `ledgerSubTab === 'y'`.
// A page counts only if LedgerTab actually mounts the file it is in.
const ledgerDir = fileURLToPath(new URL('../ledger/', import.meta.url));
const mountedPageSrc = fs.readdirSync(ledgerDir)
  .filter((f) => /Tab\.jsx$/.test(f) && f !== 'LedgerTab.jsx' && ledgerSrc.includes(`<${f.replace('.jsx', '')}`))
  .map((f) => fs.readFileSync(ledgerDir + f, 'utf8'));
const renderedPages = new Set([ledgerSrc, ...mountedPageSrc]
  .flatMap((text) => [...text.matchAll(/ledgerSubTab === '([a-z0-9-]+)'/g)].map((m) => m[1])));
const renderedTabs = new Set([...dash.matchAll(/activeTab === '([a-z0-9-]+)'/g)].map((m) => m[1]));
// Merged pages: several ids land on one screen (Accounts & Periods holds the
// chart of accounts, the periods and payment routing).
const alias = Object.fromEntries(
  [...(ledgerSrc.match(/LEDGER_ALIAS = \{([^}]*)\}/)?.[1] || '').matchAll(/([a-z0-9-]+)\s*:\s*'([a-z0-9-]+)'/gi)]
    .map((m) => [m[1], m[2]]),
);

describe('every registered screen exists', () => {
  it('renders a page for each Ledger and Reports entry', () => {
    const missing = [...ledgerPages, ...reportPages].filter((id) => !renderedPages.has(id) && !renderedPages.has(alias[id]));
    expect(missing).toEqual([]);
  });

  it('renders a tab for each sidebar entry', () => {
    const missing = NAV_GROUPS.flatMap((g) => g.items)
      .filter((it) => !it.route)              // Admin Panel is a route, not a tab
      .map((it) => it.id)
      .filter((id) => !renderedTabs.has(id));
    expect(missing).toEqual([]);
  });
});

describe('every screen can be reached', () => {
  it('has a nav group for each page the Ledger renders', () => {
    // A page is reachable from a Ledger / Reports tab, or straight from the
    // sidebar (Approvals has its own entry there, pointing at its page).
    const sidebarPages = NAV_GROUPS.flatMap((g) => g.items).map((it) => it.sub).filter(Boolean);
    // The Ledger screen holds both kinds of business's pages; the menu only
    // offers the ones this build is for, so the other kind's are not orphans.
    const otherKind = Object.values(TYPE_ONLY_REPORT_PAGES).flat();
    const known = new Set([...ledgerPages, ...reportPages, ...Object.keys(alias), ...sidebarPages, ...otherKind]);
    const orphans = [...renderedPages].filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it('offers every screen in the palette, with the path to it', () => {
    const owner = { can: () => true, isSuperAdmin: true, moduleOn: () => true, businessType: 'fb' };
    const dests = paletteDestinations(owner);
    // A buried page is exactly what search is for, so each one is offered by
    // name with where it lives.
    const exportAll = dests.find((d) => d.label === 'Export All');
    expect(exportAll).toMatchObject({ id: 'ledger', sub: 'exportall', hint: 'Ledger → Setup' });
    for (const id of [...ledgerPages, ...reportPages]) {
      expect(dests.some((d) => d.sub === id), `${id} is in no search result`).toBe(true);
    }
  });

  it('keeps the sidebar and the palette to what a person may open', () => {
    const cashier = { can: (p) => p === 'orders.view', isSuperAdmin: false, moduleOn: () => true, businessType: 'fb' };
    const groups = visibleNavGroups(cashier);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain('orders');
    expect(ids).not.toContain('ledger');
    expect(paletteDestinations(cashier).some((d) => d.id === 'ledger')).toBe(false);
  });
});

describe('the way in is on the screen', () => {
  it('puts search in the sidebar, not only behind a shortcut', () => {
    // Ctrl+K is invisible, and the "Quick Tools" section it also lived in
    // folds shut - so a desktop showed nothing that said the app is searchable.
    const sidebar = dash.slice(dash.indexOf('{/* Nav'), dash.indexOf('{/* Nav') + 2000);
    expect(dash).toMatch(/aria-label="Search screens \(Ctrl\+K\)"/);
    const nav = dash.indexOf('aria-label="Main"');
    expect(nav).toBeGreaterThan(-1);
    expect(dash.indexOf('aria-label="Search screens (Ctrl+K)"')).toBeLessThan(nav);
    expect(sidebar.length).toBeGreaterThan(0);
  });
});

describe('Approvals', () => {
  it('has its own sidebar entry, open to any staff, and is no longer a Ledger page', () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((it) => it.id === 'approvals');
    expect(item).toMatchObject({ label: 'Approvals', sub: 'approvals' });
    expect(item.perm).toBeUndefined();
    expect(ledgerPages).not.toContain('approvals');
  });
});

describe('icons', () => {
  // Collapsed to an icon strip, the icon is the only thing on screen that
  // tells two destinations apart, so no two may share one.
  it('gives every sidebar destination its own icon', () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    const byIcon = new Map();
    for (const it of items) byIcon.set(it.icon, [...(byIcon.get(it.icon) || []), it.id]);
    const shared = [...byIcon.values()].filter((ids) => ids.length > 1);
    expect(shared).toEqual([]);
  });
});
