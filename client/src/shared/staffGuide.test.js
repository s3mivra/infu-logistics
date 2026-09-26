import { describe, it, expect } from 'vitest';
import { staffGuide, showsGuide } from './staffGuide.js';

const allow = (...perms) => (p) => perms.includes(p);
const ids = (g) => g.map(s => s.id);
const text = (g) => g.flatMap(s => s.steps).join('\n');

describe('who gets the quick guide', () => {
  it('is for everyone but the owner', () => {
    expect(showsGuide({ role: 'staff' })).toBe(true);
    expect(showsGuide({ role: 'admin' })).toBe(true);
    expect(showsGuide({ role: 'Head Barista' })).toBe(true);
    expect(showsGuide({ role: 'superadmin' })).toBe(false);
    expect(showsGuide(null)).toBe(false);
  });
});

describe('what it covers', () => {
  it('shows a cashier the till, and nothing they cannot open', () => {
    const g = staffGuide({ role: 'staff', businessType: 'fb', can: allow('pos.use') });
    expect(ids(g)).toEqual(['shift', 'order', 'pay', 'fulfil', 'mistakes', 'find']);
    expect(text(g)).toMatch(/Pay & send to Kitchen/);
    expect(text(g)).toMatch(/needs a manager/);
    expect(text(g)).not.toMatch(/Not paid yet/);
  });

  it('follows the business - logistics gets its own steps', () => {
    const g = staffGuide({ role: 'staff', businessType: 'log', can: allow('pos.use') });
    expect(text(g)).toMatch(/Pay & send to Logistics/);
    expect(text(g)).toMatch(/Not paid yet - send & collect later/);
    expect(text(g)).toMatch(/Partial fulfill/);
  });

  it('tells someone who may void how, and someone who may not whom to ask', () => {
    const may = text(staffGuide({ role: 'Head Barista', businessType: 'fb', can: allow('pos.use', 'orders.delete') }));
    expect(may).toMatch(/Press Void/);
    const mayNot = text(staffGuide({ role: 'staff', businessType: 'fb', can: allow('pos.use') }));
    expect(mayNot).toMatch(/ask a manager to void/);
  });

  it('adds stock and reports only with those permissions', () => {
    const g = staffGuide({ role: 'staff', businessType: 'fb', can: allow('pos.use', 'inventory.view', 'reports.view') });
    expect(ids(g)).toContain('stock');
    expect(ids(g)).toContain('reports');
    expect(text(g)).not.toMatch(/Physical Count/);          // viewing is not counting
  });

  it('gives admins and managers their own section, listing only what they approve', () => {
    const g = staffGuide({ role: 'admin', businessType: 'log', can: allow('pos.use', 'orders.delete', 'pricing.approve') });
    const lead = g.find(s => s.id === 'lead');
    expect(lead.title).toBe('For admins');
    expect(lead.steps.join('\n')).toMatch(/Reports → Price Changes/);
    expect(lead.steps.join('\n')).not.toMatch(/Approvals/);
    expect(staffGuide({ role: 'staff', businessType: 'fb', can: allow('pos.use') }).some(s => s.id === 'lead')).toBe(false);
  });
});
