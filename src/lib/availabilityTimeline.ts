import type { AvailabilityResult } from '../types/domain';

export interface AvailabilityBlock {
  startsAt: string;
  endsAt: string;
  status: 'free' | 'reserved' | 'closed' | 'past';
  reason?: string;
}

export function nepalInputValue(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function calendarWeek(date: string): string[] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return Array.from({ length: 7 }, (_, index) => shiftDate(date, index + 1 - weekday));
}

export function buildDayTimeline(data: AvailabilityResult, now = new Date()): AvailabilityBlock[] {
  const hours = data.openingHours;
  if (!hours?.bookable || data.closureReason) return [];
  const start = new Date(`${data.date}T${hours.openTime}+05:45`).getTime();
  const end = new Date(`${data.date}T${hours.closeTime}+05:45`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const boundaries = new Set([start, end]);
  // Split at half hours and actual reservation/closure boundaries for an accurate view.
  for (let value = start + 30 * 60_000; value < end; value += 30 * 60_000) boundaries.add(value);
  for (const interval of [...data.busy, ...(data.closures || [])]) {
    for (const value of [interval.startsAt, interval.endsAt]) {
      const timestamp = new Date(value).getTime();
      if (timestamp > start && timestamp < end) boundaries.add(timestamp);
    }
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const blocks: AvailabilityBlock[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index]; const to = sorted[index + 1];
    if (from === undefined || to === undefined) continue;
    const overlaps = (interval: { startsAt: string; endsAt: string }) => from < new Date(interval.endsAt).getTime() && to > new Date(interval.startsAt).getTime();
    const closure = data.closures?.find(overlaps);
    const reserved = data.busy.some(overlaps);
    const status = closure ? 'closed' : reserved ? 'reserved' : from <= now.getTime() ? 'past' : 'free';
    blocks.push({ startsAt: new Date(from).toISOString(), endsAt: new Date(to).toISOString(), status, reason: closure?.reason });
  }
  return blocks;
}

export function selectedRangeIssue(data: AvailabilityResult, start: string, end: string, maxMinutes: number, now = new Date()): string | null {
  if (!start || !end) return 'Choose a start and end time.';
  const from = new Date(`${start}+05:45`).getTime();
  const to = new Date(`${end}+05:45`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 'End time must be later than start time.';
  if (start.slice(0, 10) !== data.date || end.slice(0, 10) !== data.date) return 'Choose times on the same date.';
  if (from <= now.getTime()) return 'Choose a future start time.';
  if (to - from > maxMinutes * 60_000) return `This equipment allows up to ${maxMinutes / 60} ${maxMinutes === 60 ? 'hour' : 'hours'} per booking.`;
  if (data.closureReason) return `Closed: ${data.closureReason}`;
  if (!data.openingHours?.bookable) return 'This date is not open for booking.';
  const open = new Date(`${data.date}T${data.openingHours.openTime}+05:45`).getTime();
  const close = new Date(`${data.date}T${data.openingHours.closeTime}+05:45`).getTime();
  if (from < open || to > close) return 'Choose a time within the opening hours shown.';
  const overlaps = (interval: { startsAt: string; endsAt: string }) => from < new Date(interval.endsAt).getTime() && to > new Date(interval.startsAt).getTime();
  const closure = data.closures?.find(overlaps);
  if (closure) return `Closed during this time: ${closure.reason}`;
  if (data.busy.some(overlaps)) return 'This time overlaps a reservation. Choose a free block or adjust your times.';
  return null;
}
