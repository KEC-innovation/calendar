import { SortableTable } from '../../../components/SortableTable';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../../../lib/api';
import { toKathmanduUtcIso } from '../../../lib/bookingRules';
import { Modal } from '../../../components/Modal';
import { StatusBadge } from '../../../components/StatusBadge';
import { can, LoadError, LoadingBlock, localDateTimeValue, nepalDateTime, PageHeader, pretty, relation, statusTone, useAdminData, type AdminProps } from '../adminShared';

interface EquipmentRelation { display_name: string }
interface BookingRow {
  id: string; booking_reference: string; status: string; starts_at: string; ends_at: string;
  contact_name: string; contact_email: string; purpose?: string | null; after_hours_override?: boolean;
  late_cancellation?: boolean; calendar_sync_status?: string; equipment?: EquipmentRelation | EquipmentRelation[] | null;
}
interface Data {
  rows: BookingRow[]; total: number;
  people: Array<{ id: string; full_name: string; email: string }>;
  equipment: Array<{ id: string; display_name: string; status: string; booking_enabled: boolean }>;
}

function toUtc(value: string): string {
  const [date = '', time = ''] = value.split('T');
  return toKathmanduUtcIso(date, time);
}

export function BookingsPanel({ session, notify }: AdminProps) {
  const [search, setSearch] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState('');
  const resource = useAdminData<Data>(session, 'bookings.list', { search: query, status });
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ personId: '', equipmentId: '', startsAt: localDateTimeValue(2), endsAt: localDateTimeValue(3), purpose: '', afterHoursOverride: false, overrideReason: '' });
  const [change, setChange] = useState<{ row: BookingRow; status: string; reason: string } | null>(null);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    try { await api.admin(session, 'bookings.create', { ...draft, startsAt: toUtc(draft.startsAt), endsAt: toUtc(draft.endsAt) }); notify({ type: 'success', text: 'Staff booking created.' }); setCreateOpen(false); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Booking could not be created.' }); }
  }
  async function update(event: React.FormEvent) {
    event.preventDefault(); if (!change) return;
    try { await api.admin(session, 'bookings.status', { bookingId: change.row.id, status: change.status, reason: change.reason }); notify({ type: 'success', text: 'Booking status updated.' }); setChange(null); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Status could not be updated.' }); }
  }
  return <>
    <PageHeader eyebrow="Reservations" title="Bookings" description="Operational schedule, staff-created reservations, overrides, and lifecycle status." action={can(session, 'admin') ? <button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create booking</button> : undefined} />
    <div className="toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}><Search size={17} /><input aria-label="Search bookings" placeholder="Reference, name, or email" value={search} onChange={(event) => setSearch(event.target.value)} /><button>Search</button></form><label className="field compact-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option>{['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'].map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label></div>
    {resource.loading && !resource.data ? <LoadingBlock label="Loading bookings" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Bookings are unavailable.'} retry={resource.reload} /> : <section className="panel panel--flush"><p className="table-sort-note">Click a heading to sort the loaded rows.</p><div className="table-scroll"><SortableTable className="data-table"><thead><tr><th>Reference</th><th>Resource</th><th>Booked for</th><th>Time</th><th>Status</th><th>Calendar</th><th></th></tr></thead><tbody>{resource.data.rows.map((row) => <tr key={row.id}><td><strong>{row.booking_reference}</strong>{row.after_hours_override && <small>After-hours override</small>}</td><td>{relation(row.equipment)?.display_name}</td><td><strong>{row.contact_name}</strong><small>{row.contact_email}</small></td><td data-sort={row.starts_at}>{nepalDateTime(row.starts_at)}<small>to {new Intl.DateTimeFormat('en-NP', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' }).format(new Date(row.ends_at))}</small></td><td><StatusBadge tone={statusTone(row.status)}>{pretty(row.status)}</StatusBadge>{row.late_cancellation && <small>Late cancellation</small>}</td><td><StatusBadge tone={statusTone(row.calendar_sync_status || 'not_configured')}>{pretty(row.calendar_sync_status || 'not_configured')}</StatusBadge></td><td>{can(session, 'admin') && <button className="table-action" onClick={() => setChange({ row, status: row.status, reason: '' })}>Update</button>}</td></tr>)}</tbody></SortableTable></div><footer className="panel-footer">{resource.data.total} bookings</footer></section>}
    <Modal title="Create staff booking" open={createOpen} onClose={() => setCreateOpen(false)}>{resource.data && <form onSubmit={(event) => void create(event)}><div className="form-grid"><label className="field field--full"><span>Person</span><select required value={draft.personId} onChange={(event) => setDraft({ ...draft, personId: event.target.value })}><option value="">Choose a person</option>{resource.data.people.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.email}</option>)}</select></label><label className="field field--full"><span>Equipment</span><select required value={draft.equipmentId} onChange={(event) => setDraft({ ...draft, equipmentId: event.target.value })}><option value="">Choose equipment</option>{resource.data.equipment.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><label className="field"><span>Starts (Nepal time)</span><input required type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label><label className="field"><span>Ends (Nepal time)</span><input required type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label><label className="field field--full"><span>Purpose</span><textarea value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label><label className="check-line field--full"><input type="checkbox" checked={draft.afterHoursOverride} onChange={(event) => setDraft({ ...draft, afterHoursOverride: event.target.checked })} /> Authorize after-hours booking</label>{draft.afterHoursOverride && <label className="field field--full"><span>Override reason</span><textarea required value={draft.overrideReason} onChange={(event) => setDraft({ ...draft, overrideReason: event.target.value })} /></label>}</div><div className="button-row"><button type="button" className="button button--secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="button button--primary">Create booking</button></div></form>}</Modal>
    <Modal title={`Update ${change?.row.booking_reference || 'booking'}`} open={Boolean(change)} onClose={() => setChange(null)}>{change && <form onSubmit={(event) => void update(event)}><div className="form-grid"><label className="field field--full"><span>Status</span><select value={change.status} onChange={(event) => setChange({ ...change, status: event.target.value })}>{['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'].map((value) => <option value={value} key={value}>{pretty(value)}</option>)}</select></label><label className="field field--full"><span>Reason / note</span><textarea value={change.reason} onChange={(event) => setChange({ ...change, reason: event.target.value })} /></label></div><div className="button-row"><button type="button" className="button button--secondary" onClick={() => setChange(null)}>Cancel</button><button className="button button--primary">Update status</button></div></form>}</Modal>
  </>;
}
