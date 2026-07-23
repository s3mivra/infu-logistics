// Unit tests for the pure RBAC permission helpers in lib/authz.js.
import { describe, it, expect } from 'vitest';
import { resolvePermissions, hasPermission, ROLE_DEFAULT_PERMISSIONS, PERMISSIONS, PERMISSION_KEYS } from '../lib/authz.js';

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
