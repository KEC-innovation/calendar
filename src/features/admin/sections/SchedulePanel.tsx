import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { EmptyState } from '../../../components/EmptyState';
import { Modal } from '../../../components/Modal';
import { can, LoadError, LoadingBlock, PageHeader, useAdminData, type AdminProps } from '../adminShared';

interface HoursRow { iso_day: number; day_name: string; open_time: string; close_time: string; bookable: boolean }
interface ClosureRow { id: string; closure_date: string; starts_at?: string | null; ends_at?: string | null; reason: string }
interface Data { hours: HoursRow[]; closures: ClosureRow[] }

export function SchedulePanel({ session, notify }: AdminProps) {
  const resource = useAdminData<Data>(session, 'schedule.get');
  const [hours, setHours] = useState<HoursRow[]>([]);
  const [closureOpen, setClosureOpen] = useState(false);
  const [closure, setClosure] = useState({ date: '', startsAt: '', endsAt: '', reason: '', active: true });
  useEffect(() => { if (resource.data) setHours(resource.data.hours); }, [resource.data]);
  async function saveHours() {
    try { await api.admin(session, 'schedule.hours-save', { hours: hours.map((row) => ({ isoDay: row.iso_day, dayName: row.day_name, openTime: row.open_time, closeTime: row.close_time, bookable: row.bookable })) }); notify({ type: 'success', text: 'Weekly hours saved.' }); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Hours could not be saved.' }); }
  }
  async function saveClosure(event: React.FormEvent) {
    event.preventDefault();
    try { await api.admin(session, 'schedule.closure-save', { closure }); notify({ type: 'success', text: 'Closure added.' }); setClosureOpen(false); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Closure could not be saved.' }); }
  }
  async function removeClosure(id: string) {
    try { await api.admin(session, 'schedule.closure-delete', { closureId: id }); notify({ type: 'success', text: 'Closure deactivated.' }); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Closure could not be removed.' }); }
  }
  return <>
    <PageHeader eyebrow="Availability policy" title="Hours & closures" description="Weekly Nepal-time opening hours and full-day or partial closures." action={can(session, 'admin') ? <button className="button button--primary" onClick={() => setClosureOpen(true)}><Plus size={16} /> Add closure</button> : undefined} />
    {resource.loading ? <LoadingBlock label="Loading schedule" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Schedule is unavailable.'} retry={resource.reload} /> : <div className="admin-two-column admin-two-column--schedule"><section className="panel"><div className="panel-heading"><div><h2>Weekly hours</h2><p>Bookings must start and end within these times</p></div></div><div className="hours-list">{hours.map((row, index) => <article key={row.iso_day}><strong>{row.day_name}</strong><label className="check-line"><input type="checkbox" disabled={!can(session, 'admin')} checked={row.bookable} onChange={(event) => setHours(hours.map((item, itemIndex) => itemIndex === index ? { ...item, bookable: event.target.checked } : item))} /> Open</label><input aria-label={`${row.day_name} opening time`} type="time" disabled={!can(session, 'admin') || !row.bookable} value={row.open_time.slice(0, 5)} onChange={(event) => setHours(hours.map((item, itemIndex) => itemIndex === index ? { ...item, open_time: event.target.value } : item))} /><span>to</span><input aria-label={`${row.day_name} closing time`} type="time" disabled={!can(session, 'admin') || !row.bookable} value={row.close_time.slice(0, 5)} onChange={(event) => setHours(hours.map((item, itemIndex) => itemIndex === index ? { ...item, close_time: event.target.value } : item))} /></article>)}</div>{can(session, 'admin') && <button className="button button--primary button--wide" onClick={() => void saveHours()}>Save weekly hours</button>}</section><section className="panel"><div className="panel-heading"><div><h2>Upcoming closures</h2><p>Holidays, maintenance, and special events</p></div></div>{resource.data.closures.length ? <div className="closure-list">{resource.data.closures.map((item) => <article key={item.id}><div><strong>{new Intl.DateTimeFormat('en-NP', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${item.closure_date}T12:00:00Z`))}</strong><span>{item.reason}{item.starts_at ? ` · ${item.starts_at.slice(0, 5)}–${item.ends_at?.slice(0, 5)}` : ' · Full day'}</span></div>{can(session, 'admin') && <button className="icon-button" aria-label={`Remove ${item.reason}`} onClick={() => void removeClosure(item.id)}><X size={16} /></button>}</article>)}</div> : <EmptyState title="No upcoming closures" detail="Standard weekly hours apply." />}</section></div>}
    <Modal title="Add closure" open={closureOpen} onClose={() => setClosureOpen(false)}><form onSubmit={(event) => void saveClosure(event)}><div className="form-grid"><label className="field field--full"><span>Date</span><input required type="date" value={closure.date} onChange={(event) => setClosure({ ...closure, date: event.target.value })} /></label><label className="field"><span>Starts <small>(blank for full day)</small></span><input type="time" value={closure.startsAt} onChange={(event) => setClosure({ ...closure, startsAt: event.target.value })} /></label><label className="field"><span>Ends</span><input type="time" required={Boolean(closure.startsAt)} value={closure.endsAt} onChange={(event) => setClosure({ ...closure, endsAt: event.target.value })} /></label><label className="field field--full"><span>Reason</span><textarea required value={closure.reason} onChange={(event) => setClosure({ ...closure, reason: event.target.value })} /></label></div><div className="button-row"><button type="button" className="button button--secondary" onClick={() => setClosureOpen(false)}>Cancel</button><button className="button button--primary">Add closure</button></div></form></Modal>
  </>;
}
