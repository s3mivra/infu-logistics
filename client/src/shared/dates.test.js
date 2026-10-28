import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from './dates.js';

describe('dates', () => {
  it('a short, fixed date', () => {
    expect(formatDate('2026-10-28T10:00:00')).toBe('28 Oct 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('nope')).toBe('');
  });
  it('today and yesterday by name', () => {
    const now = new Date(2026, 9, 28, 16, 0);
    expect(formatDateTime(new Date(2026, 9, 28, 14, 15), now)).toBe('Today 2:15 PM');
    expect(formatDateTime(new Date(2026, 9, 27, 9, 2), now)).toBe('Yesterday 9:02 AM');
    expect(formatDateTime(new Date(2026, 9, 1, 9, 2), now)).toBe('1 Oct 2026, 9:02 AM');
  });
});
