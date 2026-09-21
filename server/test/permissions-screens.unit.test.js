// Page permissions: one per page inside a tab (screen.<tab>.<page>).
//
// They narrow a tab, never widen one, and every role or person set up before
// they existed must keep exactly the pages they had. The last block reads the
// client's source, because the page ids live in three places - here, the
// client's nav registry, and the client's own can() - and a page renamed in
// one of them would otherwise vanish for everyone without an error.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SCREENS, screenKey, withScreens, resolvePermissions, hasPermission,
  setCustomRolePermissions, PERMISSIONS, PERMISSION_KEYS,
} from '../lib/authz.js';

const pagesOf = (tab) => SCREENS.find((s) => s.tab === tab).pages.map(([p]) => screenKey(tab, p));
const LEDGER = pagesOf('ledger');
const REPORTS = pagesOf('reports');

afterEach(() => setCustomRolePermissions([]));

describe('the catalogue', () => {
  it('lists every page, each under its tab and naming its parent', () => {
    for (const f of SCREENS) {
      for (const [page] of f.pages) {
        const entry = PERMISSIONS.find((p) => p.key === screenKey(f.tab, page));
        expect(entry, screenKey(f.tab, page)).toBeTruthy();
        expect(entry.parent).toBe(f.parent);
        expect(PERMISSION_KEYS.has(f.parent)).toBe(true);
      }
    }
  });
});

describe('what a list grants', () => {
  it('opens every page of a tab when none is named', () => {
    expect(withScreens(['accounting.view'])).toEqual(expect.arrayContaining(LEDGER));
  });

  it('opens only the named pages once one is named', () => {
    const out = withScreens(['accounting.view', screenKey('ledger', 'expenses'), screenKey('ledger', 'bills')]);
    expect(out.filter((k) => k.startsWith('screen.ledger.')).sort())
      .toEqual([screenKey('ledger', 'bills'), screenKey('ledger', 'expenses')]);
  });

  it('never opens a page without its tab - a page key cannot widen access', () => {
    const out = withScreens([screenKey('ledger', 'trial'), 'reports.view']);
    expect(out).not.toContain(screenKey('ledger', 'trial'));
    expect(out).not.toContain('accounting.view');
  });

  it('narrows one tab without touching another', () => {
    const out = withScreens(['accounting.view', 'reports.view', screenKey('reports', 'vatreturn')]);
    expect(out).toEqual(expect.arrayContaining(LEDGER));
    expect(out.filter((k) => k.startsWith('screen.reports.'))).toEqual([screenKey('reports', 'vatreturn')]);
  });
});

describe('everyone set up before pages existed keeps what they had', () => {
  it('a built-in role opens every page of every tab it opens', () => {
    const finance = resolvePermissions({ role: 'finance' });
    expect(finance).toEqual(expect.arrayContaining([...LEDGER, ...REPORTS]));
    const staff = resolvePermissions({ role: 'staff' });
    expect(staff.some((k) => k.startsWith('screen.ledger.'))).toBe(false);
  });

  it('a person with an older explicit list', () => {
    const perms = resolvePermissions({ role: 'cashier', permissions: ['accounting.view'] });
    expect(perms).toEqual(expect.arrayContaining(LEDGER));
  });

  it('a custom role saved before pages existed', () => {
    setCustomRolePermissions([{ name: 'Bookkeeper', permissions: ['accounting.view', 'reports.view'] }]);
    expect(resolvePermissions({ role: 'Bookkeeper' })).toEqual(expect.arrayContaining([...LEDGER, ...REPORTS]));
  });

  it('a token minted before pages existed still opens them', () => {
    // perms from an older login: no page keys at all.
    const token = { role: 'finance', perms: ['accounting.view', 'reports.view'] };
    expect(hasPermission(token, screenKey('ledger', 'trial'))).toBe(true);
    expect(hasPermission(token, screenKey('hub', 'books'))).toBe(false);   // inventory.view not held
  });
});

describe('a narrowed person', () => {
  it('gets exactly the pages chosen', () => {
    setCustomRolePermissions([{ name: 'Payables Clerk', permissions: ['accounting.view', screenKey('ledger', 'bills'), screenKey('ledger', 'expenses')] }]);
    const user = { role: 'Payables Clerk' };
    expect(hasPermission(user, screenKey('ledger', 'bills'))).toBe(true);
    expect(hasPermission(user, screenKey('ledger', 'expenses'))).toBe(true);
    expect(hasPermission(user, screenKey('ledger', 'pnl'))).toBe(false);
    expect(hasPermission(user, screenKey('ledger', 'trial'))).toBe(false);
  });
});

describe('the client agrees', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const client = (rel) => readFileSync(join(here, '..', '..', 'client', 'src', rel), 'utf8');

  // Page ids as the client's sub-navs spell them.
  const clientPages = {
    ledger: (() => {
      const src = client('features/dashboard/navRegistry.js');
      const block = src.slice(src.indexOf('LEDGER_TAB_GROUPS'), src.indexOf('REPORT_TAB_GROUPS'));
      return [...block.matchAll(/\['([a-z]+)', '[^']+', [A-Za-z0-9]+]/g)].map((m) => m[1]);
    })(),
    reports: (() => {
      const src = client('features/dashboard/navRegistry.js');
      const block = src.slice(src.indexOf('export const REPORT_TAB_GROUPS'), src.indexOf('export const navItemVisible'));
      return [...block.matchAll(/\['([a-z]+)', '[^']+', [A-Za-z0-9]+]/g)].map((m) => m[1]);
    })(),
    inventory: [...client('features/inventory/InventoryTab.jsx').matchAll(/can\('screen\.inventory\.([a-z]+)'\)/g)].map((m) => m[1]),
    hub: (() => {
      const src = client('features/hub/HubTab.jsx');
      const block = src.slice(src.indexOf("['inventory', 'Unified Inventory'"), src.indexOf("can(`screen.hub.${id}`)"));
      return [...block.matchAll(/\['([a-z]+)', '[^']+', [A-Za-z0-9]+]/g)].map((m) => m[1]);
    })(),
    procurement: (() => {
      const src = client('features/procurement/ProcurementTab.jsx');
      const block = src.slice(src.indexOf("{ id: 'orders', label: 'Purchase Orders'"), src.indexOf("can(`screen.procurement.${id}`)"));
      return [...block.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
    })(),
  };

  for (const f of SCREENS) {
    it(`${f.tab}: the same pages on both sides`, () => {
      expect(clientPages[f.tab].slice().sort()).toEqual(f.pages.map(([p]) => p).sort());
    });
  }

  it('the client\'s can() narrows each tab by the same parent', () => {
    const src = client('features/auth/auth.js');
    for (const f of SCREENS) {
      expect(src).toMatch(new RegExp(`${f.tab}: '${f.parent.replace('.', '\\.')}'`));
    }
  });
});
