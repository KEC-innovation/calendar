import type { AvailabilityResult } from '../types/domain';

export interface CachedAvailability { data: AvailabilityResult; checkedAt: Date; revision: number; }
// Lives only in the current student screen. Never persists identities or booking data.
export class AvailabilityCache {
  private readonly entries = new Map<string, CachedAvailability>();
  get(equipmentId: string, date: string, revision: number, now = Date.now()): CachedAvailability | null {
    const entry = this.entries.get(`${equipmentId}:${date}`);
    if (!entry || entry.revision !== revision || now - entry.checkedAt.getTime() >= 10_000 || now < entry.checkedAt.getTime()) return null;
    return entry;
  }
  forget(equipmentId: string, date: string): void { this.entries.delete(`${equipmentId}:${date}`); }
  set(data: AvailabilityResult, revision: number, checkedAt = new Date()): void {
    const key = `${data.equipmentId}:${data.date}`;
    this.entries.delete(key);
    this.entries.set(key, { data, revision, checkedAt });
    if (this.entries.size > 24) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
  }
}
