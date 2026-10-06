import { describe, expect, it } from 'vitest';
import { buildDayTimeline, calendarWeek, nepalInputValue, selectedRangeIssue, shiftDate } from '../src/lib/availabilityTimeline';
import type { AvailabilityResult } from '../src/types/domain';
const date = '2030-01-07';
const now = new Date('2026-10-06T00:00:00Z');
const time = (clock: string) => new Date(`${date}T${clock}+05:45`).toISOString();
const data: AvailabilityResult = { equipmentId: 'test', date, timezone: 'Asia/Kathmandu', busy: [], openingHours: { openTime: '09:00:00', closeTime: '12:00:00', bookable: true }, closures: [] };
const check = (result: AvailabilityResult, start = `${date}T09:00`, end = `${date}T10:00`, maximum = 360) => selectedRangeIssue(result, start, end, maximum, now);
describe('selected equipment availability', () => {
  it('shows half-hour free blocks within configured opening hours', () => {
    const blocks = buildDayTimeline(data, now);
    expect(blocks).toHaveLength(6);
    expect(blocks.every(block => block.status === 'free')).toBe(true);
    expect(blocks[0]?.startsAt).toBe(time('09:00'));
    expect(blocks.at(-1)?.endsAt).toBe(time('12:00'));
  });
  it('marks occupied times and keeps touching boundaries free', () => {
    const busy = { ...data, busy: [{ startsAt: time('10:00'), endsAt: time('11:00') }] };
    expect(buildDayTimeline(busy, now).map(block => block.status)).toEqual(['free', 'free', 'reserved', 'reserved', 'free', 'free']);
    expect(check(busy)).toBeNull();
    expect(check(busy, `${date}T09:30`, `${date}T10:30`)).toMatch(/reservation/);
  });
  it('splits at actual non-aligned reservation boundaries', () => {
    const blocks = buildDayTimeline({ ...data, busy: [{ startsAt: time('09:15'), endsAt: time('09:45') }] }, now);
    expect(blocks[0]).toMatchObject({ startsAt: time('09:00'), endsAt: time('09:15'), status: 'free' });
    expect(blocks[1]?.status).toBe('reserved');
    expect(blocks[3]).toMatchObject({ startsAt: time('09:45'), status: 'free' });
  });
  it('clips reservations crossing the day or opening boundaries', () => {
    const blocks = buildDayTimeline({ ...data, busy: [{ startsAt: '2030-01-06T20:00:00+05:45', endsAt: time('09:30') }] }, now);
    expect(blocks[0]?.status).toBe('reserved');
    expect(blocks[1]?.status).toBe('free');
  });
  it('reflects partial closures with their reason', () => {
    const closed = { ...data, closures: [{ startsAt: time('09:30'), endsAt: time('10:30'), reason: 'Maintenance' }] };
    expect(buildDayTimeline(closed, now)[1]).toMatchObject({ status: 'closed', reason: 'Maintenance' });
    expect(check(closed)).toMatch(/Maintenance/);
  });
  it.each([{ ...data, closureReason: 'Holiday' }, { ...data, openingHours: { ...data.openingHours!, bookable: false } }, { ...data, openingHours: undefined }])('never offers free slots for closed or unknown hours', result => {
    expect(buildDayTimeline(result, now)).toEqual([]);
    expect(check(result)).not.toBeNull();
  });
  it('marks a block that has started as unavailable to click', () => {
    const blocks = buildDayTimeline(data, new Date(`${date}T09:10:00+05:45`));
    expect(blocks[0]?.status).toBe('past');
    expect(blocks[1]?.status).toBe('free');
  });
  it('checks equipment duration, opening hours and same-day rule', () => {
    expect(check(data, `${date}T09:00`, `${date}T11:00`, 60)).toMatch(/up to 1 hour/);
    expect(check(data, `${date}T08:00`, `${date}T09:00`)).toMatch(/opening hours/);
    expect(check(data, `${date}T11:00`, '2030-01-08T00:00')).toMatch(/same date/);
  });
  it('handles cleared and reversed input without throwing', () => {
    expect(check(data, '', '')).toMatch(/Choose/);
    expect(check(data, `${date}T10:00`, `${date}T09:00`)).toMatch(/later/);
  });
  it('uses Nepal local time for slot-to-form conversion', () => {
    expect(nepalInputValue('2030-01-07T04:15:00Z')).toBe('2030-01-07T10:00');
    expect(nepalInputValue('2030-01-06T20:00:00Z').slice(0, 10)).toBe(date);
  });
  it('navigates Monday-start calendar weeks across month and year boundaries', () => {
    expect(calendarWeek(date)[0]).toBe(date);
    expect(calendarWeek(date).at(-1)).toBe('2030-01-13');
    expect(shiftDate('2029-12-31', 1)).toBe('2030-01-01');
    expect(shiftDate('2030-01-01', -1)).toBe('2029-12-31');
  });
});
