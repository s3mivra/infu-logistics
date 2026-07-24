// Unit tests for the pure RBAC permission helpers in lib/authz.js.
import { describe, it, expect } from 'vitest';
import { resolvePermissions, hasPermission, setCustomRolePermissions, ROLE_DEFAULT_PERMISSIONS, PERMISSIONS, PERMISSION_KEYS } from '../lib/authz.js';

describe('resolvePermissions', () => {
  it('grants superadmin every permission', () => {
    const perms = resolvePermissions({ role: 'superadmin' });
    expect(perms).toEqual(PERMISSIONS.map(p => p.key));
  });

  it('falls back to role defaults when no explicit override', () => {
    expect(resolvePermissions({ role: 'cashier' })).toEqual(ROLE_DEFAULT_PERMISSIONS.cashier);
  });

  it('uses explicit override when present (intersected with the catalogue)', () => {
    const perms = resolvePermissions({ role: 'cashier', permissions: ['accounting.view', 'bogus.perm', 'reports.view'] });
    expect(perms).toEqual(['accounting.view', 'reports.view']);
  });

  it('returns nothing for an unknown role with no override', () => {
    expect(resolvePermissions({ role: 'ghost' })).toEqual([]);
  });

  it('is case-insensitive on role', () => {
    expect(resolvePermissions({ role: 'SuperAdmin' })).toEqual(PERMISSIONS.map(p => p.key));
  });

  it('a custom role overrides built-in defaults of a colliding name', () => {
    // A user-created role named "Admin" with a narrow permission set must NOT be
    // silently widened to the built-in admin defaults (which include inventory /
    // procurement). The explicitly-granted set wins.
    setCustomRolePermissions([{ name: 'Admin', permissions: ['pos.use', 'orders.view'] }]);
    try {
      expect(resolvePermissions({ role: 'Admin' })).toEqual(['pos.use', 'orders.view']);
      expect(resolvePermissions({ role: 'admin' })).not.toContain('inventory.view');
    } finally {
      setCustomRolePermissions([]); // reset shared module state for other tests
    }
  });

  it('built-in roles still use defaults when no custom role shadows them', () => {
    setCustomRolePermissions([]);
    expect(resolvePermissions({ role: 'admin' })).toEqual(ROLE_DEFAULT_PERMISSIONS.admin);
  });
});

describe('hasPermission', () => {
  it('superadmin passes any permission', () => {
    expect(hasPermission({ role: 'superadmin' }, 'accounting.manage')).toBe(true);
  });

  it('reads the token perms array when present', () => {
    expect(hasPermission({ role: 'cashier', perms: ['pos.use'] }, 'pos.use')).toBe(true);
    expect(hasPermission({ role: 'cashier', perms: ['pos.use'] }, 'accounting.view')).toBe(false);
  });

  it('resolves from role defaults when the token has no perms', () => {
    expect(hasPermission({ role: 'finance' }, 'accounting.manage')).toBe(true);
    expect(hasPermission({ role: 'finance' }, 'pos.use')).toBe(false);
  });

  it('denies a null/undefined user', () => {
    expect(hasPermission(null, 'pos.use')).toBe(false);
  });
});

describe('catalogue integrity', () => {
  it('every role-default permission exists in the catalogue', () => {
    for (const [role, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const k of keys) expect(PERMISSION_KEYS.has(k), `${role} → ${k}`).toBe(true);
    }
  });
});
