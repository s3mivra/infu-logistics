import { describe, it, expect, vi } from 'vitest';
import { STAFF_ROLES, evaluateStaffAccess, evaluateClientAccess, requireStaff } from './authz.js';

describe('authz.evaluateStaffAccess', () => {
  it('allows every staff role (new tokens carry aud:staff)', () => {
    for (const role of STAFF_ROLES) {
      expect(evaluateStaffAccess({ role, aud: 'staff' }).ok).toBe(true);
    }
  });

  it('allows staff roles regardless of letter-case', () => {
    expect(evaluateStaffAccess({ role: 'Staff', aud: 'staff' }).ok).toBe(true);
    expect(evaluateStaffAccess({ role: 'SuperAdmin', aud: 'staff' }).ok).toBe(true);
  });

  it('blocks a client token (role:client + aud:client)', () => {
    const r = evaluateStaffAccess({ role: 'client', aud: 'client' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('client-audience');
  });

  it('aud beats role: explicit aud:client is rejected even with a staffish role', () => {
    const r = evaluateStaffAccess({ role: 'admin', aud: 'client' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('client-audience');
  });

  it('rejects an unknown/garbage role (allowlist, fail-closed)', () => {
    expect(evaluateStaffAccess({ role: 'wizard', aud: 'staff' }).ok).toBe(false);
    expect(evaluateStaffAccess({ role: 'kitchen', aud: 'staff' }).ok).toBe(false);
  });

  it('rejects a missing/empty role (fail-closed)', () => {
    expect(evaluateStaffAccess({ aud: 'staff' }).ok).toBe(false);
    expect(evaluateStaffAccess({ role: '', aud: 'staff' }).ok).toBe(false);
    expect(evaluateStaffAccess(null).ok).toBe(false);
    expect(evaluateStaffAccess(undefined).ok).toBe(false);
  });

  it('TRANSITIONAL: a legacy staff token with no aud is still allowed', () => {
    expect(evaluateStaffAccess({ role: 'admin' }).ok).toBe(true);
    expect(evaluateStaffAccess({ role: 'cashier' }).ok).toBe(true);
  });

  it('TRANSITIONAL: a legacy client token with no aud is still blocked via role allowlist', () => {
    const r = evaluateStaffAccess({ role: 'client' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-staff-role');
  });
});

describe('authz.evaluateClientAccess', () => {
  it('allows a proper client token (aud:client + role:client)', () => {
    expect(evaluateClientAccess({ role: 'client', aud: 'client' }).ok).toBe(true);
  });

  it('rejects a missing aud (strict — no legacy fallback)', () => {
    expect(evaluateClientAccess({ role: 'client' }).ok).toBe(false);
  });

  it('rejects a staff token on client routes', () => {
    expect(evaluateClientAccess({ role: 'admin', aud: 'staff' }).ok).toBe(false);
    expect(evaluateClientAccess({ role: 'superadmin', aud: 'staff' }).ok).toBe(false);
  });

  it('rejects aud:client without role:client', () => {
    expect(evaluateClientAccess({ role: 'admin', aud: 'client' }).ok).toBe(false);
  });
});

describe('authz.requireStaff middleware', () => {
  const mkRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  };

  it('calls next() for a staff user', () => {
    const next = vi.fn();
    const res = mkRes();
    requireStaff({ user: { role: 'admin', aud: 'staff' } }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 for a client user (no next)', () => {
    const next = vi.fn();
    const res = mkRes();
    requireStaff({ user: { role: 'client', aud: 'client' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when req.user is absent (fail-closed)', () => {
    const next = vi.fn();
    const res = mkRes();
    requireStaff({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
