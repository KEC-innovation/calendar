import type { EquipmentResource, PersonCategory, WeeklyHours } from '../types/domain';

export const KATHMANDU_TIMEZONE = 'Asia/Kathmandu' as const;
export const KATHMANDU_OFFSET = '+05:45';
export const MAX_BOOKING_MINUTES = 360;

export const CATEGORY_OPTIONS: Array<{ value: PersonCategory; label: string }> = [
  { value: 'kec_student', label: 'KEC student' },
  { value: 'kec_staff', label: 'KEC staff' },
  { value: 'other_college_student', label: 'Other college student' },
  { value: 'business_external', label: 'Business / external' },
  { value: 'member_non_kec', label: 'Non-KEC member' },
];

export function toKathmanduUtcIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Choose a valid date and time.');
  }
  const value = new Date(`${date}T${time}:00${KATHMANDU_OFFSET}`);
  if (Number.isNaN(value.getTime())) throw new Error('Choose a valid date and time.');
  return value.toISOString();
}

export function minutesBetween(startsAt: string, endsAt: string): number {
  return (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000;
}

export function validateBookingRange(startsAt: string, endsAt: string): string[] {
  const errors: string[] = [];
  const duration = minutesBetween(startsAt, endsAt);
  if (!Number.isFinite(duration) || duration <= 0) errors.push('End time must be later than start time.');
  if (duration > MAX_BOOKING_MINUTES) errors.push('A booking cannot be longer than 6 hours.');
  return errors;
}

export function intervalsOverlap(
  first: { startsAt: string; endsAt: string },
  second: { startsAt: string; endsAt: string },
): boolean {
  return new Date(first.startsAt) < new Date(second.endsAt) && new Date(first.endsAt) > new Date(second.startsAt);
}

export function bookableResources(resources: EquipmentResource[]): EquipmentResource[] {
  return resources.filter(
    (resource) =>
      resource.bookingEnabled &&
      resource.status === 'active' &&
      !resource.slug.startsWith('table-'),
  );
}

export function dayHours(hours: WeeklyHours[], date: string): WeeklyHours | undefined {
  const middayKathmandu = new Date(`${date}T12:00:00${KATHMANDU_OFFSET}`);
  const jsDay = middayKathmandu.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  return hours.find((item) => item.isoDay === isoDay);
}

export function formatKathmanduDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-NP', {
    timeZone: KATHMANDU_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatClock(value: string): string {
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const normalized = hours % 12 || 12;
  return `${normalized}:${String(minutes).padStart(2, '0')} ${suffix}`;
}
