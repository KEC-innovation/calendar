import { describe, expect, it } from 'vitest';
import {
  bookableResources, dayHours, formatClock, intervalsOverlap, minutesBetween,
  toKathmanduUtcIso, validateBookingRange,
} from '../src/lib/bookingRules';
import type { EquipmentResource, WeeklyHours } from '../src/types/domain';

describe('Nepal-time conversion', () => {
  it('converts the fixed +05:45 offset to UTC without browser timezone dependence', () => {
    expect(toKathmanduUtcIso('2026-09-07', '10:00')).toBe('2026-09-07T04:15:00.000Z');
  });

  it('rejects malformed date and time values', () => {
    expect(() => toKathmanduUtcIso('07/09/2026', '10:00')).toThrow('valid date and time');
    expect(() => toKathmanduUtcIso('2026-09-07', 'ten')).toThrow('valid date and time');
  });
});

describe('booking range invariants', () => {
  it('allows exactly six hours and rejects a minute more', () => {
    const start = '2026-09-07T04:15:00.000Z';
    expect(validateBookingRange(start, '2026-09-07T10:15:00.000Z')).toEqual([]);
    expect(validateBookingRange(start, '2026-09-07T10:16:00.000Z')).toContain('A booking cannot be longer than 6 hours.');
    expect(minutesBetween(start, '2026-09-07T10:15:00.000Z')).toBe(360);
  });

  it('rejects reversed and zero-length ranges', () => {
    expect(validateBookingRange('2026-09-07T10:00:00Z', '2026-09-07T10:00:00Z')).toContain('End time must be later than start time.');
    expect(validateBookingRange('2026-09-07T11:00:00Z', '2026-09-07T10:00:00Z')).toContain('End time must be later than start time.');
  });

  it('uses half-open overlap semantics so adjacent bookings do not collide', () => {
    const first = { startsAt: '2026-09-07T10:00:00Z', endsAt: '2026-09-07T11:00:00Z' };
    expect(intervalsOverlap(first, { startsAt: '2026-09-07T10:30:00Z', endsAt: '2026-09-07T11:30:00Z' })).toBe(true);
    expect(intervalsOverlap(first, { startsAt: '2026-09-07T11:00:00Z', endsAt: '2026-09-07T12:00:00Z' })).toBe(false);
  });
});

describe('public equipment and hours', () => {
  const base: EquipmentResource = { id: '1', slug: 'laser', displayName: 'Laser', categoryName: 'Laser', status: 'active', bookingEnabled: true, externalAllowed: false, maxMinutes: 360, requiresCertification: true, eligible: true, blockers: [] };
  it('never exposes tables as bookable resources', () => {
    expect(bookableResources([base, { ...base, id: '2', slug: 'table-1', displayName: 'Table 1' }, { ...base, id: '3', slug: 'offline', status: 'out_of_service' }]).map((item) => item.id)).toEqual(['1']);
  });

  it('maps Sunday to ISO day 7 in Nepal time', () => {
    const hours: WeeklyHours[] = [{ isoDay: 7, dayName: 'Sunday', openTime: '09:00:00', closeTime: '17:00:00', bookable: true }];
    expect(dayHours(hours, '2026-09-06')?.dayName).toBe('Sunday');
    expect(formatClock('19:00:00')).toBe('7:00 PM');
  });
});
