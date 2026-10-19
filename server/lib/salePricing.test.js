import { describe, it, expect } from 'vitest';
import { saleRunsNow, cleanSaleHours, buildSalePriceMap, businessClock } from './salePricing.js';

// Manila is UTC+8 with no daylight saving, so these instants are fixed:
// 2026-10-14 is a Wednesday.
const TZ = 'Asia/Manila';
const at = (iso) => new Date(`${iso}+08:00`);
const WED_3PM = at('2026-10-14T15:00:00');

describe('the hours a sale keeps', () => {
  it('a sale with no weekdays and no hours runs for the whole of its dates', () => {
    expect(saleRunsNow({}, WED_3PM, TZ)).toBe(true);
    expect(saleRunsNow({ daysOfWeek: [], dailyFrom: '', dailyTo: '' }, WED_3PM, TZ)).toBe(true);
  });

  it('reads the weekday and the time on the business clock, not the server one', () => {
    expect(businessClock(WED_3PM, TZ)).toEqual({ weekday: 3, minutes: 900 });
    // 23:30 UTC on Tuesday is already 07:30 Wednesday in Manila.
    expect(businessClock(new Date('2026-10-13T23:30:00Z'), TZ)).toEqual({ weekday: 3, minutes: 450 });
  });

  it('runs only on its weekdays', () => {
    expect(saleRunsNow({ daysOfWeek: [1, 2, 3, 4, 5] }, WED_3PM, TZ)).toBe(true);
    expect(saleRunsNow({ daysOfWeek: [0, 6] }, WED_3PM, TZ)).toBe(false);
  });

  it('runs only between its times - from the start, up to but not at the end', () => {
    const happy = { dailyFrom: '14:00', dailyTo: '17:00' };
    expect(saleRunsNow(happy, at('2026-10-14T13:59:00'), TZ)).toBe(false);
    expect(saleRunsNow(happy, at('2026-10-14T14:00:00'), TZ)).toBe(true);
    expect(saleRunsNow(happy, at('2026-10-14T16:59:00'), TZ)).toBe(true);
    expect(saleRunsNow(happy, at('2026-10-14T17:00:00'), TZ)).toBe(false);
  });

  it('needs both the weekday and the time when it has both', () => {
    const weekdayHappy = { daysOfWeek: [1, 2, 3, 4, 5], dailyFrom: '14:00', dailyTo: '17:00' };
    expect(saleRunsNow(weekdayHappy, WED_3PM, TZ)).toBe(true);
    expect(saleRunsNow(weekdayHappy, at('2026-10-17T15:00:00'), TZ)).toBe(false);   // Saturday
    expect(saleRunsNow(weekdayHappy, at('2026-10-14T18:00:00'), TZ)).toBe(false);
  });

  it('hours past midnight belong to the day they started on', () => {
    const lateNight = { daysOfWeek: [5], dailyFrom: '22:00', dailyTo: '02:00' };   // Friday night
    expect(saleRunsNow(lateNight, at('2026-10-16T23:00:00'), TZ)).toBe(true);        // Friday 11pm
    expect(saleRunsNow(lateNight, at('2026-10-17T01:00:00'), TZ)).toBe(true);        // Saturday 1am - still Friday's
    expect(saleRunsNow(lateNight, at('2026-10-17T02:00:00'), TZ)).toBe(false);
    expect(saleRunsNow(lateNight, at('2026-10-17T23:00:00'), TZ)).toBe(false);       // Saturday 11pm
    expect(saleRunsNow(lateNight, at('2026-10-16T01:00:00'), TZ)).toBe(false);       // Friday 1am is Thursday's
  });
});

describe('what may be saved as a sale’s hours', () => {
  it('accepts weekdays and a pair of times, and tidies them', () => {
    expect(cleanSaleHours({ daysOfWeek: [5, '1', 1, 9, 'x'], dailyFrom: '14:00', dailyTo: '17:30' })).toEqual({ daysOfWeek: [1, 5], dailyFrom: '14:00', dailyTo: '17:30' });
    // Every day ticked is the same as none ticked.
    expect(cleanSaleHours({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }).daysOfWeek).toEqual([]);
    expect(cleanSaleHours({})).toEqual({ daysOfWeek: [], dailyFrom: '', dailyTo: '' });
  });

  it('refuses half a time range, a time that is not one, and a range of nothing', () => {
    expect(cleanSaleHours({ dailyFrom: '14:00' }).error).toMatch(/both/);
    expect(cleanSaleHours({ dailyFrom: '2pm', dailyTo: '17:00' }).error).toMatch(/HH:MM/);
    expect(cleanSaleHours({ dailyFrom: '25:00', dailyTo: '26:00' }).error).toMatch(/HH:MM/);
    expect(cleanSaleHours({ dailyFrom: '14:00', dailyTo: '14:00' }).error).toMatch(/same/);
  });
});

describe('the price a product sells at', () => {
  const sale = { name: 'Happy Hour', dailyFrom: '14:00', dailyTo: '17:00', rules: [{ ruleType: 'fixed_price', productId: 'p1', salePrice: 99 }, { ruleType: 'threshold', productId: 'p2', thresholdAmount: 500, discountPercent: 10 }] };

  it('is the sale price inside its hours, and the normal price outside them', () => {
    const inside = buildSalePriceMap([sale], at('2026-10-14T15:00:00'));
    expect(inside.map.p1).toMatchObject({ salePrice: 99, saleName: 'Happy Hour' });
    expect(inside.thresholdRules).toHaveLength(1);
    const outside = buildSalePriceMap([sale], at('2026-10-14T18:00:00'));
    expect(outside.map).toEqual({});
    expect(outside.thresholdRules).toEqual([]);
  });

  it('a sale with no hours is untouched by any of this', () => {
    const always = { name: 'October', rules: [{ ruleType: 'percent_off', productId: 'p1', discountPercent: 20 }] };
    expect(buildSalePriceMap([always], at('2026-10-14T03:00:00')).map.p1).toMatchObject({ salePercent: 20 });
  });
});
