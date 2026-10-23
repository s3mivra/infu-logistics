import { describe, it, expect } from 'vitest';
import { groupNotifications } from './NotificationBell.jsx';

const n = (id, kind, severity = 'warn') => ({ id, kind, severity, title: id });

describe('notification groups', () => {
  it('splits the feed by area, in a fixed order, keeping each group\'s item order', () => {
    const groups = groupNotifications([
      n('a', 'ar_overdue', 'critical'), n('b', 'low_stock'), n('c', 'expired', 'critical'),
      n('d', 'below_zero', 'critical'), n('e', 'expiring'), n('f', 'po_overdue'),
    ]);
    expect(groups.map(g => g.key)).toEqual(['stock', 'expiry', 'ar', 'purchase']);
    expect(groups[0].items.map(i => i.id)).toEqual(['b', 'd']);
    expect(groups.map(g => g.critical)).toEqual([1, 1, 1, 0]);
  });

  it('puts a kind it does not know under Other instead of dropping it', () => {
    const groups = groupNotifications([n('x', 'something_new')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'other', label: 'Other' });
  });

  it('shows no empty groups', () => {
    expect(groupNotifications([])).toEqual([]);
  });
});
