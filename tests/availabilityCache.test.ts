import { describe, expect, it } from 'vitest';
import { AvailabilityCache } from '../src/lib/availabilityCache';
import type { AvailabilityResult } from '../src/types/domain';
const data: AvailabilityResult = { equipmentId: 'printer-1', date: '2030-01-07', timezone: 'Asia/Kathmandu', busy: [] };
const checked = new Date('2026-10-06T07:00:00Z');
describe('short-lived availability reuse', () => {
  it('reuses a checked result briefly and expires it after ten seconds', () => {
    const cache = new AvailabilityCache(); cache.set(data, 0, checked);
    expect(cache.get(data.equipmentId, data.date, 0, checked.getTime() + 9999)?.data).toBe(data);
    expect(cache.get(data.equipmentId, data.date, 0, checked.getTime() + 10_000)).toBeNull();
  });
  it('keeps different machines and dates separate', () => {
    const cache = new AvailabilityCache(); cache.set(data, 0, checked);
    expect(cache.get('printer-2', data.date, 0, checked.getTime())).toBeNull();
    expect(cache.get(data.equipmentId, '2030-01-08', 0, checked.getTime())).toBeNull();
  });
  it('never reuses a result from before a booking or cancellation revision', () => {
    const cache = new AvailabilityCache(); cache.set(data, 0, checked);
    expect(cache.get(data.equipmentId, data.date, 1, checked.getTime())).toBeNull();
    cache.set({ ...data, busy: [{ startsAt: '2030-01-07T09:00:00+05:45', endsAt: '2030-01-07T10:00:00+05:45' }] }, 1, checked);
    expect(cache.get(data.equipmentId, data.date, 1, checked.getTime())?.data.busy).toHaveLength(1);
  });
  it('discards the old result when a refresh fails', () => {
    const cache = new AvailabilityCache(); cache.set(data, 0, checked); cache.forget(data.equipmentId, data.date);
    expect(cache.get(data.equipmentId, data.date, 0, checked.getTime())).toBeNull();
  });
  it('bounds memory as a student explores dates and replaces prior results', () => {
    const cache = new AvailabilityCache();
    for (let index = 1; index <= 25; index++) cache.set({ ...data, date: `2030-01-${String(index).padStart(2, '0')}` }, 0, checked);
    expect(cache.get(data.equipmentId, '2030-01-01', 0, checked.getTime())).toBeNull();
    expect(cache.get(data.equipmentId, '2030-01-25', 0, checked.getTime())).not.toBeNull();
    cache.set({ ...data, date: '2030-01-25', busy: [{ startsAt: '2030-01-25T09:00:00Z', endsAt: '2030-01-25T10:00:00Z' }] }, 0, checked);
    expect(cache.get(data.equipmentId, '2030-01-25', 0, checked.getTime())?.data.busy).toHaveLength(1);
  });
});
