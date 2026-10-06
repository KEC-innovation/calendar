import { Award, CalendarDays, Cpu, RefreshCw, Wrench } from 'lucide-react';
import { api } from '../../../lib/api';
import { EmptyState } from '../../../components/EmptyState';
import { StatusBadge } from '../../../components/StatusBadge';
import { can, LoadError, LoadingBlock, nepalDateTime, PageHeader, pretty, relation, statusTone, useAdminData, type AdminProps } from '../adminShared';

interface EquipmentRelation { display_name: string }
interface BookingRow { id: string; booking_reference: string; status: string; starts_at: string; contact_name: string; last_calendar_sync_error?: string | null; equipment?: EquipmentRelation | EquipmentRelation[] | null }
interface PersonRelation { full_name: string }
interface DashboardData {
  today: BookingRow[]; todayCount: number; upcoming: BookingRow[];
  equipment: { active: number; outOfService: number; inactive: number };
  recentCertifications: Array<{ id: string }>;
  failedAttempts: Array<{ id: string; attempt_reference: string; score: number; max_score: number; people?: PersonRelation | PersonRelation[]; quizzes?: { display_name: string } | Array<{ display_name: string }> }>;
  calendarFailures: BookingRow[];
}

export function DashboardPanel({ session, notify }: AdminProps) {
  const resource = useAdminData<DashboardData>(session, 'dashboard');
  async function retry(bookingId: string) {
    try { await api.admin(session, 'calendar.retry', { bookingId }); notify({ type: 'success', text: 'Calendar sync queued for retry.' }); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Retry failed.' }); }
  }
  if (resource.loading) return <LoadingBlock />;
  if (resource.error || !resource.data) return <LoadError message={resource.error || 'Dashboard data is unavailable.'} retry={resource.reload} />;
  const data = resource.data;
  return <>
    <PageHeader eyebrow="Operations overview" title={`Good day, ${session.displayName.split(' ')[0] || 'staff'}.`} description="Live bookings, equipment status, training outcomes, and integration health." action={<button className="button button--secondary" onClick={resource.reload}><RefreshCw size={16} /> Refresh</button>} />
    <section className="metric-grid" aria-label="Daily metrics">
      <article className="metric-card"><span><CalendarDays size={18} /></span><div><small>Bookings today</small><strong>{data.todayCount}</strong></div></article>
      <article className="metric-card"><span><Cpu size={18} /></span><div><small>Active resources</small><strong>{data.equipment.active}</strong></div></article>
      <article className="metric-card"><span className="metric-card__warn"><Wrench size={18} /></span><div><small>Out of service</small><strong>{data.equipment.outOfService}</strong></div></article>
      <article className="metric-card"><span><Award size={18} /></span><div><small>Recent certificates</small><strong>{data.recentCertifications.length}</strong></div></article>
    </section>
    <div className="admin-two-column"><section className="panel"><div className="panel-heading"><div><h2>Today’s schedule</h2><p>Nepal time</p></div><a className="text-link" href="#/staff/bookings">All bookings</a></div>{data.today.length ? <div className="schedule-list">{data.today.map((row) => <article key={row.id}><time>{new Intl.DateTimeFormat('en-NP', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' }).format(new Date(row.starts_at))}</time><div><strong>{relation(row.equipment)?.display_name || 'Equipment'}</strong><span>{row.contact_name} · {row.booking_reference}</span></div><StatusBadge tone={statusTone(row.status)}>{pretty(row.status)}</StatusBadge></article>)}</div> : <EmptyState title="No bookings today" detail="The schedule is clear." />}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Upcoming</h2><p>Next confirmed reservations</p></div></div>{data.upcoming.length ? <div className="compact-list">{data.upcoming.map((row) => <article key={row.id}><div><strong>{relation(row.equipment)?.display_name || 'Equipment'}</strong><span>{nepalDateTime(row.starts_at)} · {row.contact_name}</span></div><StatusBadge tone={statusTone(row.status)}>{pretty(row.status)}</StatusBadge></article>)}</div> : <EmptyState title="Nothing upcoming" detail="New reservations will appear here." />}</section></div>
    {(data.calendarFailures.length > 0 || data.failedAttempts.length > 0) && <div className="admin-two-column"><section className="panel"><div className="panel-heading"><div><h2>Calendar attention</h2><p>Bookings stay valid if sync fails</p></div></div>{data.calendarFailures.length ? <div className="compact-list">{data.calendarFailures.map((row) => <article key={row.id}><div><strong>{row.booking_reference}</strong><span>{row.last_calendar_sync_error || 'Sync failed'}</span></div>{can(session, 'admin') && <button className="button button--secondary button--small" onClick={() => void retry(row.id)}>Retry</button>}</article>)}</div> : <EmptyState title="Calendar healthy" detail="No failed sync jobs." />}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Unsuccessful quizzes</h2><p>Recent results needing follow-up</p></div></div>{data.failedAttempts.length ? <div className="compact-list">{data.failedAttempts.map((attempt) => <article key={attempt.id}><div><strong>{relation(attempt.people)?.full_name || attempt.attempt_reference}</strong><span>{relation(attempt.quizzes)?.display_name} · {attempt.score}/{attempt.max_score}</span></div><StatusBadge tone="warn">Review</StatusBadge></article>)}</div> : <EmptyState title="No recent failures" detail="Training results look good." />}</section></div>}
  </>;
}
